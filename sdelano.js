// ============================================================
// SDÉLANO PAGE - JavaScript
// ============================================================

const SDELANO = {
    serverIp: null,
    imageData: {},
    isAdmin: false,
    currentDocNomer: null,
    currentDocAuthor: null,
    currentDocItems: [],

    async init() {
        this.serverIp = localStorage.getItem('serverIp');
        if (!this.serverIp) {
            window.location.href = 'login.html';
            return;
        }

        await this.checkAdminStatus();
        this.bindEvents();
        await this.loadData();

        // Устанавливаем сегодня в поля дат
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('periodStart').value = today;
        document.getElementById('periodEnd').value = today;
    },

    async checkAdminStatus() {
        try {
            const userId = localStorage.getItem('userId');
            if (!userId) return;

            const result = await this.query(`SELECT "status" FROM "sotrud" WHERE "ID"='${userId.replace(/'/g, "''")}'`);
            if (result?.trim()) {
                const lines = result.trim().split('\n').filter(l => l);
                if (lines.length >= 2) {
                    const data = lines[1].split('\t');
                    const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
                    const statusIdx = headers.indexOf('status');
                    if (statusIdx >= 0) {
                        this.isAdmin = data[statusIdx]?.trim().toLowerCase() === 'админ';
                    }
                }
            }
        } catch (e) {
            console.error('Ошибка проверки статуса:', e);
        }
    },

    bindEvents() {
        const safeAdd = (selector, event, handler) => {
            const el = document.querySelector(selector);
            if (el) el.addEventListener(event, handler);
        };

        safeAdd('#backBtn', 'click', () => {
            this.saveToWarehouse();
        });

        safeAdd('#refreshBtn', 'click', () => {
            this.loadData();
        });

        safeAdd('#saveAllBtn', 'click', () => {
            this.saveAll();
        });

        safeAdd('#searchInput', 'input', () => {
            this.filterTable();
        });

        safeAdd('#periodBtn', 'click', () => {
            this.openPeriodModal();
        });

        safeAdd('#loadDocsBtn', 'click', () => {
            this.loadDocuments();
        });

        safeAdd('#closePeriodBtn', 'click', () => {
            document.getElementById('periodModal').style.display = 'none';
        });

        safeAdd('#saveDocBtn', 'click', () => {
            this.saveDocEdit();
        });

        safeAdd('#closeDocViewBtn', 'click', () => {
            document.getElementById('docViewModal').style.display = 'none';
            document.getElementById('periodModal').style.display = 'flex';
        });

        safeAdd('#sdelanoImageFullview', 'click', () => {
            document.getElementById('sdelanoImageFullview').classList.remove('active');
        });

        // Крестики закрытия модальных окон
        document.querySelectorAll('.btn-modal-close').forEach(btn => {
            btn.addEventListener('click', () => {
                const modal = btn.closest('.warehouse-modal');
                if (modal) modal.style.display = 'none';
            });
        });

        // Кнопки печати
        safeAdd('#printYesBtn', 'click', () => {
            this.pdfDataForPrint = null; // сброс
            this.generatePDF();
            document.getElementById('printConfirmModal').style.display = 'none';
            setTimeout(() => this.goToWarehouse(), 500);
        });

        safeAdd('#printNoBtn', 'click', () => {
            document.getElementById('printConfirmModal').style.display = 'none';
            setTimeout(() => this.goToWarehouse(), 500);
        });
    },

    goToWarehouse() {
        window.location.href = 'warehouse.html';
    },

    openPeriodModal() {
        document.getElementById('periodModal').style.display = 'flex';
        document.getElementById('docsListWrapper').style.display = 'none';
    },

    async loadDocuments() {
        const startDate = document.getElementById('periodStart').value;
        const endDate = document.getElementById('periodEnd').value;

        if (!startDate || !endDate) {
            alert('Выберите начало и конец периода');
            return;
        }

        try {
            const sql = `SELECT doknom, name, data, SUM(quantity) as total_qty, MAX(redakt_id) as has_redakt FROM vergleich WHERE data BETWEEN '${startDate}' AND '${endDate}' GROUP BY doknom, name, data ORDER BY data DESC`;
            const result = await this.query(sql);

            if (!result?.trim()) {
                document.getElementById('docsListBody').innerHTML = '<tr><td colspan="4" style="text-align:center;color:#a0a0c0;">Нет документов за этот период</td></tr>';
                document.getElementById('docsListWrapper').style.display = 'block';
                return;
            }

            const lines = result.trim().split('\n').filter(l => l);
            if (lines.length < 2) {
                document.getElementById('docsListBody').innerHTML = '<tr><td colspan="4" style="text-align:center;color:#a0a0c0;">Нет документов за этот период</td></tr>';
                document.getElementById('docsListWrapper').style.display = 'block';
                return;
            }

            const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
            const doknomIdx = headers.indexOf('doknom');
            const nameIdx = headers.findIndex(h => h === 'name' || h === 'наименование' || h === 'имя');
            const dataIdx = headers.indexOf('data');
            const totalQtyIdx = headers.findIndex(h => h.includes('total') || h === 'total_qty' || h.includes('sum'));
            const redaktIdx = headers.findIndex(h => h.includes('redakt'));

            let html = '';
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split('\t');
                const doknom = doknomIdx >= 0 ? parts[doknomIdx]?.trim() : '';
                const author = nameIdx >= 0 ? parts[nameIdx]?.trim() : '';
                const date = dataIdx >= 0 ? parts[dataIdx]?.trim() : '';
                const total = totalQtyIdx >= 0 ? parts[totalQtyIdx]?.trim() : '';
                const isEdited = redaktIdx >= 0 && parts[redaktIdx]?.trim();

                const rowClass = isEdited ? 'edited-doc' : '';

                html += `<tr class="${rowClass}" style="cursor:pointer;" data-doknom="${doknom}">
                    <td><strong>${this.escapeHtml(doknom)}</strong></td>
                    <td>${this.escapeHtml(author)}</td>
                    <td>${this.escapeHtml(date)}</td>
                    <td>${total}</td>
                </tr>`;
            }

            document.getElementById('docsListBody').innerHTML = html;
            document.getElementById('docsListWrapper').style.display = 'block';

            // Привязываем клик на строку
            document.querySelectorAll('#docsListBody tr[data-doknom]').forEach(row => {
                row.addEventListener('click', () => {
                    const doknom = row.getAttribute('data-doknom');
                    this.showDocumentView(doknom);
                });
            });

        } catch (error) {
            console.error('Ошибка загрузки документов:', error);
            alert('Ошибка: ' + error.message);
        }
    },

    async showDocumentView(doknom) {
        document.getElementById('periodModal').style.display = 'none';
        document.getElementById('docViewModal').style.display = 'flex';
        document.getElementById('docViewNomer').textContent = doknom;
        document.getElementById('docViewLoading').style.display = 'block';
        document.getElementById('docViewContent').style.display = 'none';

        try {
            // Получаем строки документа
            const sql = `SELECT kod, quantity, rabota_time, danet, IDname, data, redakt_id, redakt_name, redakt_date, redakt_time, redakt_quantity FROM vergleich WHERE doknom='${doknom.replace(/'/g, "''")}' ORDER BY kod`;
            const result = await this.query(sql);

            if (!result?.trim()) {
                document.getElementById('docViewBody').innerHTML = '';
                document.getElementById('docViewEmptyMsg').style.display = 'block';
                document.getElementById('docViewLoading').style.display = 'none';
                document.getElementById('docViewContent').style.display = 'block';
                return;
            }

            const lines = result.trim().split('\n').filter(l => l);
            if (lines.length < 2) {
                document.getElementById('docViewBody').innerHTML = '';
                document.getElementById('docViewEmptyMsg').style.display = 'block';
                document.getElementById('docViewLoading').style.display = 'none';
                document.getElementById('docViewContent').style.display = 'block';
                return;
            }

            const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
            const kodIdx = headers.indexOf('kod');
            const quantityIdx = headers.indexOf('quantity');
            const rabotaTimeIdx = headers.indexOf('rabota_time');
            const danetIdx = headers.indexOf('danet');
            const idNameIdx = headers.indexOf('idname');

            const firstParts = lines[1].split('\t');
            const authorId = idNameIdx >= 0 ? firstParts[idNameIdx]?.trim() : '';
            const totalQty = lines.length - 1;

            // Получаем имя создателя
            const authorResult = await this.query(`SELECT "name" FROM "sotrud" WHERE "ID"='${authorId.replace(/'/g, "''")}'`);
            let authorName = authorId;
            if (authorResult?.trim()) {
                const aLines = authorResult.trim().split('\n').filter(l => l);
                if (aLines.length >= 2) {
                    const aParts = aLines[1].split('\t');
                    const aHeaders = aLines[0].split('\t').map(h => h.trim().toLowerCase());
                    const nameIdx = aHeaders.findIndex(h => h === 'name' || h === 'наименование');
                    if (nameIdx >= 0) authorName = aParts[nameIdx]?.trim() || authorId;
                }
            }

            this.currentDocNomer = doknom;
            this.currentDocAuthor = authorId;
            this.currentDocItems = [];

            // Получаем артиклы для всех kod одним запросом
            const kodList = [];
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split('\t');
                const kod = kodIdx >= 0 ? parts[kodIdx]?.trim() : '';
                if (kod) kodList.push(kod);
            }

            const artResult = await this.query(`SELECT "kod", "art" FROM "guide" WHERE "kod" IN (${kodList.map(k => `'${k.replace(/'/g, "''")}'`).join(',')})`);
            const artMap = {};
            if (artResult?.trim()) {
                const artLines = artResult.trim().split('\n').filter(l => l);
                if (artLines.length > 1) {
                    const artHeaders = artLines[0].split('\t').map(h => h.trim().toLowerCase());
                    const akIdx = artHeaders.indexOf('kod');
                    const aartIdx = artHeaders.indexOf('art');
                    for (let i = 1; i < artLines.length; i++) {
                        const aParts = artLines[i].split('\t');
                        const ak = akIdx >= 0 ? aParts[akIdx]?.trim() : '';
                        const aart = aartIdx >= 0 ? aParts[aartIdx]?.trim() : '';
                        if (ak) artMap[ak] = aart;
                    }
                }
            }

            // Проверяем были ли редактирования
            const redaktIdIdx = headers.indexOf('redakt_id');
            const redaktNameIdx = headers.indexOf('redakt_name');
            const redaktDateIdx = headers.indexOf('redakt_date');
            const redaktTimeIdx = headers.indexOf('redakt_time');

            let hasEdits = false;
            let editInfoHtml = '';

            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split('\t');
                if (redaktIdIdx >= 0 && parts[redaktIdIdx]?.trim()) {
                    hasEdits = true;
                    const redaktName = redaktNameIdx >= 0 ? parts[redaktNameIdx]?.trim() : '';
                    const redaktDate = redaktDateIdx >= 0 ? parts[redaktDateIdx]?.trim() : '';
                    const redaktTime = redaktTimeIdx >= 0 ? parts[redaktTimeIdx]?.trim() : '';
                    editInfoHtml = ` <span style="color:#f39c12;">| Редактировал: ${this.escapeHtml(redaktName)} (${redaktDate} ${redaktTime})</span>`;
                    break;
                }
            }

            // Проверяем права
            const userId = localStorage.getItem('userId');
            const isCreator = authorId === userId;
            const canEdit = isCreator || this.isAdmin;

            document.getElementById('docViewAuthor').textContent = authorName || '—';
            document.getElementById('docViewDate').innerHTML = (lines[1].split('\t')[headers.indexOf('data')] || '') + editInfoHtml;
            document.getElementById('docViewTotal').textContent = totalQty;

            let html = '';
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split('\t');
                const kod = kodIdx >= 0 ? parts[kodIdx]?.trim() : '';
                const quantity = quantityIdx >= 0 ? parseInt(parts[quantityIdx]) || 0 : 0;

                // Проверяем наличие redakt_quantity
                const redaktQtyIdx = headers.indexOf('redakt_quantity');
                const originalQty = redaktQtyIdx >= 0 && parts[redaktQtyIdx]?.trim() ? parseInt(parts[redaktQtyIdx]) : null;

                const art = artMap[kod] || '—';

                this.currentDocItems.push({
                    kod,
                    quantity,
                    originalQuantity: quantity,
                    redaktQuantity: originalQty
                });

                html += `<tr data-index="${i - 1}">
                    <td><strong>${this.escapeHtml(kod)}</strong></td>
                    <td>${this.escapeHtml(art)}</td>
                    <td>
                        <input type="number" class="sdelano-qty-input doc-view-qty-input" data-kod="${kod}" data-original="${quantity}" value="${quantity}" min="0" ${canEdit ? '' : 'disabled'}>
                    </td>
                    <td>${originalQty !== null ? originalQty : '—'}</td>
                </tr>`;
            }

            document.getElementById('docViewBody').innerHTML = html;
            document.getElementById('docViewEmptyMsg').style.display = 'none';
            document.getElementById('docViewLoading').style.display = 'none';
            document.getElementById('docViewContent').style.display = 'block';

            // Сохраняем права доступа
            this.docViewCanEdit = canEdit;

            // Привязываем события для редактирования
            if (canEdit) {
                document.querySelectorAll('.doc-view-qty-input').forEach(input => {
                    input.addEventListener('input', (e) => {
                        const kod = e.target.getAttribute('data-kod');
                        const idx = this.currentDocItems.findIndex(item => item.kod === kod);
                        if (idx >= 0) {
                            const val = parseInt(e.target.value) || 0;
                            this.currentDocItems[idx].quantity = val;
                        }
                    });
                });
            }

        } catch (error) {
            console.error('Ошибка просмотра документа:', error);
            alert('Ошибка: ' + error.message);
        }
    },

    async saveDocEdit() {
        if (!this.docViewCanEdit) {
            alert('У вас нет прав для редактирования этого документа');
            return;
        }

        const userId = localStorage.getItem('userId');
        const isCreator = this.currentDocAuthor === userId;

        try {
            // Получаем name пользователя
            const nameResult = await this.query(`SELECT "name" FROM "sotrud" WHERE "ID"='${userId.replace(/'/g, "''")}'`);
            let name = '';
            if (nameResult?.trim()) {
                const lines = nameResult.trim().split('\n').filter(l => l);
                if (lines.length >= 2) {
                    const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
                    const nameIdx = headers.findIndex(h => h === 'name' || h === 'наименование');
                    const data = lines[1].split('\t');
                    if (nameIdx >= 0) name = data[nameIdx]?.trim() || '';
                }
            }

            const now = new Date();
            const dateStr = now.toISOString().split('T')[0];
            const timeStr = now.toTimeString().split(' ')[0];

            // Обновляем каждую строку
            for (const item of this.currentDocItems) {
                const oldQuantity = item.originalQuantity;
                const newQuantity = item.quantity;

                // Получаем time из guide для пересчёта rabota_time
                let guideTime = 0;
                const timeResult = await this.query(`SELECT "time" FROM "guide" WHERE "kod"='${item.kod.replace(/'/g, "''")}'`);
                if (timeResult?.trim()) {
                    const tLines = timeResult.trim().split('\n').filter(l => l);
                    if (tLines.length >= 2) {
                        const tHeaders = tLines[0].split('\t').map(h => h.trim().toLowerCase());
                        const tIdx = tHeaders.indexOf('time');
                        const tData = tLines[1].split('\t');
                        guideTime = tIdx >= 0 ? parseFloat(tData[tIdx]) || 0 : 0;
                    }
                }
                const rabotaTime = newQuantity * guideTime;

                let sql = `UPDATE "vergleich" SET "quantity"=${newQuantity}, "rabota_time"=${rabotaTime}`;

                // Если редактирует не создатель
                if (!isCreator) {
                    sql += `, "redakt_ID"='${userId.replace(/'/g, "''")}'`;
                    sql += `, "redakt_name"='${name.replace(/'/g, "''")}'`;
                    sql += `, "redakt_date"='${dateStr}'`;
                    sql += `, "redakt_time"='${timeStr}'`;

                    // Изначальное количество сохраняем только при первом редактировании
                    if (!item.redaktQuantity) {
                        sql += `, "redakt_quantity"=${oldQuantity}`;
                        item.redaktQuantity = oldQuantity;
                    }
                }

                sql += ` WHERE "doknom"='${this.currentDocNomer.replace(/'/g, "''")}' AND "kod"='${item.kod.replace(/'/g, "''")}'`;

                console.log(`[saveDoc] SQL: ${sql}`);

                try {
                    await this.query(sql);
                    console.log(`[saveDoc] ✅ Updated ${item.kod}`);
                } catch (e) {
                    console.error(`[saveDoc] ❌ Ошибка update ${item.kod}:`, e);
                    alert('❌ Ошибка сохранения ' + item.kod + ': ' + e.message);
                    return;
                }
            }

            console.log('[saveDoc] ✅ Все строки сохранены');

            // Показываем модалку печати
            this.pdfData = {
                doknom: this.currentDocNomer,
                name: name || this.currentDocAuthor,
                userId: userId,
                items: this.currentDocItems.map(item => ({
                    kod: item.kod,
                    quantity: item.quantity
                }))
            };

            document.getElementById('printConfirmModal').style.display = 'flex';

        } catch (error) {
            console.error('Ошибка сохранения:', error);
            alert('❌ Ошибка сохранения: ' + error.message);
        }
    },

    saveToWarehouse() {
        // Comment и made уже сохранены в sessionStorage в реальном времени
        // Просто переходим на склад
        window.location.href = 'warehouse.html';
    },

    async loadData() {
        const container = document.getElementById('sdelanoTableContainer');
        container.innerHTML = '<div class="loading-message">Загрузка данных...</div>';

        // Загружаем данные из sessionStorage (перенесённые со склада)
        const sdelanoData = sessionStorage.getItem('sdelanoData');
        if (!sdelanoData) {
            container.innerHTML = '<div class="no-data-message">Нет данных для отображения. Перейдите со склада.</div>';
            return;
        }

        try {
            const data = JSON.parse(sdelanoData);

            // Загружаем картинки из IndexedDB
            this.imageData = {};
            try {
                const db = await this.getDb();
                const images = await new Promise((resolve, reject) => {
                    const tx = db.transaction('images', 'readonly');
                    const request = tx.objectStore('images').getAll();
                    request.onsuccess = () => resolve(request.result || []);
                    request.onerror = () => reject(request.error);
                });
                images.forEach(item => {
                    this.imageData[item.kod] = item.data;
                });
            } catch (e) {
                console.error('Ошибка загрузки картинок:', e);
            }

            // Рендерим таблицу из переданных данных
            let html = `<table class="sdelano-table"><thead><tr>`;
            html += `<th>Код</th>`;
            html += `<th>Наименование</th>`;
            html += `<th>Количество</th>`;
            html += `<th>Картинка</th>`;
            html += `<th>Сверка</th>`;
            html += `<th>Комментарий</th>`;
            html += `</tr></thead><tbody>`;

            let count = 0;
            for (const item of data) {
                const kod = item.kod;
                const art = item.art;
                const made = item.made;

                if (!kod || made <= 0) continue;

                count++;

                const imgData = this.imageData[kod];
                const imgHtml = imgData
                    ? `<img class="sdelano-thumbnail" src="${imgData}" data-kod="${kod}" alt="">`
                    : `<span class="no-sdelano-img">—</span>`;

                // Загружаем comment из sessionStorage
                const savedComment = item.comment || '';

                html += `<tr data-kod="${kod}">`;
                html += `<td><strong>${this.escapeHtml(kod)}</strong></td>`;
                html += `<td>${this.escapeHtml(art)}</td>`;
                html += `<td class="sdelano-qty">
                    <input type="number" class="sdelano-qty-input" data-kod="${kod}" value="${made}" min="0">
                </td>`;
                html += `<td class="sdelano-img-cell">${imgHtml}</td>`;

                // Пустая рамка для рукописной сверки
                html += `<td class="sdelano-check-cell">
                    <div class="sdelano-manual-check-box" data-kod="${kod}"></div>
                </td>`;

                // Комментарий
                html += `<td class="sdelano-comment-cell">
                    <textarea class="sdelano-comment-input" data-kod="${kod}" placeholder="Введите комментарий...">${this.escapeHtml(savedComment)}</textarea>
                </td>`;

                html += `</tr>`;
            }

            html += '</tbody></table>';
            container.innerHTML = html;

            // Привязываем события
            this.bindCommentInputs();
            this.bindImageEvents();
            this.bindQtyInputs();

            console.log(`Загружено записей с Сделано > 0: ${count}`);

            if (count === 0) {
                container.innerHTML += '<div class="no-data-message" style="margin-top: 20px; color: #e74c3c;">⚠️ Нет записей с введенным значением "Сделано"</div>';
            }

        } catch (error) {
            console.error('Ошибка загрузки данных:', error);
            container.innerHTML = `<div class="error-message">❌ Ошибка: ${error.message}</div>`;
        }
    },

    bindCommentInputs() {
        const comments = document.querySelectorAll('.sdelano-comment-input');
        comments.forEach(textarea => {
            textarea.addEventListener('input', (e) => {
                const kod = e.target.getAttribute('data-kod');
                // Сохраняем comment напрямую в sessionStorage
                const sdelanoData = sessionStorage.getItem('sdelanoData');
                if (sdelanoData) {
                    try {
                        const data = JSON.parse(sdelanoData);
                        for (const item of data) {
                            if (item.kod === kod) {
                                item.comment = e.target.value || '';
                                break;
                            }
                        }
                        sessionStorage.setItem('sdelanoData', JSON.stringify(data));
                    } catch (err) {
                        // ignore
                    }
                }
            });
        });
    },

    bindQtyInputs() {
        const inputs = document.querySelectorAll('.sdelano-qty-input');
        inputs.forEach(input => {
            input.addEventListener('change', (e) => {
                const kod = e.target.getAttribute('data-kod');
                const val = parseInt(e.target.value, 10);
                const made = isNaN(val) || val < 0 ? 0 : val;
                e.target.value = made;

                // Обновляем в sessionStorage
                const sdelanoData = sessionStorage.getItem('sdelanoData');
                if (sdelanoData) {
                    const data = JSON.parse(sdelanoData);
                    for (const item of data) {
                        if (item.kod === kod) {
                            item.made = made;
                            break;
                        }
                    }
                    sessionStorage.setItem('sdelanoData', JSON.stringify(data));
                }
            });
        });
    },

    bindImageEvents() {
        const images = document.querySelectorAll('.sdelano-thumbnail');
        images.forEach(img => {
            img.addEventListener('click', (e) => {
                const kod = e.target.getAttribute('data-kod');
                const imgData = this.imageData[kod];
                if (imgData) {
                    const imgSrc = `data:image/png;base64,${imgData}`;
                    document.getElementById('sdelanoFullviewImg').src = imgSrc;
                    document.getElementById('sdelanoImageFullview').classList.add('active');
                }
            });
        });
    },

    filterTable() {
        const query = document.getElementById('searchInput').value.toLowerCase().trim();
        const rows = document.querySelectorAll('.sdelano-table tbody tr');

        rows.forEach(row => {
            const kod = row.getAttribute('data-kod').toLowerCase();
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(query) || kod.includes(query) ? '' : 'none';
        });
    },

    saveAll() {
        // Собираем все строки с количеством > 0
        const sdelanoData = sessionStorage.getItem('sdelanoData');
        if (!sdelanoData) {
            alert('Нет данных для сохранения');
            return;
        }

        try {
            const data = JSON.parse(sdelanoData);
            const items = data.filter(item => item.made > 0);

            if (items.length === 0) {
                alert('Нет записей с количеством > 0');
                return;
            }

            const kodList = items.map(i => `'${i.kod.replace(/'/g, "''")}'`).join(',');
            this.saveToDB(items, kodList);
        } catch (error) {
            console.error('Ошибка подготовки:', error);
            alert('Ошибка подготовки данных: ' + error.message);
        }
    },

    async saveToDB(items, kodList) {
        try {
            const serverIp = localStorage.getItem('serverIp');
            const userId = localStorage.getItem('userId');

            if (!serverIp || !userId) {
                alert('Не найдены данные подключения или пользователя');
                return;
            }

            console.log('[sdelano] userId:', userId);

            // 1. Получаем name из sotrud
            const sotrudResult = await this.query(`SELECT "name" FROM "sotrud" WHERE "ID"='${userId.replace(/'/g, "''")}'`);
            console.log('[sdelano] sotrudResult:', sotrudResult);

            if (!sotrudResult?.trim()) {
                alert('Не найдены данные сотрудника');
                return;
            }

            let name = '';
            const sotrudLines = sotrudResult.trim().split('\n').filter(l => l);
            if (sotrudLines.length >= 2) {
                const headers = sotrudLines[0].split('\t').map(h => h.trim().toLowerCase());
                const nameIdx = headers.findIndex(h => h === 'name' || h === 'наименование' || h === 'имя');
                const dataParts = sotrudLines[1].split('\t');
                if (nameIdx >= 0 && dataParts[nameIdx]) {
                    name = dataParts[nameIdx].trim();
                }
            }

            console.log('[sdelano] name:', name);

            // 2. Получаем time из guide
            const timeResult = await this.query(`SELECT "kod", "time" FROM "guide" WHERE "kod" IN (${kodList})`);
            console.log('[sdelano] timeResult:', timeResult);

            const guideTimeMap = {};
            if (timeResult?.trim()) {
                const timeLines = timeResult.trim().split('\n').filter(l => l);
                if (timeLines.length > 1) {
                    const timeHeaders = timeLines[0].split('\t').map(h => h.trim().toLowerCase());
                    const kodIdx = timeHeaders.indexOf('kod');
                    const timeIdx = timeHeaders.indexOf('time');
                    for (let i = 1; i < timeLines.length; i++) {
                        const parts = timeLines[i].split('\t');
                        const kod = kodIdx >= 0 ? parts[kodIdx]?.trim() : '';
                        const time = timeIdx >= 0 ? parseFloat(parts[timeIdx]) || 0 : 0;
                        if (kod) guideTimeMap[kod] = time;
                    }
                }
            }

            console.log('[sdelano] guideTimeMap:', guideTimeMap);

            // 3. Генерируем doknom один раз на всю партию
            const doknom = 'S' + Date.now();

            // 4. Текущие дата и время
            const now = new Date();
            const dataStr = now.toISOString().split('T')[0];
            const timeStr = now.toTimeString().split(' ')[0];

            console.log('[sdelano] doknom:', doknom, 'dataStr:', dataStr, 'timeStr:', timeStr);

            // 5. INSERT для каждой строки
            let inserted = 0;
            for (const item of items) {
                const guideTime = guideTimeMap[item.kod] || 0;
                const rabotaTime = Math.round(item.made * guideTime * 100) / 100; // Округляем до 2 знаков

                console.log(`[sdelano] INSERT kod=${item.kod}, made=${item.made}, guideTime=${guideTime}, rabotaTime=${rabotaTime}`);

                const kodEsc = item.kod.replace(/'/g, "''");
                const nameEsc = name.replace(/'/g, "''");

                const sql = `INSERT INTO "vergleich" ("time", "data", "kod", "quantity", "rabota_time", "doknom", "danet", "stavka", "IDname", "name", "redakt_ID", "redakt_name") VALUES ('${timeStr}', '${dataStr}', '${kodEsc}', ${item.made}, ${rabotaTime}, '${doknom.replace(/'/g, "''")}', 0, 0, '${userId.replace(/'/g, "''")}', '${nameEsc}', NULL, NULL)`;

                console.log('[sdelano] SQL:', sql);

                try {
                    await this.query(sql);
                    inserted++;
                    console.log(`[sdelano] ✅ Inserted ${item.kod}`);
                } catch (e) {
                    console.error(`[sdelano] ❌ Ошибка insert ${item.kod}:`, e);
                    alert('❌ Ошибка сохранения ' + item.kod + ': ' + e.message);
                    return;
                }
            }

            console.log('[sdelano] Всього вставлено:', inserted);

            if (inserted === 0) {
                alert('❌ Не удалось сохранить ни одной записи. Проверьте консоль для деталей.');
                return;
            }

            // 6. Очищаем sessionStorage
            sessionStorage.removeItem('sdelanoData');

            // Сохраняем данные для печати
            this.pdfData = {
                doknom,
                name,
                userId,
                items: items.map(i => ({
                    kod: i.kod,
                    quantity: i.made
                }))
            };

            // Показываем модалку печати
            document.getElementById('printConfirmModal').style.display = 'flex';

        } catch (error) {
            console.error('Ошибка сохранения в БД:', error);
            alert('❌ Ошибка сохранения: ' + error.message);
        }
    },

    async loadImagesForPDF(items) {
        try {
            this.pdfImages = {};
            const db = await new Promise((resolve, reject) => {
                const request = indexedDB.open('ImageDB', 3);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            
            const tx = db.transaction('images', 'readonly');
            const store = tx.objectStore('images');
            const request = store.getAll();

            await new Promise((resolve, reject) => {
                request.onsuccess = () => {
                    const images = request.result || [];
                    console.log('[PDF] Загружено картинок из IndexedDB:', images.length);

                    const kodList = items.map(i => i.kod);
                    images.forEach(img => {
                        if (kodList.includes(img.kod)) {
                            this.pdfImages[img.kod] = img.data;
                            console.log(`[PDF] Картинка найдена: ${img.kod}`);
                        }
                    });
                    resolve();
                };
                request.onerror = () => {
                    console.error('[PDF] Ошибка чтения из IndexedDB');
                    reject(request.error);
                };
            });
        } catch (e) {
            console.error('[PDF] Ошибка загрузки картинок:', e);
            this.pdfImages = {};
        }
    },

    async generatePDF() {
        console.log('[PDF] 🚀 Начал генерацию');

        document.getElementById('printConfirmModal').style.display = 'none';

        try {
            if (!this.pdfData || !this.pdfData.items || this.pdfData.items.length === 0) {
                console.error('[PDF] ❌ Нет данных');
                alert('❌ Нет данных для PDF');
                return;
            }

            console.log('[PDF] Данные:', this.pdfData);

            const { pdfData } = this;

            // Фильтруем только те, где количество > 0
            const itemsToPrint = pdfData.items.filter(item => item.quantity > 0);

            // Считаем общее количество
            const totalQty = itemsToPrint.reduce((sum, item) => sum + item.quantity, 0);

            if (itemsToPrint.length === 0) {
                alert('⚠️ Нет товаров с количеством > 0 для печати');
                return;
            }

            // 🔑 ОТКРЫВАЕМ ОКНО СРАЗУ (синхронно из клика) — чтобы браузер не блокировал
            const printWindow = window.open('', '_blank');
            if (!printWindow) {
                alert('⚠️ Браузер заблокировал новое окно. Разрешите всплывающие окна.');
                return;
            }

            // Загружаем картинки из IndexedDB перед генерацией
            try {
                await this.loadImagesForPDF(itemsToPrint);
                console.log('[PDF] Картинки загружены:', this.pdfImages);
            } catch (e) {
                console.warn('[PDF] Ошибка загрузки картинок, продолжаем без них:', e);
            }

            // Получаем артикулы
            const kodList = itemsToPrint.map(i => `'${i.kod.replace(/'/g, "''")}'`).join(',');
            const artResult = await this.query(`SELECT "kod", "art" FROM "guide" WHERE "kod" IN (${kodList})`);
            const artMap = {};
            if (artResult?.trim()) {
                const artLines = artResult.trim().split('\n').filter(l => l);
                if (artLines.length > 1) {
                    const artHeaders = artLines[0].split('\t').map(h => h.trim().toLowerCase());
                    const akIdx = artHeaders.indexOf('kod');
                    const aartIdx = artHeaders.indexOf('art');
                    for (let i = 1; i < artLines.length; i++) {
                        const aParts = artLines[i].split('\t');
                        const ak = akIdx >= 0 ? aParts[akIdx]?.trim() : '';
                        const aart = aartIdx >= 0 ? aParts[aartIdx]?.trim() : '';
                        if (ak) artMap[ak] = aart;
                    }
                }
            }

            // Конвертируем картинки из this.pdfImages
            const imageMap = {};
            if (this.pdfImages) {
                for (const [kod, imgData] of Object.entries(this.pdfImages)) {
                    let imageData = imgData;
                    if (!imageData.startsWith('data:')) {
                        imageData = 'data:image/png;base64,' + imgData;
                    }
                    imageMap[kod] = imageData;
                }
            }
            console.log('[PDF] imageMap keys:', Object.keys(imageMap));

            // Генерируем QR-код
            const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(pdfData.doknom)}`;

            // Генерируем строки таблицы с картинками
            let rowsHtml = '';
            itemsToPrint.forEach((item, idx) => {
                const art = artMap[item.kod] || '—';
                const imgHtml = imageMap[item.kod] ?
                    `<img src="${imageMap[item.kod]}" style="width:70px;height:70px;object-fit:contain;border:1px solid #ccc;" onerror="this.style.display='none';">` :
                    '—';

                rowsHtml += `
                    <tr style="min-height:73px;">
                        <td style="padding:8px;border:2px solid #333;text-align:center;width:50px;">${idx + 1}</td>
                        <td style="padding:8px;border:2px solid #333;font-size:12px;width:50px;">${item.kod}</td>
                        <td style="padding:8px;border:2px solid #333;text-align:center;width:75px;">${imgHtml}</td>
                        <td style="padding:8px;border:2px solid #333;font-weight:bold;font-size:16px;width:200px;">${art}</td>
                        <td style="padding:8px;border:2px solid #333;text-align:center;font-size:18px;font-weight:bold;width:75px;">${item.quantity}</td>
                        <td style="padding:8px;border:2px solid #333;height:73px;width:75px;"></td>
                        <td style="padding:8px;border:2px solid #333;height:73px;"></td>
                    </tr>
                `;
            });

            // Создаём HTML-страницу для печати
            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <title>Документ ${pdfData.doknom}</title>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            padding: 20px;
                            max-width: 900px;
                            margin: 0 auto;
                        }
                        h1 {
                            text-align: center;
                            font-size: 20px;
                            margin-bottom: 5px;
                        }
                        .info {
                            margin-bottom: 20px;
                        }
                        .info p {
                            margin: 5px 0;
                            font-size: 14px;
                        }
                        table {
                            width: 100%;
                            border-collapse: collapse;
                            margin-top: 20px;
                        }
                        th {
                            background: #34495e;
                            color: white;
                            padding: 10px 8px;
                            text-align: center;
                            font-size: 12px;
                        }
                        @media print {
                            .no-print { display: none; }
                            body { padding: 0; }
                            table { page-break-inside: auto; }
                            tr { page-break-inside: avoid; }
                        }
                    </style>
                </head>
                <body>
                    <div class="no-print" style="background:#f0f0f0;color:#333;padding:15px;border-radius:8px;margin-bottom:20px;text-align:center;">
                        <p style="margin:0;font-size:16px;">Документ сформирован!</p>
                        <p style="margin:10px 0 0 0;">
                            <button onclick="window.print()" style="padding:10px 30px;font-size:16px;background:#d0d0d0;color:#333;border:none;border-radius:5px;cursor:pointer;">
                                Распечатать
                            </button>
                        </p>
                    </div>

                    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:20px;">
                        <div>
                            <h1 style="font-size:20px;margin:0 0 10px 0;">ДОКУМЕНТ СДАЧИ</h1>
                            <p style="margin:5px 0;font-size:14px;"><strong>Номер:</strong> ${pdfData.doknom}</p>
                            <p style="margin:5px 0;font-size:14px;"><strong>Оператор:</strong> ${pdfData.name}</p>
                            <p style="margin:5px 0;font-size:14px;"><strong>Дата:</strong> ${new Date().toLocaleDateString('ru-RU')}</p>
                            <p style="margin:5px 0;font-size:14px;"><strong>Товаров:</strong> ${itemsToPrint.length} | <strong>Общее количество:</strong> ${totalQty}</p>
                        </div>
                        <img src="${qrCodeUrl}" style="width:80px;height:80px;margin-bottom:5px;" alt="QR">
                    </div>
                    <table>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </body>
                </html>
            `;

            // Записываем содержимое в уже открытое окно
            printWindow.document.open();
            printWindow.document.write(htmlContent);
            printWindow.document.close();

            console.log('[PDF] ✅ HTML страница записана в окно!');

        } catch (error) {
            console.error('[PDF] ❌ Ошибка:', error);
            alert('❌ Ошибка: ' + error.message);
        }
    },

    async query(sql) {
        const serverIp = this.serverIp;
        const encodedSql = encodeURIComponent(sql.trim());
        const url = `http://${serverIp}:8080/query?sql=${encodedSql}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
            const response = await fetch(url, {
                method: 'GET',
                mode: 'cors',
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                let errorText = '';
                try { errorText = await response.text(); } catch (e) {}
                throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
            }

            const text = await response.text();
            return text || '';
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('Таймаут запроса (15 сек)');
            }
            if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
                throw new Error('CORS ошибка или сервер недоступен');
            }
            throw error;
        }
    },

    // ============================================================
    // УТИЛИТЫ
    // ============================================================
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    async getDb() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('ImageDB', 3);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('images')) {
                    db.createObjectStore('images', { keyPath: 'kod' });
                }
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = () => reject(request.error);
        });
    }
};

// ============================================================
// ЗАПУСК
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    SDELANO.init();
});
