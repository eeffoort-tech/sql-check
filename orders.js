// ============================================================
// ORDERS PAGE - JavaScript (REWRITTEN)
// ============================================================

const ORDERS = {
    serverIp: null,
    userName: null,
    currentFilter: null,
    showMyOnly: false,

    init() {
        this.serverIp = localStorage.getItem('serverIp');
        this.userName = localStorage.getItem('userName') || '';
        if (!this.serverIp) {
            window.location.href = 'login.html';
            return;
        }

        this.bindEvents();
        this.loadFullStats();
        this.applyFilter('plan');
    },

    bindEvents() {
        const safeAdd = (selector, event, handler) => {
            const el = document.querySelector(selector);
            if (el) el.addEventListener(event, handler);
        };

        safeAdd('#btnCloseDetail', 'click', () => this.closeDetailModal());
        safeAdd('#orderDetailModal .modal-overlay', 'click', () => this.closeDetailModal());
        safeAdd('#orderDetailModal .btn-modal-close', 'click', () => this.closeDetailModal());
        safeAdd('#btnCreateOrderFromModal', 'click', () => this.createOrderFromNomer());
        safeAdd('#btnSaveDraftFromModal', 'click', () => this.saveDraftFromNomer());
        safeAdd('#btnDeleteFromModal', 'click', () => this.deleteFromNomer());
        safeAdd('#btnAllDocs', 'click', () => this.loadAllOrders());
        safeAdd('#backToWarehouseBtn', 'click', () => window.history.back());

        safeAdd('#showMyOnly', 'change', (e) => {
            this.showMyOnly = e.target.checked;
            // Повторно применяем текущий фильтр или загружаем все
            if (this.currentFilter) {
                this.applyFilter(this.currentFilter);
            } else {
                this.loadAllOrders();
            }
        });

        document.querySelectorAll('.stat-card.stat-filterable').forEach(card => {
            card.addEventListener('click', () => {
                const filter = card.getAttribute('data-filter');
                this.applyFilter(filter);
            });
        });
    },

    // ============================================================
    // ЗАГРУЗКА СЧЁТЧИКОВ
    // ============================================================
    async loadFullStats() {
        try {
            const result = await this.query(
                `SELECT "nomer", "user", MIN("status") as "status" FROM "zakaz" GROUP BY "nomer", "user"`
            );

            const stats = { plan: 0, draft: 0, order: 0, done: 0 };
            if (result?.trim()) {
                const lines = result.trim().split('\n').filter(l => l);
                const headers = lines[0]?.split('\t').map(h => h.trim().toLowerCase());
                const statusIdx = headers.indexOf('status');

                for (let i = 1; i < lines.length; i++) {
                    const parts = lines[i].split('\t');
                    const status = parseInt(parts[statusIdx]) || 0;

                    if (status === 0) stats.done++;
                    else if (status === 4) stats.draft++;
                    else if (status === 3) stats.order++;
                    else if (status === 1 || status === 2) stats.plan++;
                }
            }

            this.updateStats(stats);
        } catch (e) {
            console.error('Ошибка загрузки счётчиков:', e);
        }
    },

    // ============================================================
    // ЗАГРУЗКА "ВСЕ ЗАКАЗЫ" (без фильтра)
    // ============================================================
    async loadAllOrders() {
        this.currentFilter = null;
        this.updateFilterButtons(null);
        await this.loadTable(null, this.showMyOnly);
    },

    // ============================================================
    // ПРИМЕНЕНИЕ ФИЛЬТРА ПО СТАТУСУ
    // ============================================================
    async applyFilter(filter) {
        this.currentFilter = filter;
        this.updateFilterButtons(filter);

        const statusMap = {
            plan: [1, 2],
            draft: [4],
            order: [3],
            done: [0]
        };

        let statusIn = statusMap[filter] || null;
        await this.loadTable(statusIn, this.showMyOnly);
    },

    updateFilterButtons(activeFilter) {
        document.querySelectorAll('.stat-card.stat-filterable').forEach(card => {
            const filter = card.getAttribute('data-filter');
            if (filter === activeFilter) {
                card.classList.add('stat-active');
            } else {
                card.classList.remove('stat-active');
            }
        });
    },

    // ============================================================
    // ЗАГРУЗКА ТАБЛИЦЫ
    // ============================================================
    async loadTable(statusIn, showMyOnly) {
        const tbody = document.getElementById('ordersTableBody');
        tbody.innerHTML = '<tr><td colspan="5" class="loading-message">Загрузка...</td></tr>';

        try {
            // Если statusIn — это строка (название фильтра), конвертируем в массив
            const statusMap = {
                plan: [1, 2],
                draft: [4],
                order: [3],
                done: [0]
            };
            if (typeof statusIn === 'string') {
                statusIn = statusMap[statusIn] || null;
            }

            const conditions = [];
            if (statusIn) {
                conditions.push(`"status" IN (${statusIn.map(s => '"' + s + '"').join(', ')})`);
            }
            if (showMyOnly && this.userName) {
                conditions.push(`"user" = '${this.userName.replace(/'/g, "''")}'`);
            }

            const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

            // Группируем по nomer + user, статус = минимальный статус из отфильтрованных строк
            const result = await this.query(
                `SELECT "nomer", "user", MIN("status") as "status", ` +
                `MAX("data") as "data", MAX("time") as "time", ` +
                `SUM(CASE WHEN NOT ("status" = 2 AND "kod" IN (SELECT "kod2" FROM "sostav")) ` +
                `THEN "koli" ELSE 0 END) as "total" ` +
                `FROM "zakaz" ${where} GROUP BY "nomer", "user" ` +
                `ORDER BY MAX("data") DESC, MAX("time") DESC`
            );

            if (!result?.trim()) {
                tbody.innerHTML = `
                    <tr><td colspan="5">
                        <div class="no-orders">
                            <div class="no-orders-icon">📭</div>
                            <div>Заказы отсутствуют</div>
                        </div>
                    </td></tr>`;
                return;
            }

            this.renderTable(result, tbody, statusIn);

        } catch (e) {
            console.error('Ошибка загрузки:', e);
            tbody.innerHTML = `
                <tr><td colspan="5" style="text-align:center; color:#e74c3c; padding:40px;">
                    Ошибка загрузки: ${this.escapeHtml(e.message)}
                </td></tr>`;
        }
    },

    // ============================================================
    // ОТРИСОВКА ТАБЛИЦЫ
    // ============================================================
    renderTable(result, tbody, statusIn) {
        const lines = result.trim().split('\n').filter(l => l);
        if (lines.length <= 1) {
            tbody.innerHTML = `
                <tr><td colspan="5">
                    <div class="no-orders">
                        <div class="no-orders-icon">📭</div>
                        <div>Нет заказов</div>
                    </div>
                </td></tr>`;
            return;
        }

        const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
        const nomerIdx = headers.indexOf('nomer');
        const userIdx = headers.indexOf('user');
        const statusIdx = headers.indexOf('status');
        const dataIdx = headers.indexOf('data');
        const timeIdx = headers.indexOf('time');
        const totalIdx = headers.indexOf('total');

        const statusLabels = {
            0: 'Выполнен', 1: 'План', 2: 'План',
            3: 'Заказ', 4: 'Черновик'
        };
        const statusClasses = {
            0: 'status-done', 1: 'status-plan', 2: 'status-plan',
            3: 'status-order', 4: 'status-draft'
        };

        let html = '';
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split('\t');
            const nomer = parts[nomerIdx]?.trim() || '';
            const user = parts[userIdx]?.trim() || '';
            const status = parseInt(parts[statusIdx]) || 0;
            const data = parts[dataIdx]?.trim() || '';
            const time = parts[timeIdx]?.trim() || '';
            const total = parseInt(parts[totalIdx]) || 0;

            const dateTime = `${data} ${time}`.trim();
            const statusLabel = statusLabels[status] || 'Неизвестно';
            const statusClass = statusClasses[status] || '';

            html += `
                <tr data-nomer="${this.escapeHtml(nomer)}" data-status="${status}">
                    <td><strong>${this.escapeHtml(nomer)}</strong></td>
                    <td>${this.escapeHtml(user)}</td>
                    <td>${total}</td>
                    <td>${this.escapeHtml(dateTime)}</td>
                    <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                </tr>`;
        }

        tbody.innerHTML = html;

        // Attach row clicks
        tbody.querySelectorAll('tr[data-nomer]').forEach(tr => {
            tr.addEventListener('click', () => {
                const nomer = tr.getAttribute('data-nomer');
                const status = parseInt(tr.getAttribute('data-status'));
                this.openDetailModal(nomer, status);
            });
        });
    },

    // ============================================================
    // МОДАЛЬНОЕ ОКНО ДЕТАЛЕЙ
    // ============================================================
    async openDetailModal(nomer, status) {
        this.currentDetailNomer = nomer;

        const modal = document.getElementById('orderDetailModal');
        const title = document.getElementById('detailTitle');
        const infoDiv = document.getElementById('detailInfo');
        const tbody = document.getElementById('detailItemsBody');
        const emptyMsg = document.getElementById('detailEmptyMsg');

        if (!modal || !title || !infoDiv || !tbody || !emptyMsg) return;

        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">Загрузка...</td></tr>';
        emptyMsg.style.display = 'none';

        const statusLabels = {
            0: 'Выполнен', 1: 'План', 2: 'План',
            3: 'Заказ', 4: 'Черновик'
        };
        const statusClasses = {
            0: 'status-done', 1: 'status-plan', 2: 'status-plan',
            3: 'status-order', 4: 'status-draft'
        };

        title.textContent = `📄 ${nomer}`;

        // Показываем кнопки только для статусов 1, 2, 3, 4
        const createOrderBtn = document.getElementById('btnCreateOrderFromModal');
        const saveDraftBtn = document.getElementById('btnSaveDraftFromModal');
        const deleteBtn = document.getElementById('btnDeleteFromModal');
        if (status === 1 || status === 2) {
            // План — обе кнопки + удалить
            createOrderBtn.style.display = 'inline-block';
            saveDraftBtn.style.display = 'inline-block';
            deleteBtn.style.display = 'inline-block';
        } else if (status === 4) {
            // Черновик — только "Создать заказ" + удалить
            createOrderBtn.style.display = 'inline-block';
            saveDraftBtn.style.display = 'none';
            deleteBtn.style.display = 'inline-block';
        } else if (status === 3) {
            // Заказ — только "Удалить"
            createOrderBtn.style.display = 'none';
            saveDraftBtn.style.display = 'none';
            deleteBtn.style.display = 'inline-block';
        } else {
            // Выполнен (0) — ни одной кнопки
            createOrderBtn.style.display = 'none';
            saveDraftBtn.style.display = 'none';
            deleteBtn.style.display = 'none';
        }
        infoDiv.innerHTML = `
            <div class="detail-info-item">
                <span class="label">Статус</span>
                <span class="value"><span class="status-badge ${statusClasses[status] || ''}">${statusLabels[status] || 'Неизвестно'}</span></span>
            </div>
        `;

        // Загружаем товары (с status)
        const result = await this.query(
            `SELECT "nomer", "kod", "koli", "status" FROM "zakaz" WHERE "nomer"='${nomer.replace(/'/g, "''")}' ORDER BY "kod"`
        );

        if (!result?.trim()) {
            tbody.innerHTML = '';
            emptyMsg.style.display = 'block';
            modal.style.display = 'block';
            return;
        }

        const lines = result.trim().split('\n').filter(l => l);
        const headers = lines[0]?.split('\t').map(h => h.trim().toLowerCase());
        const kodIdx = headers.indexOf('kod');
        const koliIdx = headers.indexOf('koli');
        const statusIdx = headers.indexOf('status');

        if (lines.length <= 1) {
            tbody.innerHTML = '';
            emptyMsg.style.display = 'block';
            modal.style.display = 'block';
            return;
        }

        // Загружаем список kod2 из sostav (компоненты оптовиков)
        const compResult = await this.query(`SELECT "kod2" FROM "sostav"`);
        const componentKods = new Set();
        if (compResult?.trim()) {
            const compLines = compResult.trim().split('\n').filter(l => l);
            if (compLines.length > 1) {
                const compHeaders = compLines[0].split('\t').map(h => h.trim().toLowerCase());
                const kod2Idx = compHeaders.indexOf('kod2');
                for (let i = 1; i < compLines.length; i++) {
                    const parts = compLines[i].split('\t');
                    const k2 = kod2Idx >= 0 ? parts[kod2Idx]?.trim() : '';
                    if (k2) componentKods.add(k2);
                }
            }
        }

        // Загружаем артикулы
        const allKods = [];
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split('\t');
            const kod = parts[kodIdx]?.trim();
            if (kod) allKods.push(kod);
        }

        let artMap = {};
        if (allKods.length > 0) {
            const optKodList = allKods.map(k => `'${k.replace(/'/g, "''")}'`).join(',');
            const optResult = await this.query(
                `SELECT "kod", "art" FROM "guide" WHERE "kod" IN (${optKodList})`
            );

            if (optResult?.trim()) {
                const optLines = optResult.trim().split('\n').filter(l => l);
                if (optLines.length > 1) {
                    const optHeaders = optLines[0].split('\t').map(h => h.trim().toLowerCase());
                    const optKodIdx = optHeaders.indexOf('kod');
                    const optArtIdx = optHeaders.indexOf('art');
                    for (let i = 1; i < optLines.length; i++) {
                        const parts = optLines[i].split('\t');
                        const k = optKodIdx >= 0 ? parts[optKodIdx]?.trim() : '';
                        const a = optArtIdx >= 0 ? parts[optArtIdx]?.trim() : '—';
                        if (k) artMap[k] = a || '—';
                    }
                }
            }
        }

        // Рендерим товары (скрываем только компоненты со статусом 2)
        let html = '';
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split('\t');
            const kod = kodIdx >= 0 ? parts[kodIdx]?.trim() || '' : '';
            const koli = koliIdx >= 0 ? parts[koliIdx]?.trim() || '0' : '0';
            const status = statusIdx >= 0 ? parseInt(parts[statusIdx]) || 0 : 0;

            // Показываем только если:
            // - статус=1 (компонент запланирован отдельно)
            // - status=2 и kod НЕ в kod2 (это сам оптовик, а не компонент)
            if (status === 2 && componentKods.has(kod)) continue;

            const art = artMap[kod] || '—';

            html += `
                <tr>
                    <td>${this.escapeHtml(kod)}</td>
                    <td>${this.escapeHtml(art)}</td>
                    <td>${this.escapeHtml(koli)}</td>
                </tr>`;
        }

        if (html === '') {
            tbody.innerHTML = '';
            emptyMsg.style.display = 'block';
        } else {
            tbody.innerHTML = html;
            emptyMsg.style.display = 'none';
        }
        modal.style.display = 'block';
    },

    closeDetailModal() {
        const modal = document.getElementById('orderDetailModal');
        if (modal) modal.style.display = 'none';
        this.currentDetailNomer = null;
    },

    // Создаёт заказ со статусом 3 из всех записей текущего документа
    async createOrderFromNomer() {
        if (!this.currentDetailNomer) return;

        const nomer = this.currentDetailNomer;
        const safeNomer = String(nomer || '').replace(/'/g, "''");

        try {
            // === ПРОВЕРКА ОТРИЦАТЕЛЬНЫХ ОСТАТКОВ ===
            // 1. Загружаем все записи текущего документа (все статусы)
            const itemsResult = await this.query(
                `SELECT "kod", SUM("koli") as "total" FROM "zakaz" WHERE "nomer"='${safeNomer}' GROUP BY "kod"`
            );

            if (!itemsResult?.trim()) {
                this.showOrderError('Ошибка', 'В документе нет записей');
                return;
            }

            const lines = itemsResult.trim().split('\n').filter(l => l);
            const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
            const kodIdx = headers.indexOf('kod');
            const totalIdx = headers.findIndex(h => h.includes('total') || h === 'sum');

            const items = [];
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split('\t');
                const kod = kodIdx >= 0 ? parts[kodIdx]?.trim() : '';
                const koli = totalIdx >= 0 ? parseInt(parts[totalIdx]) || 0 : 0;
                if (kod) items.push({ kod, koli });
            }

            if (items.length === 0) {
                this.showOrderError('Ошибка', 'В документе нет товаров');
                return;
            }

            // 2. Загружаем складские остатки из history (SUM quantity * prostuk) и резерв
            const kodListQuoted = items.map(i => `'${i.kod.replace(/'/g, "''")}'`).join(',');
            const kodList = items.map(i => `'${i.kod.replace(/'/g, "''")}'`).join(',');

            const warehouseResult = await this.query(
                `SELECT "kod", SUM("quantity" * "prostuk") as "total" FROM "history" WHERE "kod" IN (${kodListQuoted}) GROUP BY "kod"`
            );
            const warehouseCache = {};
            if (warehouseResult?.trim()) {
                const wLines = warehouseResult.trim().split('\n').filter(l => l);
                const wHeaders = wLines[0].split('\t').map(h => h.trim().toLowerCase());
                const wKodIdx = wHeaders.indexOf('kod');
                const wTotalIdx = wHeaders.findIndex(h => h.includes('total') || h === 'sum');
                for (let i = 1; i < wLines.length; i++) {
                    const parts = wLines[i].split('\t');
                    const k = wKodIdx >= 0 ? parts[wKodIdx]?.trim() : '';
                    const q = wTotalIdx >= 0 ? parseFloat(parts[wTotalIdx]) || 0 : 0;
                    warehouseCache[k] = q;
                }
            }

            const reserveResult = await this.query(
                `SELECT "kod", SUM("koli") as "total" FROM "zakaz" WHERE "kod" IN (${kodList}) AND "status" IN (1, 2, 3, 4) GROUP BY "kod"`
            );
            const reserveData = {};
            if (reserveResult?.trim()) {
                const rLines = reserveResult.trim().split('\n').filter(l => l);
                const rHeaders = rLines[0].split('\t').map(h => h.trim().toLowerCase());
                const rKodIdx = rHeaders.indexOf('kod');
                const rTotalIdx = rHeaders.findIndex(h => h.includes('total') || h === 'sum');
                for (let i = 1; i < rLines.length; i++) {
                    const parts = rLines[i].split('\t');
                    const k = rKodIdx >= 0 ? parts[rKodIdx]?.trim() : '';
                    const q = rTotalIdx >= 0 ? parseInt(parts[rTotalIdx]) || 0 : 0;
                    reserveData[k] = q;
                }
            }

            // 3. Вычисляем доступное и ищем отрицательные
            const negativeItems = [];
            for (const item of items) {
                const totalWh = warehouseCache[item.kod] || 0;
                const reserve = reserveData[item.kod] || 0;
                const available = totalWh - reserve;

                if (available < 0) {
                    const guideResult = await this.query(
                        `SELECT "art", "name" FROM "guide" WHERE "kod"='${item.kod.replace(/'/g, "''")}'`
                    );
                    let art = '';
                    let name = '';
                    if (guideResult?.trim()) {
                        const gLines = guideResult.trim().split('\n').filter(l => l);
                        const gHeaders = gLines[0].split('\t').map(h => h.trim().toLowerCase());
                        const artIdx = gHeaders.indexOf('art');
                        const nameIdx = gHeaders.indexOf('name');
                        const gParts = gLines[1]?.split('\t') || [];
                        art = artIdx >= 0 ? gParts[artIdx]?.trim() || '' : '';
                        name = nameIdx >= 0 ? gParts[nameIdx]?.trim() || '' : '';
                    }

                    negativeItems.push({
                        kod: item.kod,
                        art: art || item.kod,
                        name,
                        available,
                        plan: item.koli
                    });
                }
            }

            if (negativeItems.length > 0) {
                const msg = negativeItems
                    .map(i => `❌ ${i.art} (${i.name || i.kod}): Доступно = ${i.available}, План = ${i.plan}`)
                    .join('\n');

                alert(
                    `⛔ Нельзя создать заказ!\n\n` +
                    `${negativeItems.length} товаров с отрицательным «Доступно» имеют заполненный План:\n\n` +
                    msg +
                    '\n\nУменьшите план для указанных позиций или дождитесь поступления товара на склад.'
                );

                console.warn('[ORDERS.createOrderFromNomer] Создание заказа заблокировано: отрицательный остаток', negativeItems);
                return;
            }
            // === КОНЕЦ ПРОВЕРКИ ===

            // 4. Проверка пройдена — меняем статус на 3 (Заказ)
            await this.query(
                `UPDATE "zakaz" SET "status"=3 WHERE "nomer"='${safeNomer}'`
            );

            this.showOrderSuccess('✅ Заказ создан!', 'Статус обновлён');
            this.closeDetailModal();
            this.loadFullStats();
            await this.loadTable(this.currentFilter || null, this.showMyOnly);
        } catch (e) {
            console.error('Ошибка создания заказа:', e);
            this.showOrderError('Ошибка создания заказа', e.message);
        }
    },

    // Сохраняет как черновик со статусом 4 из всех записей текущего документа
    async saveDraftFromNomer() {
        if (!this.currentDetailNomer) return;

        try {
            const safeNomer = String(this.currentDetailNomer || '').replace(/'/g, "''");
            await this.query(
                `UPDATE "zakaz" SET "status"=4 WHERE "nomer"='${safeNomer}'`
            );

            this.showOrderSuccess('✅ Черновик сохранён!', 'Статус обновлён');
            this.closeDetailModal();
            this.loadFullStats();
            await this.loadTable(this.currentFilter || null, this.showMyOnly);
        } catch (e) {
            console.error('Ошибка сохранения черновика:', e);
            this.showOrderError('Ошибка сохранения черновика', e.message);
        }
    },

    // Удаляет текущий документ из БД
    async deleteFromNomer() {
        if (!this.currentDetailNomer) return;

        try {
            const safeNomer = String(this.currentDetailNomer || '').replace(/'/g, "''");
            await this.query(
                `DELETE FROM "zakaz" WHERE "nomer"='${safeNomer}'`
            );

            this.showOrderSuccess('✅ Документ удалён', '');
            this.closeDetailModal();
            this.loadFullStats();
            await this.loadTable(this.currentFilter || null, this.showMyOnly);
        } catch (e) {
            console.error('Ошибка удаления:', e);
            this.showOrderError('Ошибка удаления', e.message);
        }
    },

    // ============================================================
    // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
    // ============================================================
    updateStats(stats) {
        const statPlan = document.getElementById('statPlan');
        const statDraft = document.getElementById('statDraft');
        const statOrder = document.getElementById('statOrder');
        const statDone = document.getElementById('statDone');
        if (statPlan) statPlan.textContent = stats.plan;
        if (statDraft) statDraft.textContent = stats.draft;
        if (statOrder) statOrder.textContent = stats.order;
        if (statDone) statDone.textContent = stats.done;
    },

    // Toast-уведомление об успехе
    showOrderSuccess(title, subtitle) {
        this._showOrderToast('success', title, subtitle);
    },

    // Toast-уведомление об ошибке
    showOrderError(title, message) {
        this._showOrderToast('error', title, message);
    },

    _showOrderToast(type, title, message) {
        // Убираем старый toast
        const old = document.getElementById('ordersToast');
        if (old) old.remove();

        const isError = type === 'error';
        const borderColor = isError ? '#ef4444' : '#22c55e';
        const bgColor = isError ? '#1c1017' : '#0f172a';
        const icon = isError ? '✕' : '✓';
        const textColor = isError ? '#fca5a5' : '#22c55e';

        const toast = document.createElement('div');
        toast.id = 'ordersToast';
        toast.style.cssText = `
            position: fixed;
            top: -100px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 100001;
            background: ${bgColor};
            border: 2px solid ${borderColor};
            border-radius: 12px;
            padding: 16px 24px;
            min-width: 320px;
            max-width: 480px;
            display: flex;
            align-items: flex-start;
            gap: 12px;
            box-shadow: 0 4px 24px ${isError ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)'};
            transition: top 0.4s cubic-bezier(0.22, 1, 0.36, 1);
        `;

        toast.innerHTML = `
            <div style="
                width: 32px;
                height: 32px;
                border-radius: 50%;
                background: ${borderColor};
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 18px;
                font-weight: bold;
                color: #fff;
                flex-shrink: 0;
            ">${icon}</div>
            <div style="flex: 1;">
                <div style="
                    font-size: 0.95rem;
                    font-weight: 600;
                    color: ${textColor};
                    margin-bottom: ${message ? '4px' : '0'};
                ">${title}</div>
                ${message ? `<div style="font-size: 0.85rem; color: ${isError ? '#f87171' : '#86efac'};">${message}</div>` : ''}
            </div>
            <button onclick="document.getElementById('ordersToast')?.remove()" style="
                background: none;
                border: none;
                color: ${isError ? '#fca5a5' : '#86efac'};
                font-size: 1.2rem;
                cursor: pointer;
                padding: 0;
                line-height: 1;
            ">×</button>
        `;

        document.body.appendChild(toast);

        requestAnimationFrame(() => {
            toast.style.top = '24px';
        });

        setTimeout(() => {
            toast.style.top = '-100px';
            setTimeout(() => toast.remove(), 400);
        }, isError ? 5000 : 3000);
    },

    async query(sql) {
        const encodedSql = encodeURIComponent(sql.trim());
        const url = `http://${this.serverIp}:8080/query?sql=${encodedSql}`;
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

            return await response.text();
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') throw new Error('Таймаут запроса (15 сек)');
            if (error.name === 'TypeError' && error.message === 'Failed to fetch') throw new Error('CORS ошибка или сервер недоступен');
            throw error;
        }
    },

    escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
};

// Запуск при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    ORDERS.init();
});
