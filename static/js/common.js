// Общие утилиты обеих страниц: списка и карточки записи.

// Базовый адрес API приходит из /config.js. Пустая строка означает «тот же
// источник, что и страница»; при раздельном запуске там абсолютный адрес.
const API = `${window.API_BASE || ''}/api/files`;

// Абсолютный адрес ресурса — годится и для относительного, и для абсолютного API
function apiUrl(path = '') {
    return new URL(`${API}${path}`, window.location.origin).href;
}
const REQUEST_TIMEOUT = 30000;
const UPLOAD_TIMEOUT = 120000;

// Каждая страница задаёт свой контейнер для сообщений
let MESSAGE_BOX = 'filesMessage';

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
}

function formatDate(value) {
    const d = new Date(value);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ` +
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
    const box = document.getElementById(MESSAGE_BOX);
    if (!box) return;
    box.textContent = text;
    box.className = `notice ${kind}`;
    box.style.display = text ? 'block' : 'none';
    if (text && kind === 'success') {
        setTimeout(() => { box.style.display = 'none'; }, 4000);
    }
}
