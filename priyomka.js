// ============================================================
// PRIYOMKA PAGE - JavaScript
// ============================================================

const PRIYOMKA = {
    serverIp: null,
    searchResults: [],
    selectedItems: new Set(),
    currentDoknom: null,
    imageData: {}, // { kod: base64data }

    async init() {
        this.serverIp = localStorage.getItem('serverIp');
        if (!this.serverIp) {
            window.location.href = 'login.html';
            return;
        }

        // Загружаем картинки из IndexedDB
        await this.loadImagesFromDB();

        // Сбрасываем шапку
        this.clearHeader();

        // Устанавливаем дату по умолчанию — сегодня
        const today = new Date();
        const dateStr = today.getFullYear() + '-' +
            String(today.getMonth() + 1).padStart(2, '0') + '-' +
            String(today.getDate()).padStart(2, '0');
        document.getElementById('selectDateInput').value = dateStr;

        this.bindEvents();
        this.adjustTableHeight();
        window.addEventListener('resize', () => this.adjustTableHeight());
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

    async loadImagesFromDB() {
        try {
            const db = await this.getDb();
            return new Promise((resolve) => {
                const tx = db.transaction('images', 'readonly');
                const request = tx.objectStore('images').getAll();
                request.onsuccess = () => {
                    this.imageData = {};
                    request.result.forEach(item => {
                        this.imageData[item.kod] = item.data;
                    });
                    console.log('[priyomka] Загружено картинок:', Object.keys(this.imageData).length);
                    resolve();
                };
                request.onerror = () => {
                    this.imageData = {};
                    resolve();
                };
            });
        } catch (e) {
            console.error('[priyomka] Ошибка загрузки картинок:', e);
            this.imageData = {};
        }
    },

    adjustTableHeight() {
        const tableWrapper = document.querySelector('.guide-table-wrapper');
        const header = document.querySelector('.editor-header');
        const toolbar = document.querySelector('.guide-toolbar');

        if (!tableWrapper) return;

        const headerHeight = header ? header.offsetHeight : 60;
        const toolbarHeight = toolbar ? toolbar.offsetHeight : 50;
        const totalTopOffset = headerHeight + toolbarHeight + 80;

        tableWrapper.style.height = `${Math.max(400, window.innerHeight - totalTopOffset)}px`;
    },

    bindEvents() {
        // Кнопка "Назад"
        document.getElementById('backBtn').addEventListener('click', () => {
            window.location.href = 'admin.html';
        });

        // Кнопка "Загрузить" - открывает модалку
        document.getElementById('loadPriyomkaBtn').addEventListener('click', () => {
            this.openLoadModal();
        });

        // Кнопка "Принять на склад"
        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.acceptToStock();
        });

        // Выбор даты
        document.getElementById('selectDateInput').addEventListener('change', () => {
            this.loadDocumentsList();
        });

        // Закрытие модалки
        document.getElementById('closeLoadModal').addEventListener('click', () => {
            this.closeLoadModal();
        });

        document.getElementById('loadPriyomkaModal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('loadPriyomkaModal')) {
                this.closeLoadModal();
            }
        });

        // Закрытие по кнопке ×
        document.querySelectorAll('.btn-modal-close').forEach(btn => {
            btn.addEventListener('click', () => {
                const modal = btn.closest('.priyomka-modal');
                if (modal) modal.style.display = 'none';
            });
        });

        // Кнопка "Распечатать стикеры"
        document.getElementById('printStickersBtn').addEventListener('click', () => {
            this.openStickersModal();
        });

        // Общий чекбокс "Выбрать все"
        document.getElementById('selectAllStickers').addEventListener('change', (e) => {
            const checked = e.target.checked;
            document.querySelectorAll('#stickersTableBody input[type="checkbox"]').forEach(cb => {
                cb.checked = checked;
            });
        });

        // Кнопка "Распечатать" в модальном окне
        document.getElementById('printStickersConfirmBtn').addEventListener('click', () => {
            this.printStickers();
            document.getElementById('stickersModal').style.display = 'none';
        });

        // Кнопка "Закрыть"
        document.getElementById('closeStickersModal').addEventListener('click', () => {
            document.getElementById('stickersModal').style.display = 'none';
        });

        document.getElementById('stickersModal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('stickersModal')) {
                document.getElementById('stickersModal').style.display = 'none';
            }
        });

        // Поиск по doknom - загружает документ
        document.getElementById('searchInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const doknom = document.getElementById('searchInput').value.trim();
                if (doknom) {
                    this.searchAndLoadByDoknom(doknom);
                }
            }
        });

        // Клик по изображению — показать полностью
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('warehouse-thumbnail')) {
                const kod = e.target.getAttribute('data-kod');
                this.showImageFullview(kod);
            }
            if (e.target.classList.contains('no-image')) {
                // Можно добавить загрузку изображения
                const kod = e.target.getAttribute('data-kod');
                this.openImageUpload(kod);
            }
        });
    },

    showImageFullview(kod) {
        const imgData = this.imageData[kod];
        if (!imgData) return;

        const modal = document.getElementById('imageFullview');
        const img = document.getElementById('fullviewImg');
        img.src = imgData;
        modal.style.display = 'flex';
    },

    openImageUpload(kod) {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (ev) => {
                const dataUrl = ev.target.result;
                this.imageData[kod] = dataUrl;
                this.saveImageToDB(kod, dataUrl);
                // Перерисовываем таблицу
                if (this.currentDoknom) {
                    this.loadDoknomData(this.currentDoknom);
                }
            };
            reader.readAsDataURL(file);
        };
        fileInput.click();
    },

    async saveImageToDB(kod, dataUrl) {
        try {
            const db = await this.getDb();
            return new Promise((resolve) => {
                const tx = db.transaction('images', 'readwrite');
                tx.objectStore('images').put({ kod, data: dataUrl });
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            });
        } catch (e) {
            console.error('[priyomka] Ошибка сохранения изображения:', e);
        }
    },

    // ============================================================
    // МОДАЛКА ЗАГРУЗКИ
    // ============================================================
    openLoadModal() {
        document.getElementById('loadPriyomkaModal').style.display = 'flex';
        this.loadDocumentsList();
    },

    closeLoadModal() {
        document.getElementById('loadPriyomkaModal').style.display = 'none';
    },

    clearHeader() {
        document.getElementById('doknomInfo').style.display = 'none';
    },

    // ============================================================
    // ПОИСК И ЗАГРУЗКА ПО DOKNOM
    // ============================================================
    async searchAndLoadByDoknom(doknom) {
        const container = document.getElementById('priyomkaTableContainer');
        container.innerHTML = '<div class="loading-message">Поиск документа...</div>';

        console.log('[priyomka] Поиск по doknom:', doknom);

        // Пробуем разные варианты поиска
        const variants = [
            `SELECT kod, quantity, danet FROM vergleich WHERE doknom='${doknom.replace(/'/g, "''")}' ORDER BY kod`,
            `SELECT kod, quantity, danet FROM vergleich WHERE TRIM(doknom)='${doknom.replace(/'/g, "''")}' ORDER BY kod`,
            `SELECT kod, quantity, danet FROM vergleich WHERE doknom LIKE '%${doknom.replace(/'/g, "''")}%' ORDER BY kod`
        ];

        let result = '';
        let found = false;

        for (const sql of variants) {
            const encodedSql = encodeURIComponent(sql);
            const url = `http://${this.serverIp}:8080/query?sql=${encodedSql}`;
            console.log('[priyomka] Пробую SQL:', sql);

            const response = await fetch(url, { method: 'GET', mode: 'cors' });
            const rawResult = await response.text();
            const lines = rawResult.trim().split('\n').filter(l => l);

            console.log('[priyomka] Результат строк:', lines.length);

            if (lines.length >= 2) {
                result = rawResult;
                found = true;
                console.log('[priyomka] Документ найден!');
                break;
            }
        }

        if (!found) {
            container.innerHTML = '<div class="no-data-message">Документ не найден</div>';
            return;
        }

        this.currentDoknom = doknom;
        this.loadDoknomData(doknom, result);
    },

    showStickersButton() {
        const btn = document.getElementById('printStickersBtn');
        if (btn && this.currentDoknom) {
            btn.style.display = 'inline-block';
        }
    },

    async loadDocumentsList() {
        const dateVal = document.getElementById('selectDateInput').value;
        if (!dateVal) return;

        // Дата в БД хранится в формате YYYY-MM-DD, как есть
        // Для отображения превращаем в DD.MM.YYYY
        const [year, month, day] = dateVal.split('-');
        const displayDate = `${day}.${month}.${year}`;

        console.log('[priyomka] Выбранная дата (input):', dateVal);
        console.log('[priyomka] Дата для отображения:', displayDate);
        console.log('[priyomka] Дата для БД (YYYY-MM-DD):', dateVal);

        document.getElementById('selectedDateLabel').textContent = displayDate;
        document.getElementById('documentsEmptyMsg').style.display = 'none';
        document.getElementById('documentsListWrapper').style.display = 'none';

        try {
            const sql = `SELECT doknom, time, IDname, data, MAX(danet) as max_danet FROM vergleich WHERE data='${dateVal}' GROUP BY doknom, time, IDname, data ORDER BY time DESC`;
            
            console.log('[priyomka] SQL запрос:', sql);
            
            const encodedSql = encodeURIComponent(sql);
            const url = `http://${this.serverIp}:8080/query?sql=${encodedSql}`;

            console.log('[priyomka] URL запроса:', url);

            const response = await fetch(url, { method: 'GET', mode: 'cors' });
            const result = await response.text();

            console.log('[priyomka] Результат запроса:', result);

            const lines = result.trim().split('\n').filter(l => l);
            console.log('[priyomka] Строк результата:', lines.length);
            if (lines.length > 0) {
                console.log('[priyomka] Заголовки:', lines[0]);
            }

            if (lines.length < 2) {
                console.log('[priyomka] Нет результатов, пробуем посмотреть данные таблицы...');
                const debugSql = `SELECT DISTINCT data FROM vergleich ORDER BY data DESC LIMIT 10`;
                const debugEncoded = encodeURIComponent(debugSql);
                const debugUrl = `http://${this.serverIp}:8080/query?sql=${debugEncoded}`;
                console.log('[priyomka] Debug SQL:', debugSql);
                
                try {
                    const debugResp = await fetch(debugUrl, { method: 'GET', mode: 'cors' });
                    const debugResult = await debugResp.text();
                    console.log('[priyomka] Доступные даты:', debugResult);
                } catch (e) {
                    console.error('[priyomka] Ошибка debug запроса:', e);
                }

                document.getElementById('documentsEmptyMsg').style.display = 'block';
                return;
            }

            // Загружаем имена авторов
            const idNames = {};
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split('\t');
                const id = parts[2]?.trim();
                if (id && !idNames[id]) {
                    idNames[id] = null;
                }
            }

            // Загружаем имена из sotrud
            const ids = Object.keys(idNames);
            if (ids.length > 0) {
                const idsList = ids.map(id => `'${id.replace(/'/g, "''")}'`).join(',');
                const nameSql = encodeURIComponent(`SELECT "ID", "NAME" FROM "sotrud" WHERE "ID" IN (${idsList})`);
                const nameUrl = `http://${this.serverIp}:8080/query?sql=${nameSql}`;
                const nameResp = await fetch(nameUrl, { method: 'GET', mode: 'cors' });
                const nameResult = await nameResp.text();

                const nameLines = nameResult.trim().split('\n').filter(l => l);
                if (nameLines.length >= 2) {
                    const nHeaders = nameLines[0].split('\t');
                    const idIdx = nHeaders.indexOf('ID');
                    const nameIdx = nHeaders.indexOf('NAME');
                    for (let i = 1; i < nameLines.length; i++) {
                        const np = nameLines[i].split('\t');
                        const nId = idIdx >= 0 ? np[idIdx]?.trim() : '';
                        const nName = nameIdx >= 0 ? np[nameIdx]?.trim() : '';
                        if (nId) idNames[nId] = nName;
                    }
                }
            }

            // Заполняем список документов
            const tbody = document.getElementById('documentsListBody');
            tbody.innerHTML = '';

            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split('\t');
                const doknom = parts[0]?.trim() || '';
                const time = parts[1]?.trim() || '';
                const idName = parts[2]?.trim() || '';
                const maxDanet = parts[4] || '0';
                const author = idNames[idName] || idName || '—';
                const isAccepted = maxDanet === '1';

                const tr = document.createElement('tr');
                tr.className = 'document-row';
                tr.setAttribute('data-doknom', doknom);
                tr.innerHTML = `
                    <td class="col-kod">${doknom}</td>
                    <td>${time}</td>
                    <td>${author}</td>
                    <td style="text-align:center;font-size:1.2rem;">${isAccepted ? '<span style="color:#2ecc71;">✓</span>' : '<span style="color:#e74c3c;">✕</span>'}</td>
                `;
                tbody.appendChild(tr);
            }

            document.getElementById('documentsListWrapper').style.display = 'block';

            // Привязываем клик на строку
            document.querySelectorAll('.document-row').forEach(row => {
                row.addEventListener('click', () => {
                    const doknom = row.getAttribute('data-doknom');
                    this.currentDoknom = doknom;
                    this.closeLoadModal();
                    this.loadDoknomData(doknom);
                });
            });

        } catch (error) {
            console.error('[priyomka] Ошибка загрузки списка документов:', error);
            alert('Ошибка при загрузке: ' + error.message);
        }
    },

    // ============================================================
    // ОБНОВЛЕНИЕ ШАПКИ С ИНФОРМАЦИЕЙ О ДОКУМЕНТЕ
    // ============================================================
    async updateHeader(doknom) {
        this.clearHeader();
        try {
            // Получаем информацию о документе
            const sql = `SELECT doknom, IDname, data, redakt_name, redakt_date FROM vergleich WHERE doknom='${doknom.replace(/'/g, "''")}' ORDER BY rowid DESC LIMIT 1`;
            const encodedSql = encodeURIComponent(sql);
            const url = `http://${this.serverIp}:8080/query?sql=${encodedSql}`;

            console.log('[priyomka] Загрузка шапки, SQL:', sql);

            const response = await fetch(url, { method: 'GET', mode: 'cors' });
            const result = await response.text();

            console.log('[priyomka] Результат шапки:', result);

            const lines = result.trim().split('\n').filter(l => l);
            if (lines.length < 2) {
                console.error('[priyomka] Нет данных в шапке, строк:', lines.length);
                return;
            }

            const headers = lines[0].split('\t');
            const parts = lines[1].split('\t');
            const doknomIdx = headers.indexOf('doknom');
            const idNameIdx = headers.indexOf('IDname');
            const dataIdx = headers.indexOf('data');
            const redaktNameIdx = headers.indexOf('redakt_name');
            const redaktDateIdx = headers.indexOf('redakt_date');

            const doknomVal = doknomIdx >= 0 ? parts[doknomIdx]?.trim() || doknom : doknom;
            const idNameVal = idNameIdx >= 0 ? parts[idNameIdx]?.trim() : '';
            const dataVal = dataIdx >= 0 ? parts[dataIdx]?.trim() : '';
            const redaktNameVal = redaktNameIdx >= 0 ? parts[redaktNameIdx]?.trim() : '';
            const redaktDateVal = redaktDateIdx >= 0 ? parts[redaktDateIdx]?.trim() : '';

            // Загружаем имя автора из sotrud
            let authorName = idNameVal;
            if (idNameVal) {
                const nameSql = encodeURIComponent(`SELECT "ID", "NAME" FROM "sotrud" WHERE "ID"='${idNameVal.replace(/'/g, "''")}'`);
                const nameUrl = `http://${this.serverIp}:8080/query?sql=${nameSql}`;
                const nameResp = await fetch(nameUrl, { method: 'GET', mode: 'cors' });
                const nameResult = await nameResp.text();
                const nameLines = nameResult.trim().split('\n').filter(l => l);
                if (nameLines.length >= 2) {
                    const nHeaders = nameLines[0].split('\t');
                    const nNameIdx = nHeaders.indexOf('NAME');
                    const nParts = nameLines[1].split('\t');
                    authorName = nNameIdx >= 0 ? nParts[nNameIdx]?.trim() || idNameVal : idNameVal;
                }
            }

            // Обновляем шапку
            document.getElementById('docNomer').textContent = doknomVal;
            document.getElementById('docAuthor').textContent = authorName || '—';
            document.getElementById('docAuthorInfo').style.display = idNameVal ? 'inline' : 'none';
            document.getElementById('docDate').textContent = dataVal || '—';
            document.getElementById('docDateInfo').style.display = dataVal ? 'inline' : 'none';

            if (redaktNameVal && redaktDateVal) {
                // Загружаем имя редактора
                let redaktAuthor = redaktNameVal;
                const redaktSql = encodeURIComponent(`SELECT "ID", "NAME" FROM "sotrud" WHERE "ID"='${redaktNameVal.replace(/'/g, "''")}'`);
                const redaktUrl = `http://${this.serverIp}:8080/query?sql=${redaktSql}`;
                const redaktResp = await fetch(redaktUrl, { method: 'GET', mode: 'cors' });
                const redaktResult = await redaktResp.text();
                const redaktLines = redaktResult.trim().split('\n').filter(l => l);
                if (redaktLines.length >= 2) {
                    const rHeaders = redaktLines[0].split('\t');
                    const rNameIdx = rHeaders.indexOf('NAME');
                    const rParts = redaktLines[1].split('\t');
                    redaktAuthor = rNameIdx >= 0 ? rParts[rNameIdx]?.trim() || redaktNameVal : redaktNameVal;
                }
                document.getElementById('docRedate').textContent = `${redaktDateVal} - ${redaktAuthor}`;
                document.getElementById('docRedateInfo').style.display = 'inline';
            } else {
                document.getElementById('docRedateInfo').style.display = 'none';
            }

            document.getElementById('doknomInfo').style.display = 'flex';

        } catch (error) {
            console.error('[priyomka] Ошибка обновления шапки:', error);
        }
    },

    // ============================================================
    // ЗАГРУЗКА ДАННЫХ ДОКУМЕНТА
    // ============================================================
    async loadDoknomData(doknom, preloadedResult = null) {
        this.currentDoknom = doknom;
        const container = document.getElementById('priyomkaTableContainer');
        container.innerHTML = '<div class="loading-message">Загрузка данных...</div>';

        console.log('[priyomka] Загружаю документ, doknom:', JSON.stringify(doknom), 'length:', doknom.length);
        console.log('[priyomka] doknom hex:', Array.from(doknom).map(c => c.charCodeAt(0).toString(16)).join(' '));

        // Обновляем шапку
        this.updateHeader(doknom);

        try {
            let result = '';
            let resultLines = [];

            // Если результат уже загружен (из поиска), используем его
            if (preloadedResult) {
                result = preloadedResult;
                resultLines = result.trim().split('\n').filter(l => l);
                console.log('[priyomka] Используем предзагруженный результат');
            } else {
                // Пробуем разные варианты поиска
                const variants = [
                    `SELECT kod, quantity, danet FROM vergleich WHERE doknom='${doknom.replace(/'/g, "''")}' ORDER BY kod`,
                    `SELECT kod, quantity, danet FROM vergleich WHERE TRIM(doknom)='${doknom.replace(/'/g, "''")}' ORDER BY kod`,
                    `SELECT kod, quantity, danet FROM vergleich WHERE doknom LIKE '%${doknom.replace(/'/g, "''")}%' ORDER BY kod`
                ];

                let found = false;
                for (const sql of variants) {
                    const encodedSql = encodeURIComponent(sql);
                    const url = `http://${this.serverIp}:8080/query?sql=${encodedSql}`;
                    console.log('[priyomka] Пробую SQL:', sql);

                    const response = await fetch(url, { method: 'GET', mode: 'cors' });
                    const rawResult = await response.text();
                    resultLines = rawResult.trim().split('\n').filter(l => l);

                    console.log('[priyomka] Результат строк:', resultLines.length);

                    if (resultLines.length >= 2) {
                        result = rawResult;
                        found = true;
                        console.log('[priyomka] Нашёл данные!');
                        break;
                    }
                }

                if (!found) {
                    console.error('[priyomka] Не нашёл данные ни одним запросом');
                    container.innerHTML = '<div class="no-data-message">Нет данных для этого документа</div>';
                    return;
                }
            }

            const lines = resultLines;

            // Получаем артикулы и картинки из guide
            const kodList = lines.slice(1).map(l => {
                const parts = l.split('\t');
                return parts[0];
            }).filter(k => k).map(k => `'${k.replace(/'/g, "''")}'`).join(',');

            let artMap = {};
            if (kodList) {
                const artSql = encodeURIComponent(`SELECT "kod", "art" FROM "guide" WHERE "kod" IN (${kodList})`);
                const artUrl = `http://${this.serverIp}:8080/query?sql=${artSql}`;
                const artResp = await fetch(artUrl, { method: 'GET', mode: 'cors' });
                const artResult = await artResp.text();

                const artLines = artResult.trim().split('\n').filter(l => l);
                if (artLines.length >= 2) {
                    const artHeaders = artLines[0].split('\t');
                    const kodIdx = artHeaders.indexOf('kod');
                    const artIdx = artHeaders.indexOf('art');
                    for (let i = 1; i < artLines.length; i++) {
                        const parts = artLines[i].split('\t');
                        artMap[parts[kodIdx]?.trim()] = parts[artIdx]?.trim() || '';
                    }
                }
            }

            this.searchResults = [];
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split('\t');
                const kod = parts[0]?.trim() || '';
                const quantity = parseFloat(parts[1]) || 0;
                const danet = parts[2] || '0';
                const status = danet === '1' ? 'Принят' : 'Не принят';
                const art = artMap[kod] || '—';

                // Не добавляем записи с количеством = 0
                if (quantity === 0) continue;

                this.searchResults.push({
                    poka_nichego: 'пока ничего',
                    kod: kod,
                    art: art,
                    quantity: quantity,
                    status: status
                });
            }

            this.renderMainTable();
            this.showStickersButton();

        } catch (error) {
            console.error('[priyomka] Ошибка загрузки данных:', error);
            container.innerHTML = `<div class="error-message">Ошибка: ${error.message}</div>`;
        }
    },

    // ============================================================
    // ПРИНЯТЬ НА СКЛАД
    // ============================================================
    async acceptToStock() {
        if (this.searchResults.length === 0) {
            alert('⚠️ Нет данных для приёмки. Загрузите документ.');
            return;
        }

        const userId = localStorage.getItem('userId');
        if (!userId) {
            alert('❌ Не авторизован');
            return;
        }

        // Проверяем, не принят ли документ уже
        if (!this.currentDoknom) {
            alert('⚠️ Нет загруженного документа');
            return;
        }
        try {
            const checkDanetSql = `SELECT COUNT(*) as cnt, SUM(CASE WHEN danet=1 THEN 1 ELSE 0 END) as accepted FROM vergleich WHERE doknom='${this.currentDoknom.replace(/'/g, "''")}'`;
            const checkResult = await this.query(checkDanetSql);
            const checkLines = checkResult.trim().split('\n').filter(l => l);
            if (checkLines.length >= 2) {
                const hParts = checkLines[0].split('\t');
                const dParts = checkLines[1].split('\t');
                const cntIdx = hParts.findIndex(h => h.trim().toLowerCase() === 'cnt');
                const accIdx = hParts.findIndex(h => h.trim().toLowerCase() === 'accepted');
                const total = parseInt((cntIdx >= 0 ? dParts[cntIdx] : '0') || '0', 10);
                const accepted = parseInt((accIdx >= 0 ? dParts[accIdx] || '0' : '0'), 10);
                if (total > 0 && accepted >= total) {
                    alert('⚠️ Документ уже принят на склад');
                    return;
                }
            }
        } catch (e) {
            console.error('[priyomka.accept] Ошибка проверки danet:', e);
        }

        // Получаем имя пользователя из sotrud
        let userName = userId;
        try {
            const nameSql = `SELECT "ID", "NAME" FROM "sotrud" WHERE "ID"='${userId.replace(/'/g, "''")}'`;
            const nameResult = await this.query(nameSql);
            const nameLines = nameResult.trim().split('\n').filter(l => l);
            if (nameLines.length >= 2) {
                const nHeaders = nameLines[0].split('\t');
                const nameIdx = nHeaders.indexOf('NAME');
                const nParts = nameLines[1].split('\t');
                userName = nameIdx >= 0 ? nParts[nameIdx]?.trim() || userId : userId;
            }
        } catch (e) {
            console.error('[priyomka] Ошибка получения имени пользователя:', e);
        }

        console.log('[priyomka.accept] userId:', userId, 'userName:', userName);
        console.log('[priyomka.accept] searchResults:', this.searchResults);

        console.log('[priyomka.accept] Кол-во позиций для приёмки:', this.searchResults.length);
        for (const item of this.searchResults.slice(0, 3)) {
            console.log('[priyomka.accept]  - item:', item);
        }

        const now = new Date();
        const dataStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().split(' ')[0];

        console.log('[priyomka.accept] date:', dataStr, 'time:', timeStr);

        let accepted = 0;

        for (const item of this.searchResults) {
            const kod = item.kod;
            const quantity = item.quantity;

            if (!quantity || quantity <= 0) continue;

            // Получаем состав из sostav где upak = 'Да'
            let compResult = '';
            try {
                const compSql = `SELECT "kod2", "koli" FROM "sostav" WHERE "kod"='${kod.replace(/'/g, "''")}' AND "upak"='Да'`;
                compResult = await this.query(compSql);
            } catch (e) {
                console.warn('[priyomka] Ошибка запроса состава для', kod, e);
                compResult = '';
            }

            const compLines = compResult.trim().split('\n').filter(l => l);

            // Основная запись: kod из приёмки, prostuk = 1
            const insertMainSql = `INSERT INTO "history" ("kod", "data", "time", "quantity", "prostuk", "user", "ID_user") VALUES ('${kod.replace(/'/g, "''")}', '${dataStr}', '${timeStr}', ${quantity}, 1, '${userName.replace(/'/g, "''")}', '${userId.replace(/'/g, "''")}')`;
            console.log('[priyomka.accept] INSERT MAIN SQL:', insertMainSql);
            try {
                const mainResult = await this.query(insertMainSql);
                console.log('[priyomka.accept] INSERT MAIN result:', mainResult);
                accepted++;
            } catch (e) {
                console.error('[priyomka] Ошибка вставки основной записи для', kod, e);
            }

            // Записи состава: kod2 из sostav, prostuk = -koli
            console.log('[priyomka.accept] Состав для kod=' + kod + ', compLines:', compLines);
            for (let i = 1; i < compLines.length; i++) {
                const parts = compLines[i].split('\t');
                const kod2 = parts[0]?.trim() || '';
                const koli = parseFloat(parts[1]) || 0;

                if (!kod2) continue;

                const insertCompSql = `INSERT INTO "history" ("kod", "data", "time", "quantity", "prostuk", "user", "ID_user") VALUES ('${kod2.replace(/'/g, "''")}', '${dataStr}', '${timeStr}', ${quantity}, -${koli}, '${userName.replace(/'/g, "''")}', '${userId.replace(/'/g, "''")}')`;
                console.log('[priyomka.accept] INSERT COMP SQL:', insertCompSql);
                try {
                    const compResult = await this.query(insertCompSql);
                    console.log('[priyomka.accept] INSERT COMP result:', compResult);
                } catch (e) {
                    console.error('[priyomka] Ошибка вставки состава для', kod2, e);
                }
            }
        }

        // Обновляем danet = 1 для всех позиций текущего документа
        console.log('[priyomka.accept] Обновляем danet = 1 для doknom:', this.currentDoknom);
        for (const item of this.searchResults) {
            const kod = item.kod;
            const updateDanetSql = `UPDATE "vergleich" SET "danet" = 1 WHERE "doknom" = '${this.currentDoknom.replace(/'/g, "''")}' AND "kod" = '${kod.replace(/'/g, "''")}'`;
            try {
                const danetResult = await this.query(updateDanetSql);
                console.log('[priyomka.accept] danet update для', kod, ':', danetResult);
            } catch (e) {
                console.error('[priyomka.accept] Ошибка обновления danet для', kod, e);
            }
        }

        // Записываем в podmena
        console.log('[priyomka.accept] Запись в podmena для doknom:', this.currentDoknom);
        try {
            const maxKodpodResult = await this.query(`SELECT MAX("kodpod") as mx FROM "podmena"`);
            let kodpod = 1;
            if (maxKodpodResult.trim()) {
                const mxLines = maxKodpodResult.trim().split('\n').filter(l => l);
                if (mxLines.length >= 2) {
                    const hParts = mxLines[0].split('\t');
                    const dParts = mxLines[1].split('\t');
                    const mxIdx = hParts.findIndex(h => h.trim().toLowerCase() === 'mx');
                    const mxVal = parseInt((mxIdx >= 0 ? dParts[mxIdx] : '0') || '0', 10);
                    if (!isNaN(mxVal)) kodpod = mxVal + 1;
                }
            }
            console.log('[priyomka.accept] kodpod начало:', kodpod);

            for (const item of this.searchResults) {
                const kod = item.kod;
                const quantity = item.quantity || 1;

                // Для каждой единицы количества — отдельная запись
                for (let q = 0; q < quantity; q++) {
                    const insertPodmenaSql = `INSERT INTO "podmena" ("kodpod", "kod", "status", "data", "wremja", "SOTRUDNIK", "doknom") VALUES (${kodpod}, '${kod.replace(/'/g, "''")}', 1, '${dataStr}', '${timeStr}', '${userName.replace(/'/g, "''")}', '${this.currentDoknom.replace(/'/g, "''")}')`;
                    console.log('[priyomka.accept] INSERT podmena SQL:', insertPodmenaSql);
                    try {
                        const podmenaResult = await this.query(insertPodmenaSql);
                        console.log('[priyomka.accept] podmena result для', kod, '#'+(q+1), ':', podmenaResult);
                    } catch (e) {
                        console.error('[priyomka.accept] Ошибка вставки в podmena для', kod, '#'+(q+1), e);
                    }
                    kodpod++;
                }
            }
        } catch (e) {
            console.error('[priyomka.accept] Ошибка записи в podmena:', e);
        }

        alert(`✅ Принято на склад: ${accepted} позиций`);
    },

    // ============================================================
    // СТИКЕРЫ
    // ============================================================
    async openStickersModal() {
        if (!this.currentDoknom || this.searchResults.length === 0) {
            alert('⚠️ Нет загруженного документа');
            return;
        }

        try {
            // Загружаем данные из podmena
            const sql = `SELECT "kodpod", "kod" FROM "podmena" WHERE "doknom"='${this.currentDoknom.replace(/'/g, "''")}' ORDER BY "kodpod"`;
            const result = await this.query(sql);
            const lines = result.trim().split('\n').filter(l => l);

            if (lines.length < 2) {
                alert('⚠️ Нет данных в podmena для этого документа');
                return;
            }

            // Получаем артикулы
            const kodList = lines.slice(1).map(l => {
                const parts = l.split('\t');
                return parts[1];
            }).filter(k => k).map(k => `'${k.replace(/'/g, "''")}'`).join(',');

            let artMap = {};
            if (kodList) {
                const artSql = `SELECT "kod", "art" FROM "guide" WHERE "kod" IN (${kodList})`;
                const artResult = await this.query(artSql);
                const artLines = artResult.trim().split('\n').filter(l => l);
                if (artLines.length >= 2) {
                    const artHeaders = artLines[0].split('\t');
                    const kodIdx = artHeaders.indexOf('kod');
                    const artIdx = artHeaders.indexOf('art');
                    for (let i = 1; i < artLines.length; i++) {
                        const parts = artLines[i].split('\t');
                        artMap[parts[kodIdx]?.trim()] = parts[artIdx]?.trim() || '—';
                    }
                }
            }

            // Заполняем таблицу
            const tbody = document.getElementById('stickersTableBody');
            tbody.innerHTML = '';

            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split('\t');
                const kodpod = parts[0]?.trim() || '';
                const kod = parts[1]?.trim() || '';
                const art = artMap[kod] || '—';

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="text-align:center;width:40px;">
                        <input type="checkbox" class="sticker-item-cb" checked>
                    </td>
                    <td style="text-align:center;">${kodpod}</td>
                    <td style="font-weight:600;">${kod}</td>
                    <td>${art}</td>
                `;
                tbody.appendChild(tr);
            }

            // Сбрасываем общий чекбокс
            document.getElementById('selectAllStickers').checked = true;

            // Открываем модальное окно
            document.getElementById('stickersModal').style.display = 'flex';

        } catch (error) {
            console.error('[priyomka] Ошибка загрузки стикеров:', error);
            alert('❌ Ошибка загрузки стикеров: ' + error.message);
        }
    },

    printStickers() {
        const selectedItems = document.querySelectorAll('#stickersTableBody input[type="checkbox"]:checked');
        if (selectedItems.length === 0) {
            alert('⚠️ Выберите хотя бы один стикер');
            return;
        }

        // Собираем данные для печати
        const rows = document.querySelectorAll('#stickersTableBody tr');
        const stickers = [];

        rows.forEach((row, idx) => {
            const cb = row.querySelector('.sticker-item-cb');
            if (cb && cb.checked) {
                const cells = row.querySelectorAll('td');
                stickers.push({
                    kodpod: cells[1]?.textContent || '',
                    kod: cells[2]?.textContent || '',
                    art: cells[3]?.textContent || ''
                });
            }
        });

        // Создаём видимый контейнер для html2pdf
        const container = document.createElement('div');
        container.id = 'stickers-pdf-container';
        container.style.position = 'fixed';
        container.style.top = '-1000px';
        container.style.left = '0';
        container.style.width = 'fit-content';
        container.style.backgroundColor = '#fff';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '0';
        container.style.padding = '0';
        container.style.margin = '0';

        stickers.forEach((item, idx) => {
            const stickerDiv = document.createElement('div');
            stickerDiv.style.width = '58mm';
            stickerDiv.style.height = '40mm';
            stickerDiv.style.padding = '2mm';
            stickerDiv.style.boxSizing = 'border-box';
            stickerDiv.style.pageBreakAfter = 'page';
            stickerDiv.style.pageBreakInside = 'avoid';
            stickerDiv.style.backgroundColor = '#fff';
            stickerDiv.style.display = 'flex';
            stickerDiv.style.flexDirection = 'column';
            stickerDiv.style.alignItems = 'center';
            stickerDiv.style.justifyContent = 'center';
            stickerDiv.style.overflow = 'hidden';
            stickerDiv.style.flexShrink = '0';

            // QR код
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(item.kodpod)}`;

            const img = new Image();
            img.src = qrUrl;
            img.style.width = '40mm';
            img.style.height = '40mm';
            img.style.objectFit = 'contain';
            img.alt = '';
            img.style.display = 'block';

            const artDiv = document.createElement('div');
            artDiv.style.fontSize = '14px';
            artDiv.style.fontWeight = 'bold';
            artDiv.style.marginTop = '2mm';
            artDiv.style.textAlign = 'center';
            artDiv.textContent = item.art;

            const kodDiv = document.createElement('div');
            kodDiv.style.fontSize = '10px';
            kodDiv.style.color = '#666';
            kodDiv.textContent = item.kodpod;

            stickerDiv.appendChild(img);
            stickerDiv.appendChild(artDiv);
            stickerDiv.appendChild(kodDiv);
            container.appendChild(stickerDiv);
        });

        // Добавляем на страницу временно
        document.body.appendChild(container);

        // Ждём загрузки всех изображений и рендеринг
        const allImages = container.querySelectorAll('img');
        let loadedCount = 0;

        const checkAllLoaded = () => {
            loadedCount++;
            if (loadedCount >= allImages.length) {
                console.log('[priyomka] Все QR загружены, генерируем PDF через jsPDF, stickers:', stickers.length);
                document.body.removeChild(container);
                this.generateStickerPDF(stickers);
            }
        };

        allImages.forEach(img => {
            if (img.complete && img.naturalHeight > 0) {
                checkAllLoaded();
            } else {
                img.onload = checkAllLoaded;
                img.onerror = checkAllLoaded;
            }
        });

        // Таймаут - не ждём больше 5 секунд
        setTimeout(() => {
            try { document.body.removeChild(container); } catch(e) {}
            this.generateStickerPDF(stickers);
        }, 5000);
    },

    // ============================================================
    // ГЕНЕРАЦИЯ PDF СТЕРИКЕРОВ ЧЕРЕЗ jsPDF + Canvas
    // ============================================================
    generateStickerPDF(stickersList) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: [58, 40], orientation: 'landscape' });
        let loaded = 0;

        if (stickersList.length === 0) {
            alert('⚠️ Нет стикеров для печати');
            return;
        }

        const processSticker = (item, pageIndex) => {
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(item.kodpod)}`;

            fetch(qrUrl)
                .then(r => r.blob())
                .then(blob => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        // Создаём canvas для рендеринга стикера с кириллицей
                        const canvas = document.createElement('canvas');
                        canvas.width = 600;
                        canvas.height = 400;
                        const ctx = canvas.getContext('2d');

                        // Белый фон
                        ctx.fillStyle = '#fff';
                        ctx.fillRect(0, 0, 600, 400);

                        // QR код в правом верхнем углу (отступы 2mm ≈ 20px)
                        const qrImg = new Image();
                        qrImg.src = reader.result;

                        qrImg.onload = () => {
                            // QR 25mm в правом верхнем углу (отступы 2mm)
                            // 2mm ≈ 20px, QR 25mm ≈ 250px
                            // X = 600 - 20 - 250 = 330
                            ctx.drawImage(qrImg, 330, 20, 250, 250);

                            // kodpod сразу под QR кодом
                            ctx.fillStyle = '#000';
                            ctx.font = '36px Arial, sans-serif'; // kodpod
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            ctx.fillText(item.kodpod, 455, 300);

                            // "3D IDEA" слева по центру
                            ctx.font = 'bold 48px Arial, sans-serif'; // 3D IDEA
                            ctx.fillText('3D IDEA', 100, 200);

                            // Артикул по низу стикера по центру
                            ctx.font = 'bold 58px Arial, sans-serif'; // artikul
                            ctx.fillText(item.art, 200, 350);

                            // Конвертируем canvas в изображение для PDF
                            const stickerData = canvas.toDataURL('image/jpeg', 0.95);

                            if (pageIndex > 0) doc.addPage();
                            doc.addImage(stickerData, 'JPEG', 0, 0, 58, 40);

                            loaded++;
                            if (loaded === stickersList.length) {
                                doc.save(`stickers_${Date.now()}.pdf`);
                            }
                        };

                        qrImg.onerror = () => {
                            // Если QR не загрузился — всё равно показываем стикер
                            if (pageIndex > 0) doc.addPage();
                            doc.addImage(stickerData || '', 'JPEG', 0, 0, 58, 40);
                            loaded++;
                            if (loaded === stickersList.length) {
                                doc.save(`stickers_${Date.now()}.pdf`);
                            }
                        };
                    };
                    reader.readAsDataURL(blob);
                })
                .catch(err => {
                    console.error('[priyomka] Ошибка для', item.kodpod, err);
                    loaded++;
                    if (loaded === stickersList.length) {
                        doc.save(`stickers_${Date.now()}.pdf`);
                    }
                });
        };

        stickersList.forEach((item, idx) => processSticker(item, idx));
    },

    // ============================================================
    // ОТРИСОВКА ГЛАВНОЙ ТАБЛИЦЫ
    // ============================================================
    renderMainTable() {
        const container = document.getElementById('priyomkaTableContainer');
        container.innerHTML = `
            <table class="guide-table">
                <thead>
                    <tr>
                        <th>Пока ничего</th>
                        <th>Код</th>
                        <th>Артикул</th>
                        <th style="width:50px;">Картинка</th>
                        <th>Количество</th>
                        <th>Статус</th>
                    </tr>
                </thead>
                <tbody id="priyomkaTableBody"></tbody>
            </table>
        `;

        const tbody = document.getElementById('priyomkaTableBody');
        for (const item of this.searchResults) {
            this.renderRow(tbody, item);
        }
    },

    renderRow(tbody, item) {
        const tr = document.createElement('tr');
        const imgData = this.imageData[item.kod];
        let imgCell = '';
        if (imgData) {
            imgCell = `<td class="col-image"><img class="warehouse-thumbnail" src="${imgData}" data-kod="${item.kod}" alt="" title="Клик — просмотр"></td>`;
        } else {
            imgCell = `<td class="col-image"><span class="no-image" data-kod="${item.kod}" title="Нет изображения">+</span></td>`;
        }

        tr.innerHTML = `
            <td class="col-poka-nichego">${item.poka_nichego || 'пока ничего'}</td>
            <td class="col-kod">${item.kod}</td>
            <td class="col-art">${item.art}</td>
            ${imgCell}
            <td class="col-qty">${item.quantity}</td>
            <td class="col-status">${item.status}</td>
        `;
        tbody.appendChild(tr);
    },

    filterTable(searchTerm) {
        const rows = document.querySelectorAll('#priyomkaTableBody tr');
        const term = searchTerm.toLowerCase();

        rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(term) ? '' : 'none';
        });
    },

    async loadData() {
        // Загрузка основных данных (если нужно)
    },

    async query(sql) {
        console.log('[priyomka.query] SQL:', sql);
        const encodedSql = encodeURIComponent(sql.trim());
        const url = `http://${this.serverIp}:8080/query?sql=${encodedSql}`;
        console.log('[priyomka.query] URL:', url);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        try {
            const response = await fetch(url, {
                method: 'GET',
                mode: 'cors',
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            const text = await response.text();
            console.log('[priyomka.query] Status:', response.status, 'Response:', text);
            if (!response.ok) {
                console.error('[priyomka.query] ❌ HTTP error:', response.status, text);
            }
            return text;
        } catch (error) {
            clearTimeout(timeoutId);
            console.error('[priyomka.query] ❌ Fetch error:', error);
            throw error;
        }
    }
};

// ============================================================
// ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    PRIYOMKA.init();
});
