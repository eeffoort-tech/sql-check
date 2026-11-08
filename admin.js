// ============================================================
// ADMIN PAGE - JavaScript
// ============================================================

const ADMIN = {
    // ============================================================
    // КАРТА КНОПОК: название -> страница
    // ============================================================
    buttonMap: {
        'База данных': 'sql-editor.html',
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
        'Инвентаризация': 'inventory.html',
        'Админ': 'admin.html',
    },

    // ============================================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================================
    init() {
        this.checkAuth();
        this.filterButtons();
        this.bindEvents();
        this.displayUserInfo();
        this.highlightFirstAllowed();
    },

    // ============================================================
    // ФИЛЬТРАЦИЯ КНОПОК ПО ДОСТУПУ
    // ============================================================
    filterButtons() {
        const grid = document.querySelector('.actions-grid');
        if (!grid) return;

        const userAccess = window.getUserAccess?.() || [];
        const buttons = grid.querySelectorAll('.admin-btn');

        buttons.forEach(btn => {
            const titleEl = btn.querySelector('.admin-btn-title');
            if (!titleEl) return;

            const key = titleEl.textContent.trim();
            const allowed = userAccess.includes('*') || userAccess.includes(key);

            if (!allowed) {
                btn.style.display = 'none';
            } else {
                // Сохраняем оригинальное поведение
                const originalDisplay = getComputedStyle(btn).display;
                btn.style.display = '';
            }
        });
    },

    // ============================================================
    // ПОДСВЕТКА ПЕРВОЙ ДОСТУПНОЙ КНОПКИ
    // ============================================================
    highlightFirstAllowed() {
        const grid = document.querySelector('.actions-grid');
        if (!grid) return;

        const userAccess = window.getUserAccess?.() || [];
        const buttons = grid.querySelectorAll('.admin-btn');
        let firstFound = false;

        buttons.forEach(btn => {
            if (firstFound) {
                btn.style.display = '';
                return;
            }

            const titleEl = btn.querySelector('.admin-btn-title');
            if (!titleEl) return;

            const key = titleEl.textContent.trim();
            const allowed = userAccess.includes('*') || userAccess.includes(key);

            if (!allowed) {
                btn.style.display = 'none';
            } else {
                firstFound = true;
            }
        });
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
    // ОТОБРАЖЕНИЕ ИНФОРМАЦИИ О ПОЛЬЗОВАТЕЛЕ
    // ============================================================
    async displayUserInfo() {
        const serverIp = localStorage.getItem('serverIp');
        const userId = localStorage.getItem('userId');

        if (!serverIp || !userId) return;

        document.getElementById('serverIpDisplay').textContent = serverIp;

        try {
            // Запрос к таблице "sotrud" по ID для получения имени
            const sql = `SELECT "NAME" FROM "sotrud" WHERE "ID"='${userId}'`;
            const encodedSql = encodeURIComponent(sql.trim());
            const url = `http://${serverIp}:8080/query?sql=${encodedSql}`;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(url, {
                method: 'GET',
                mode: 'cors',
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            let result = '';
            try { result = await response.text(); } catch(e) {}

            // Парсим результат — первая строка заголовки, вторая значение
            const lines = result.trim().split('\n').filter(l => l);
            if (lines.length >= 2) {
                const name = lines[1]?.trim() || userId;
                document.getElementById('userIdDisplay').textContent = name;
            } else {
                document.getElementById('userIdDisplay').textContent = userId;
            }
        } catch (error) {
            console.error('Ошибка получения имени:', error);
            document.getElementById('userIdDisplay').textContent = userId;
        }
    },

    // ============================================================
    // СОБЫТИЯ
    // ============================================================
    bindEvents() {
        // Навигация по кнопкам с проверкой доступа
        const buttonActions = {
            'goToDatabaseBtn': 'База данных',
            'goToClientsBtn': 'Клиенты',
            'goToProductsBtn': 'Товары',
            'goToWarehouseBtn': 'Склад',
            'goToPriyomkaBtn': 'Приёмка',
            'goToStickerConfigBtn': 'Стикеры',
            'goToEmployeesBtn': 'Сотрудники',
            'goToSalaryBtn': 'Моя зарплата',
            'goToReferenceBtn': 'Справочник',
            'goToShipmentBtn': 'Отгрузка',
            'goToReportsBtn': 'Отчёты',
            'goToInventoryBtn': 'Инвентаризация',
        };

        Object.entries(buttonActions).forEach(([btnId, key]) => {
            const btn = document.getElementById(btnId);
            if (btn) {
                btn.addEventListener('click', () => {
                    const page = this.buttonMap[key];
                    if (page) {
                        window.location.href = page;
                    }
                });
            }
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
    ADMIN.init();
});
