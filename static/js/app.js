// таймауты
const TIMEOUT_CONFIG = {
    FILE_OPERATIONS: 80000,
    DEFAULT: 30000
};

// ограничения размеров файлов
const SIZE_LIMITS = {
    TOTAL_UPLOAD: 1.5 * 1000 * 1000 * 1000  // 1.5 ГБ = 1.5 × 1000 × 1000 × 1000 байт
};

// преобразования размеров
const SIZE_UNITS = {
    KB: 1000,
    MB: 1000 * 1000,
    GB: 1000 * 1000 * 1000
};

// серверные лимиты
let SERVER_LIMITS = {
    raw_size: 0,
    raw_limit: 5 * 1000 * 1000 * 1000,  // 5 ГБ лимит хранилища
    raw_size_left: 5 * 1000 * 1000 * 1000
};

const API_BASE_URL = window.location.origin;
let currentUser = null;
let selectedFiles = [];
let currentDirectory = null;
let directoryStack = [];
let currentSharingFileId = null;

// форматирование даты
function formatDate(dateString) {
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}.${month}.${year} ${hours}:${minutes}`;
}

// таймауты
function createTimeoutController(timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort();
    }, timeoutMs);

    return {
        signal: controller.signal,
        clear: () => clearTimeout(timeoutId)
    };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_CONFIG.DEFAULT) {
    const timeoutCtrl = createTimeoutController(timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: timeoutCtrl.signal
        });
        timeoutCtrl.clear();
        return response;
    } catch (error) {
        timeoutCtrl.clear();
        if (error.name === 'AbortError') {
            throw new Error(`Запрос превысил timeout ${timeoutMs}мс`);
        }
        throw error;
    }
}

// форматирование размеров
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1000; // Десятичная система
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatFileSizeForDisplay(bytes) {
    if (bytes >= SIZE_UNITS.GB) {
        return (bytes / SIZE_UNITS.GB).toFixed(2) + ' GB';
    } else if (bytes >= SIZE_UNITS.MB) {
        return (bytes / SIZE_UNITS.MB).toFixed(2) + ' MB';
    } else if (bytes >= SIZE_UNITS.KB) {
        return (bytes / SIZE_UNITS.KB).toFixed(2) + ' KB';
    }
    return bytes + ' Bytes';
}

// проверка размера
function calculateTotalSize() {
    return selectedFiles.reduce((total, file) => total + file.size, 0);
}

function checkFileSizeLimits(newFiles) {
    const issues = [];

    // проверка суммарного размера для одной загрузки
    const currentTotalSize = calculateTotalSize();
    const newFilesTotalSize = newFiles.reduce((total, file) => total + file.size, 0);
    const potentialTotalSize = currentTotalSize + newFilesTotalSize;

    if (potentialTotalSize > SIZE_LIMITS.TOTAL_UPLOAD) {
        issues.push({
            type: 'total_upload_size',
            currentSize: currentTotalSize,
            newSize: newFilesTotalSize,
            potentialSize: potentialTotalSize,
            maxSize: SIZE_LIMITS.TOTAL_UPLOAD
        });
    }

    // проверка общего лимита хранилища
    const totalUploadSize = currentTotalSize + newFilesTotalSize;
    if (SERVER_LIMITS.raw_size + totalUploadSize > SERVER_LIMITS.raw_limit) {
        const availableSpace = SERVER_LIMITS.raw_limit - SERVER_LIMITS.raw_size;
        issues.push({
            type: 'storage_limit',
            currentUsage: SERVER_LIMITS.raw_size,
            uploadSize: totalUploadSize,
            availableSpace: availableSpace,
            storageLimit: SERVER_LIMITS.raw_limit
        });
    }

    return issues;
}

function updateTotalSizeDisplay() {
    const totalSizeInfo = document.getElementById('totalSizeInfo');
    const totalSize = calculateTotalSize();

    if (selectedFiles.length === 0) {
        totalSizeInfo.style.display = 'none';
        return;
    }

    totalSizeInfo.style.display = 'block';

    let displayClass = '';
    let statusText = '';

    const sizeIssues = checkFileSizeLimits([]);

    const hasStorageLimitIssue = sizeIssues.some(issue => issue.type === 'storage_limit');
    const hasUploadLimitIssue = sizeIssues.some(issue => issue.type === 'total_upload_size');

    if (hasStorageLimitIssue) {
        displayClass = 'size-error';
        statusText = '⚠️ Превышен лимит хранилища! ';
    } else if (hasUploadLimitIssue) {
        displayClass = 'size-error';
        statusText = '⚠️ Превышен лимит загрузки! ';
    } else if (totalSize > SIZE_LIMITS.TOTAL_UPLOAD * 0.8) {
        displayClass = 'size-warning';
        statusText = '⚠️ Близко к лимиту загрузки! ';
    } else if (SERVER_LIMITS.raw_size + totalSize > SERVER_LIMITS.raw_limit * 0.9) {
        displayClass = 'size-warning';
        statusText = '⚠️ Близко к лимиту хранилища! ';
    }

    totalSizeInfo.className = `total-size-info ${displayClass}`;

    totalSizeInfo.textContent =
        `${statusText}Общий размер загрузки: ${formatFileSizeForDisplay(totalSize)} / ${formatFileSizeForDisplay(SIZE_LIMITS.TOTAL_UPLOAD)}`;
}

// статус хранилища
async function loadStorageStatus() {
    try {
        const response = await fetchWithTimeout(`/file/storage/status`, {
            method: 'GET',
            credentials: 'include'
        }, TIMEOUT_CONFIG.DEFAULT);

        if (response.ok) {
            const status = await response.json();

            SERVER_LIMITS = {
                raw_size: status.raw_size,
                raw_limit: status.raw_limit,
                raw_size_left: status.raw_size_left
            };
            updateStorageStatusDisplay(status);
            return status;
        } else {
            throw new Error('Не удалось загрузить статус хранилища');
        }
    } catch (error) {
        console.error('Ошибка при загрузке статуса хранилища:', error);
        document.getElementById('storageStatus').textContent = 'Ошибка загрузки статуса';
        document.getElementById('storageStatus').className = 'storage-status error';
        return null;
    }
}

function updateStorageStatusDisplay(status) {
    const storageStatus = document.getElementById('storageStatus');

    if (!status) {
        storageStatus.textContent = 'Ошибка загрузки статуса';
        storageStatus.className = 'storage-status error';
        return;
    }

    const usedGB = (status.raw_size / SIZE_UNITS.GB).toFixed(2);
    const totalGB = (status.raw_limit / SIZE_UNITS.GB).toFixed(1);
    const percentage = (status.raw_size / status.raw_limit) * 100;

    let statusClass = '';
    let statusIcon = '';

    if (percentage >= 90) {
        statusClass = 'error';
        statusIcon = '⚠️ ';
    } else if (percentage >= 70) {
        statusClass = 'warning';
        statusIcon = '⚠️ ';
    }

    storageStatus.className = `storage-status ${statusClass}`;
    storageStatus.textContent = `${statusIcon}${status.human_size} / ${status.human_limit}`;
    storageStatus.title = `Использовано: ${usedGB} GB из ${totalGB} GB (${percentage.toFixed(1)}%)`;
}

// обработка исключений с сервера
async function handleApiError(error, defaultMessage) {
    console.error('API Error:', error);

    if (error.message.includes('timeout') || error.name === 'AbortError') {
        return `Превышено время ожидания. Попробуйте еще раз.`;
    }

    return defaultMessage || 'Произошла ошибка. Пожалуйста, попробуйте еще раз.';
}

document.addEventListener('DOMContentLoaded', async function() {
    await checkAuthAndLoadData();
    setupDragAndDrop();
    setupClearAllButton();
    setupModalHandlers();
    setupFolderHandlers();
    setupUploadHandler();
    setupRefreshHandler();
    setupLogoutHandler();

    // статус хранилища при старте
    await loadStorageStatus();
});

function setupModalHandlers() {
    document.getElementById('createFolderBtn').addEventListener('click', showCreateFolderModal);
    document.getElementById('closeCreateFolderModal').addEventListener('click', hideCreateFolderModal);
    document.getElementById('cancelCreateFolder').addEventListener('click', hideCreateFolderModal);
    document.getElementById('confirmCreateFolder').addEventListener('click', createFolder);

    document.getElementById('closeRenameFolderModal').addEventListener('click', hideRenameFolderModal);
    document.getElementById('cancelRenameFolder').addEventListener('click', hideRenameFolderModal);
    document.getElementById('confirmRenameFolder').addEventListener('click', renameFolder);

    document.getElementById('closeShareModal').addEventListener('click', hideShareModal);
    document.getElementById('copyLinkBtn').addEventListener('click', copyShareLink);

    window.addEventListener('click', function(event) {
        const modals = ['shareModal', 'createFolderModal', 'renameFolderModal'];
        modals.forEach(modalId => {
            const modal = document.getElementById(modalId);
            if (event.target === modal) {
                modal.style.display = 'none';
            }
        });
    });
}

function setupFolderHandlers() {
    document.getElementById('backBtn').addEventListener('click', goBackDirectory);
}

function setupUploadHandler() {
    document.getElementById('uploadBtn').addEventListener('click', uploadFiles);
}

function setupRefreshHandler() {
    document.getElementById('refreshBtn').addEventListener('click', async function() {
        await loadDirectoryContents(currentDirectory);
        await loadStorageStatus();
        showFilesMessage('Содержимое обновлено', 'success');
    });
}

function setupLogoutHandler() {
    document.getElementById('logoutBtn').addEventListener('click', logout);
}

function showCreateFolderModal() {
    document.getElementById('createFolderModal').style.display = 'flex';
    document.getElementById('folderName').value = '';
    document.getElementById('folderName').focus();
}

function hideCreateFolderModal() {
    document.getElementById('createFolderModal').style.display = 'none';
}

function showRenameFolderModal(folderId, currentName) {
    document.getElementById('renameFolderModal').style.display = 'flex';
    document.getElementById('newFolderName').value = currentName;
    document.getElementById('newFolderName').setAttribute('data-folder-id', folderId);
    document.getElementById('newFolderName').focus();
}

function hideRenameFolderModal() {
    document.getElementById('renameFolderModal').style.display = 'none';
}

function hideShareModal() {
    document.getElementById('shareModal').style.display = 'none';
    currentSharingFileId = null;
}

function goBackDirectory() {
    if (directoryStack.length > 1) {
        directoryStack.pop();
        const parentDirectory = directoryStack[directoryStack.length - 1];
        currentDirectory = parentDirectory;
        loadDirectoryContents(parentDirectory);
    }
}

function setupDragAndDrop() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');

    dropZone.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            handleFileSelection(Array.from(e.target.files));
        }
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');

        if (e.dataTransfer.files.length) {
            handleFileSelection(Array.from(e.dataTransfer.files));
        }
    });
}

function handleFileSelection(files) {
    const sizeIssues = checkFileSizeLimits(files);

    if (sizeIssues.length > 0) {
        let errorMessage = 'Не удалось добавить файлы:\n\n';

        sizeIssues.forEach(issue => {
            if (issue.type === 'total_upload_size') {
                errorMessage += `• Суммарный размер загрузки (${formatFileSizeForDisplay(issue.potentialSize)}) превышает лимит одной загрузки ${formatFileSizeForDisplay(issue.maxSize)}\n`;
            } else if (issue.type === 'storage_limit') {
                errorMessage += `• Недостаточно места в хранилище. Доступно: ${formatFileSizeForDisplay(issue.availableSpace)}, нужно: ${formatFileSizeForDisplay(issue.uploadSize)}\n`;
            }
        });

        showUploadError(errorMessage);
        return;
    }

    files.forEach(file => {
        if (!selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
            selectedFiles.push(file);
        }
    });

    updateSelectedFilesDisplay();
    updateUploadButtonState();
    updateTotalSizeDisplay();
}

function setupClearAllButton() {
    document.getElementById('clearAllBtn').addEventListener('click', clearAllFiles);
}

function deselectFile(index) {
    selectedFiles.splice(index, 1);
    updateSelectedFilesDisplay();
    updateUploadButtonState();
    updateTotalSizeDisplay();
}

function clearAllFiles() {
    selectedFiles = [];
    updateSelectedFilesDisplay();
    updateUploadButtonState();
    updateTotalSizeDisplay();
}

function updateSelectedFilesDisplay() {
    const selectedFilesDiv = document.getElementById('selectedFiles');
    const selectedFileList = document.getElementById('selectedFileList');

    selectedFileList.innerHTML = '';

    if (selectedFiles.length === 0) {
        selectedFilesDiv.style.display = 'none';
        return;
    }

    selectedFilesDiv.style.display = 'block';

    selectedFiles.forEach((file, index) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'selected-file-item';

        fileItem.innerHTML = `
            <div class="selected-file-info">
                <div class="selected-file-name">${file.name}</div>
                <div class="selected-file-size">${formatFileSize(file.size)}</div>
            </div>
            <button class="deselect-btn" data-index="${index}" title="Удалить файл">×</button>
        `;
        selectedFileList.appendChild(fileItem);
    });

    document.querySelectorAll('.deselect-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const index = parseInt(this.getAttribute('data-index'));
            deselectFile(index);
        });
    });
}

function updateUploadButtonState() {
    const uploadBtn = document.getElementById('uploadBtn');
    const totalSize = calculateTotalSize();

    const sizeIssues = checkFileSizeLimits([]);
    const hasAnyIssue = sizeIssues.length > 0;

    uploadBtn.disabled = selectedFiles.length === 0 || hasAnyIssue;
}

async function checkAuthAndLoadData() {
    try {
        document.getElementById('loadingFiles').style.display = 'block';

        const response = await fetchWithTimeout(`/auth/userinfo`, {
            method: 'GET',
            credentials: 'include'
        }, TIMEOUT_CONFIG.DEFAULT);

        if (response.ok) {
            const userData = await response.json();
            currentUser = userData;
            document.getElementById('username').textContent = userData.username || 'Пользователь';

            const rootDirectory = {
                id: userData.id || userData.uuid,
                name: "Home"
            };
            currentDirectory = rootDirectory;
            directoryStack = [rootDirectory];

            await loadDirectoryContents();
        } else {
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('Ошибка при проверке авторизации:', error);
        if (error.message.includes('timeout')) {
            showFilesMessage('Таймаут при проверке авторизации', 'error');
        } else {
            showFilesMessage('Ошибка соединения с сервером', 'error');
        }
    }
}

async function loadDirectoryContents(directory = null) {
    try {
        document.getElementById('loadingFiles').style.display = 'block';
        document.getElementById('foldersContent').style.display = 'none';
        document.getElementById('filesContent').style.display = 'none';

        let url = '/file/directories/contents';
        if (directory && directory.id) {
            url += `?directory_id=${directory.id}`;
        }

        const response = await fetchWithTimeout(url, {
            method: 'GET',
            credentials: 'include'
        }, TIMEOUT_CONFIG.DEFAULT);

        if (response.ok) {
            const contents = await response.json();
            displayDirectoryContents(contents, directory);
            updateDirectoryTitle();
            updateNavigationButtons();
        } else {
            throw new Error(`Ошибка сервера: ${response.status}`);
        }
    } catch (error) {
        console.error('Ошибка при загрузке содержимого директории:', error);
        if (error.message.includes('timeout')) {
            showFilesMessage('Таймаут при загрузке содержимого папки', 'error');
        } else {
            showFilesMessage('Не удалось загрузить содержимое папки', 'error');
        }
    } finally {
        document.getElementById('loadingFiles').style.display = 'none';
    }
}

function displayDirectoryContents(contents, directory) {
    const foldersList = document.getElementById('foldersList');
    const filesList = document.getElementById('filesList');
    const emptyState = document.getElementById('emptyState');
    const foldersContent = document.getElementById('foldersContent');
    const filesContent = document.getElementById('filesContent');

    foldersList.innerHTML = '';
    filesList.innerHTML = '';

    if (contents.directory && contents.directory.name) {
        currentDirectory.name = contents.directory.name;
    } else if (directory && directory.id === (currentUser.id || currentUser.uuid)) {
        currentDirectory.name = "Home";
    }

    if (contents.subdirectories && contents.subdirectories.length > 0) {
        foldersContent.style.display = 'block';

        contents.subdirectories.forEach(folder => {
            const folderItem = document.createElement('div');
            folderItem.className = 'folder-item';
            folderItem.innerHTML = `
                <div class="folder-icon">
                    <img src="/static/icons/folder.svg" class="icon-svg" alt="Папка">
                </div>
                <div class="folder-name">${folder.name}</div>
                <div class="folder-actions">
                    <button class="folder-action-btn rename-folder-btn"
                            onclick="event.stopPropagation(); showRenameFolderModal('${folder.id}', '${folder.name}')"
                            title="Переименовать">
                        <img src="/static/icons/edit.svg" class="icon-svg" alt="Переименовать">
                    </button>
                    <button class="folder-action-btn delete-folder-btn"
                            onclick="event.stopPropagation(); deleteFolder('${folder.id}', '${folder.name}')"
                            title="Удалить">
                        <img src="/static/icons/bin.svg" class="icon-svg" alt="Удалить">
                    </button>
                </div>
            `;

            folderItem.addEventListener('click', () => {
                enterDirectory(folder);
            });

            foldersList.appendChild(folderItem);
        });
    } else {
        foldersContent.style.display = 'none';
    }

    if (contents.files && contents.files.length > 0) {
        filesContent.style.display = 'block';
        emptyState.style.display = 'none';

        contents.files.forEach(file => {
            const row = document.createElement('tr');
            const uploadDate = formatDate(file.created_at);

            row.innerHTML = `
                <td class="file-name-cell">
                    <div class="file-name-content">
                        <span class="file-name-text" title="${file.filename}">${file.filename}</span>
                    </div>
                </td>
                <td>${file.file_size}</td>
                <td>${uploadDate}</td>
                <td>
                    <div class="file-actions">
                        <button class="action-btn download-btn" onclick="downloadFile('${file.id}')" title="Скачать">
                            <img src="/static/icons/download.svg" class="icon-svg" alt="Скачать">
                        </button>
                        <button class="action-btn share-btn" onclick="shareFile('${file.id}', '${file.filename}')" title="Поделиться">
                            <img src="/static/icons/link.svg" class="icon-svg" alt="Поделиться">
                        </button>
                        <button class="action-btn public-btn ${file.is_public ? '' : 'private'}"
                                onclick="togglePublicStatus('${file.id}', this)"
                                title="${file.is_public ? 'Сделать приватным' : 'Сделать публичным'}">
                            <img src="/static/icons/${file.is_public ? 'lock-open.svg' : 'lock-locked.svg'}" class="icon-svg" alt="${file.is_public ? 'Публичный' : 'Приватный'}">
                        </button>
                        <button class="action-btn delete-btn" onclick="deleteFile('${file.id}', '${file.filename}')" title="Удалить">
                            <img src="/static/icons/bin.svg" class="icon-svg" alt="Удалить">
                        </button>
                    </div>
                </td>
            `;
            filesList.appendChild(row);
        });
    } else {
        filesContent.style.display = 'block';
        emptyState.style.display = 'block';
    }
}

function updateDirectoryTitle() {
    const directoryName = document.getElementById('directoryName');
    if (currentDirectory) {
        directoryName.textContent = currentDirectory.name || 'Home';
    } else {
        directoryName.textContent = 'Home';
    }
}

function updateNavigationButtons() {
    const backBtn = document.getElementById('backBtn');
    backBtn.disabled = directoryStack.length <= 1;
}

function enterDirectory(directory) {
    directoryStack.push(directory);
    currentDirectory = directory;
    loadDirectoryContents(directory);
}

async function createFolder() {
    const folderName = document.getElementById('folderName').value.trim();

    if (!folderName) {
        alert('Введите название папки');
        return;
    }

    try {
        const requestBody = {
            name: folderName
        };

        if (currentDirectory && currentDirectory.id !== currentUser.id && currentDirectory.id !== currentUser.uuid) {
            requestBody.parent_id = currentDirectory.id;
        } else {
            requestBody.parent_id = currentUser.id || currentUser.uuid;
        }

        const response = await fetchWithTimeout(`/file/create_dir`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody),
            credentials: 'include'
        }, TIMEOUT_CONFIG.DEFAULT);

        if (response.ok) {
            hideCreateFolderModal();
            showFilesMessage(`Папка "${folderName}" успешно создана`, 'success');
            await loadDirectoryContents(currentDirectory);
        } else {
            let errorMessage = 'Ошибка создания папки';
            if (response.status === 408) {
                errorMessage = 'Превышено время создания папки. Попробуйте еще раз.';
            } else if (response.status === 507) {
                errorMessage = 'Недостаточно места в хранилище для создания папки.';
            }
            throw new Error(errorMessage);
        }
    } catch (error) {
        console.error('Ошибка при создании папки:', error);
        const userFriendlyMessage = await handleApiError(error, 'Ошибка создания папки');
        showFilesMessage(userFriendlyMessage, 'error');
    }
}

async function renameFolder() {
    const folderId = document.getElementById('newFolderName').getAttribute('data-folder-id');
    const newName = document.getElementById('newFolderName').value.trim();

    if (!newName) {
        alert('Введите новое название папки');
        return;
    }

    try {
        const response = await fetchWithTimeout(`/file/directories/${folderId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                new_name: newName
            }),
            credentials: 'include'
        }, TIMEOUT_CONFIG.DEFAULT);

        if (response.ok) {
            hideRenameFolderModal();
            showFilesMessage('Папка успешно переименована', 'success');
            await loadDirectoryContents(currentDirectory);
        } else {
            let errorMessage = 'Ошибка переименования папки';
            if (response.status === 408) {
                errorMessage = 'Превышено время переименования папки. Попробуйте еще раз.';
            }
            throw new Error(errorMessage);
        }
    } catch (error) {
        console.error('Ошибка при переименовании папки:', error);
        const userFriendlyMessage = await handleApiError(error, 'Ошибка переименования папки');
        showFilesMessage(userFriendlyMessage, 'error');
    }
}

