// ============================================================
// SALARY PAGE - JavaScript (FIXED)
// ============================================================

const SALARY = {
    // Текущий пользователь
    currentUser: null,
    currentUserName: null,
    isAdmin: false,
    // Выбранный сотрудник (если админ может менять)
    selectedUserName: null, // Имя сотрудника для SQL запросов
    selectedDisplayName: null, // Имя для отображения в UI
    // Выбранный месяц
    selectedMonth: null,
    // Календарь
    pickerYear: null,
    pickerMonth: null,
    pickerOpen: false,
    // Все сотрудники для выбора
    employees: [],

    // ============================================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================================
    async init() {
        this.cacheDOM();
        this.checkAuth();
        this.setDefaultMonth();
        await this.checkAdminAccess();
        this.initCalendar();
        this.bindEvents();
        await this.loadEmployees();
    },

    // ============================================================
    // ПРОВЕРКА АДМИН ДОСТУПА
    // ============================================================
    async checkAdminAccess() {
        try {
            const sql = `SELECT "NAME", "status" FROM "sotrud" WHERE "ID"='${this.currentUser}'`;
            const result = await this.executeQuery(sql);
            const lines = result.trim().split('\n').filter(l => l.trim());

            if (lines.length < 2) {
                this.currentUserName = this.currentUser;
                this.currentUserStatus = '';
                return;
            }

            const cols = lines[1].split('\t').map(c => c.trim());
            const name = cols[0] || '';
            const status = cols[1] || '';

            this.currentUserName = name;
            this.currentUserStatus = status;

            // Обновляем отображение имени в шапке
            const nameEl = document.getElementById('currentEmployeeName');
            if (nameEl) {
                nameEl.textContent = name;
            }

            if (status === 'Админ') {
                this.isAdmin = true;
            }
        } catch (error) {
            console.error('[SALARY] Ошибка проверки доступа:', error);
            this.currentUserName = this.currentUser;
            this.currentUserStatus = '';
        }
    },

    // ============================================================
    // КЭШИРОВАНИЕ DOM
    // ============================================================
    cacheDOM() {
        this.els = {
            employeeSelect: document.getElementById('employeeSelect'),
            refreshBtn: document.getElementById('refreshBtn'),
            backBtn: document.getElementById('backBtn'),
            monthEarned: document.getElementById('monthEarned'),
            totalDebt: document.getElementById('totalDebt'),
            todayForecast: document.getElementById('todayForecast'),
            salaryTableBody: document.getElementById('salaryTableBody'),
            // Modal
            modal: document.getElementById('salaryModal'),
            modalTitle: document.getElementById('modalTitle'),
            modalCloseBtn: document.getElementById('modalCloseBtn'),
            modalCloseBtnBottom: document.getElementById('modalCloseBtnBottom'),
            modalStavka: document.getElementById('modalStavka'),
            modalTime: document.getElementById('modalTime'),
            modalArticlesBody: document.getElementById('modalArticlesBody'),
            // Finance
            modalPayValue: document.getElementById('modalPayValue'),
            modalDoppayValue: document.getElementById('modalDoppayValue'),
            modalStrafValue: document.getElementById('modalStrafValue'),
        };
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

        // Проверка доступа к модулю
        const userAccess = window.getUserAccess?.() || [];
        if (userAccess.length === 0 || (!userAccess.includes('*') && !userAccess.includes('Моя зарплата'))) {
            window.location.href = 'login.html';
            return;
        }

        this.serverIp = serverIp;
        this.currentUser = userId;
    },

    // ============================================================
    // УСТАНОВКА МЕСЯЦА ПО УМОЛЧАНИЮ (текущий)
    // ============================================================
    setDefaultMonth() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        this.selectedMonth = `${year}-${month}`;
        this.pickerYear = year;
        this.pickerMonth = now.getMonth(); // 0-based
        this.updateMonthDisplay();
    },

    formatMonthDisplay(year, month) {
        const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
        return `${months[month]} ${year}`;
    },

    updateMonthDisplay() {
        const el = document.getElementById('monthPickerValue');
        if (el && this.selectedMonth) {
            const [y, m] = this.selectedMonth.split('-').map(Number);
            el.textContent = this.formatMonthDisplay(y, m - 1);
        }
    },

    // ============================================================
    // КАЛЕНДАРЬ (выбор месяца)
    // ============================================================
    initCalendar() {
        const display = document.getElementById('monthPickerDisplay');
        const dropdown = document.getElementById('monthPickerDropdown');
        const grid = document.getElementById('monthPickerGridMonths');
        const yearsContainer = document.getElementById('monthPickerYears');

        // Открыть/закрыть
        display.addEventListener('click', (e) => {
            e.stopPropagation();
            this.pickerOpen ? this.closePicker() : this.openPicker();
        });

        // Закрытие при клике вне
        document.addEventListener('click', (e) => {
            if (this.pickerOpen && !e.target.closest('.custom-month-picker')) {
                this.closePicker();
            }
        });

        // Инициализация
        this.renderPickerGrid(grid, yearsContainer);

        // Делегирование кликов на контейнер — не пересоздаётся при innerHTML
        yearsContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.month-picker-year-btn');
            if (!btn) return;
            e.stopPropagation();
            const year = parseInt(btn.dataset.year);
            if (year === this.pickerYear) {
                this.closePicker();
            } else {
                this.pickerYear = year;
                this.renderPickerGrid(grid, yearsContainer);
            }
        });

        grid.addEventListener('click', (e) => {
            const btn = e.target.closest('.month-picker-month-btn');
            if (!btn) return;
            e.stopPropagation();
            const month = parseInt(btn.dataset.month);
            this.selectMonth(this.pickerYear, month);
            this.closePicker();
        });
    },

    openPicker() {
        const dropdown = document.getElementById('monthPickerDropdown');
        const display = document.getElementById('monthPickerDisplay');
        dropdown.style.display = 'block';
        display.classList.add('open');
        this.pickerOpen = true;
        this.renderPickerGrid(
            document.getElementById('monthPickerGridMonths'),
            document.getElementById('monthPickerYears')
        );
    },

    closePicker() {
        const dropdown = document.getElementById('monthPickerDropdown');
        const display = document.getElementById('monthPickerDisplay');
        dropdown.style.display = 'none';
        display.classList.remove('open');
        this.pickerOpen = false;
    },

    selectMonth(year, month) {
        this.selectedMonth = `${year}-${String(month).padStart(2, '0')}`;
        this.updateMonthDisplay();
        this.loadSalaryData();
    },

    renderPickerGrid(grid, yearsContainer) {
        const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
        const now = new Date();
        const currentYear = now.getFullYear();

        // Рендерим годы — текущий и 2 предыдущих
        const years = [currentYear - 2, currentYear - 1, currentYear];
        let yearsHtml = '';
        for (const y of years) {
            let cls = 'month-picker-year-btn';
            if (y === this.pickerYear) {
                cls += ' selected';
            }
            yearsHtml += `<button class="${cls}" data-year="${y}">${y}</button>`;
        }
        yearsContainer.innerHTML = yearsHtml;

        // Рендерим месяцы
        let monthsHtml = '';
        for (let m = 1; m <= 12; m++) {
            let cls = 'month-picker-month-btn';
            if (this.selectedMonth) {
                const [y, mo] = this.selectedMonth.split('-').map(Number);
                if (y === this.pickerYear && mo === m) {
                    cls += ' selected';
                }
            }
            monthsHtml += `<button class="${cls}" data-month="${m}">${months[m - 1]}</button>`;
        }
        grid.innerHTML = monthsHtml;
    },

    // ============================================================
    // ЗАГРУЗКА СПИСКА СОТРУДНИКОВ
    // ============================================================
    async loadEmployees() {
        try {
            const sql = `SELECT "ID", "NAME", "status" FROM "sotrud"`;
            const result = await this.executeQuery(sql);
            const lines = result.trim().split('\n').filter(l => l.trim());

            if (lines.length < 2) {
                this.els.employeeSelect.innerHTML = '<option value="">Нет данных</option>';
                return;
            }

            // Первая строка — заголовки, начиная с 1 — данные
            this.employees = [];
            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split('\t').map(c => c.trim());
                if (cols.length >= 3) {
                    const emp = {
                        id: cols[0],
                        name: cols[1],
                        status: cols[2]
                    };
                    this.employees.push(emp);
                }
            }

            // Заполняем select
            this.renderEmployeeSelect();

            // Определяем имя текущего сотрудника
            const selfEmp = this.employees.find(e => e.id === this.currentUser);
            const selfName = selfEmp ? selfEmp.name : (this.currentUserName || this.currentUser);

            // Если админ — показываем всех, выбираем себя по умолчанию
            // Если обычный — скрываем select, показываем только свои данные
            if (this.isAdmin) {
                this.selectedUserName = selfName;
                this.selectedDisplayName = selfName;
            } else {
                this.selectedUserName = selfName;
                // Скрываем select для обычного сотрудника
                this.els.employeeSelect.parentElement.style.display = 'none';
            }

            // Загружаем данные
            await this.loadSalaryData();
        } catch (error) {
            console.error('[SALARY] Ошибка загрузки сотрудников:', error);
            this.els.employeeSelect.innerHTML = '<option value="">Ошибка загрузки</option>';
        }
    },

    // ============================================================
    // ОТРИСОВКА SELECT СОТРУДНИКОВ
    // ============================================================
    renderEmployeeSelect() {
        this.els.employeeSelect.innerHTML = this.employees
            .map(e => `<option value="${e.name}">${e.name} (${e.id})</option>`)
            .join('');
    },

    // ============================================================
    // ЗАГРУЗКА ДАННЫХ ЗАРПЛАТЫ
    // ============================================================
    async loadSalaryData() {
        if (!this.serverIp || !this.selectedUserName || !this.selectedMonth) {
            return;
        }

        this.showLoading();

        const [monthResult, debtResult, forecastResult] = await Promise.all([
            this.loadMonthSalary(),
            this.loadTotalDebt(),
            this.loadTodayForecast()
        ]);

        if (monthResult) {
            this.renderTable(monthResult);
        }
        if (debtResult !== null) {
            this.renderDebt(debtResult);
        }
        if (forecastResult !== null) {
            this.renderForecast(forecastResult);
        }
    },

    // ============================================================
    // ЗАГРУЗКА ПРОГНОЗА НА СЕГОДНЯ
    // ============================================================
    async loadTodayForecast() {
        try {
            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const day = String(today.getDate()).padStart(2, '0');
            const todayStr = `${year}-${month}-${day}`;

            const [resultEarned, resultDoppay, resultStraf] = await Promise.all([
                this.executeQuery(`SELECT COALESCE(SUM("rabota_time" / 3600.0 * "stavka"), 0) as total FROM "vergleich" WHERE "name" = '${this.selectedUserName}' AND "data" = '${todayStr}'`),
                this.executeQuery(`SELECT COALESCE(SUM("doppay"), 0) as total FROM "zp" WHERE "user" = '${this.selectedUserName}' AND "data" = '${todayStr}'`),
                this.executeQuery(`SELECT COALESCE(SUM("straf"), 0) as total FROM "zp" WHERE "user" = '${this.selectedUserName}' AND "data" = '${todayStr}'`)
            ]);

            const parseLine = (result) => {
                const lines = result.trim().split('\n').filter(l => l.trim());
                return parseFloat((lines[1] || '0').split('\t')[0]) || 0;
            };

            const earned = parseLine(resultEarned);
            const doppay = parseLine(resultDoppay);
            const straf = parseLine(resultStraf);
            const forecast = earned + doppay - straf;

            return { forecast };
        } catch (error) {
            console.error('[SALARY] Ошибка загрузки прогноза:', error);
            return { forecast: 0, earned: 0, doppay: 0, straf: 0 };
        }
    },

    // ============================================================
    // ЗАГРУЗКА ДАННЫХ ЗА МЕСЯЦ
    // ============================================================
    async loadMonthSalary() {
        try {
            const salarySql = `SELECT "data", SUM("rabota_time" / 3600.0 * "stavka") as earned, 0 as doppay, 0 as straf, 0 as pay FROM "vergleich" WHERE "name" = '${this.selectedUserName}' AND "danet" = 1 AND strftime('%Y-%m', "data") = '${this.selectedMonth}' GROUP BY "data" ORDER BY "data" ASC`;
            const result = await this.executeQuery(salarySql);
            const parsedData = this.parseSalaryResult(result);

            const [doppayResult, strafResult, payResult] = await Promise.all([
                this.executeQuery(`SELECT "data", SUM("doppay") as val FROM "zp" WHERE "user" = '${this.selectedUserName}' AND strftime('%Y-%m', "data") = '${this.selectedMonth}' GROUP BY "data"`),
                this.executeQuery(`SELECT "data", SUM("straf") as val FROM "zp" WHERE "user" = '${this.selectedUserName}' AND strftime('%Y-%m', "data") = '${this.selectedMonth}' GROUP BY "data"`),
                this.executeQuery(`SELECT "data", SUM("pay") as val FROM "zp" WHERE "user" = '${this.selectedUserName}' AND strftime('%Y-%m', "data") = '${this.selectedMonth}' GROUP BY "data"`)
            ]);

            const doppayMap = this.parseMapResult(doppayResult);
            const strafMap = this.parseMapResult(strafResult);
            const payMap = this.parseMapResult(payResult);

            parsedData.forEach(row => {
                if (doppayMap[row.date] != null) row.doppay = doppayMap[row.date];
                if (strafMap[row.date] != null) row.straf = strafMap[row.date];
                if (payMap[row.date] != null) row.pay = payMap[row.date];
            });

            const allZpDates = new Set([...Object.keys(doppayMap), ...Object.keys(strafMap), ...Object.keys(payMap)]);
            const existingDates = new Set(parsedData.map(d => d.date));
            allZpDates.forEach(date => {
                if (!existingDates.has(date)) {
                    parsedData.push({ date, earned: 0, doppay: doppayMap[date] || 0, straf: strafMap[date] || 0, pay: payMap[date] || 0 });
                }
            });

            const fullData = this.fillEmptyDays(parsedData, this.selectedMonth);
            this.updateMonthEarned(fullData);
            return fullData;
        } catch (error) {
            console.error('[SALARY] Ошибка загрузки ЗП за месяц:', error);
            return null;
        }
    },

    // ============================================================
    // ПАРСИНГ РЕЗУЛЬТАТА В MAP
    // ============================================================
    parseMapResult(result) {
        const map = {};
        const lines = result.trim().split('\n').filter(l => l.trim());
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split('\t').map(c => c.trim());
            if (cols.length >= 2) {
                map[cols[0]] = parseFloat(cols[1]) || 0;
            }
        }
        return map;
    },

    // ============================================================
    // ПАРСИНГ РЕЗУЛЬТАТА ЗАПРОСА
    // ============================================================
    parseSalaryResult(result) {
        const lines = result.trim().split('\n').filter(l => l.trim());
        const data = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split('\t').map(c => c.trim());
            if (cols.length >= 5) {
                data.push({ date: cols[0], earned: parseFloat(cols[1]) || 0, doppay: parseInt(cols[2]) || 0, straf: parseInt(cols[3]) || 0, pay: parseFloat(cols[4]) || 0 });
            }
        }
        return data;
    },

    // ============================================================
    // ЗАПОЛНЕНИЕ ПУСТЫХ ДНЕЙ
    // ============================================================
    fillEmptyDays(data, monthStr) {
        const [year, month] = monthStr.split('-').map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();
        const result = [];
        const dataMap = {};
        data.forEach(d => {
            if (!dataMap[d.date]) {
                dataMap[d.date] = { date: d.date, earned: 0, doppay: 0, straf: 0, pay: 0 };
            }
            const existing = dataMap[d.date];
            existing.earned += d.earned || 0;
            existing.doppay += d.doppay || 0;
            existing.straf += d.straf || 0;
            existing.pay += d.pay || 0;
        });

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const existingData = dataMap[dateStr];
            result.push(existingData || { date: dateStr, earned: 0, doppay: 0, straf: 0, pay: 0 });
        }
        return result;
    },

    // ============================================================
    // ОБНОВЛЕНИЕ СУММЫ ЗА МЕСЯЦ
    // ============================================================
    updateMonthEarned(data) {
        let total = 0;
        for (const row of data) {
            const earned = row.earned || 0;
            const doppay = row.doppay || 0;
            const straf = row.straf || 0;
            const dayTotal = earned + doppay - straf;
            total += dayTotal;
        }
        this.els.monthEarned.textContent = this.formatMoney(total);
        this.els.monthEarned.className = 'summary-value ' + (total >= 0 ? 'positive' : '');
    },

    // ============================================================
    // ЗАГРУЗКА ОБЩЕГО ДОЛГА
    // ============================================================
    async loadTotalDebt() {
        try {
            const debtSql = `SELECT COALESCE((SELECT SUM(v."rabota_time" / 3600.0 * v."stavka") FROM "vergleich" v WHERE v."name" = '${this.selectedUserName}' AND v."danet" = 1), 0) as total_earned, COALESCE((SELECT SUM("pay") FROM "zp" WHERE "user" = '${this.selectedUserName}'), 0) as total_pay, COALESCE((SELECT SUM("straf") FROM "zp" WHERE "user" = '${this.selectedUserName}'), 0) as total_straf, COALESCE((SELECT SUM("doppay") FROM "zp" WHERE "user" = '${this.selectedUserName}'), 0) as total_doppay`;
            const result = await this.executeQuery(debtSql);
            const lines = result.trim().split('\n').filter(l => l.trim());
            if (lines.length < 2) return 0;

            const cols = lines[1].split('\t').map(c => c.trim());
            const earned = parseFloat(cols[0]) || 0;
            const pay = parseFloat(cols[1]) || 0;
            const straf = parseFloat(cols[2]) || 0;
            const doppay = parseFloat(cols[3]) || 0;
            const debt = earned + doppay - pay - straf;
            return debt;
        } catch (error) {
            console.error('[SALARY] Ошибка загрузки долга:', error);
            return 0;
        }
    },

    // ============================================================
    // ОТРИСОВКА ДОЛГА
    // ============================================================
    renderDebt(debt) {
        this.els.totalDebt.textContent = this.formatMoney(debt);
        this.els.totalDebt.className = 'summary-value ' + (debt > 0 ? 'positive' : (debt < 0 ? 'negative' : ''));
    },

    // ============================================================
    // ОТРИСОВКА ПРОГНОЗА
    // ============================================================
    renderForecast(forecast) {
        this.els.todayForecast.textContent = this.formatMoney(forecast.forecast);
        this.els.todayForecast.className = 'summary-value forecast';
    },

    // ============================================================
    // ОТРИСОВКА ТАБЛИЦЫ
    // ============================================================
    renderTable(data) {
        if (data.length === 0) {
            this.els.salaryTableBody.innerHTML = `<tr class="empty-row"><td colspan="5">Нет данных за ${this.formatMonth(this.selectedMonth)}</td></tr>`;
            return;
        }

        const rows = [];
        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const earned = row.earned > 0 ? this.formatMoney(row.earned) : '';
            const doppay = row.doppay > 0 ? this.formatMoney(row.doppay) : '';
            const straf = row.straf > 0 ? this.formatMoney(row.straf) : '';
            const pay = row.pay > 0 ? this.formatMoney(row.pay) : '';

            rows.push(`<tr data-date="${row.date}" class="salary-row"><td>${this.formatDate(row.date)}</td><td>${earned}</td><td>${doppay}</td><td>${straf}</td><td>${pay}</td></tr>`);
        }
        this.els.salaryTableBody.innerHTML = rows.join('');

        this.els.salaryTableBody.querySelectorAll('.salary-row').forEach(row => {
            row.addEventListener('click', () => {
                const date = row.getAttribute('data-date');
                this.openModal(date);
            });
        });
    },

    // ============================================================
    // МОДАЛЬНОЕ ОКНО
    // ============================================================
    async openModal(date) {
        try {
            this.showModalLoading();
            const statsSql = `SELECT SUM("rabota_time") as total_rabota_time, MAX("stavka") as stavka FROM "vergleich" WHERE "name" = '${this.selectedUserName}' AND "danet" = 1 AND "data" = '${date}'`;
            const statsResult = await this.executeQuery(statsSql);
            const statsLines = statsResult.trim().split('\n').filter(l => l.trim());

            let rabotaTime = 0;
            let stavka = 0;
            if (statsLines.length >= 2) {
                const cols = statsLines[1].split('\t').map(c => c.trim());
                rabotaTime = parseInt(cols[0]) || 0;
                stavka = parseInt(cols[1]) || 0;
            }

            const totalHours = rabotaTime / 3600;
            const hours = Math.floor(totalHours);
            const minutes = Math.round((totalHours - hours) * 60);
            const timeStr = `${hours} ч. ${minutes} мин.`;

            this.els.modalTitle.textContent = `Детали — ${this.formatDate(date)}`;
            this.els.modalStavka.textContent = this.formatMoney(stavka);
            this.els.modalTime.textContent = timeStr;

            const articlesSql = `SELECT v."kod", v."quantity", v."rabota_time", v."stavka", g."art" FROM "vergleich" v LEFT JOIN "guide" g ON g."kod" = v."kod" WHERE v."name" = '${this.selectedUserName}' AND v."danet" = 1 AND v."data" = '${date}' ORDER BY v."kod" ASC`;
            const articlesResult = await this.executeQuery(articlesSql);
            const articleLines = articlesResult.trim().split('\n').filter(l => l.trim());

            if (articleLines.length < 2) {
                this.els.modalArticlesBody.innerHTML = '<tr class="empty-row"><td colspan="3">Нет данных</td></tr>';
            } else {
                const rows = [];
                for (let i = 1; i < articleLines.length; i++) {
                    const cols = articleLines[i].split('\t').map(c => c.trim());
                    if (cols.length >= 5) {
                        const art = (cols[4] && cols[4] !== '') ? cols[4] : (cols[0] || '—');
                        const quantity = parseInt(cols[1]) || 0;
                        const itemRt = parseInt(cols[2]) || 0;
                        const itemSt = parseInt(cols[3]) || 0;
                        const itemSum = itemRt > 0 && itemSt > 0 ? (itemRt / 3600.0 * itemSt) : 0;
                        const itemSumPerUnit = quantity > 0 ? (itemSum / quantity) : 0;

                        rows.push(`<tr><td>${art}</td><td>${quantity}</td><td>${this.formatMoney(itemSum)} <span class="per-unit">(${this.formatMoneyPerUnit(itemSumPerUnit)} / шт.)</span></td></tr>`);
                    }
                }
                this.els.modalArticlesBody.innerHTML = rows.join('');
            }

            // Загружаем финансы за день
            const [payResult, doppayResult, doppayCommentResult, strafResult, strafCommentResult] = await Promise.all([
                this.executeQuery(`SELECT COALESCE(SUM("pay"), 0) as total FROM "zp" WHERE "user" = '${this.selectedUserName}' AND "data" = '${date}'`),
                this.executeQuery(`SELECT COALESCE(SUM("doppay"), 0) as total FROM "zp" WHERE "user" = '${this.selectedUserName}' AND "data" = '${date}'`),
                this.executeQuery(`SELECT MAX("komm") as comment FROM "zp" WHERE "user" = '${this.selectedUserName}' AND "data" = '${date}' AND "doppay" > 0`),
                this.executeQuery(`SELECT COALESCE(SUM("straf"), 0) as total FROM "zp" WHERE "user" = '${this.selectedUserName}' AND "data" = '${date}'`),
                this.executeQuery(`SELECT MAX("komm") as comment FROM "zp" WHERE "user" = '${this.selectedUserName}' AND "data" = '${date}' AND "straf" > 0`)
            ]);

            const parseLine = (result) => {
                const lines = result.trim().split('\n').filter(l => l.trim());
                return lines.length >= 2 ? lines[1].split('\t')[0] : '';
            };

            const parseValue = (result) => {
                const lines = result.trim().split('\n').filter(l => l.trim());
                return parseFloat((lines[1] || '0').split('\t')[0]) || 0;
            };

            const pay = parseValue(payResult);
            const doppay = parseValue(doppayResult);
            const straf = parseValue(strafResult);
            const doppayComment = parseLine(doppayCommentResult);
            const strafComment = parseLine(strafCommentResult);

            this.els.modalPayValue.textContent = pay > 0 ? this.formatMoney(pay) : '—';
            this.els.modalDoppayValue.textContent = doppay > 0 ? this.formatMoney(doppay) : '—';
            this.els.modalStrafValue.textContent = straf > 0 ? this.formatMoney(straf) : '—';

            // Комментарии
            if (doppayComment && doppayComment.trim()) {
                const commentEl = document.getElementById('modalDoppayComment');
                commentEl.textContent = '💬 ' + doppayComment.trim();
                commentEl.title = doppayComment.trim();
                commentEl.style.display = 'block';
            }
            if (strafComment && strafComment.trim()) {
                const commentEl = document.getElementById('modalStrafComment');
                commentEl.textContent = '💬 ' + strafComment.trim();
                commentEl.title = strafComment.trim();
                commentEl.style.display = 'block';
            }

            this.els.modal.style.display = 'flex';
        } catch (error) {
            console.error('[SALARY] Ошибка загрузки деталей:', error);
        }
    },

    // ============================================================
    // УТИЛИТЫ
    // ============================================================
    showLoading() {
        this.els.salaryTableBody.innerHTML = '<tr class="empty-row"><td colspan="5">Загрузка...</td></tr>';
    },
    showModalLoading() {
        this.els.modalArticlesBody.innerHTML = '<tr class="empty-row"><td colspan="3">Загрузка...</td></tr>';
        this.els.modalPayValue.textContent = '—';
        this.els.modalDoppayValue.textContent = '—';
        this.els.modalStrafValue.textContent = '—';
        const doppayComment = document.getElementById('modalDoppayComment');
        if (doppayComment) { doppayComment.style.display = 'none'; doppayComment.textContent = ''; }
        const strafComment = document.getElementById('modalStrafComment');
        if (strafComment) { strafComment.style.display = 'none'; strafComment.textContent = ''; }
    },
    formatMoney(value) {
        return `${parseInt(value || 0)} ₽`;
    },
    formatMoneyPerUnit(value) {
        return `${parseInt(value || 0)} ₽`;
    },
    formatDate(dateStr) {
        const date = new Date(dateStr);
        return `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
    },
    formatMonth(monthStr) {
        const [year, month] = monthStr.split('-');
        const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
        return `${months[parseInt(month) - 1]} ${year}`;
    },

    // ============================================================
    // ИСПОЛНЕНИЕ ЗАПРОСА
    // ============================================================
    async executeQuery(sql) {
        const serverIp = localStorage.getItem('serverIp');
        const encodedSql = encodeURIComponent(sql.trim());
        const url = `http://${serverIp}:8080/query?sql=${encodedSql}`;

        try {
            const response = await fetch(url, { method: 'GET', mode: 'cors' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.text();
        } catch (error) {
            console.error('[SALARY] Ошибка запроса:', error);
            throw error;
        }
    },

    // ============================================================
    // СОБЫТИЯ
    // ============================================================
    bindEvents() {
        document.getElementById('modalCloseBtn').addEventListener('click', () => this.els.modal.style.display = 'none');
        document.getElementById('modalCloseBtnBottom').addEventListener('click', () => this.els.modal.style.display = 'none');
        document.getElementById('refreshBtn').addEventListener('click', () => this.loadSalaryData());
        document.getElementById('backBtn').addEventListener('click', () => {
            window.history.back();
        });
        document.getElementById('employeeSelect').addEventListener('change', (e) => {
            this.selectedUserName = e.target.value;
            this.loadSalaryData();
        });
    }
};

// ============================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    SALARY.init();
});
