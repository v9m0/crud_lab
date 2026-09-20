// Список записей. Утилиты — в common.js.

let records = [];

// Описание может быть длинным, а всплывающая подсказка на несколько тысяч
// символов бесполезна — обрезаем её, полный текст виден на странице записи.
const TOOLTIP_LIMIT = 300;

function tooltip(text) {
    return text.length > TOOLTIP_LIMIT ? `${text.slice(0, TOOLTIP_LIMIT)}…` : text;
}

function setLoading(active) {
    document.getElementById('loadingFiles').style.display = active ? 'block' : 'none';
    document.getElementById('filesContent').style.display = active ? 'none' : 'block';
}

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

    tbody.innerHTML = '';
    empty.style.display = data.items.length ? 'none' : 'block';
    for (const item of data.items) {
        const row = document.createElement('tr');
        row.className = 'clickable-row';
        row.dataset.id = item.id;
        row.title = 'Открыть запись';
        row.innerHTML = `
            <td class="file-name-cell">
                <span class="file-name-text">${escapeHtml(item.filename)}</span>
                ${item.description
                    ? `<span class="row-hint" title="${escapeHtml(tooltip(item.description))}">${escapeHtml(item.description)}</span>`
                    : ''}
            </td>
            <td>${item.has_content ? formatSize(item.size_bytes) : '<span class="muted">нет файла</span>'}</td>
            <td><span class="badge ${item.is_public ? 'badge-public' : 'badge-private'}">
                ${item.is_public ? 'публичная' : 'приватная'}</span></td>
            <td>${formatDate(item.created_at)}</td>
            <td class="actions-cell">
                <div class="file-actions">
                    <button class="action-btn public-btn ${item.is_public ? '' : 'private'}"
                            data-act="toggle" data-id="${item.id}"
                            title="${item.is_public ? 'Сделать приватной' : 'Сделать публичной'}">
                        <img src="/static/icons/${item.is_public ? 'lock-open.svg' : 'lock-locked.svg'}"
                             class="icon-svg" alt="Доступ"></button>
                    <button class="action-btn delete-btn" data-act="delete" data-id="${item.id}" title="Удалить">
                        <img src="/static/icons/bin.svg" class="icon-svg" alt="Удалить"></button>
                </div>
            </td>`;
        tbody.appendChild(row);
    }
}

// ---------- создание ----------

function openForm() {
    document.getElementById('fieldFilename').value = '';
    document.getElementById('fieldDescription').value = '';
    document.getElementById('fieldIsPublic').checked = false;
    document.getElementById('formError').style.display = 'none';
    document.getElementById('formModal').style.display = 'flex';
    document.getElementById('fieldFilename').focus();
}

function closeForm() {
    document.getElementById('formModal').style.display = 'none';
}

async function submitForm() {
    const payload = {
        filename: document.getElementById('fieldFilename').value.trim(),
        description: document.getElementById('fieldDescription').value.trim(),
        is_public: document.getElementById('fieldIsPublic').checked,
    };

    const button = document.getElementById('submitForm');
    button.disabled = true;
    button.textContent = 'Сохранение...';

    try {
        const response = await fetchWithTimeout(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(await readServerError(response));

        closeForm();
        await loadFiles();
        showMessage('Запись создана', 'success');
    } catch (error) {
        const box = document.getElementById('formError');
        box.textContent = error.message;
        box.style.display = 'block';
    } finally {
        button.disabled = false;
        button.textContent = 'Сохранить';
    }
}

// ---------- действия в строке ----------

// Точечное изменение одного поля — PATCH.
// Полная замена записи живёт на её странице и отправляет PUT.
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

// ---------- быстрая загрузка перетаскиванием ----------

// Новых эндпоинтов не появляется: один жест клиента складывается из двух уже
// существующих вызовов — создания записи и загрузки её содержимого.
async function createFromFile(file) {
    const created = await fetchWithTimeout(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, description: '', is_public: false }),
    });
    if (!created.ok) throw new Error(await readServerError(created));
    const record = await created.json();

    const form = new FormData();
    form.append('file', file);
    const uploaded = await fetchWithTimeout(
        `${API}/${record.id}/content`, { method: 'PUT', body: form }, UPLOAD_TIMEOUT,
    );
    // Запись уже создана: если содержимое не дошло, она останется без файла,
    // и его можно догрузить на странице записи.
    if (!uploaded.ok) throw new Error(await readServerError(uploaded));
}

function showProgress(done, total, name) {
    const box = document.getElementById('progressContainer');
    box.style.display = 'block';
    document.getElementById('progressFill').style.width = `${Math.round((done / total) * 100)}%`;
    document.getElementById('progressText').textContent =
        done < total ? `Загрузка ${done + 1} из ${total}: ${name}` : `Готово: ${total}`;
}

async function handleFiles(fileList) {
    const files = Array.from(fileList);
    if (!files.length) return;

    const failures = [];
    for (let i = 0; i < files.length; i += 1) {
        showProgress(i, files.length, files[i].name);
        try {
            await createFromFile(files[i]);
        } catch (error) {
            failures.push(`${files[i].name} — ${error.message}`);
        }
    }
    showProgress(files.length, files.length);
    setTimeout(() => { document.getElementById('progressContainer').style.display = 'none'; }, 1200);

    await loadFiles();
    if (failures.length) {
        showMessage(`Не удалось загрузить: ${failures.join('; ')}`);
    } else {
        showMessage(`Загружено файлов: ${files.length}`, 'success');
    }
}

function bindDropZone() {
    const zone = document.getElementById('dropZone');
    const input = document.getElementById('fileInput');

    ['dragenter', 'dragover'].forEach((type) => {
        zone.addEventListener(type, (event) => {
            event.preventDefault();
            zone.classList.add('drag-over');
        });
    });
    ['dragleave', 'drop'].forEach((type) => {
        zone.addEventListener(type, (event) => {
            event.preventDefault();
            zone.classList.remove('drag-over');
        });
    });

    zone.addEventListener('drop', (event) => handleFiles(event.dataTransfer.files));
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            input.click();
        }
    });
    input.addEventListener('change', (event) => {
        handleFiles(event.target.files);
        event.target.value = '';
    });

    // Файл, брошенный мимо зоны, не должен открываться в соседней вкладке
    ['dragover', 'drop'].forEach((type) => {
        window.addEventListener(type, (event) => {
            if (!zone.contains(event.target)) event.preventDefault();
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    bindDropZone();

    document.getElementById('refreshBtn').addEventListener('click', loadFiles);
    document.getElementById('createBtn').addEventListener('click', openForm);
    document.getElementById('cancelForm').addEventListener('click', closeForm);
    document.getElementById('closeFormModal').addEventListener('click', closeForm);
    document.getElementById('submitForm').addEventListener('click', submitForm);

    let searchTimer;
    document.getElementById('searchInput').addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(loadFiles, 300);
    });
    document.getElementById('publicFilter').addEventListener('change', loadFiles);

    document.getElementById('filesList').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-act]');
        if (button) {
            // кнопки в строке не должны открывать страницу записи
            event.stopPropagation();
            const record = records.find((item) => item.id === button.dataset.id);
            if (!record) return;
            if (button.dataset.act === 'toggle') togglePublic(record);
            if (button.dataset.act === 'delete') removeRecord(record);
            return;
        }

        const row = event.target.closest('tr[data-id]');
        if (row) window.location.href = `/files/${row.dataset.id}`;
    });

    window.addEventListener('click', (event) => {
        if (event.target.classList.contains('modal')) event.target.style.display = 'none';
    });
    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeForm();
    });

    loadFiles();
});