async function deleteFolder(folderId, folderName) {
    const confirmation = confirm(
        `Вы уверены, что хотите удалить папку "${folderName}"?\n\n` +
        `Вместе с папкой будут удалены:\n` +
        `Все файлы в этой папке\n` +
        `Все подпапки и их содержимое\n\n`
    );

    if (!confirmation) {
        return;
    }

    try {
        showFilesMessage(`Удаление папки "${folderName}" и всего содержимого...`, 'success');

        const response = await fetchWithTimeout(`/file/directories/${folderId}`, {
            method: 'DELETE',
            credentials: 'include'
        }, TIMEOUT_CONFIG.DEFAULT);

        if (response.ok) {
            const result = await response.json();
            showFilesMessage(
                `Папка "${folderName}" и все ее содержимое успешно удалены. ` +
                `Удалено файлов: ${result.deleted_files_count}`,
                'success'
            );

            //if (directoryStack.length > 1) {
            //    directoryStack.pop();
            //    currentDirectory = directoryStack[directoryStack.length - 1];
            //}
            await loadDirectoryContents(currentDirectory);
            await loadStorageStatus();
        } else {
            let errorMessage = 'Ошибка удаления папки';
            if (response.status === 408) {
                errorMessage = 'Превышено время удаления папки. Попробуйте еще раз.';
            }
            throw new Error(errorMessage);
        }
    } catch (error) {
        console.error('Ошибка при удалении папки:', error);
        const userFriendlyMessage = await handleApiError(error, 'Ошибка удаления папки');
        showFilesMessage(userFriendlyMessage, 'error');
    }
}

