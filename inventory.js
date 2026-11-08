// ============================================================
// INVENTORY PAGE - JavaScript
// ============================================================

const INVENTORY = {
    serverIp: null,
    currentType: null,
    tableData: [], // [{ kod, art, qty, scratched: false, crossort: false }]
    currentScratchKod: null, // kod для которого делаем -1
    processedKodpod: new Set(), // уже обработанные kodpod за сессию
    historyRecords: [], // история обработанных кодов для отображения
    writeoffData: null, // данные для списания {kod, art, edizm, type}

    init() {
        this.serverIp = localStorage.getItem('serverIp');
        if (!this.serverIp) {
            window.location.href = 'login.html';
            return;
        }

        this.bindEvents();
    },

    bindEvents() {
        document.getElementById('backBtn').addEventListener('click', () => {
            window.history.back();
        });

        document.getElementById('typeSelect').addEventListener('change', (e) => {
            this.onTypeChange(e.target.value);
        });

        // Обработка Enter (для сканера штрихкодов)
        document.getElementById('podmenaInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const val = document.getElementById('podmenaInput').value.trim();
                if (val && this.currentType === 'Товар') {
                    this.searchPodmena(val);
                    // Очищаем поле и возвращаем фокус для следующего сканирования
                    setTimeout(() => {
                        document.getElementById('podmenaInput').value = '';
                        document.getElementById('podmenaInput').focus();
                    }, 100);
                }
            }
        });

        // === МОДАЛЬНОЕ ОКНО СПИСАНИЯ ===
        document.getElementById('closeWriteoffModal').addEventListener('click', () => {
            this.closeWriteoffModal();
        });

        document.getElementById('cancelWriteoffBtn').addEventListener('click', () => {
            this.closeWriteoffModal();
        });

        document.getElementById('writeoffModal').addEventListener('click', (e) => {
            if (e.target.id === 'writeoffModal') {
                this.closeWriteoffModal();
            }
        });

        document.getElementById('writeoffQty').addEventListener('input', (e) => {
            this.validateWriteoffQty(e.target.value);
        });

        document.getElementById('confirmWriteoffBtn').addEventListener('click', () => {
            this.confirmWriteoff();
        });
    },

    // ============================================================
    // СМЕНА ТИПА ПОЗИЦИИ
    // ============================================================
    async onTypeChange(type) {
        if (!type) return;

        this.currentType = type;
        this.tableData = [];

        // Активируем/дезактивируем поле ввода
        const podmenaInput = document.getElementById('podmenaInput');
        podmenaInput.disabled = type !== 'Товар';

        // Очищаем статус
        this.clearStatus();

        // Очищаем поле
        podmenaInput.value = '';

        // Загружаем данные для типа
        await this.loadInventoryTable(type);
    },

    // ============================================================
    // ЗАГРУЗКА ТАБЛИЦЫ СКЛАДА
    // ============================================================
    async loadInventoryTable(type) {
        const tbody = document.getElementById('inventoryTableBody');
        tbody.innerHTML = '<tr><td colspan="4" class="no-data">Загрузка...</td></tr>';

        try {
            // Загружаем все записи guide где type = выбранный и vidim = 'ДА'
            // opt != "Сборка" фильтруем на клиенте (как на складе)
            const guideResult = await this.query(
                `SELECT "kod", "art", "opt" FROM "guide" WHERE "type"='${type.replace(/'/g, "''")}' AND "vidim" = 'ДА'`
            );

            if (!guideResult?.trim()) {
                tbody.innerHTML = '<tr><td colspan="4" class="no-data">Нет данных для выбранного типа</td></tr>';
                console.log('[inventory] Пустой результат для type:', type);
                return;
            }

            console.log('[inventory] raw guideResult:', guideResult);

            const lines = guideResult.trim().split('\n').filter(l => l);
            const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
            const kodIdx = headers.indexOf('kod');
            const artIdx = headers.indexOf('art');
            const optIdx = headers.indexOf('opt');

            const uniqueKods = [];
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split('\t');
                const kod = kodIdx >= 0 ? parts[kodIdx]?.trim() : '';
                if (!kod) continue;

                // Исключаем Сборка (как на складе)
                const opt = optIdx >= 0 ? parts[optIdx]?.trim() : '';
                if (opt === 'Сборка') continue;

                const art = artIdx >= 0 ? parts[artIdx]?.trim() || '—' : '—';
                uniqueKods.push({ kod, art });
            }

            // Загружаем остатки из history
            let warehouseCache = {};
            if (uniqueKods.length > 0) {
                const kodList = uniqueKods.map(k => `'${k.kod.replace(/'/g, "''")}'`).join(',');
                const historyResult = await this.query(
                    `SELECT "kod", SUM("quantity" * "prostuk") as "total" FROM "history" WHERE "kod" IN (${kodList}) GROUP BY "kod"`
                );

                if (historyResult?.trim()) {
                    const hLines = historyResult.trim().split('\n').filter(l => l);
                    const hHeaders = hLines[0].split('\t').map(h => h.trim().toLowerCase());
                    const hKodIdx = hHeaders.indexOf('kod');
                    const hTotalIdx = hHeaders.findIndex(h => h.includes('total') || h === 'sum');

                    for (let i = 1; i < hLines.length; i++) {
                        const parts = hLines[i].split('\t');
                        const k = hKodIdx >= 0 ? parts[hKodIdx]?.trim() : '';
                        const q = hTotalIdx >= 0 ? parseFloat(parts[hTotalIdx]) || 0 : 0;
                        warehouseCache[k] = q;
                    }
                }
            }

            // Формируем данные таблицы
            this.tableData = uniqueKods.map(k => ({
                kod: k.kod,
                art: k.art,
                qty: warehouseCache[k.kod] || 0,
                scratched: false,
                crossort: false
            }));

            // Рендерим
            this.renderTable();

        } catch (e) {
            console.error('Ошибка загрузки таблицы:', e);
            tbody.innerHTML = `<tr><td colspan="4" class="no-data" style="color:#ef4444;">Ошибка: ${e.message}</td></tr>`;
        }
    },

    // ============================================================
    // РЕНДЕР ТАБЛИЦЫ
    // ============================================================
    renderTable() {
        const tbody = document.getElementById('inventoryTableBody');

        // Фильтруем: убираем zero qty (кроме scratched/crossort)
        const visibleData = this.tableData.filter(d => {
            if (d.qty === 0 && !d.scratched && !d.crossort) return false;
            return true;
        });

        if (visibleData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="no-data">Нет данных для отображения</td></tr>';
            return;
        }

        tbody.innerHTML = visibleData.map(d => {
            let rowClass = '';
            let qtyClass = '';

            if (d.scratched) {
                rowClass = 'row-scratched';
                qtyClass = 'qty-scratched';
            } else if (d.crossort) {
                rowClass = 'row-crossort';
                qtyClass = 'qty-crossort';
            }

            return `<tr data-kod="${this.escapeHtml(d.kod)}" class="${rowClass}">
                <td>${this.escapeHtml(d.kod)}</td>
                <td>${this.escapeHtml(d.art)}</td>
                <td class="qty-cell ${qtyClass}">${d.qty}</td>
                <td>
                    <button class="write-off-btn" data-kod="${this.escapeHtml(d.kod)}" title="Списание (−1)">🗑️ Списание</button>
                </td>
            </tr>`;
        }).join('');

        // Привязываем события на кнопки "Списание"
        tbody.querySelectorAll('.write-off-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const kod = e.target.getAttribute('data-kod');
                this.onWriteOff(kod);
            });
        });
    },

    // ============================================================
    // ПОИСК В PODRENA
    // ============================================================
    async searchPodmena(kodpod) {
        const podmenaInput = document.getElementById('podmenaInput');

        if (!kodpod) return;

        // Проверяем, не был ли уже обработан за сессию
        if (this.processedKodpod.has(kodpod)) {
            this.playSound('error');
            this.showToast(`Код ${kodpod} уже был обработан в этой сессии`, 'warning', 4000);
            return;
        }

        try {
            // Ищем в podmena по kodpod
            const podmenaResult = await this.query(
                `SELECT "kodpod", "kod", "status" FROM "podmena" WHERE "kodpod"='${kodpod.replace(/'/g, "''")}'`
            );

            if (!podmenaResult?.trim()) {
                this.playSound('error');
                this.showToast(`Код ${kodpod} не найден в базе подмен`, 'error', 4000);
                return;
            }

            // Нашли в podmena
            const lines = podmenaResult.trim().split('\n').filter(l => l);
            const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());

            if (lines.length < 2) {
                this.playSound('error');
                this.showToast(`Код ${kodpod} не найден в базе подмен`, 'error', 4000);
                return;
            }

            const kodpodIdx = headers.indexOf('kodpod');
            const kodIdx = headers.indexOf('kod');
            const statusIdx = headers.indexOf('status');

            const foundKodpod = kodpodIdx >= 0 ? lines[1]?.split('\t')[kodpodIdx]?.trim() : '';
            const foundKod = kodIdx >= 0 ? lines[1]?.split('\t')[kodIdx]?.trim() : '';
            const status = statusIdx >= 0 ? parseInt(lines[1]?.split('\t')[statusIdx]) : 0;

            if (status === 0) {
                this.playSound('error');
                this.showToast(`Код ${kodpod} найден, но его статус = 0 (уже использован)`, 'warning', 4000);
                this.processedKodpod.add(kodpod);
                this.addHistoryRecord({ kodpod, foundKod, status: 0, result: 'used' });
                this.renderHistory();
                return;
            }

            // ✅ status = 1 — активен
            // Проверяем, есть ли такой kod в таблице
            const row = this.tableData.find(d => d.kod === foundKod);

            if (!row) {
                this.playSound('error');
                this.showToast(`Пересорт: kodpod ${kodpod} → guide.kod = ${foundKod} не найден в таблице`, 'warning', 4000);
                this.processedKodpod.add(kodpod);
                this.addHistoryRecord({ kodpod, foundKod, status: 1, result: 'crossort' });
                this.renderHistory();
                return;
            }

            // ✅ status = 1 и есть в таблице — делаем -1
            this.playSound('success');
            this.showToast(`Списание выполнено! Осталось: ${row.qty - 1}`, 'success', 2000);
            row.qty -= 1;
            this.renderTable();

            this.processedKodpod.add(kodpod);
            this.addHistoryRecord({ kodpod, foundKod, status: 1, result: 'scratched', qty: row.qty });
            this.renderHistory();

            podmenaInput.value = '';

        } catch (e) {
            console.error('Ошибка поиска в podmena:', e);
            this.playSound('error');
            this.showToast(`Ошибка поиска: ${e.message}`, 'error', 4000);
        }
    },

    // ============================================================
    // ДОБАВИТЬ ЗАПИСЬ В ИСТОРИЮ
    // ============================================================
    addHistoryRecord(record) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        record.time = timeStr;
        record.timestamp = now.getTime();
        
        this.historyRecords.unshift(record); // добавляем в начало
    },

    // ============================================================
    // РЕНДЕР ИСТОРИИ
    // ============================================================
    renderHistory() {
        const container = document.getElementById('historyContainer');
        if (!container) return;

        if (this.historyRecords.length === 0) {
            container.innerHTML = '<div class="history-empty">История пуста</div>';
            return;
        }

        const rows = this.historyRecords.map(record => {
            let statusClass = '';
            let statusText = '';
            
            switch (record.result) {
                case 'scratched':
                    statusClass = 'history-success';
                    statusText = `✅ Списание (-1), осталось: ${record.qty}`;
                    break;
                case 'used':
                    statusClass = 'history-warning';
                    statusText = '⚠️ Код уже использован (status=0)';
                    break;
                case 'crossort':
                    statusClass = 'history-warning';
                    statusText = `⚠️ Пересорт: guide.kod = ${this.escapeHtml(record.foundKod || '—')}`;
                    break;
            }

            return `<tr class="${statusClass}">
                <td>${this.escapeHtml(record.time)}</td>
                <td>${this.escapeHtml(record.kodpod)}</td>
                <td>${this.escapeHtml(record.foundKod || '—')}</td>
                <td>${statusText}</td>
            </tr>`;
        }).join('');

        container.innerHTML = `
            <table class="history-table">
                <thead>
                    <tr>
                        <th>Время</th>
                        <th>kodpod</th>
                        <th>guide.kod</th>
                        <th>Результат</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        `;
    },

    // ============================================================
    // СПИСАНИЕ (открытие модального окна)
    // ============================================================
    async onWriteOff(kod) {
        const row = this.tableData.find(d => d.kod === kod);
        if (!row) return;

        try {
            // Загружаем edizm и type из guide
            const guideResult = await this.query(
                `SELECT "art", "edizm", "type" FROM "guide" WHERE "kod"='${kod.replace(/'/g, "''")}'`
            );

            let art = row.art;
            let edizm = '—';
            let type = '';

            if (guideResult?.trim()) {
                const lines = guideResult.trim().split('\n').filter(l => l);
                if (lines.length >= 2) {
                    const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
                    const artIdx = headers.indexOf('art');
                    const edizmIdx = headers.indexOf('edizm');
                    const typeIdx = headers.indexOf('type');
                    const parts = lines[1]?.split('\t') || [];
                    art = artIdx >= 0 ? parts[artIdx]?.trim() || '—' : '—';
                    edizm = edizmIdx >= 0 ? parts[edizmIdx]?.trim() || '—' : '—';
                    type = typeIdx >= 0 ? parts[typeIdx]?.trim() : '';
                }
            }

            this.writeoffData = { kod, art, edizm, type };

            // Заполняем модальное окно
            document.getElementById('writeoffKod').textContent = kod;
            document.getElementById('writeoffArt').textContent = art;
            document.getElementById('writeoffEdizmDisplay').textContent = edizm;

            // Настраиваем поле ввода
            const qtyInput = document.getElementById('writeoffQty');
            qtyInput.value = '';
            qtyInput.disabled = false;

            if (type === 'Товар') {
                qtyInput.step = '1';
                qtyInput.pattern = '[0-9]*';
            } else {
                qtyInput.step = '0.01';
            }

            document.getElementById('writeoffDefect').checked = false;
            document.getElementById('writeoffError').style.display = 'none';

            // Открываем модальное окно
            document.getElementById('writeoffModal').classList.add('show');
            setTimeout(() => qtyInput.focus(), 100);

        } catch (e) {
            console.error('Ошибка загрузки данных для списания:', e);
            this.showToast(`Ошибка: ${e.message}`, 'error', 4000);
        }
    },

    closeWriteoffModal() {
        document.getElementById('writeoffModal').classList.remove('show');
        this.writeoffData = null;
    },

    // ============================================================
    // ВАЛИДАЦИЯ ПОЛЯ ВВОДА КОЛИЧЕСТВА
    // ============================================================
    validateWriteoffQty(value) {
        const input = document.getElementById('writeoffQty');
        const errorEl = document.getElementById('writeoffError');

        if (!this.writeoffData) return true;

        let valid = true;
        const numValue = parseFloat(value);

        if (value === '' || value === '0') {
            errorEl.style.display = 'none';
            valid = false; // 0 не допускается
        } else if (isNaN(numValue) || numValue < 0) {
            errorEl.textContent = 'Введите положительное число';
            errorEl.style.display = 'block';
            valid = false;
        } else if (this.writeoffData.type === 'Товар') {
            // Для "Товар" — только целые числа
            if (!Number.isInteger(numValue)) {
                errorEl.textContent = 'Для товаров введите целое число';
                errorEl.style.display = 'block';
                valid = false;
            } else {
                errorEl.style.display = 'none';
            }
        } else {
            // Для остальных — до сотых
            const decimalPart = value.split('.')[1];
            if (decimalPart && decimalPart.length > 2) {
                errorEl.textContent = 'Максимум 2 знака после запятой';
                errorEl.style.display = 'block';
                valid = false;
            } else {
                errorEl.style.display = 'none';
            }
        }

        return valid;
    },

    // ============================================================
    // ПОДТВЕРЖДЕНИЕ СПИСАНИЯ
    // ============================================================
    async confirmWriteoff() {
        if (!this.writeoffData) return;

        const qtyInput = document.getElementById('writeoffQty');
        const defectCheckbox = document.getElementById('writeoffDefect');
        const errorEl = document.getElementById('writeoffError');

        const value = qtyInput.value.trim();
        const numValue = parseFloat(value);

        // Валидация
        if (!value || isNaN(numValue) || numValue < 0) {
            errorEl.textContent = 'Введите корректное количество';
            errorEl.style.display = 'block';
            return;
        }

        if (this.writeoffData.type === 'Товар' && !Number.isInteger(numValue)) {
            errorEl.textContent = 'Для товаров введите целое число';
            errorEl.style.display = 'block';
            return;
        }

        const prostuk = numValue;
        const prichina = defectCheckbox.checked ? 'Брак' : '';

        // Загружаем данные пользователя
        const userId = localStorage.getItem('userId') || '';
        const userName = localStorage.getItem('userName') || userId;

        try {
            const now = new Date();
            const dataStr = now.toISOString().split('T')[0];
            const timeStr = now.toTimeString().split(' ')[0].slice(0, 8);

            // INSERT INTO history
            const sql = `INSERT INTO "history" ("kod", "data", "time", "quantity", "prostuk", "user", "ID_user", "prichina") ` +
                `VALUES ('${this.writeoffData.kod.replace(/'/g, "''")}', '${dataStr}', '${timeStr}', '-1', ${prostuk}, '${userName.replace(/'/g, "''")}', '${userId.replace(/'/g, "''")}', '${prichina.replace(/'/g, "''")}')`;

            await this.query(sql);

            // Успех
            this.playSound('success');
            this.showToast('Товар успешно списан!', 'success', 2000);

            // Закрываем модалку
            this.closeWriteoffModal();

            // Обновляем таблицу
            await this.loadInventoryTable(this.currentType);

        } catch (e) {
            console.error('Ошибка списания:', e);
            this.showToast(`Ошибка списания: ${e.message}`, 'error', 4000);
        }
    },

    // ============================================================
    // ЗВУКИ
    // ============================================================
    playSound() {
        const audio = document.getElementById('soundWriteoff');
        if (audio) {
            audio.currentTime = 0;
            audio.play().catch(() => {});
        }
    },

    // ============================================================
    // УТИЛИТЫ
    // ============================================================
    showToast(message, type = 'success', duration = 2000) {
        const toast = document.getElementById('toastNotification');
        if (!toast) return;

        // Убираем старые классы
        toast.className = 'toast-notification';
        toast.textContent = message;

        // Добавляем тип
        toast.classList.add(`toast-${type}`);

        // Показываем
        setTimeout(() => toast.classList.add('show'), 10);

        // Скрываем
        setTimeout(() => {
            toast.classList.remove('show');
        }, duration);
    },
    clearStatus() {
        const statusEl = document.getElementById('searchStatus');
        statusEl.className = 'search-status';
        statusEl.textContent = '';
    },

    async query(sql) {
        const encodedSql = encodeURIComponent(sql.trim());
        const url = `http://${this.serverIp}:8080/query?sql=${encodedSql}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                mode: 'cors'
            });
            return await response.text();
        } catch (e) {
            throw e;
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
    INVENTORY.init();
});
