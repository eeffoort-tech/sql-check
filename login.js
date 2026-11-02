// ============================================================
// LOGIN PAGE - JavaScript
// ============================================================

const LOGIN = {
    serverIp: '',
    isConnected: false,

    // ============================================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================================
    async init() {
        window.ConnectionHistory.displayHistory();
        this.loadLastSuccessfulIP();

        // Автоматически подключаемся к последнему успешному IP
        await this.autoConnectLastIP();

        this.bindEvents();
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

        // Показываем статус подключения
        this.showStatus('loading', '⏳ Автоподключение...', `Подключение к ${ip}:8080...`);

        // Небольшая задержка для отображения статуса
        await new Promise(resolve => setTimeout(resolve, 300));

        const connectBtn = document.getElementById('connectBtn');
        connectBtn.disabled = true;
        connectBtn.querySelector('.btn-icon').textContent = '⏳';
        connectBtn.childNodes[connectBtn.childNodes.length - 1].textContent = ' Автоподключение...';

        const url = `http://${ip}:8080/`;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000); // быстрее таймаут для авто

            const response = await fetch(url, {
                method: 'GET',
                mode: 'cors',
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            let text = '';
            try { text = await response.text(); } catch(e) {}

            const isConnected = response.ok || text.toLowerCase().includes('сервер') || text.toLowerCase().includes('http');

            if (isConnected) {
                console.log('✅ Автоподключение успешно');
                this.serverIp = ip;
                this.isConnected = true;
                this.enableAuthForm();
                this.showStatus('success', '✅ Подключено!', 'Автоматическое подключение успешно');
            } else {
                console.log('❌ Автоподключение не удалось');
                this.showStatus('error', '❌ Ошибка', 'Не удалось автоматически подключиться. Введите IP вручную.');
            }
        } catch (error) {
            console.log('❌ Автоподключение прервано:', error.message);
            // Не показываем ошибку, просто остаёмся в исходном состоянии
            this.hideStatus();
        } finally {
            connectBtn.disabled = false;
            connectBtn.querySelector('.btn-icon').textContent = '🔍';
            connectBtn.childNodes[connectBtn.childNodes.length - 1].textContent = ' Подключиться';
        }
    },

    // ============================================================
    // СОБЫТИЯ
    // ============================================================
    bindEvents() {
        document.getElementById('connectBtn').addEventListener('click', () => {
            this.connectToServer();
        });

        document.getElementById('clearBtn').addEventListener('click', () => {
            this.clearForm();
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
            this.showStatus('error', 'Ошибка', 'Введите IP-адрес сервера');
            return;
        }

        const connectBtn = document.getElementById('connectBtn');
        connectBtn.disabled = true;
        connectBtn.querySelector('.btn-icon').textContent = '⏳';
        connectBtn.childNodes[connectBtn.childNodes.length - 1].textContent = ' Подключение...';

        this.hideStatus();

        const url = `http://${ip}:8080/`;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(url, {
                method: 'GET',
                mode: 'cors',
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            let text = '';
            try { text = await response.text(); } catch(e) {}

            const isConnected = response.ok || text.toLowerCase().includes('сервер') || text.toLowerCase().includes('http');

            if (isConnected) {
                this.serverIp = ip;
                this.isConnected = true;

                // Сохраняем успешный IP
                window.ConnectionHistory.save(ip, true);
                this.loadLastSuccessfulIP();

                // Разблокируем форму авторизации
                this.enableAuthForm();

                this.showStatus('success', '✅ Подключено!', 'Сервер отвечает. Введите данные для входа.');
            } else {
                this.showStatus('error', `❌ Ошибка ${response.status}`, text || response.statusText);
                window.ConnectionHistory.save(ip, false);
            }
        } catch (error) {
            console.error('Connection error:', error);

            window.ConnectionHistory.save(ip, false);

            if (error.name === 'AbortError') {
                this.showStatus('error', '❌ Тайм-аут', `Нет ответа от ${ip}:8080 за 5000мс`);
            } else {
                this.showStatus('error', '❌ Не подключено',
                    `Не удалось соединиться с ${ip}:8080. ` +
                    `Убедитесь что: 1) Сервер запущен 2) Устройства в одной сети 3) CORS разрешён`
                );
            }
        } finally {
            connectBtn.disabled = false;
            connectBtn.querySelector('.btn-icon').textContent = '🔍';
            connectBtn.childNodes[connectBtn.childNodes.length - 1].textContent = ' Подключиться';
        }
    },

    // ============================================================
    // АВТОРИЗАЦИЯ
    // ============================================================
    async authenticate() {
        const userId = document.getElementById('userIdInput').value.trim();
        const password = document.getElementById('passwordInput').value;

        if (!userId) {
            this.showStatus('error', 'Ошибка', 'Введите ID сотрудника');
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
                this.showStatus('error', '❌ Ошибка', 'Не удалось выполнить запрос к базе данных');
                this.resetLoginButton();
                return;
            }

            // Парсим результат (формат: значение1\tзначение2\t...\n)
            const lines = result.trim().split('\n').filter(l => l);

            if (lines.length === 0) {
                this.showStatus('error', '❌ Не найдено', `Сотрудник с ID "${userId}" не найден`);
                this.resetLoginButton();
                return;
            }

            // Предполагаем структуру: ID\tpass\t na4alo
            // Первая строка - заголовки, вторая - данные
            const dataLine = lines[lines.length - 1];
            const columns = dataLine.split('\t');

            // Ищем индексы колонок (ищем по названиям в первой строке)
            const headerLine = lines[0];
            const headers = headerLine.split('\t').map(h => h.trim());

            const idIndex = headers.findIndex(h => h.toUpperCase() === 'ID');
            const passIndex = headers.findIndex(h => h.toLowerCase() === 'pass');
            const na4aloIndex = headers.findIndex(h => h.toLowerCase() === 'na4alo' || h === 'на4ало');

            const passValue = passIndex !== -1 ? (columns[passIndex] || '').trim() : '';
            const na4aloValue = na4aloIndex !== -1 ? (columns[na4aloIndex] || '').trim() : '';

            // Проверяем пароль
            let passwordValid = true;
            if (passValue !== '' && passValue !== '0' && passValue !== password) {
                passwordValid = false;
            }

            if (!passwordValid) {
                this.showStatus('error', '❌ Ошибка', 'Неверный пароль');
                this.resetLoginButton();
                return;
            }

            // Проверяем роль
            if (na4aloValue.toUpperCase() === 'АДМИН' || na4aloValue.toUpperCase() === 'ADMIN') {
                // Успешный вход как администратор
                localStorage.setItem('serverIp', this.serverIp);
                localStorage.setItem('userId', userId);
                window.location.href = 'admin.html';
            } else {
                this.showStatus('error', '❌ Доступ запрещён', `У вас нет прав администратора`);
                this.resetLoginButton();
            }

        } catch (error) {
            console.error('Authentication error:', error);
            this.showStatus('error', '❌ Ошибка', `Не удалось авторизоваться: ${error.message}`);
            this.resetLoginButton();
        }
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

    showStatus(type, text, detail = '') {
        const statusSection = document.getElementById('statusSection');
        const statusIcon = document.getElementById('statusIcon');
        const statusText = document.getElementById('statusText');
        const statusDetails = document.getElementById('statusDetails');

        statusSection.style.display = 'block';
        statusIcon.className = `status-indicator ${type}`;
        statusText.textContent = text;
        statusDetails.textContent = detail;
    },

    hideStatus() {
        document.getElementById('statusSection').style.display = 'none';
    },

    clearForm() {
        document.getElementById('ipInput').value = '';
        document.getElementById('userIdInput').value = '';
        document.getElementById('passwordInput').value = '';
        this.hideStatus();

        // Блокируем форму авторизации
        const authStep = document.getElementById('authStep');
        const userIdInput = document.getElementById('userIdInput');
        const passwordInput = document.getElementById('passwordInput');
        const loginBtn = document.getElementById('loginBtn');

        authStep.setAttribute('disabled', '');
        userIdInput.setAttribute('disabled', '');
        passwordInput.setAttribute('disabled', '');
        loginBtn.setAttribute('disabled', '');

        document.getElementById('ipInput').focus();
    }
};

// ============================================================
// ЭКСПОРТ ГЛОБАЛЬНО (для onclick в истории подключений)
// ============================================================
window.LOGIN = LOGIN;

// ============================================================
// ДОПОЛНЕНИЕ ConnectionHistory (если нужно)
// ============================================================
// ConnectionHistory уже определён в app.js и экспортирован в window.ConnectionHistory

// ============================================================
// ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    LOGIN.init();
});