async function uploadFiles() {
    if (selectedFiles.length === 0) {
        showUploadError('Сначала выберите файлы');
        return;
    }

    const sizeIssues = checkFileSizeLimits([]);
    if (sizeIssues.length > 0) {
        let errorMessage = 'Невозможно загрузить файлы:\n\n';

        sizeIssues.forEach(issue => {
            if (issue.type === 'total_upload_size') {
                errorMessage += `• Суммарный размер загрузки (${formatFileSizeForDisplay(issue.potentialSize)}) превышает лимит одной загрузки ${formatFileSizeForDisplay(issue.maxSize)}\n`;
            } else if (issue.type === 'storage_limit') {
                errorMessage += `• Недостаточно места в хранилище. Доступно: ${formatFileSizeForDisplay(issue.availableSpace)}, нужно: ${formatFileSizeForDisplay(issue.uploadSize)}\n`;
            }
        });

        showUploadError(errorMessage);
        return;
    }

    const uploadBtn = document.getElementById('uploadBtn');
    const uploadError = document.getElementById('uploadError');
    const uploadSuccess = document.getElementById('uploadSuccess');
    const progressContainer = document.getElementById('progressContainer');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');

    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Загрузка...';
    uploadError.style.display = 'none';
    uploadSuccess.style.display = 'none';
    progressContainer.style.display = 'block';

    let uploadedCount = 0;
    let errorCount = 0;
    const totalFiles = selectedFiles.length;
    const errorDetails = [];

    for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const formData = new FormData();
        formData.append('file', file);

        if (currentDirectory) {
            formData.append('dir_id', currentDirectory.id);
        } else {
            formData.append('dir_id', currentUser.id || currentUser.uuid);
        }

        try {
            progressText.textContent = `Загрузка файла ${i + 1} из ${totalFiles}: ${file.name}`;

            const response = await fetchWithTimeout(`/file/upload`, {
                method: 'POST',
                body: formData,
                credentials: 'include'
            }, TIMEOUT_CONFIG.FILE_OPERATIONS);

            if (response.ok) {
                uploadedCount++;
            } else {
                let errorMessage = `Файл "${file.name}": `;

                let errorDetail = '';
                try {
                    const errorData = await response.json();
                    errorDetail = errorData.detail || '';
                } catch (e) {
                    console.error('Не удалось распарсить ошибку:', e);
                }

                if (response.status === 408) {
                    errorMessage += 'Превышено время загрузки. Попробуйте еще раз.';
                    errorDetails.push({ file: file.name, type: 'timeout' });
                } else if (response.status === 507) {
                    errorMessage += 'Недостаточно места в хранилище.';
                    errorDetails.push({ file: file.name, type: 'storage_full' });
                } else if (response.status === 404 && errorDetail === "File too large") {
                    errorMessage += 'Недостаточно места в хранилище.';
                    errorDetails.push({ file: file.name, type: 'storage_full' });
                } else {
                    errorMessage += errorDetail || `Ошибка сервера (${response.status})`;
                    errorDetails.push({ file: file.name, type: 'server_error' });
                }

                console.error(`Ошибка загрузки файла ${file.name}:`, errorMessage);
                errorCount++;
            }
        } catch (error) {
            console.error(`Ошибка при загрузке файла ${file.name}:`, error);
            let errorMessage = `Файл "${file.name}": `;
            let errorType = 'network_error';

            if (error.message.includes('timeout') || error.name === 'AbortError') {
                errorMessage += 'Превышено время загрузки. Попробуйте еще раз.';
                errorType = 'timeout';
            } else {
                errorMessage += 'Ошибка сети. Проверьте подключение.';
            }

            errorDetails.push({ file: file.name, type: errorType });
            errorCount++;
        }

        const progress = ((i + 1) / totalFiles) * 100;
        progressFill.style.width = `${progress}%`;
    }

    progressContainer.style.display = 'none';
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Загрузить все';

    if (errorCount > 0) {
        const timeoutErrors = errorDetails.filter(e => e.type === 'timeout');
        const storageErrors = errorDetails.filter(e => e.type === 'storage_full');
        const otherErrors = errorDetails.filter(e => !['timeout', 'storage_full'].includes(e.type));

        let errorMessage = '';

        if (timeoutErrors.length > 0) {
            errorMessage += `Превышено время загрузки для файлов: ${timeoutErrors.map(e => e.file).join(', ')}. `;
            errorMessage += 'Попробуйте загружать файлы меньшего размера или проверьте соединение.\n';
        }

        if (storageErrors.length > 0) {
            errorMessage += `Недостаточно места в хранилище для файлов: ${storageErrors.map(e => e.file).join(', ')}. `;
            errorMessage += 'Освободите место или удалите ненужные файлы.\n';
        }

        if (otherErrors.length > 0) {
            errorMessage += `Ошибки загрузки для файлов: ${otherErrors.map(e => e.file).join(', ')}.`;
        }

        if (uploadedCount > 0) {
            showUploadSuccess(`Успешно загружено ${uploadedCount} файлов! Но возникли ошибки:\n${errorMessage}`);
        } else {
            let mainError = '';
            if (storageErrors.length > 0) {
                mainError = 'Недостаточно места в хранилище для загрузки файлов.';
            } else if (timeoutErrors.length > 0) {
                mainError = 'Превышено время загрузки файлов.';
            } else {
                mainError = 'Не удалось загрузить файлы из-за ошибок сервера.';
            }

            showUploadError(`${mainError}\n\nДетали:\n${errorMessage}`);
        }
    } else {
        showUploadSuccess(`Успешно загружено ${uploadedCount} файлов!`);
    }

    if (uploadedCount > 0) {
        clearAllFiles();
        await loadDirectoryContents(currentDirectory);
        await loadStorageStatus();
    }
}

