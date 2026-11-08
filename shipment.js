// ============================================================
// SHIPMENT PAGE - JavaScript
// ============================================================

const SHIPMENT = {
    serverIp: '',
    currentOrder: null,
    currentNomer: '',
    shipmentData: [],
    shippedKodpods: [],    // массив успешно введённых kodpod
    modalArticles: [],     // артикулы в модалке
    markedRows: [],        // индексы отмеченных строк в shipmentData

    // Звуки
    _okAudio: null,
    _errorAudio: null,

    // ============================================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================================
    init() {
        this.checkAuth();
        this.loadSounds();
        this.bindEvents();
    },

    loadSounds() {
        // Определяем путь к звукам относительно текущей страницы
        const base = window.location.pathname;
        const dir = base.substring(0, base.lastIndexOf('/') + 1);
        this._okAudio = new Audio(dir + 'OK.mp3');
        this._errorAudio = new Audio(dir + 'ERROR.mp3');
    },

    playSound(type) {
        const audio = type === 'ok' ? this._okAudio : this._errorAudio;
        if (audio) {
            audio.currentTime = 0;
            audio.play().catch(() => {});
        }
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
        this.serverUserId = userId;
        this.userID = userId;
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
    // СОБЫТИЯ
    // ============================================================
    bindEvents() {
        // Кнопка "Назад"
        document.getElementById('backBtn').addEventListener('click', () => {
            window.history.back();
        });

        // Кнопка "Загрузить"
        document.getElementById('loadBtn').addEventListener('click', () => {
            this.openOrderModal();
        });

        // Кнопка "Отгрузить"
        document.getElementById('shipBtn').addEventListener('click', () => {
            this.shipOrder();
        });

        // Кнопка "Начать"
        document.getElementById('startBtn').addEventListener('click', () => {
            this.startShipment();
        });

        // Кнопка закрытия модалки
        document.getElementById('closeModalBtn').addEventListener('click', () => {
            this.closeOrderModal();
        });

        // Закрытие модалки по клику на фон
        document.getElementById('orderModal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('orderModal')) {
                this.closeOrderModal();
            }
        });

        // Escape для закрытия модалки
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeOrderModal();
            }
        });

        // Поиск в модалке
        document.getElementById('modalSearchInput').addEventListener('input', (e) => {
            this.filterModalOrders(e.target.value);
        });

        // ===== НАЧАТЬ =====
        document.getElementById('closeStartModalBtn').addEventListener('click', () => {
            this.closeStartModal();
        });

        document.getElementById('startModal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('startModal')) {
                this.closeStartModal();
            }
        });

        document.getElementById('startConfirmBtn').addEventListener('click', () => {
            this.checkKodpod();
        });

        document.getElementById('kodpodInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.checkKodpod();
            }
        });
    },

    // ============================================================
    // МОДАЛЬНОЕ ОКНО ЗАКАЗОВ
    // ============================================================
    async openOrderModal() {
        const modal = document.getElementById('orderModal');
        modal.style.display = 'flex';
        document.getElementById('modalSearchInput').value = '';
        await this.loadOrders();
    },

    closeOrderModal() {
        document.getElementById('orderModal').style.display = 'none';
    },

    // ============================================================
    // НАЧАТЬ — МОДАЛЬНОЕ ОКНО
    // ============================================================
    startShipment() {
        // НЕ сбрасываем markedRows — они сохраняются между открытиями
        this.clearStatus();
        this.renderCounter();

        document.getElementById('kodpodInput').value = '';
        const modal = document.getElementById('startModal');
        modal.style.display = 'flex';
        modal.querySelector('.modal-dialog').style.width = '700px';
        modal.querySelector('.modal-dialog').style.maxWidth = '700px';

        // Пересобираем артикулы модалки
        this.buildModalArticles();
        // Перерисовываем таблицу с учётом отмеченных строк
        this.renderShipmentTable();
        // Деактивируем кнопку отгрузки
        document.getElementById('shipBtn').disabled = true;
        document.getElementById('startBtn').disabled = false;
        // Фокус на поле ввода
        setTimeout(() => document.getElementById('kodpodInput').focus(), 100);
    },

    closeStartModal() {
        document.getElementById('startModal').style.display = 'none';
        // Сбрасываем стили
        document.getElementById('startModal').querySelector('.modal-dialog').style.width = '';
        document.getElementById('startModal').querySelector('.modal-dialog').style.maxWidth = '';
    },

    buildModalArticles() {
        // Собираем артикулы без оптовиков, храним и kod и art
        this.modalArticles = [];
        this.shipmentData.forEach((item, index) => {
            if (!item.isWholesale) {
                this.modalArticles.push({ kod: item.kod, art: item.art, shipmentIndex: index });
            }
        });
        this.renderModalArticles();
    },

    renderModalArticles() {
        const tbody = document.getElementById('startModalTableBody');
        const empty = document.getElementById('startModalEmpty');
        const wrapper = document.querySelector('.start-modal-table-wrapper');

        // Фильтруем только не отмеченные
        const visible = this.modalArticles.filter(a => !this.markedRows.includes(a.shipmentIndex));

        if (visible.length === 0 && this.modalArticles.length > 0) {
            wrapper.style.display = 'none';
            empty.style.display = 'block';
            return;
        }

        wrapper.style.display = 'block';
        empty.style.display = 'none';

        tbody.innerHTML = visible.map((a, i) => `
            <tr>
                <td>${i + 1}</td>
                <td>${this.escapeHtml(a.art)}</td>
            </tr>
        `).join('');
    },

    clearStatus() {
        const el = document.getElementById('startStatus');
        el.style.display = 'none';
        el.className = 'start-status';
        el.textContent = '';
        document.getElementById('startCounter').style.display = 'none';
    },

    renderCounter() {
        const el = document.getElementById('startCounter');
        const total = this.modalArticles.length;
        const found = this.markedRows.length;
        const remaining = total - found;

        if (total === 0) {
            el.style.display = 'none';
            return;
        }

        el.style.display = 'flex';
        el.textContent = `Найдено: ${found} / ${total} | Осталось: ${remaining}`;

        if (remaining === 0) {
            el.className = 'start-counter';
            el.style.color = '#2ecc71';
        } else {
            el.className = 'start-counter';
            el.style.color = '#a0a0c0';
        }
    },

    showStatus(message, type) {
        const el = document.getElementById('startStatus');
        el.className = 'start-status ' + type;
        el.textContent = message;
        el.style.display = 'block';
    },

    // ============================================================
    // ПРОВЕРKA KOdpod
    // ============================================================
    async checkKodpod() {
        const input = document.getElementById('kodpodInput');
        const kodpod = input.value.trim();

        if (!kodpod) return;

        // 1. Проверяем — уже отгружен?
        if (this.shippedKodpods.includes(kodpod)) {
            this.showStatus('Уже отгружен', 'error');
            this.playSound('error');
            input.value = '';
            input.focus();
            return;
        }

        // 2. Ищем в podmena с status = "1"
        try {
            const sql = `SELECT "kodpod", "kod", "status" FROM "podmena" WHERE "kodpod"='${kodpod.replace(/'/g, "''")}'`;
            const result = await this.query(sql);
            const lines = result.trim().split('\n').filter(l => l);

            if (lines.length <= 1) {
                // Kodpod не найден в podmena
                this.showStatus('Такого кода нет в базе', 'error');
                this.playSound('error');
                input.value = '';
                input.focus();
                return;
            }

            // Нашли запись в podmena
            const cols = lines[1].split('\t');
            const podKodpod = cols[0] || '';
            const dbKod = cols[1] || '';
            const dbStatus = cols[2] || '';

            // 3. Статус = "0" → отгружено ранее
            if (dbStatus === '0') {
                this.showStatus('Отгружено ранее', 'error');
                this.playSound('error');
                input.value = '';
                input.focus();
                return;
            }

            // 4. Ищем этот kod в списке заказа среди неотмечённых строк
            const foundIndex = this.modalArticles.findIndex(a => a.kod === dbKod && !this.markedRows.includes(a.shipmentIndex));

            if (foundIndex === -1) {
                // Проверим — есть ли вообще такой kod в заказе
                const existsInOrder = this.modalArticles.find(a => a.kod === dbKod);
                if (existsInOrder) {
                    this.showStatus('Это лишнее', 'warning');
                } else {
                    this.showStatus('Нет в заказе', 'warning');
                }
                this.playSound('error');
                input.value = '';
                input.focus();
                return;
            }

            // 5. Совпадение! Находим индекс строки в shipmentData
            const found = this.modalArticles[foundIndex];
            if (!this.markedRows.includes(found.shipmentIndex)) {
                this.markedRows.push(found.shipmentIndex);
            }
            this.shippedKodpods.push(kodpod);

            // Перерисовываем таблицу (отмеченные строки подсветятся через CSS)
            this.renderShipmentTable();
            // Обновляем счётчик
            this.renderCounter();

            // Проверяем — все ли товары найдены?
            const total = this.modalArticles.length;
            const shippedCount = this.markedRows.length;
            if (shippedCount === total && total > 0) {
                document.getElementById('shipBtn').disabled = false;
                document.getElementById('startBtn').disabled = true;
            }

            // Убираем артикул из модалки
            this.renderModalArticles();

            this.showStatus('Найден', 'success');
            this.playSound('ok');
            input.value = '';
            input.focus();

        } catch (error) {
            console.error('Ошибка проверки kodpod:', error);
            this.showStatus('Ошибка: ' + error.message, 'error');
            this.playSound('error');
        }
    },

    async loadOrders() {
        const orderList = document.getElementById('orderList');
        const emptyState = document.getElementById('modalEmptyState');
        orderList.innerHTML = '<div class="loading-message">Загрузка заказов...</div>';

        try {
            // Получаем уникальные номера документов со статусом "3" и данными
            const sql = `SELECT DISTINCT "nomer", "user", "data", "time" FROM "zakaz" WHERE "status"='3' ORDER BY "nomer"`;
            const result = await this.query(sql);
            const lines = result.trim().split('\n').filter(l => l);

            if (lines.length <= 1) {
                orderList.innerHTML = '';
                emptyState.style.display = 'block';
                return;
            }

            emptyState.style.display = 'none';

            // Сохраняем номера для фильтрации
            this.allOrderNomers = lines.slice(1);

            this.renderOrderList(this.allOrderNomers);

        } catch (error) {
            console.error('Ошибка загрузки заказов:', error);
            orderList.innerHTML = `<div style="color: #e74c3c; text-align: center; padding: 20px;">Ошибка: ${error.message}</div>`;
        }
    },

    renderOrderList(nomers) {
        const orderList = document.getElementById('orderList');

        if (nomers.length === 0) {
            orderList.innerHTML = '';
            document.getElementById('modalEmptyState').style.display = 'block';
            return;
        }

        document.getElementById('modalEmptyState').style.display = 'none';

        orderList.innerHTML = nomers.map((line, index) => {
            const cols = line.split('\t');
            const nomer = cols[0] || '';
            const user = cols[1] || '';
            const date = cols[2] || '';
            const time = cols[3] || '';

            return `
                <div class="modal-order-item" data-index="${index}" onclick="SHIPMENT.selectOrder('${nomer.replace(/'/g, "''")}')">
                    <span class="item-nomer">${this.escapeHtml(nomer)}</span>
                    <span class="item-meta">${this.escapeHtml(user)} | ${this.escapeHtml(date)} ${this.escapeHtml(time)}</span>
                </div>
            `;
        }).join('');
    },

    filterModalOrders(query) {
        if (!this.allOrderNomers) return;

        if (!query.trim()) {
            this.renderOrderList(this.allOrderNomers);
            return;
        }

        const lowerQuery = query.toLowerCase();
        const filtered = this.allOrderNomers.filter(line => {
            return line.toLowerCase().includes(lowerQuery);
        });

        this.renderOrderList(filtered);
    },

    // ============================================================
    // ВЫБОР ДОКУМЕНТА
    // ============================================================
    async selectOrder(nomer) {
        // Подсветка выбранного
        document.querySelectorAll('.modal-order-item').forEach(el => {
            el.classList.remove('selected');
        });
        const item = document.querySelector(`.modal-order-item[onclick*="${nomer}"]`);
        if (item) item.classList.add('selected');

        // Сохраняем номер текущего документа
        this.currentNomer = nomer;

        // Закрываем модалку
        this.closeOrderModal();

        // Загружаем данные отгрузки
        await this.loadShipmentData(nomer);

        // Показываем секцию таблицы
        document.getElementById('shipmentTableSection').style.display = 'block';

        // Активируем кнопку "Начать", деактивируем "Отгрузить"
        document.getElementById('shipBtn').disabled = true;
        document.getElementById('startBtn').disabled = false;
    },

    // ============================================================
    // ЗАГРУЗКА ДАННЫХ ОТГРУЗКИ С JOIN
    // ============================================================
    async loadShipmentData(nomer) {
        const tbody = document.getElementById('shipmentTableBody');
        tbody.innerHTML = '<tr><td colspan="4" class="loading-message">Загрузка данных...</td></tr>';

        try {
            // Получаем информацию о документе
            const infoSql = `SELECT "user", "data", "time" FROM "zakaz" WHERE "nomer"='${nomer.replace(/'/g, "''")}' LIMIT 1`;
            const infoResult = await this.query(infoSql);
            const infoLines = infoResult.trim().split('\n').filter(l => l);

            let user = '—', date = '—', time = '—';
            if (infoLines.length >= 2) {
                const infoCols = infoLines[1].split('\t');
                user = infoCols[0] || '—';
                date = infoCols[1] || '—';
                time = infoCols[2] || '—';
            }

            // Устанавливаем шапку
            document.getElementById('infoNomer').textContent = nomer || '—';
            document.getElementById('infoUser').textContent = user;
            document.getElementById('infoDate').textContent = date;
            document.getElementById('infoTime').textContent = time;

            // Загружаем данные с JOIN guide для получения артикула и флага оптовика
            const sql = `SELECT "zakaz"."kod", "guide"."art", "guide"."opt", "zakaz"."koli" FROM "zakaz" LEFT JOIN "guide" ON "zakaz"."kod" = "guide"."kod" WHERE "zakaz"."nomer"='${nomer.replace(/'/g, "''")}'`;
            const result = await this.query(sql);
            const lines = result.trim().split('\n').filter(l => l);

            if (lines.length <= 1) {
                tbody.innerHTML = '<tr><td colspan="3" class="loading-message">Данные не найдены</td></tr>';
                this.shipmentData = [];
                this.renderQtyCard(0);
                return;
            }

            let qtyWithoutWholesale = 0;
            const groupedData = lines.slice(1).map(line => {
                const cols = line.split('\t');
                const kod = cols[0] || '';
                const art = cols[1] || '—';
                const opt = cols[2] || '';
                const koli = parseInt(cols[3]) || 0;
                const isWholesale = opt === 'Сборка';
                if (!isWholesale) {
                    qtyWithoutWholesale += koli;
                }
                return { kod, art, koli, isWholesale };
            });

            // Разворачиваем в поштучный вид
            this.shipmentData = [];
            for (const item of groupedData) {
                for (let i = 0; i < item.koli; i++) {
                    this.shipmentData.push({
                        kod: item.kod,
                        art: item.art,
                        koli: 1,
                        isWholesale: item.isWholesale
                    });
                }
            }

            // Рендерим таблицу
            this.renderShipmentTable();

            // Обновляем карточку количества
            this.renderQtyCard(qtyWithoutWholesale);

        } catch (error) {
            console.error('Ошибка загрузки данных отгрузки:', error);
            tbody.innerHTML = `<tr><td colspan="4" style="color: #e74c3c; text-align: center; padding: 20px;">Ошибка: ${error.message}</td></tr>`;
        }
    },

    renderQtyCard(qty) {
        const card = document.getElementById('shipmentQtyCard');
        const value = document.getElementById('shipmentQtyValue');
        value.textContent = qty;
        card.style.display = 'flex';
    },

    renderShipmentTable() {
        const tbody = document.getElementById('shipmentTableBody');

        if (this.shipmentData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="loading-message">Нет данных</td></tr>';
            return;
        }

        // Всегда перерисовываем таблицу заново
        const html = this.shipmentData.map((item, index) => {
            const classes = [];
            if (item.isWholesale) classes.push('opt-wholesale');
            if (this.markedRows.includes(index)) classes.push('marked-row');
            const classAttr = classes.length ? ' class="' + classes.join(' ') + '"' : '';
            return `
                <tr${classAttr}>
                    <td class="col-num">${index + 1}</td>
                    <td>${this.escapeHtml(item.kod)}</td>
                    <td>${this.escapeHtml(item.art)}</td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = html;
    },

    // ============================================================
    // ДЕЙСТВИЯ
    // ============================================================
    async shipOrder() {
        if (!this.currentNomer) return;

        if (!confirm(`Отгрузить документ ${this.currentNomer}?`)) {
            return;
        }

        try {
            // Загружаем имя пользователя
            await this.loadUserInfo();

            // Собираем оптовые и простые товары
            const wholesaleItems = this.shipmentData.filter(item => item.isWholesale);
            const simpleItems = this.shipmentData.filter(item => !item.isWholesale);

            // Считаем количество каждого оптовика в заказе
            const wholesaleCounts = {};
            for (const item of wholesaleItems) {
                if (!wholesaleCounts[item.kod]) wholesaleCounts[item.kod] = 0;
                wholesaleCounts[item.kod] += item.koli;
            }

            const recordedKods = new Map(); // kod -> сколько единиц уже списано в составе оптовиков

            for (const [optKod, optCount] of Object.entries(wholesaleCounts)) {
                const sql = `SELECT "kod", "kod2", "koli" FROM "sostav" WHERE "kod"='${optKod.replace(/'/g, "''")}'`;
                const result = await this.query(sql);
                const lines = result.trim().split('\n').filter(l => l);

                for (let i = 1; i < lines.length; i++) {
                    const cols = lines[i].split('\t');
                    const kod2 = cols[1] || '';
                    const koli = parseInt(cols[2]) || 0;

                    if (kod2 && koli > 0) {
                        // Записываем в history: koli * optCount (т.к. оптовиков несколько)
                        const historySql = this.recordHistory(kod2, -koli * optCount);
                        await this.query(historySql);
                        // Запоминаем сколько единиц уже списано
                        const alreadyRecorded = recordedKods.get(kod2) || 0;
                        recordedKods.set(kod2, alreadyRecorded + koli * optCount);
                    }
                }
            }

            // ===================== ШАГ 2: ПРОСТЫЕ ТОВАРЫ =====================
            if (simpleItems.length > 0) {
                // Группируем простые товары по kod и суммируем koli
                const simpleGrouped = {};
                for (const item of simpleItems) {
                    if (!simpleGrouped[item.kod]) {
                        simpleGrouped[item.kod] = 0;
                    }
                    simpleGrouped[item.kod] += item.koli;
                }

                const simpleKods = Object.keys(simpleGrouped);

                // Загружаем состав ВСЕХ строк из sostav (не только upak='Нет')
                let kods2Info = {}; // kod -> [{ kod2, koli, upak }]
                if (simpleKods.length > 0) {
                    const kodList = simpleKods.map(k => `'${k.replace(/'/g, "''")}'`).join(',');
                    const sql = `SELECT "kod", "kod2", "koli", "upak" FROM "sostav" WHERE "kod" IN (${kodList})`;
                    const result = await this.query(sql);
                    const lines = result.trim().split('\n').filter(l => l);

                    for (let i = 1; i < lines.length; i++) {
                        const cols = lines[i].split('\t');
                        const kod = cols[0] || '';
                        const kod2 = cols[1] || '';
                        const koli = parseInt(cols[2]) || 0;
                        const upak = (cols[3] || '').trim();

                        if (kod && kod2) {
                            if (!kods2Info[kod]) kods2Info[kod] = [];
                            kods2Info[kod].push({ kod2, koli, upak });
                        }
                    }
                }

                // Записываем в history каждый простой товар
                for (const [kod, sumKoli] of Object.entries(simpleGrouped)) {
                    // Проверяем сколько единиц уже списано в составе оптовика
                    const recordedCount = recordedKods.get(kod) || 0;
                    const toShip = sumKoli - recordedCount;

                    if (toShip <= 0) continue;

                    // Записываем разницу (то что не вошло в оптовик)
                    const historySql = this.recordHistory(kod, -toShip);
                    await this.query(historySql);

                    // Записываем kod2 из sostav если upak = "Нет"
                    const comps = kods2Info[kod];
                    if (comps) {
                        for (const comp of comps) {
                            if (comp.upak === 'Нет') {
                                const histCompSql = this.recordHistory(comp.kod2, -comp.koli);
                                await this.query(histCompSql);
                            }
                        }
                    }
                }
            }

            // ===================== ЗАВЕРШЕНИЕ =====================
            const sql = `UPDATE "zakaz" SET "status"='0' WHERE "nomer"='${this.currentNomer.replace(/'/g, "''")}'`;
            await this.query(sql);

            // Помечаем все kodpod из этого заказа как status='0'
            const kods = [...new Set(this.shipmentData.map(item => item.kod))];
            if (kods.length > 0) {
                const kodList = kods.map(k => `'${k.replace(/'/g, "''")}'`).join(',');
                // Обновляем только те kodpod, которые ещё имеют status='1'
                const podmenaSql = `UPDATE "podmena" SET "status"='0' WHERE "kod" IN (${kodList}) AND "status"='1'`;
                await this.query(podmenaSql);
            }

            alert('✅ Документ отгружен');
            this.resetForm();
        } catch (error) {
            console.error('Ошибка отгрузки:', error);
            alert(`❌ Ошибка отгрузки: ${error.message}`);
        }
    },

    resetForm() {
        this.currentNomer = null;
        this.shipmentData = [];
        this.shippedKodpods = [];
        this.markedRows = [];
        this.modalArticles = [];
        this.userName = '';
        this.userID = this.serverUserId || '';
        document.getElementById('docSearchInput').value = '';
        document.getElementById('shipmentTableSection').style.display = 'none';
        document.getElementById('shipmentQtyCard').style.display = 'none';
        document.getElementById('shipBtn').disabled = true;
        document.getElementById('startBtn').disabled = true;
    },

    // ============================================================
    // ЗАПИСЬ В HISTORY
    // ============================================================
    async loadUserInfo() {
        try {
            const sql = `SELECT "ID", "name" FROM "sotrud" WHERE "ID"='${this.serverUserId.replace(/'/g, "''")}'`;
            const result = await this.query(sql);
            const lines = result.trim().split('\n').filter(l => l);

            if (lines.length >= 2) {
                const cols = lines[1].split('\t');
                this.userID = cols[0] || '';
                this.userName = cols[1] || '';
            }
        } catch (error) {
            console.error('Ошибка загрузки пользователя:', error);
        }
    },

    recordHistory(kod, prostuk) {
        const today = new Date();
        const dateStr = today.toISOString().slice(0, 10);
        const timeStr = today.toTimeString().slice(0, 8);

        return `INSERT INTO "history" ("kod", "data", "time", "quantity", "prostuk", "user", "ID_user") ` +
               `VALUES ('${kod.replace(/'/g, "''")}', '${dateStr}', '${timeStr}', '1', ${prostuk}, ` +
               `'${this.userName.replace(/'/g, "''")}', '${this.userID.replace(/'/g, "''")}')`;
    },

    // ============================================================
    // ЭКРАНИРОВАНИЕ HTML
    // ============================================================
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

// ============================================================
// ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    SHIPMENT.init();
});
