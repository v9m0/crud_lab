// Клиент каталога файлов. Все запросы асинхронные, страница не перезагружается.

const API = '/api/files';
const REQUEST_TIMEOUT = 30000;
const UPLOAD_TIMEOUT = 120000;

let records = [];
let editingId = null;      // null — режим создания, иначе режим редактирования
let pendingContentId = null;

// ---------- утилиты ----------

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
}

function formatDate(value) {
    const d = new Date(value);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(-2)} ` +
           `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatSize(bytes) {
    if (!bytes) return '—';
    const units = ['Б', 'КБ', 'МБ', 'ГБ'];
    const i = Math.floor(Math.log(bytes) / Math.log(1000));
    return `${parseFloat((bytes / Math.pow(1000, i)).toFixed(2))} ${units[i]}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error(`Превышено время ожидания (${timeoutMs / 1000} с)`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

// Сервер всегда отвечает конвертом {"error": "...", "details": [...]}
async function readServerError(response) {
    try {
        const body = await response.json();
        const details = Array.isArray(body.details) && body.details.length
            ? `: ${body.details.join('; ')}`
            : '';
        return `${body.error || `Ошибка ${response.status}`}${details}`;
    } catch {
        return `Ошибка ${response.status}`;
    }
}

function showMessage(text, kind = 'error') {
    const box = document.getElementById('filesMessage');
    box.textContent = text;
    box.className = `files-message ${kind}`;
    box.style.display = text ? 'block' : 'none';
    if (text && kind === 'success') {
        setTimeout(() => { box.style.display = 'none'; }, 4000);
    }
}

function setLoading(active) {
    document.getElementById('loadingFiles').style.display = active ? 'block' : 'none';
    document.getElementById('filesContent').style.display = active ? 'none' : 'block';
}

// ---------- список ----------

async function loadFiles() {
    setLoading(true);
    showMessage('');

    const params = new URLSearchParams({ limit: '100', offset: '0' });
    const search = document.getElementById('searchInput').value.trim();
    const isPublic = document.getElementById('publicFilter').value;
    if (search) params.set('q', search);
    if (isPublic) params.set('is_public', isPublic);

    try {
        const response = await fetchWithTimeout(`${API}?${params}`);
        if (!response.ok) throw new Error(await readServerError(response));

        const data = await response.json();
        records = data.items;
        renderTable(data);
    } catch (error) {
        records = [];
        renderTable({ items: [], total: 0 });
        showMessage(error.message);
    } finally {
        setLoading(false);
    }
}

function renderTable(data) {
    const tbody = document.getElementById('filesList');
    const empty = document.getElementById('emptyState');
    const footer = document.getElementById('tableFooter');

    tbody.innerHTML = '';
    empty.style.display = data.items.length ? 'none' : 'block';
    footer.textContent = data.items.length ? `Показано записей: ${data.items.length} из ${data.total}` : '';

    for (const item of data.items) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="file-name-cell">
                <span class="file-name-text" title="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}</span>
            </td>
            <td>${item.description ? escapeHtml(item.description) : '<span class="muted">—</span>'}</td>
            <td>${item.has_content ? formatSize(item.size_bytes) : '<span class="muted">нет файла</span>'}</td>
            <td><span class="badge ${item.is_public ? 'badge-public' : 'badge-private'}">
                ${item.is_public ? 'публичная' : 'приватная'}</span></td>
            <td>${formatDate(item.created_at)}</td>
            <td>
                <div class="file-actions">
                    <button class="action-btn" data-act="upload" data-id="${item.id}" title="Загрузить файл">
                        <img src="/static/icons/upload.svg" class="icon-svg" alt="Загрузить"></button>
                    <button class="action-btn download-btn" data-act="download" data-id="${item.id}"
                            title="Скачать" ${item.has_content ? '' : 'disabled'}>
                        <img src="/static/icons/download.svg" class="icon-svg" alt="Скачать"></button>
                    <button class="action-btn share-btn" data-act="share" data-id="${item.id}" title="Ссылка">
                        <img src="/static/icons/link.svg" class="icon-svg" alt="Ссылка"></button>
                    <button class="action-btn public-btn ${item.is_public ? '' : 'private'}"
                            data-act="toggle" data-id="${item.id}"
                            title="${item.is_public ? 'Сделать приватной' : 'Сделать публичной'}">
                        <img src="/static/icons/${item.is_public ? 'lock-open.svg' : 'lock-locked.svg'}"
                             class="icon-svg" alt="Доступ"></button>
                    <button class="action-btn" data-act="edit" data-id="${item.id}" title="Редактировать">
                        <img src="/static/icons/edit.svg" class="icon-svg" alt="Редактировать"></button>
                    <button class="action-btn delete-btn" data-act="delete" data-id="${item.id}" title="Удалить">
                        <img src="/static/icons/bin.svg" class="icon-svg" alt="Удалить"></button>
                </div>
            </td>`;
        tbody.appendChild(row);
    }
}

// ---------- форма создания и редактирования ----------