async function downloadFile(fileId) {
    try {
        const downloadUrl = `/file/owning_download/${fileId}`;

        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        document.body.appendChild(iframe);

        const timeoutId = setTimeout(() => {
            document.body.removeChild(iframe);
            showFilesMessage('Таймаут при скачивании файла', 'error');
        }, TIMEOUT_CONFIG.FILE_OPERATIONS);

        iframe.onload = function() {
            clearTimeout(timeoutId);
            document.body.removeChild(iframe);
        };

        iframe.src = downloadUrl;

    } catch (error) {
        console.error('Ошибка при скачивании файла:', error);
        showFilesMessage('Ошибка при скачивании файла', 'error');
    }
}

async function togglePublicStatus(fileId, button) {
    try {
        const response = await fetchWithTimeout(`/file/${fileId}/public?copy=false`, {
            method: 'PATCH',
            credentials: 'include'
        }, TIMEOUT_CONFIG.DEFAULT);

        if (response.ok) {
            const result = await response.json();

            if (result.is_public) {
                button.classList.remove('private');
                button.innerHTML = '<img src="/static/icons/lock-open.svg" class="icon-svg" alt="Публичный">';
                button.title = 'Сделать приватным';
            } else {
                button.classList.add('private');
                button.innerHTML = '<img src="/static/icons/lock-locked.svg" class="icon-svg" alt="Приватный">';
                button.title = 'Сделать публичным';
            }

            showFilesMessage(`Файл теперь ${result.is_public ? 'публичный' : 'приватный'}`, 'success');
        } else {
            let errorMessage = 'Ошибка изменения статуса файла';
            if (response.status === 408) {
                errorMessage = 'Превышено время изменения статуса файла. Попробуйте еще раз.';
            }
            throw new Error(errorMessage);
        }
    } catch (error) {
        console.error('Ошибка при изменении публичного статуса:', error);
        const userFriendlyMessage = await handleApiError(error, 'Ошибка при изменении статуса файла');
        showFilesMessage(userFriendlyMessage, 'error');
    }
}

