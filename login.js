// ============================================================
// LOGIN PAGE - JavaScript
// ============================================================

const LOGIN = {
    serverIp: '',
    isConnected: false,
    _connecting: false,

    // ============================================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================================
    async init() {
        // На странице логина — не проверяем авторизацию,
        // чтобы не было бесконечных перезагрузок при смене прав

        this.populateHistoryDropdown();
        this.loadLastSuccessfulIP();

        // Автоматически подключаемся к последнему успешному IP
        await this.autoConnectLastIP();

        this.bindEvents();
    },

    // ============================================================
    // УПРАВЛЕНИЕ СВЕЧЕНИЕМ IP-ПОЛЯ
    // ============================================================
    setConnectionGlow(isConnected) {
        const ipInput = document.getElementById('ipInput');
        ipInput.classList.remove('glow-red', 'glow-green');

        if (isConnected) {
            ipInput.classList.add('glow-green');
        } else {
            ipInput.classList.add('glow-red');
        }
    },

    // ============================================================
    // АВТОПОДКЛЮЧЕНИЕ К ПОСЛЕДНЕМУ IP
    // ============================================================
    async autoConnectLastIP() {
        const history = window.ConnectionHistory.getAll();
        const lastSuccessful = history.find(item => item.success);

        if (!lastSuccessful) return;

        const ip = lastSuccessful.ip;
        console.log('🔄 Автоматическое подключение к:', ip);

        this.setConnectionGlow(false);

        await new Promise(resolve => setTimeout(resolve, 300));

        const connectBtn = document.getElementById('connectBtn');
        connectBtn.disabled = true;
        connectBtn.querySelector('.btn-icon').textContent = '⏳';
        connectBtn.childNodes[connectBtn.childNodes.length - 1].textContent = ' Автоподключение...';

        try {
            const isConnected = await this.tryConnect(ip, 3000, { mode: 'cors' });

            if (isConnected) {
                console.log('✅ Автоподключение успешно');
                this.serverIp = ip;
                this.isConnected = true;
                this.setConnectionGlow(true);
                this.populateHistoryDropdown();
                this.enableAuthForm();
            } else {
                const isConnected2 = await this.tryConnect(ip, 3000, { mode: 'no-cors' });
                if (isConnected2) {
                    console.log('✅ Автоподключение (no-cors) успешно');
                    this.serverIp = ip;
                    this.isConnected = true;
                    this.setConnectionGlow(true);
                    this.populateHistoryDropdown();
                    this.enableAuthForm();
                } else {
                    console.log('❌ Автоподключение не удалось');
                    this.setConnectionGlow(false);
                    this.populateHistoryDropdown();
                }
            }
        } catch (error) {
            console.log('❌ Автоподключение прервано:', error.message);
            this.setConnectionGlow(false);
            this.populateHistoryDropdown();
        } finally {
            connectBtn.disabled = false;
            connectBtn.querySelector('.btn-icon').textContent = '🔍';
            connectBtn.childNodes[connectBtn.childNodes.length - 1].textContent = ' Подключиться';
        }
    },

    // ============================================================
    // TOAST УВЕДОМЛЕНИЯ
    // ============================================================
    showToast(message, type = 'error', duration = 4000) {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        const icons = { error: '❌', success: '✅', info: 'ℹ️' };
        toast.innerHTML = `
            <span class="toast-icon">${icons[type] || icons.error}</span>
            <span class="toast-text">${message}</span>
            <button class="toast-close">✕</button>
        `;

        const closeBtn = toast.querySelector('.toast-close');
        closeBtn.addEventListener('click', () => this.hideToast(toast));

        container.appendChild(toast);

        // Авто-скрытие
        if (duration > 0) {
            setTimeout(() => this.hideToast(toast), duration);
        }
    },

    hideToast(toast) {
        if (!toast || toast.classList.contains('toast-hiding')) return;
        toast.classList.add('toast-hiding');
        setTimeout(() => toast.remove(), 300);
    },

    // ============================================================
    // ВЫПАДАЮЩИЙ СПИСОК ИСТОРИИ (datalist)
    // ============================================================
    populateHistoryDropdown() {
        const datalist = document.getElementById('ipHistoryList');

        if (!datalist) return;

        const history = window.ConnectionHistory.getAll();

        if (history.length === 0) {
            datalist.innerHTML = '';
            return;
        }

        datalist.innerHTML = '';

        history.forEach(item => {
            const option = document.createElement('option');
            option.value = item.ip;

            const statusIcon = item.success ? '✓' : '✗';
            const timeAgo = this.getTimeAgo(item.timestamp);

            option.label = `${item.ip}  ${statusIcon}  ${timeAgo}`;
            datalist.appendChild(option);
        });
    },

    getTimeAgo(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;

        const minutes = Math.floor(diff / 60000);
        if (minutes < 1) return 'только что';
        if (minutes < 60) return `${minutes} мин. назад`;

        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours} ч. назад`;

        const days = Math.floor(hours / 24);
        return `${days} дн. назад`;
    },

    // ============================================================
    // СОБЫТИЯ
    // ============================================================
    bindEvents() {
        document.getElementById('connectBtn').addEventListener('click', () => {
            this.connectToServer();
        });

        document.getElementById('guideBtn').addEventListener('click', () => {
            this.openGuide();
        });

        document.getElementById('closeGuideBtn').addEventListener('click', () => {
            this.closeGuide();
        });

        document.getElementById('guideModal').addEventListener('click', (e) => {
            if (e.target.id === 'guideModal') {
                this.closeGuide();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeGuide();
            }
        });

        document.getElementById('loginBtn').addEventListener('click', () => {
            this.authenticate();
        });

        // Enter для подключения
        document.getElementById('ipInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !document.getElementById('connectBtn').disabled) {
                this.connectToServer();
            }
        });

        // Автоподключение при выборе IP из истории (datalist)
        document.getElementById('ipInput').addEventListener('change', (e) => {
            const history = window.ConnectionHistory.getAll();
            const matches = history.filter(item => item.ip === e.target.value.trim());
            if (matches.length > 0 && !this._connecting && document.getElementById('connectBtn').disabled !== false) {
                document.getElementById('connectBtn').click();
            }
        });

        // Enter для входа
        document.getElementById('passwordInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !document.getElementById('loginBtn').disabled) {
                this.authenticate();
            }
        });

        document.getElementById('userIdInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !document.getElementById('loginBtn').disabled) {
                this.authenticate();
            }
        });
    },

    // ============================================================
    // ПОДКЛЮЧЕНИЕ К СЕРВЕРУ
    // ============================================================
    async connectToServer() {
        const ip = document.getElementById('ipInput').value.trim();

        if (!ip) {
            this.showToast('Введите IP-адрес сервера', 'error');
            return;
        }

        if (this._connecting) return;
        this._connecting = true;

        const connectBtn = document.getElementById('connectBtn');
        connectBtn.disabled = true;
        connectBtn.querySelector('.btn-icon').textContent = '⏳';
        connectBtn.childNodes[connectBtn.childNodes.length - 1].textContent = ' Подключение...';

        this.setConnectionGlow(false);

        try {
            const isConnected = await this.tryConnect(ip, 3000, { mode: 'cors' });

            if (isConnected) {
                this.serverIp = ip;
                this.isConnected = true;

                window.ConnectionHistory.save(ip, true);
                this.loadLastSuccessfulIP();
                this.populateHistoryDropdown();
                this.setConnectionGlow(true);
                this.enableAuthForm();
            } else {
                const isConnected2 = await this.tryConnect(ip, 3000, { mode: 'no-cors' });

                if (isConnected2) {
                    this.serverIp = ip;
                    this.isConnected = true;

                    window.ConnectionHistory.save(ip, true);
                    this.loadLastSuccessfulIP();
                    this.populateHistoryDropdown();
                    this.setConnectionGlow(true);
                    this.enableAuthForm();
                } else {
                    window.ConnectionHistory.save(ip, false);
                    this.populateHistoryDropdown();
                    this.showToast('Нет подключения к серверу', 'error');
                }
            }
        } catch (error) {
            console.error('Connection error:', error);
            window.ConnectionHistory.save(ip, false);
            this.setConnectionGlow(false);
            this.populateHistoryDropdown();
            this.showToast('Нет подключения к серверу', 'error');
        } finally {
            connectBtn.disabled = false;
            connectBtn.querySelector('.btn-icon').textContent = '🔍';
            connectBtn.childNodes[connectBtn.childNodes.length - 1].textContent = ' Подключиться';
            this._connecting = false;
        }
    },

    async tryConnect(ip, timeout, init) {
        const url = `http://${ip}:8080/`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(url, {
                ...init,
                signal: controller.signal
            });

            if (init.mode === 'cors') {
                clearTimeout(timeoutId);
                let text = '';
                try { text = await response.text(); } catch(e) {}
                return response.ok || text.toLowerCase().includes('сервер') || text.toLowerCase().includes('http');
            } else {
                // no-cors всегда возвращает "opaque" ответ, считаем это успехом
                clearTimeout(timeoutId);
                return true;
            }
        } catch (e) {
            clearTimeout(timeoutId);
            throw e;
        }
    },

    // ============================================================
    // АВТОРИЗАЦИЯ
    // ============================================================
    async authenticate() {
        const userId = document.getElementById('userIdInput').value.trim();
        const password = document.getElementById('passwordInput').value;

        if (!userId) {
            this.showToast('Введите логин', 'error');
            return;
        }

        const loginBtn = document.getElementById('loginBtn');
        loginBtn.disabled = true;
        loginBtn.querySelector('.btn-icon').textContent = '⏳';
        loginBtn.childNodes[loginBtn.childNodes.length - 1].textContent = ' Проверка...';

        try {
            // Запрос к таблице "sotrud" по ID
            const sql = `SELECT * FROM "sotrud" WHERE "ID"='${userId}'`;
            const result = await this.querySql(sql);

            if (!result || result.includes('ОШИБКА') || result.includes('ERROR')) {
                this.showToast('Не удалось выполнить запрос к базе данных', 'error');
                this.resetLoginButton();
                return;
            }

            // Парсим результат (формат: значение1\tзначение2\t...\n)
            const lines = result.trim().split('\n').filter(l => l);

            if (lines.length === 0) {
                this.showToast(`Логин "${userId}" не найден`, 'error');
                this.resetLoginButton();
                return;
            }

            // Ищем индексы колонок
            const headerLine = lines[0];
            const headers = headerLine.split('\t').map(h => h.trim());
            console.log('📋 Заголовки:', headers);

            const passIndex = headers.findIndex(h => h.toLowerCase() === 'pass');
            const statusIndex = headers.findIndex(h => h.toLowerCase() === 'status');
            const dostupIndex = headers.findIndex(h => h.toLowerCase() === 'dostup');
            console.log('📊 Индексы колонок — pass:', passIndex, 'status:', statusIndex, 'dostup:', dostupIndex);

            const dataLine = lines[lines.length - 1];
            const columns = dataLine.split('\t');
            console.log('📊 Данные:', columns);
            console.log('📊 Всего строк:', lines.length);

            const passValue = passIndex !== -1 ? (columns[passIndex] || '').trim() : '';
            const statusValue = statusIndex !== -1 ? (columns[statusIndex] || '').trim() : '';
            const dostupRaw = dostupIndex !== -1 ? (columns[dostupIndex] || '').trim() : '';

            console.log('📊 Значения — pass:', passValue, 'status:', statusValue, 'dostup:', dostupRaw);

            // Проверяем пароль
            let passwordValid = true;
            if (passValue !== '' && passValue !== '0' && passValue !== password) {
                passwordValid = false;
            }

            if (!passwordValid) {
                this.showToast('Неверный пароль', 'error');
                this.resetLoginButton();
                return;
            }

            // Определяем уровень доступа
            const isAdmin = statusValue.toLowerCase() === 'админ' || statusValue.toLowerCase() === 'admin';
            const доступ = isAdmin ? ['*'] : this.parseДоступ(dostupRaw);

            console.log('🔐 Доступ — isAdmin:', isAdmin, 'доступ:', доступ);

            // Сохраняем сессию
            localStorage.setItem('serverIp', this.serverIp);
            localStorage.setItem('userId', userId);
            localStorage.setItem('userFio', this.findColumn(headers, columns, ['fio', 'FIO', 'ФИО']));
            localStorage.setItem('userAccess', JSON.stringify(доступ));

            const redirectPage = this.getRedirectPage(доступ);
            console.log('🚀 Перенаправление на:', redirectPage);
            window.location.href = redirectPage;

        } catch (error) {
            console.error('Authentication error:', error);
            this.showToast(`Не удалось авторизоваться: ${error.message}`, 'error');
            this.resetLoginButton();
        }
    },

    // ============================================================
    // РАЗБОЛ ДОСТУПА ИЗ ПОЛЯ
    // ============================================================
    parseДоступ(raw) {
        if (!raw) return [];
        if (raw.trim() === '*') return ['*'];

        // Разделитель — запятая
        return raw.split(',').map(s => s.trim()).filter(s => s);
    },

    findColumn(headers, columns, possibleNames) {
        for (const name of possibleNames) {
            const idx = headers.findIndex(h => h.toUpperCase() === name.toUpperCase());
            if (idx !== -1) return columns[idx] || '';
        }
        return '';
    },

    // ============================================================
    // ПОЛУЧИТЬ ПЕРВУЮ ДОСТУПНУЮ СТРАНИЦУ
    // ============================================================
    getRedirectPage(доступ) {
        if (!доступ || доступ.length === 0) {
            console.warn('⚠️ Пустой доступ, перенаправление на login.html');
            return 'login.html';
        }

        // Админ всегда на admin.html
        if (доступ.includes('*')) {
            console.log('✅ Полный доступ → admin.html');
            return 'admin.html';
        }

        const accessMap = [
            { key: 'Отчёты', page: 'dashboard.html' },
            { key: 'База данных', page: 'dashboard.html' },
            { key: 'Клиенты', page: 'dashboard.html' },
            { key: 'Товары', page: 'dashboard.html' },
            { key: 'Склад', page: 'dashboard.html' },
            { key: 'Приёмка', page: 'dashboard.html' },
            { key: 'Стикеры', page: 'dashboard.html' },
            { key: 'Сотрудники', page: 'dashboard.html' },
            { key: 'Моя зарплата', page: 'dashboard.html' },
            { key: 'Справочник', page: 'dashboard.html' },
            { key: 'Отгрузка', page: 'dashboard.html' },
        ];

        for (const entry of accessMap) {
            if (доступ.includes(entry.key)) {
                console.log('✅ Доступ:', entry.key, '→', entry.page);
                return entry.page;
            }
        }

        // Если доступ есть, но модуль не в карте — всё равно dashboard.html
        if (доступ.length > 0) {
            console.log('✅ Есть доступ → dashboard.html');
            return 'dashboard.html';
        }

        console.warn('⚠️ Ни один модуль не найден, перенаправление на login.html');
        return 'login.html';
    },

    // ============================================================
    // SQL ЗАПРОС
    // ============================================================
    async querySql(sql) {
        const encodedSql = encodeURIComponent(sql.trim());
        const url = `http://${this.serverIp}:8080/query?sql=${encodedSql}`;

        console.log('SQL Query:', sql);

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
    // ИНСТРУКЦИЯ (МОДАЛЬНОЕ ОКНО)
    // ============================================================
    openGuide() {
        document.getElementById('guideModal').style.display = 'flex';
    },

    closeGuide() {
        document.getElementById('guideModal').style.display = 'none';
    },

    // ============================================================
    // УТИЛИТЫ
    // ============================================================
    enableAuthForm() {
        const authStep = document.getElementById('authStep');
        const userIdInput = document.getElementById('userIdInput');
        const passwordInput = document.getElementById('passwordInput');
        const loginBtn = document.getElementById('loginBtn');

        authStep.removeAttribute('disabled');
        userIdInput.removeAttribute('disabled');
        passwordInput.removeAttribute('disabled');
        loginBtn.removeAttribute('disabled');

        userIdInput.focus();
    },

    resetLoginButton() {
        const loginBtn = document.getElementById('loginBtn');
        loginBtn.disabled = false;
        loginBtn.querySelector('.btn-icon').textContent = '🚪';
        loginBtn.childNodes[loginBtn.childNodes.length - 1].textContent = ' Войти';
    },

    loadLastSuccessfulIP() {
        const history = window.ConnectionHistory.getAll();
        const lastSuccessful = history.find(item => item.success);
        if (lastSuccessful) {
            document.getElementById('ipInput').value = lastSuccessful.ip;
        }
    },

    clearForm() {
        document.getElementById('ipInput').value = '';
        document.getElementById('userIdInput').value = '';
        document.getElementById('passwordInput').value = '';
        this.setConnectionGlow(false);
        this.closeGuide();
        this.populateHistoryDropdown();
    }
};

// ============================================================
// ЭКСПОРТ ГЛОБАЛЬНО (для onclick в истории подключений)
// ============================================================
window.LOGIN = LOGIN;

// ============================================================
// ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    LOGIN.init();
});
