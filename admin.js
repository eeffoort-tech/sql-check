// ============================================================
// ADMIN PAGE - JavaScript
// ============================================================

const ADMIN = {
    // ============================================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================================
    init() {
        this.checkAuth();
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
            // Пользователь не авторизован - перенаправляем на страницу входа
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
        // Переход к базе данных (все таблицы)
        document.getElementById('goToDatabaseBtn').addEventListener('click', () => {
            this.goToTables();
        });

        // Переход к клиентам
        document.getElementById('goToClientsBtn').addEventListener('click', () => {
            this.goToTable('clients');
        });

        // Переход к товарам
        document.getElementById('goToProductsBtn').addEventListener('click', () => {
            this.goToTable('products');
        });

        // Переход к складу
        document.getElementById('goToWarehouseBtn').addEventListener('click', () => {
            window.location.href = 'warehouse.html';
        });

        // Переход к приёмке
        document.getElementById('goToPriyomkaBtn').addEventListener('click', () => {
            window.location.href = 'priyomka.html';
        });

        // Переход к сотрудникам
        document.getElementById('goToEmployeesBtn').addEventListener('click', () => {
            this.goToTable('sotrud');
        });

        // Переход к зарплате
        document.getElementById('goToSalaryBtn').addEventListener('click', () => {
            this.goToTable('salary');
        });

        // Переход к справочнику
        document.getElementById('goToReferenceBtn').addEventListener('click', () => {
            window.location.href = 'guide.html';
        });

        // Переход к отчётам
        document.getElementById('goToReportsBtn').addEventListener('click', () => {
            alert('Раздел отчётов в разработке');
        });

        // Выход из системы
        document.getElementById('logoutBtn').addEventListener('click', () => {
            if (confirm('Вы действительно хотите выйти?')) {
                localStorage.removeItem('serverIp');
                localStorage.removeItem('userId');
                window.location.href = 'login.html';
            }
        });
    },

    // ============================================================
    // НАВИГАЦИЯ
    // ============================================================
    goToTables() {
        const serverIp = localStorage.getItem('serverIp');
        if (serverIp) {
            window.location.href = `sql-editor.html?ip=${serverIp}`;
        }
    },

    goToTable(tableName) {
        const serverIp = localStorage.getItem('serverIp');
        if (serverIp) {
            window.location.href = `sql-editor.html?ip=${serverIp}&table=${tableName}`;
        }
    }
};

// ============================================================
// ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    ADMIN.init();
});