async function shareFile(fileId, filename) {
    try {
        const response = await fetchWithTimeout(`/file/${fileId}/public?copy=true`, {
            method: 'PATCH',
            credentials: 'include'
        }, TIMEOUT_CONFIG.DEFAULT);

        if (response.ok) {
            const result = await response.json();

            if (result.is_public) {
                const rows = document.querySelectorAll('#filesList tr');
                rows.forEach(row => {
                    const downloadBtn = row.querySelector('.download-btn');
                    if (downloadBtn && downloadBtn.onclick && downloadBtn.onclick.toString().includes(fileId)) {
                        const publicBtn = row.querySelector('.public-btn');
                        if (publicBtn) {
                            publicBtn.classList.remove('private');
                            publicBtn.innerHTML = '<img src="/static/icons/lock-open.svg" class="icon-svg" alt="Публичный">';
                            publicBtn.title = 'Сделать приватным';
                        }
                    }
                });

                showFilesMessage(`Файл "${filename}" теперь публичный`, 'success');
            }

            currentSharingFileId = fileId;

            const shareLink = `${window.location.origin}/file/download/${fileId}`;
            document.getElementById('shareLink').value = shareLink;
            document.getElementById('shareModal').style.display = 'flex';

        } else {
            let errorMessage = 'Не удалось сделать файл публичным';
            if (response.status === 408) {
                errorMessage = 'Превышено время изменения статуса файла. Попробуйте еще раз.';
            }
            throw new Error(errorMessage);
        }
    } catch (error) {
        console.error('Ошибка при попытке поделиться файлом:', error);
        const userFriendlyMessage = await handleApiError(error, 'Не удалось сделать файл публичным для sharing');
        showFilesMessage(userFriendlyMessage, 'error');
    }
}

