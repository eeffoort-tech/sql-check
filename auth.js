// ============================================================
// AUTH UTILS - Проверка доступа для всех страниц
// ============================================================

/**
 * Получить доступные модули из localStorage
 * @returns {string[]}
 */
window.getUserAccess = function() {
    const raw = localStorage.getItem('userAccess');
    console.log('🔍 getUserAccess: localStorage["userAccess"] =', raw);
    try {
        return raw ? JSON.parse(raw) : [];
    } catch {
        console.warn('⚠️ getUserAccess: ошибка парсинга');
        return [];
    }
};

/**
 * Проверить, есть ли доступ к модулю
 * @param {string[]} userAccess - массив доступных модулей пользователя (из localStorage)
 * @param {string} moduleKey - ключ модуля (название кнопки)
 * @returns {boolean}
 */
window.hasAccess = function(userAccess, moduleKey) {
    if (!userAccess || userAccess.length === 0) return false;
    return userAccess.includes('*') || userAccess.includes(moduleKey);
};

// Отладка: выводим текущий доступ при загрузке
console.log('🔐 [auth.js] Инициализация. userAccess =', localStorage.getItem('userAccess'));

/**
 * Проверить авторизацию и права доступа
 * @param {string[]} requiredAccess - массив требуемых модулей для этой страницы
 * @returns {boolean} - true если доступ разрешён
 */
window.checkAuth = function(requiredAccess = []) {
    const serverIp = localStorage.getItem('serverIp');
    const userId = localStorage.getItem('userId');

    if (!serverIp || !userId) {
        window.location.href = 'login.html';
        return false;
    }

    const userAccess = window.getUserAccess();

    // Админ - всё доступно
    if (userAccess.includes('*')) {
        return true;
    }

    // Если requiredAccess задан - проверяем что есть доступ к хотя бы одному
    if (requiredAccess.length > 0) {
        const hasRequired = requiredAccess.some(key => userAccess.includes(key));
        if (!hasRequired) {
            window.location.href = 'login.html';
            return false;
        }
    }

    return true;
};

/**
 * Скрыть недоступные кнопки на странице
 * @param {HTMLElement} container - контейнер с кнопками (обычно .actions-grid)
 */
window.filterButtons = function(container) {
    if (!container) return;

    const buttons = container.querySelectorAll('.admin-btn');
    const userAccess = window.getUserAccess();

    buttons.forEach(btn => {
        const titleEl = btn.querySelector('.admin-btn-title');
        if (!titleEl) return;

        const key = titleEl.textContent.trim();
        const allowed = userAccess.includes('*') || userAccess.includes(key);

        if (!allowed) {
            btn.style.display = 'none';
        }
    });
};

/**
 * Показать первую доступную кнопку и прокрутить к ней
 * @param {HTMLElement} container - контейнер с кнопками
 */
window.highlightFirstAllowedButton = function(container) {
    if (!container) return;

    const buttons = container.querySelectorAll('.admin-btn');
    const userAccess = window.getUserAccess();

    buttons.forEach(btn => {
        const titleEl = btn.querySelector('.admin-btn-title');
        if (!titleEl) return;

        const key = titleEl.textContent.trim();
        if (userAccess.includes('*') || userAccess.includes(key)) {
            btn.style.background = 'linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(99, 102, 241, 0.15))';
            btn.style.boxShadow = '0 0 20px rgba(139, 92, 246, 0.2)';
            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });
};
