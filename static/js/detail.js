// Страница одной записи: подробности и редактирование.

MESSAGE_BOX = 'message';

const recordId = window.location.pathname.split('/').filter(Boolean).pop();
let record = null;

function setLoading(active) {
    document.getElementById('loading').style.display = active ? 'block' : 'none';
    if (active) {
        document.getElementById('detailContent').style.display = 'none';
        document.getElementById('notFound').style.display = 'none';
    }
}

function fillForm() {
    // Форма предзаполняется текущими значениями записи
    document.getElementById('fieldFilename').value = record.filename;
    document.getElementById('fieldDescription').value = record.description;
    document.getElementById('fieldIsPublic').checked = record.is_public;
    document.getElementById('formError').style.display = 'none';
}

function render() {
    document.getElementById('recordTitle').textContent = record.filename;
    document.title = `${record.filename} — каталог файлов`;

    fillForm();

    document.getElementById('infoSize').textContent =
        record.has_content ? formatSize(record.size_bytes) : '—';
    document.getElementById('infoType').textContent = record.content_type || '—';
    document.getElementById('infoHasContent').innerHTML = record.has_content
        ? '<span class="badge badge-public">да</span>'
        : '<span class="badge badge-private">нет</span>';
    document.getElementById('infoCreated').textContent = formatDate(record.created_at);
    document.getElementById('infoUpdated').textContent = formatDate(record.updated_at);

    document.getElementById('downloadBtn').disabled = !record.has_content;
    document.getElementById('linkBtn').disabled = !record.has_content;

    document.getElementById('detailContent').style.display = 'block';
}

async function loadRecord() {
    setLoading(true);
    showMessage('');
    try {
        const response = await fetchWithTimeout(`${API}/${recordId}`);
        if (response.status === 404) {
            document.getElementById('notFound').style.display = 'block';
            document.getElementById('recordTitle').textContent = 'Запись не найдена';
            return;
        }
        if (!response.ok) throw new Error(await readServerError(response));

        record = await response.json();
        render();
    } catch (error) {
        showMessage(error.message);
        document.getElementById('recordTitle').textContent = 'Ошибка загрузки';
    } finally {
        setLoading(false);
    }
}

// Форма содержит все изменяемые поля сразу, поэтому отправляется PUT —
// полная замена записи, а не частичное изменение.
async function save() {
    const payload = {
        filename: document.getElementById('fieldFilename').value.trim(),
        description: document.getElementById('fieldDescription').value.trim(),
        is_public: document.getElementById('fieldIsPublic').checked,
    };

    const button = document.getElementById('saveBtn');
    button.disabled = true;
    button.textContent = 'Сохранение...';

    try {
        const response = await fetchWithTimeout(`${API}/${recordId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(await readServerError(response));

        record = await response.json();
        render();
        showMessage('Изменения сохранены', 'success');
    } catch (error) {
        const box = document.getElementById('formError');
        box.textContent = error.message;
        box.style.display = 'block';
    } finally {
        button.disabled = false;
        button.textContent = 'Сохранить';
    }
}

async function uploadContent(file) {
    const form = new FormData();
    form.append('file', file);
    showMessage('Загрузка файла...', 'info');

    try {
        const response = await fetchWithTimeout(
            `${API}/${recordId}/content`, { method: 'PUT', body: form }, UPLOAD_TIMEOUT,
        );
        if (!response.ok) throw new Error(await readServerError(response));
        record = await response.json();
        render();
        showMessage('Файл загружен', 'success');
    } catch (error) {
        showMessage(error.message);
    }
}

async function removeRecord() {
    if (!confirm(`Удалить запись «${record.filename}»? Действие необратимо.`)) return;

    try {
        const response = await fetchWithTimeout(`${API}/${recordId}`, { method: 'DELETE' });
        // 204 приходит с пустым телом
        if (response.status !== 204) throw new Error(await readServerError(response));
        window.location.href = '/';
    } catch (error) {
        showMessage(error.message);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const toList = () => { window.location.href = '/'; };
    document.getElementById('backBtn').addEventListener('click', toList);
    document.getElementById('backToListBtn').addEventListener('click', toList);
    document.getElementById('refreshBtn').addEventListener('click', loadRecord);

    document.getElementById('saveBtn').addEventListener('click', save);
    document.getElementById('resetBtn').addEventListener('click', () => {
        if (record) fillForm();
    });
    document.getElementById('deleteBtn').addEventListener('click', removeRecord);

    document.getElementById('downloadBtn').addEventListener('click', () => {
        window.location.href = `${API}/${recordId}/content`;
    });
    document.getElementById('linkBtn').addEventListener('click', async () => {
        await navigator.clipboard.writeText(apiUrl(`/${recordId}/content`));
        showMessage(
            record.is_public
                ? 'Ссылка скопирована'
                : 'Ссылка скопирована. Запись приватная — предупредите об этом получателя',
            'success',
        );
    });

    document.getElementById('uploadBtn').addEventListener('click', () => {
        document.getElementById('contentInput').click();
    });
    document.getElementById('contentInput').addEventListener('change', (event) => {
        const [file] = event.target.files;
        if (file) uploadContent(file);
        event.target.value = '';
    });

    loadRecord();
});