async function copyShareLink() {
    const shareLink = document.getElementById('shareLink');
    shareLink.select();

    try {
        await navigator.clipboard.writeText(shareLink.value);

        const btn = document.getElementById('copyLinkBtn');
        const originalText = btn.textContent;
        btn.textContent = 'Скопировано!';
        btn.style.background = '#45a049';

        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = '';
        }, 2000);

        showFilesMessage('Ссылка скопирована в буфер обмена', 'success');

    } catch (err) {
        document.execCommand('copy');

        const btn = document.getElementById('copyLinkBtn');
        const originalText = btn.textContent;
        btn.textContent = 'Скопировано!';
        btn.style.background = '#45a049';

        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = '';
        }, 2000);

        showFilesMessage('Ссылка скопирована в буфер обмена', 'success');
    }
}

async function deleteFile(fileId, filename) {
    if (!confirm(`Вы уверены, что хотите удалить файл "${filename}"?`)) {
        return;
    }

    try {
        const response = await fetchWithTimeout(`/file/delete_file/${fileId}`, {
            method: 'DELETE',
            credentials: 'include'
        }, TIMEOUT_CONFIG.DEFAULT);

        if (response.ok) {
            showFilesMessage(`Файл "${filename}" успешно удален`, 'success');
            await loadDirectoryContents(currentDirectory);
            await loadStorageStatus();
        } else {
            let errorMessage = 'Ошибка удаления файла';
            if (response.status === 408) {
                errorMessage = 'Превышено время удаления файла. Попробуйте еще раз.';
            }
            throw new Error(errorMessage);
        }
    } catch (error) {
        console.error('Ошибка при удалении файла:', error);
        const userFriendlyMessage = await handleApiError(error, 'Ошибка при удалении файла');
        showFilesMessage(userFriendlyMessage, 'error');
    }
}

