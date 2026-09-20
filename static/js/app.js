// Список записей. Утилиты — в common.js.

let records = [];

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
    const footer = document.getElementById('tableFooter');

    tbody.innerHTML = '';
    empty.style.display = data.items.length ? 'none' : 'block';
    footer.textContent = data.items.length
        ? `Показано записей: ${data.items.length} из ${data.total}`
        : '';

    for (const item of data.items) {
        const row = document.createElement('tr');
        row.className = 'clickable-row';
        row.dataset.id = item.id;
        row.title = 'Открыть запись';
        row.innerHTML = `
            <td class="file-name-cell">
                <span class="file-name-text">${escapeHtml(item.filename)}</span>
                ${item.description
                    ? `<span class="row-hint">${escapeHtml(item.description.slice(0, 60))}${item.description.length > 60 ? '…' : ''}</span>`
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

document.addEventListener('DOMContentLoaded', () => {
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

    loadFiles();
});
