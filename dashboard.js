// ============================================================
// DASHBOARD PAGE - JavaScript
// ============================================================

const DASHBOARD = {
    // ============================================================
    // КАРТА КНОПОК: название модуля -> страница
    // ============================================================
    buttonMap: {
        'База данных': 'app.html',
        'Клиенты': 'employees.html',
        'Товары': 'column-config.html',
        'Склад': 'warehouse.html',
        'Приёмка': 'priyomka.html',
        'Стикеры': 'column-config.html',
        'Сотрудники': 'employees.html',
        'Моя зарплата': 'my-salary.html',
        'Справочник': 'guide-add.html',
        'Отгрузка': 'shipment.html',
        'Отчёты': 'sdelano.html',
    },

    // ============================================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================================
    init() {
        this.checkAuth();
        this.filterButtons();
        this.bindEvents();
        this.displayUserInfo();
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
    },

    // ============================================================
    // ФИЛЬТРАЦИЯ КНОПОК ПО ДОСТУПУ
    // ============================================================
    filterButtons() {
        const grid = document.getElementById('actionsGrid');
        if (!grid) return;

        const userAccess = window.getUserAccess?.() || [];
        const buttons = grid.querySelectorAll('.admin-btn');

        buttons.forEach(btn => {
            // Пропускаем кнопку "Выйти"
            if (btn.id === 'logoutBtn') {
                return;
            }

            const key = btn.getAttribute('data-module');
            if (!key) return;

            const allowed = userAccess.includes('*') || userAccess.includes(key);
            btn.style.display = allowed ? '' : 'none';
        });

        // Подсвечиваем первую доступную кнопку
        this.highlightFirstAllowed(grid);
    },

    // ============================================================
    // ПОДСВЕТКА ПЕРВОЙ ДОСТУПНОЙ КНОПКИ
    // ============================================================
    highlightFirstAllowed(grid) {
        const buttons = grid.querySelectorAll('.admin-btn');
        let firstFound = false;

        buttons.forEach(btn => {
            if (btn.id === 'logoutBtn') return;
            if (btn.style.display === 'none') return;

            if (!firstFound) {
                firstFound = true;
            }
        });
    },

    // ============================================================
    // ОТОБРАЖЕНИЕ ИНФОРМАЦИИ О ПОЛЬЗОВАТЕЛЕ
    // ============================================================
    displayUserInfo() {
        const userFio = localStorage.getItem('userFio');

        if (userFio) {
            // Извлекаем имя — второе слово из "Фамилия Имя Отчество"
            const parts = userFio.trim().split(/\s+/);
            const displayName = parts.length >= 2 ? parts[1] : parts[0];
            document.getElementById('userNameDisplay').textContent = displayName;
        } else {
            const userId = localStorage.getItem('userId');
            document.getElementById('userNameDisplay').textContent = userId || 'Гость';
        }
    },

    // ============================================================
    // СОБЫТИЯ
    // ============================================================
    bindEvents() {
        // Навигация по кнопкам
        const grid = document.getElementById('actionsGrid');
        const buttons = grid.querySelectorAll('.admin-btn[data-module]');

        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                const moduleKey = btn.getAttribute('data-module');
                const page = this.buttonMap[moduleKey];
                if (page) {
                    window.location.href = page;
                }
            });
        });

        // Выход из системы
        document.getElementById('logoutBtn').addEventListener('click', () => {
            if (confirm('Вы действительно хотите выйти?')) {
                localStorage.removeItem('serverIp');
                localStorage.removeItem('userId');
                localStorage.removeItem('userAccess');
                localStorage.removeItem('userFio');
                window.location.href = 'login.html';
            }
        });
    }
};

// ============================================================
// ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    DASHBOARD.init();
});