async function logout() {
    try {
        const response = await fetchWithTimeout(`/auth/logout`, {
            method: 'DELETE',
            credentials: 'include'
        }, TIMEOUT_CONFIG.DEFAULT);

        if (response.ok) {
            window.location.href = '/login';
        } else {
            let errorMessage = 'Ошибка выхода';
            if (response.status === 408) {
                errorMessage = 'Превышено время выхода из системы. Попробуйте еще раз.';
            }
            throw new Error(errorMessage);
        }
    } catch (error) {
        console.error('Ошибка при выходе:', error);
        const userFriendlyMessage = await handleApiError(error, 'Ошибка при выходе из системы');
        showFilesMessage(userFriendlyMessage, 'error');
    }
}

function showFilesMessage(message, type) {
    const filesMessage = document.getElementById('filesMessage');
    filesMessage.textContent = message;
    const isMultiline = message.includes('\n');
    filesMessage.className = `files-message ${type} ${isMultiline ? 'multiline' : ''}`;
    filesMessage.style.display = 'block';

    setTimeout(() => {
        filesMessage.style.display = 'none';
    }, 5000);
}

function showUploadError(message) {
    const uploadError = document.getElementById('uploadError');
    uploadError.textContent = message;
    uploadError.className = 'error-message upload-error-multiline';
    uploadError.style.display = 'block';

    setTimeout(() => {
        uploadError.style.display = 'none';
    }, 10000);
}

function showUploadSuccess(message) {
    const uploadSuccess = document.getElementById('uploadSuccess');
    uploadSuccess.textContent = message;
    uploadSuccess.className = 'success-message upload-error-multiline';
    uploadSuccess.style.display = 'block';

    setTimeout(() => {
        uploadSuccess.style.display = 'none';
    }, 8000);
}