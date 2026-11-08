// ============================================================
// PRIYOMKA PAGE - JavaScript
// ============================================================

const PRIYOMKA = {
    serverIp: null,
    searchResults: [],
    selectedItems: new Set(),
    currentDoknom: null,
    imageData: {}, // { kod: base64data }
    _currentProfile: null, // профиль стикера по умолчанию

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

        // Фокус на поле поиска при загрузке страницы
        document.getElementById('searchInput').focus();

        // Загружаем профиль стикера по умолчанию
        await this.loadStickerProfile();
    },

    // ============================================================
    // ЗАГРУЗКА ПРОФИЛЯ СТИКЕРА
    // ============================================================
    async loadStickerProfile() {
        try {
            const result = await this.query('SELECT "id","name","width_mm","height_mm","elements" FROM "sticker_profiles" WHERE "is_default"=1 LIMIT 1');
            const lines = result.trim().split('\n').filter(l => l);
            if (lines.length >= 2) {
                const h = lines[0].split('\t');
                const p = lines[1].split('\t');
                const gv = n => { const i = h.indexOf(n); return i >= 0 ? p[i] : ''; };
                const widthMM = parseInt(gv('width_mm')) || 58;
                const heightMM = parseInt(gv('height_mm')) || 40;
                const elementsData = JSON.parse(gv('elements'));
                const elements = Array.isArray(elementsData.elements) ? elementsData.elements : elementsData;
                this._currentProfile = { widthMM: widthMM, heightMM: heightMM, elements: elements };
                console.log('[priyomka] ✅ Профиль загружен:', this._currentProfile);
                console.log('[priyomka]   width:', widthMM, 'height:', heightMM);
                console.log('[priyomka]   elements:', elements.length);
                elements.forEach(el => console.log('[priyomka]   -', el));
            }
        } catch (e) { console.warn('[priyomka] Профиль не найден, используем встроенный'); this._currentProfile = null; }
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
            window.history.back();
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
    // ПРИНЯТЬ НА СКЛАД (ОПТИМИЗИРОВАННОЕ)
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

        if (!this.currentDoknom) {
            alert('⚠️ Нет загруженного документа');
            return;
        }

        console.log('[priyomka.accept] === НАЧАЛО ПРИЁМКИ (ОПТИМИЗИРОВАННОЕ) ===');
        console.log('[priyomka.accept] currentDoknom:', this.currentDoknom);
        console.log('[priyomka.accept] searchResults.length:', this.searchResults.length);

        try {
            // 1. Проверяем, не принят ли документ уже
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

            // 2. Получаем имя пользователя и stavka из sotrud
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

            const now = new Date();
            const dataStr = now.toISOString().split('T')[0];
            const timeStr = now.toTimeString().split(' ')[0];
            const userIdEsc = userId.replace(/'/g, "''");
            const userNameEsc = userName.replace(/'/g, "''");
            const doknomEsc = this.currentDoknom.replace(/'/g, "''");

            // 3. Загружаем составы пачкой (IN list) — ДО начала основных запросов
            const kods = this.searchResults.filter(i => i.quantity > 0).map(i => `'${i.kod.replace(/'/g, "''")}'`).join(',');
            let compResult = '';
            if (kods) {
                const compSql = `SELECT "kod", "kod2", "koli" FROM "sostav" WHERE "kod" IN (${kods}) AND "upak"='Да'`;
                compResult = await this.query(compSql);
            }
            console.log('[priyomka.accept] compResult:', compResult);

            // Парсим составы в map: kod -> [{kod2, koli}]
            const compMap = {};
            if (compResult?.trim()) {
                const compLines = compResult.trim().split('\n').filter(l => l);
                for (let i = 1; i < compLines.length; i++) {
                    const parts = compLines[i].split('\t');
                    const kod = parts[0]?.trim() || '';
                    const kod2 = parts[1]?.trim() || '';
                    const koli = parseFloat(parts[2]) || 0;
                    if (kod && kod2) {
                        if (!compMap[kod]) compMap[kod] = [];
                        compMap[kod].push({ kod2, koli });
                    }
                }
            }

            // 4. Получаем max kodpod для podmena — ДО начала вставок
            let kodpod = 1;
            try {
                const maxKodpodResult = await this.query(`SELECT MAX("kodpod") as mx FROM "podmena"`);
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
            } catch (e) {
                console.warn('[priyomka.accept] Ошибка получения max kodpod:', e);
            }
            console.log('[priyomka.accept] kodpod начало:', kodpod);

            // 5. Формируем bulk INSERT для history (основные записи)
            const mainValues = [];
            const compValues = [];
            let acceptedCount = 0;

            for (const item of this.searchResults) {
                const kod = item.kod;
                const quantity = item.quantity;
                if (!quantity || quantity <= 0) continue;

                const kodEsc = kod.replace(/'/g, "''");

                // Основная запись
                mainValues.push(`('${kodEsc}', '${dataStr}', '${timeStr}', ${quantity}, 1, '${userNameEsc}', '${userIdEsc}')`);
                acceptedCount++;

                // Состав
                const comps = compMap[kod];
                if (comps) {
                    for (const c of comps) {
                        const kod2Esc = c.kod2.replace(/'/g, "''");
                        compValues.push(`('${kod2Esc}', '${dataStr}', '${timeStr}', ${quantity}, -${c.koli}, '${userNameEsc}', '${userIdEsc}')`);
                    }
                }
            }

            console.log('[priyomka.accept] mainValues.count:', mainValues.length);
            console.log('[priyomka.accept] compValues.count:', compValues.length);

            // 6. Выполняем bulk INSERT для history (основные)
            if (mainValues.length > 0) {
                const bulkSql = `INSERT INTO "history" ("kod", "data", "time", "quantity", "prostuk", "user", "ID_user") VALUES ${mainValues.join(', ')};`;
                console.log('[priyomka.accept] Bulk INSERT main history:', bulkSql.substring(0, 200) + '...');
                await this.query(bulkSql, 30000);
            }

            // 7. Выполняем bulk INSERT для состава
            if (compValues.length > 0) {
                const bulkCompSql = `INSERT INTO "history" ("kod", "data", "time", "quantity", "prostuk", "user", "ID_user") VALUES ${compValues.join(', ')};`;
                console.log('[priyomka.accept] Bulk INSERT comp history:', bulkCompSql.substring(0, 200) + '...');
                await this.query(bulkCompSql, 30000);
            }

            // 8. Обновляем danet одним запросом на весь документ
            console.log('[priyomka.accept] UPDATE danet = 1 для doknom:', this.currentDoknom);
            await this.query(`UPDATE "vergleich" SET "danet" = 1 WHERE "doknom" = '${doknomEsc}';`, 15000);

            // 9. Формируем bulk INSERT для podmena
            const podmenaValues = [];
            for (const item of this.searchResults) {
                const kod = item.kod;
                const quantity = item.quantity || 1;
                const kodEsc = kod.replace(/'/g, "''");

                for (let q = 0; q < quantity; q++) {
                    podmenaValues.push(`(${kodpod}, '${kodEsc}', 1, '${dataStr}', '${timeStr}', '${userNameEsc}', '${doknomEsc}')`);
                    kodpod++;
                }
            }

            console.log('[priyomka.accept] podmenaValues.count:', podmenaValues.length);
            // Разбиваем на пачки по 20 записей, чтобы не превысить лимит длины URL
            const batchSize = 20;
            for (let i = 0; i < podmenaValues.length; i += batchSize) {
                const batch = podmenaValues.slice(i, i + batchSize);
                const bulkPodmenaSql = `INSERT INTO "podmena" ("kodpod", "kod", "status", "data", "wremja", "SOTRUDNIK", "doknom") VALUES ${batch.join(', ')};`;
                console.log('[priyomka.accept] Bulk INSERT podmena batch', Math.floor(i/batchSize)+1, ':', bulkPodmenaSql.substring(0, 200) + '...');
                await this.query(bulkPodmenaSql, 30000);
            }

            console.log('[priyomka.accept] ✅ ПРИЁМКА ЗАВЕРШЕНА УСПЕШНО. Принято:', acceptedCount);

            // Показываем toast-уведомление
            this.showSuccessToast(`✅ Принято на склад: ${acceptedCount} позиций`);

        } catch (error) {
            console.error('[priyomka.accept] ❌ ОШИБКА приёмки:', error);
            console.log('[priyomka.accept] ROLLBACK');
            try {
                await this.query('ROLLBACK;');
            } catch (rbError) {
                console.error('[priyomka.accept] Ошибка отката транзакции:', rbError);
            }
            alert(`❌ Ошибка приёмки: ${error.message || 'Неизвестная ошибка'}`);
        }
    },

    // ============================================================
    // TOAST-УВЕДОМЛЕНИЕ
    // ============================================================
    showSuccessToast(message) {
        // Удаляем старый toast если есть
        const oldToast = document.querySelector('.priyomka-toast');
        if (oldToast) oldToast.remove();

        const toast = document.createElement('div');
        toast.className = 'priyomka-toast';
        toast.textContent = message;
        document.body.appendChild(toast);

        // Анимация появления
        setTimeout(() => toast.classList.add('show'), 10);

        // Автоудаление через 2 секунды
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 2000);
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

    // ============================================================
    // СТИКЕРЫ — ПЕЧАТЬ QR-ЭТИКЕТОК (оптимизировано)
    // ============================================================

    // Кэш QR-кодов: kodpod -> Image object
    _qrCache: new Map(),

    async getQRImage(kodpod) {
        if (this._qrCache.has(kodpod)) {
            return this._qrCache.get(kodpod);
        }

        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(kodpod)}&bgcolor=ffffff&color=000000`;

        try {
            const response = await fetch(qrUrl, { cache: 'force-cache' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            const img = await createImageBitmap(blob);
            this._qrCache.set(kodpod, img);
            return img;
        } catch (e) {
            console.warn('[priyomka] QR API failed, generating canvas fallback:', e);
            return this._canvasQRImage(kodpod);
        }
    },

    _canvasQRImage(data) {
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 200;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 200, 200);

        // Finder patterns
        const s = 200 / 25;
        const drawFinder = (ox, oy) => {
            ctx.fillStyle = '#000';
            for (let dy = 0; dy < 7; dy++) {
                for (let dx = 0; dx < 7; dx++) {
                    if (dy === 0 || dy === 6 || dx === 0 || dx === 6 ||
                        (dy >= 2 && dy <= 4 && dx >= 2 && dx <= 4)) {
                        ctx.fillRect((ox + dx) * s, (oy + dy) * s, s, s);
                    }
                }
            }
        };
        drawFinder(0, 0);
        drawFinder(18 * s, 0);
        drawFinder(0, 18 * s);

        // Data pattern (simplified)
        ctx.fillStyle = '#000';
        const seed = data.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
        for (let y = 0; y < 25; y++) {
            for (let x = 0; x < 25; x++) {
                const hash = Math.sin(seed * 9301 + x * 49297 + y * 61637) * 10000;
                if (hash - Math.floor(hash) > 0.55) {
                    ctx.fillRect(x * s, y * s, s, s);
                }
            }
        }

        return canvas;
    },

    async printStickers() {
        const selectedItems = document.querySelectorAll('#stickersTableBody input[type="checkbox"]:checked');
        if (selectedItems.length === 0) {
            alert('⚠️ Выберите хотя бы один стикер');
            return;
        }

        const rows = document.querySelectorAll('#stickersTableBody tr');
        const stickers = [];

        rows.forEach(row => {
            const cb = row.querySelector('.sticker-item-cb');
            if (cb && cb.checked) {
                const cells = row.querySelectorAll('td');
                const kodpod = cells[1]?.textContent?.trim() || '';
                const kod = cells[2]?.textContent?.trim() || '';
                const art = cells[3]?.textContent?.trim() || '';
                if (kodpod) {
                    stickers.push({ kodpod, kod, art });
                }
            }
        });

        if (stickers.length === 0) {
            alert('⚠️ Нет данных для печати');
            return;
        }

        const count = stickers.length;
        console.log('[priyomka] Печать стикеров:', count);

        // Показываем прогресс
        const start = Date.now();
        const progressInterval = setInterval(() => {
            const elapsed = ((Date.now() - start) / 1000).toFixed(0);
            console.log(`[priyomka] ⏳ Генерация... ${elapsed}с`);
        }, 500);

        try {
            const { jsPDF } = window.jspdf;

            // Размер PDF под профиль
            const pdfWidth = this._currentProfile ? this._currentProfile.widthMM : 58;
            const pdfHeight = this._currentProfile ? this._currentProfile.heightMM : 40;
            const doc = new jsPDF({ unit: 'mm', format: [pdfWidth, pdfHeight], orientation: 'landscape' });

            // Размер canvas: под профиль
            const scale = 3;
            const canvasW = Math.round(pdfWidth * 3.78 * scale);
            const canvasH = Math.round(pdfHeight * 3.78 * scale);

            // QR размеры в пикселях
            const qrSizeMM = 24;
            const qrSizePx = Math.round(qrSizeMM * 3.78 * scale);
            const qrMarginPx = Math.round(2 * 3.78 * scale);

            // Кэшируем Image объекты для многократного использования
            const imgCache = new Map();

            // Параллельно загружаем все QR
            const qrPromises = stickers.map(s => this.getQRImage(s.kodpod));
            const qrImages = await Promise.all(qrPromises);

            // Параллельно рендерим все стикеры
            const renderPromises = qrImages.map(async (qrImg, i) => {
                const item = stickers[i];

                // Кэш image
                if (imgCache.has(item.kodpod)) {
                    return imgCache.get(item.kodpod);
                }

                return new Promise((resolve) => {
                    const canvas = document.createElement('canvas');
                    canvas.width = canvasW;
                    canvas.height = canvasH;
                    const ctx = canvas.getContext('2d');

                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, canvasW, canvasH);

                    const pxPerMM = 3.78 * scale;

                    // Если есть профиль — используем его элементы
                    if (this._currentProfile) {
                        // Извлекаем конфигурацию QR из профиля
                        const qrConfig = (this._currentProfile.elements || []).find(function(el) { return el.type === 'qr'; }) || { sizeMM: 24, marginMM: 2 };
                        console.log('[priyomka] Печать стикера, qrConfig:', qrConfig);
                        console.log('[priyomka] Печать стикера, profile:', JSON.stringify(this._currentProfile));

                        // QR из изображения
                        const qrSizePx = Math.round(qrConfig.sizeMM * pxPerMM);
                        const qrMarginPx = Math.round(qrConfig.marginMM * pxPerMM);
                        ctx.drawImage(qrImg, canvasW - qrSizePx - qrMarginPx, qrMarginPx, qrSizePx, qrSizePx);

                        // Передаём QR-конфиг в рендер для kodpod
                        this.renderStickerFromProfile(ctx, item, this._currentProfile, canvasW, canvasH, pxPerMM, qrConfig);
                    } else {
                        // Fallback: хардкод
                        this.renderStickerFallback(ctx, item, canvasW, canvasH, scale);
                    }

                    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
                    imgCache.set(item.kodpod, dataUrl);
                    resolve(dataUrl);
                });
            });

            const stickerDataUrls = await Promise.all(renderPromises);

            // Собираем PDF
            for (let i = 0; i < stickerDataUrls.length; i++) {
                if (i > 0) doc.addPage();
                doc.addImage(stickerDataUrls[i], 'JPEG', 0, 0, pdfWidth, pdfHeight);
            }

            doc.save(`stickers_${Date.now()}.pdf`);
            clearInterval(progressInterval);
            console.log('[priyomka] ✅ PDF готов за', ((Date.now() - start) / 1000).toFixed(1), 'с');
        } catch (err) {
            clearInterval(progressInterval);
            console.error('[priyomka] Ошибка генерации PDF:', err);
            alert('❌ Ошибка генерации PDF: ' + err.message);
        }
    },

    truncateStr(str, maxLen) {
        if (!str) return '';
        if (str.length <= maxLen) return str;
        return str.substring(0, maxLen - 1) + '…';
    },

    // ============================================================
    // РЕНДЕР СТИКЕРА ИЗ ПРОФИЛЯ
    // ============================================================
    renderStickerFromProfile(ctx, item, profile, canvasW, canvasH, pxPerMM, qrConfig) {
        const data = {
            kodpod: item.kodpod || '',
            art: item.art || '',
            kod: item.kod || ''
        };

        // Если qrConfig не передан — ищем в профиле
        if (!qrConfig) {
            const qrEl = profile.elements.find(function(el) { return el.type === 'qr'; });
            if (qrEl) {
                qrConfig = { sizeMM: qrEl.sizeMM || 24, marginMM: qrEl.marginMM || 2 };
            } else {
                qrConfig = { sizeMM: 24, marginMM: 2 };
            }
        }

        for (const el of (profile.elements || [])) {
            // QR-элемент пропускаем — QR уже как картинка
            if (el.type === 'qr') continue;
            this.renderProfileElement(ctx, el, data, canvasW, canvasH, pxPerMM, qrConfig);
        }
    },

    renderProfileElement(ctx, el, data, canvasW, canvasH, pxPerMM, qrConfig) {
        const p = pxPerMM;
        const wMM = canvasW / p;
        const hMM = canvasH / p;

        // Debug: выводим настройки каждого элемента
        console.log('[priyomka] renderProfileElement:', el.type, el, 'wMM:', wMM, 'hMM:', hMM, 'qrConfig:', qrConfig);

        switch (el.type) {
            case 'text': {
                const fs = Math.round(el.fontSize * p / 3.78);
                ctx.font = 'bold ' + fs + 'px Arial, sans-serif';
                ctx.fillStyle = '#000000';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';
                const y = (el.topMM || 20) * p + fs * 0.8;
                const x = (el.leftMM || 10) * p;
                console.log('[priyomka]   text:', el.value, 'font:', fs, 'pos:', x, y);
                ctx.fillText(el.value || '3D IDEA', x, y);
                break;
            }
            case 'art': {
                const val = data.art || '';
                const fs = Math.round(el.fontSize * p / 3.78);
                ctx.font = 'bold ' + fs + 'px Arial, sans-serif';
                ctx.fillStyle = '#000000';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'alphabetic';
                const mw = (el.maxWidthMM || 54) * p;
                const ax = wMM * p / 2;
                const ay = (hMM - (el.bottomMM || 12)) * p + fs * 0.8;
                console.log('[priyomka]   art: fs:', fs, 'mw:', mw, 'pos:', ax, ay);
                this.drawArtText(ctx, val, ax, ay, fs, mw, el.lineGap || 0.7);
                break;
            }
            case 'kodpod': {
                const val = data[el.dataField] || data.kodpod || '';
                const fs = Math.round(el.fontSize * p / 3.78);
                ctx.font = 'bold ' + fs + 'px Arial, sans-serif';
                ctx.fillStyle = '#000000';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';
                // Координаты относительно левого верхнего угла стикера
                const x = (el.leftMM != null ? el.leftMM : 10) * p;
                const y = (el.topMM != null ? el.topMM : 30) * p + fs * 0.8;
                console.log('[priyomka]   kodpod: fs:', fs, 'pos:', x, y, 'val:', val);
                ctx.fillText(val, x, y);
                break;
            }
        }
    },

    drawArtText(ctx, art, x, y, fontSize, maxWidth, lineGap) {
        const words = (art || '').split(/\s+/).filter(function(w) { return w; });
        if (ctx.measureText(art).width <= maxWidth) { ctx.fillText(art, x, y); return; }
        let l1 = words[0], l2 = '';
        for (let i = 1; i < words.length; i++) {
            const t = l1 + ' ' + words[i];
            if (ctx.measureText(t).width <= maxWidth) l1 = t; else { l2 = words.slice(i).join(' '); break; }
        }
        const gap = fontSize * (lineGap || 0.5);
        ctx.fillText(l1, x, y - gap);
        if (l2) ctx.fillText(l2, x, y + gap);
    },

    renderStickerFallback(ctx, item, canvasW, canvasH, scale) {
        const pxPerMM = 3.78 * scale;
        const p = pxPerMM;
        const wMM = canvasW / p;
        const hMM = canvasH / p;

        const kodpodFontSize = Math.round(11 * scale);
        const brandFontSize = Math.round(18 * scale);
        const artFontSizePx = Math.round(20 * scale);
        const artLineGap = Math.round(artFontSizePx * 0.7);
        const artMaxWidth = Math.round(54 * pxPerMM);

        const qrSizePx = Math.round(24 * pxPerMM);
        const qrMarginPx = Math.round(2 * pxPerMM);
        const kodpodX = canvasW - qrSizePx - qrMarginPx + qrSizePx / 2;
        const kodpodY = qrSizePx + Math.round(3 * pxPerMM);
        const brandX = Math.round(10 * pxPerMM);
        const brandY = canvasH / 2;
        const artX = canvasW / 2;
        const artY = canvasH - Math.round(12 * pxPerMM);

        ctx.fillStyle = '#000000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${kodpodFontSize}px Arial, sans-serif`;
        ctx.fillText(this.truncateStr(item.kodpod, 10), kodpodX, kodpodY);
        ctx.font = `bold ${brandFontSize}px Arial, sans-serif`;
        ctx.fillText('3D IDEA', brandX, brandY);
        this.splitArtByWidth(ctx, item.art, artX, artY, artFontSizePx, artMaxWidth, artLineGap);
    },

    splitArtByWidth(ctx, art, x, y, fontSize, maxWidth, lineGap) {
        if (!art) return 0;

        ctx.font = `bold ${fontSize}px Arial, sans-serif`;
        const words = art.split(/\s+/).filter(w => w);

        // Пробуем одну строку
        if (ctx.measureText(art).width <= maxWidth) {
            ctx.fillText(art, x, y);
            return 1;
        }

        // Две строки — сначала слова в первую, потом во вторую
        let line1 = words[0];
        let line2 = '';

        for (let i = 1; i < words.length; i++) {
            const testLine1 = line1 + ' ' + words[i];
            if (ctx.measureText(testLine1).width <= maxWidth) {
                line1 = testLine1;
            } else {
                // Остальное во вторую строку
                line2 = words.slice(i).join(' ');
                break;
            }
        }

        // Рисуем
        ctx.fillText(line1, x, y - lineGap);
        if (line2) {
            ctx.fillText(line2, x, y + lineGap);
        }

        return 2;
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

    async query(sql, timeoutMs = 10000) {
        console.log('[priyomka.query] SQL:', sql.substring(0, 200) + (sql.length > 200 ? '...' : ''));
        const encodedSql = encodeURIComponent(sql.trim());
        const url = `http://${this.serverIp}:8080/query?sql=${encodedSql}`;
        console.log('[priyomka.query] URL:', url);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, {
                method: 'GET',
                mode: 'cors',
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            const text = await response.text();
            console.log('[priyomka.query] Status:', response.status, 'Response:', text.substring(0, 100));
            if (!response.ok) {
                console.error('[priyomka.query] ❌ HTTP error:', response.status, text);
                throw new Error(text); // Бросаем ошибку, чтобы код продолжения знал, что запрос не удался
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
