// ============================================================
// GUIDE PAGE - JavaScript
// ============================================================

const GUIDE = {
    serverIp: '',
    currentTable: 'guide',
    currentData: { columns: [], rows: [] },
    editingRowIndex: null,
    columnTranslations: {},

    // ============================================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================================
    init() {
        this.checkAuth();
        this.bindEvents();
        this.loadTranslations().then(() => {
            this.loadGuideData();
        });
    },

    // ============================================================
    // ПРОВЕРКА АВТОРИЗАЦИИ
    // ============================================================
    checkAuth() {
        const serverIp = localStorage.getItem('serverIp');
        const userId = localStorage.getItem('userId');

        if (!serverIp || !userId) {
            window.location.href = 'login.html';
            return;
        }

        this.serverIp = serverIp;
    },

    // ============================================================
    // ЗАГРУЗКА ПЕРЕВОДОВ ИЗ TABLE "perevod"
    // ============================================================
    async loadTranslations() {
        try {
            const sql = `SELECT "original", "slovo" FROM "perevod"`;
            const result = await this.query(sql);
            const lines = result.trim().split('\n').filter(l => l);

            if (lines.length > 1) {
                for (let i = 1; i < lines.length; i++) {
                    const parts = lines[i].split('\t');
                    if (parts.length >= 2) {
                        this.columnTranslations[parts[0].trim()] = parts[1].trim();
                    }
                }
            }
        } catch (error) {
            console.warn('Не удалось загрузить переводы:', error);
        }
    },

    // ============================================================
    // ПОЛУЧЕНИЕ НАЗВАНИЯ КОЛОНКИ С ПЕРЕВОДОМ
    // ============================================================
    getColumnName(originalName) {
        return this.columnTranslations[originalName] || originalName;
    },

    // ============================================================
    // API ЗАПРОСЫ
    // ============================================================
    async query(sql) {
        const encodedSql = encodeURIComponent(sql.trim());
        const url = `http://${this.serverIp}:8080/query?sql=${encodedSql}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        try {
            const response = await fetch(url, {
                method: 'GET',
                mode: 'cors',
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            let errorText = '';
            try { errorText = await response.text(); } catch(e) {}

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
            }

            return errorText || await response.text();
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    },

    // ============================================================
    // ЗАГРУЗКА ДАННЫХ СПРАВОЧНИКА
    // ============================================================
    async loadGuideData() {
        const container = document.getElementById('guideTableContainer');
        container.innerHTML = '<div class="loading-message">Загрузка данных...</div>';

        try {
            // Получаем типы данных из sqlite_master
            const typeResult = await this.query(
                `SELECT sql FROM sqlite_master WHERE type='table' AND name='guide'`
            );
            const columnsMap = this.parseTableTypes(typeResult);

            // Получаем заголовки колонок
            const headersResult = await this.query(
                `SELECT * FROM "guide" LIMIT 1`
            );

            const headerLines = headersResult.trim().split('\n').filter(l => l);
            if (headerLines.length === 0) {
                container.innerHTML = '<div class="loading-message">Таблица пуста или не существует</div>';
                return;
            }

            // Первая строка — имена колонок из БД
            const columnNames = headerLines[0].split('\t').map(name => ({
                name: name.trim(),
                type: columnsMap[name.trim()] || ''
            }));

            // Получаем все данные
            const dataResult = await this.query(
                `SELECT * FROM "guide" LIMIT 1000`
            );

            const dataLines = dataResult.trim().split('\n').filter(l => l);
            const rows = dataLines.slice(1).map(line => line.split('\t'));

            this.currentData = { columns: columnNames, rows };

            this.renderTable(columnNames, rows);

        } catch (error) {
            console.error('Ошибка загрузки данных:', error);
            container.innerHTML = `<div class="loading-message" style="color: #e74c3c;">
                Ошибка загрузки данных: ${error.message}
                <br><br>
                <button onclick="GUIDE.loadGuideData()" style="padding: 8px 16px; background: #8b5cf6; color: white; border: none; border-radius: 6px; cursor: pointer;">Повторить</button>
            </div>`;
        }
    },

    // ============================================================
    // ПАРСИНГ ТИПОВ КОЛОНОК
    // ============================================================
    parseTableTypes(sql) {
        const columnsMap = {};
        if (!sql) return columnsMap;

        const lastOpen = sql.lastIndexOf('(');
        const lastClose = sql.lastIndexOf(')');

        if (lastOpen === -1 || lastClose === -1 || lastClose <= lastOpen) {
            return columnsMap;
        }

        const columnsStr = sql.substring(lastOpen + 1, lastClose);
        const columns = columnsStr.split(',');

        for (const col of columns) {
            const trimmed = col.trim();
            if (!trimmed) continue;

            const parts = trimmed.split(/\s+/);
            if (parts.length >= 2) {
                const colName = parts[0].replace(/"/g, '');
                const colType = parts[1].toUpperCase();

                const validTypes = ['TEXT', 'INTEGER', 'REAL', 'BLOB', 'NUMERIC', 'VARCHAR', 'CHAR'];
                if (validTypes.includes(colType)) {
                    columnsMap[colName] = colType;
                }
            }
        }

        return columnsMap;
    },

    // ============================================================
    // ОТРИСОВКА ТАБЛИЦЫ
    // ============================================================
    renderTable(columns, rows, filterText = '') {
        const container = document.getElementById('guideTableContainer');

        if (columns.length === 0) {
            container.innerHTML = '<div class="loading-message">Нет данных</div>';
            return;
        }

        // Фильтрация строк по тексту поиска
        let filteredRows = rows;
        if (filterText.trim() !== '') {
            const lowerQuery = filterText.toLowerCase();
            filteredRows = rows.filter(row => {
                return row.some(cell =>
                    cell.toLowerCase().includes(lowerQuery)
                );
            });
        }

        const kodColumn = columns.find(c => c.name.toLowerCase() === 'kod');
        const kodIndex = kodColumn ? columns.indexOf(kodColumn) : -1;

        const html = `
            <table class="guide-table">
                <colgroup>
                    <col class="col-edit">
                    <col class="col-image">
                    ${columns.map(() => '<col>').join('')}
                    <col class="col-delete">
                </colgroup>
                <thead>
                    <tr>
                        <th class="col-edit" rowspan="2">✏️</th>
                        <th rowspan="2">🖼️</th>
                        ${columns.map(col => `
                            <th>
                                <span class="original-name">${this.escapeHtml(col.name)}</span>
                                <span class="translated-name">${this.escapeHtml(this.getColumnName(col.name))}</span>
                            </th>
                        `).join('')}
                        <th class="col-delete" rowspan="2">🗑️</th>
                    </tr>
                </thead>
                <tbody>
                    ${filteredRows.map((row, index) => {
                        const originalIndex = rows.indexOf(row);
                        const kod = kodIndex >= 0 ? row[kodIndex] : null;
                        return this.renderRowHTML(row, originalIndex, columns, kod);
                    }).join('')}
                </tbody>
            </table>
            ${filteredRows.length === 0 ? '<div class="loading-message">Ничего не найдено</div>' : ''}
        `;

        container.innerHTML = html;

        // Загружаем изображения асинхронно
        this.loadAllImages();
    },

    async loadAllImages() {
        const cells = document.querySelectorAll('.col-image');
        for (const cell of cells) {
            const kod = cell.dataset.kod;
            if (kod) {
                try {
                    const imageData = await this.loadImage(kod);
                    if (imageData) {
                        const thumb = cell.querySelector('.thumbnail');
                        const preview = cell.querySelector('.thumbnail-preview');
                        if (thumb) thumb.src = imageData;
                        if (preview) preview.src = imageData;
                    }
                } catch (error) {
                    // ignore
                }
            }
        }
        this.bindThumbnailHover();
    },

    bindThumbnailHover() {
        const colImageCells = document.querySelectorAll('.col-image');
        colImageCells.forEach(cell => {
            const preview = cell.querySelector('.thumbnail-preview');
            const thumbnail = cell.querySelector('.thumbnail');
            if (!preview || !thumbnail) return;

            cell.addEventListener('mouseenter', () => {
                const rect = thumbnail.getBoundingClientRect();
                preview.style.left = `${rect.left}px`;
                preview.style.top = `${rect.top}px`;
            });

            cell.addEventListener('mouseleave', () => {
                preview.style.left = '';
                preview.style.top = '';
            });

            // Клик по ячейке изображения — открыть fullview
            cell.addEventListener('click', () => {
                const kod = cell.dataset.kod;
                if (kod) this.showFullImage(kod);
            });
        });
    },

    async showFullImage(kod) {
        const imageData = await this.loadImage(kod);
        if (!imageData) return;

        const fullview = document.getElementById('imageFullview');
        if (!fullview) return;

        const img = fullview.querySelector('img');
        if (img) {
            img.src = imageData;
        }
        fullview.classList.add('active');
    },

    renderRowHTML(row, index, columns, kod) {
        return `
            <tr>
                <td class="col-edit">
                    <button class="btn-edit-guide" onclick="GUIDE.editRecord(${index})" title="Редактировать">✏️</button>
                </td>
                <td class="col-image" data-kod="${kod || ''}">
                    ${kod ? '<img class="thumbnail" src="" alt=""><img class="thumbnail-preview" src="" alt="">' : ''}
                </td>
                ${columns.map((col, colIndex) => {
                    const value = row[colIndex] || '';
                    const displayValue = value.length > 50 ? value.substring(0, 50) + '...' : value;
                    return `<td title="${this.escapeHtml(value)}">${this.escapeHtml(displayValue)}</td>`;
                }).join('')}
                <td class="col-delete">
                    <button class="btn-delete-guide-row" onclick="GUIDE.deleteRecord(${index})" title="Удалить">🗑️</button>
                </td>
            </tr>
        `;
    },

    // ============================================================
    // ДОБАВЛЕНИЕ ЗАПИСИ
    // ============================================================
    openAddRecordModal() {
        window.location.href = 'guide-add.html';
    },

    // ============================================================
    // РЕДАКТИРОВАНИЕ ЗАПИСИ
    // ============================================================
    editRecord(rowIndex) {
        const row = this.currentData.rows[rowIndex];
        const columns = this.currentData.columns;

        // Находим kod
        const kodColumn = columns.find(c => c.name.toLowerCase() === 'kod');
        const kod = kodColumn ? row[columns.indexOf(kodColumn)] : null;

        window.location.href = `guide-add.html?kod=${encodeURIComponent(kod || '')}`;
    },

    // ============================================================
    // УДАЛЕНИЕ ЗАПИСИ
    // ============================================================
    async deleteRecord(rowIndex) {
        const row = this.currentData.rows[rowIndex];
        const columns = this.currentData.columns;

        // Находим kod
        const kodColumn = columns.find(c => c.name.toLowerCase() === 'kod');
        const kod = kodColumn ? row[columns.indexOf(kodColumn)] : null;

        if (!kod) {
            alert('Не найден kod для удаления');
            return;
        }

        if (!confirm(`Удалить запись с kod="${kod}"?`)) {
            return;
        }

        try {
            const sql = `DELETE FROM "guide" WHERE "kod"='${kod.replace(/'/g, "''")}'`;
            await this.query(sql);
            await this.deleteImageFromStorage(kod);
            alert('✅ Запись удалена');
            await this.loadGuideData();
        } catch (error) {
            console.error('Ошибка удаления:', error);
            alert(`❌ Ошибка удаления: ${error.message}`);
        }
    },

    // ============================================================
    // ЭКРАНИРОВАНИЕ HTML
    // ============================================================
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // ============================================================
    // IMAGE HANDLING - IndexedDB
    // ============================================================
    getDb() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('ImageDB', 3);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('images')) {
                    db.createObjectStore('images', { keyPath: 'kod' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async deleteImageFromStorage(kod) {
        try {
            const db = await this.getDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('images', 'readwrite');
                tx.objectStore('images').delete(kod);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) {
            console.error('Ошибка удаления изображения:', e);
        }
    },

    async loadImage(kod) {
        try {
            const db = await this.getDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('images', 'readonly');
                const request = tx.objectStore('images').get(kod);
                request.onsuccess = () => {
                    if (request.result && request.result.data) {
                        resolve(request.result.data);
                    } else {
                        resolve(null);
                    }
                };
                request.onerror = () => {
                    resolve(null);
                };
            });
        } catch (e) {
            return null;
        }
    },

    async saveImageToLocalStorage(kod, dataUrl) {
        try {
            const db = await this.getDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('images', 'readwrite');
                tx.objectStore('images').put({ kod, data: dataUrl });
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) {
            console.error('Ошибка сохранения изображения:', e);
        }
    },

    // ============================================================
    // СОБЫТИЯ
    // ============================================================
    bindEvents() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const fullview = document.getElementById('imageFullview');
                if (fullview) {
                    fullview.classList.remove('active');
                }
            }
        });

        document.getElementById('backBtn').addEventListener('click', () => {
            window.history.back();
        });

        document.getElementById('addRecordBtn').addEventListener('click', () => {
            this.openAddRecordModal();
        });

        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.loadGuideData();
        });

        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.renderTable(this.currentData.columns, this.currentData.rows, e.target.value);
        });

        // Закрытие fullview по клику на фон или крестик
        document.addEventListener('click', (e) => {
            const fullview = document.getElementById('imageFullview');
            if (fullview && (e.target === fullview || e.target.classList.contains('image-fullview-close'))) {
                fullview.classList.remove('active');
            }
        });
    }
};

// ============================================================
// ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    GUIDE.init();
});