function openForm(record = null) {
    editingId = record ? record.id : null;
    document.getElementById('formModalTitle').textContent =
        record ? 'Редактировать запись' : 'Добавить запись';
    // Форма редактирования предзаполняется текущими значениями
    document.getElementById('fieldFilename').value = record ? record.filename : '';
    document.getElementById('fieldDescription').value = record ? record.description : '';
    document.getElementById('fieldIsPublic').checked = record ? record.is_public : false;
    document.getElementById('formError').style.display = 'none';
    document.getElementById('formModal').style.display = 'flex';
    document.getElementById('fieldFilename').focus();
}

function closeForm() {
    document.getElementById('formModal').style.display = 'none';
    editingId = null;
}

async function submitForm() {
    const payload = {
        filename: document.getElementById('fieldFilename').value.trim(),
        description: document.getElementById('fieldDescription').value.trim(),
        is_public: document.getElementById('fieldIsPublic').checked,
    };

    // PUT при редактировании — форма отправляет запись целиком.
    // POST при создании.
    const [url, method] = editingId ? [`${API}/${editingId}`, 'PUT'] : [API, 'POST'];
    const button = document.getElementById('submitForm');
    button.disabled = true;
    button.textContent = 'Сохранение...';

    try {
        const response = await fetchWithTimeout(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(await readServerError(response));

        const wasEditing = editingId !== null;
        closeForm();
        await loadFiles();
        showMessage(wasEditing ? 'Запись обновлена' : 'Запись создана', 'success');
    } catch (error) {
        const box = document.getElementById('formError');
        box.textContent = error.message;
        box.style.display = 'block';
    } finally {
        button.disabled = false;
        button.textContent = 'Сохранить';
    }
}

// ---------- действия над записью ----------

// Точечное изменение одного поля — это PATCH, в отличие от формы выше
async function togglePublic(record) {
    try {
        const response = await fetchWithTimeout(`${API}/${record.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_public: !record.is_public }),
        });
        if (!response.ok) throw new Error(await readServerError(response));
        await loadFiles();
    } catch (error) {
        showMessage(error.message);
    }
}

async function removeRecord(record) {
    if (!confirm(`Удалить запись «${record.filename}»? Действие необратимо.`)) return;

    try {
        const response = await fetchWithTimeout(`${API}/${record.id}`, { method: 'DELETE' });
        // 204 приходит с пустым телом, response.json() на нём упадёт
        if (response.status !== 204) throw new Error(await readServerError(response));
        await loadFiles();
        showMessage('Запись удалена', 'success');
    } catch (error) {
        showMessage(error.message);
    }
}

async function uploadContent(recordId, file) {
    const form = new FormData();
    form.append('file', file);
    showMessage('Загрузка файла...', 'info');

    try {
        const response = await fetchWithTimeout(
            `${API}/${recordId}/content`, { method: 'PUT', body: form }, UPLOAD_TIMEOUT,
        );
        if (!response.ok) throw new Error(await readServerError(response));
        await loadFiles();
        showMessage('Файл загружен', 'success');
    } catch (error) {
        showMessage(error.message);
    }
}

function shareRecord(record) {
    const input = document.getElementById('shareLink');
    input.value = `${window.location.origin}${API}/${record.id}/content`;
    document.getElementById('shareModal').style.display = 'flex';
    if (!record.is_public) {
        showMessage('Запись приватная — ссылка будет работать только у вас', 'info');
    }
}

// ---------- привязка событий ----------

function byId(id) {
    return records.find((item) => item.id === id);
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('refreshBtn').addEventListener('click', loadFiles);
    document.getElementById('createBtn').addEventListener('click', () => openForm());
    document.getElementById('cancelForm').addEventListener('click', closeForm);
    document.getElementById('closeFormModal').addEventListener('click', closeForm);
    document.getElementById('submitForm').addEventListener('click', submitForm);

    document.getElementById('closeShareModal').addEventListener('click', () => {
        document.getElementById('shareModal').style.display = 'none';
    });
    document.getElementById('copyLinkBtn').addEventListener('click', async () => {
        await navigator.clipboard.writeText(document.getElementById('shareLink').value);
        showMessage('Ссылка скопирована', 'success');
    });

    let searchTimer;
    document.getElementById('searchInput').addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(loadFiles, 300);
    });
    document.getElementById('publicFilter').addEventListener('change', loadFiles);

    // Делегирование: кнопки строк создаются динамически
    document.getElementById('filesList').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-act]');
        if (!button) return;
        const record = byId(button.dataset.id);
        if (!record) return;

        switch (button.dataset.act) {
            case 'edit':     openForm(record); break;
            case 'delete':   removeRecord(record); break;
            case 'toggle':   togglePublic(record); break;
            case 'share':    shareRecord(record); break;
            case 'download': window.location.href = `${API}/${record.id}/content`; break;
            case 'upload':
                pendingContentId = record.id;
                document.getElementById('contentInput').click();
                break;
        }
    });

    document.getElementById('contentInput').addEventListener('change', (event) => {
        const [file] = event.target.files;
        if (file && pendingContentId) uploadContent(pendingContentId, file);
        event.target.value = '';
        pendingContentId = null;
    });

    window.addEventListener('click', (event) => {
        if (event.target.classList.contains('modal')) event.target.style.display = 'none';
    });

    loadFiles();
});
