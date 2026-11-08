// ============================================================
// КОНФИГУРАЦИЯ
// ============================================================
const DEFAULT_PORT = '8080';
const CONNECT_TIMEOUT = 5000; // 5 секунд на проверку подключения

// ============================================================
// DOM ЭЛЕМЕНТЫ
// ============================================================
let ipInput, connectBtn, testQueryBtn, clearBtn, goToTablesBtn;
let statusSection, statusIcon, statusText, statusDetails;
let responseSection, responseContainer;

function cacheDOMElements() {
    ipInput = document.getElementById('ipInput');
    connectBtn = document.getElementById('connectBtn');
    testQueryBtn = document.getElementById('testQueryBtn');
    clearBtn = document.getElementById('clearBtn');
    goToTablesBtn = document.getElementById('goToTablesBtn');

    statusSection = document.getElementById('statusSection');
    statusIcon = document.getElementById('statusIcon');
    statusText = document.getElementById('statusText');
    statusDetails = document.getElementById('statusDetails');

    responseSection = document.getElementById('responseSection');
    responseContainer = document.getElementById('responseContainer');
}

// ============================================================
// УТИЛИТЫ
// ============================================================

/**
 * Управление историей подключений
 */
const ConnectionHistory = {
    STORAGE_KEY: 'connectionHistory',
    MAX_ITEMS: 5,

    getAll() {
        try {
            const data = localStorage.getItem(this.STORAGE_KEY);
            return data ? JSON.parse(data) : [];
        } catch {
            return [];
        }
    },

    save(ip, success) {
        let history = this.getAll();
        
        // Удаляем дубликат этого IP если есть
        history = history.filter(item => item.ip !== ip);
        
        // Добавляем в начало
        history.unshift({
            ip,
            success,
            timestamp: Date.now()
        });

        // Оставляем только последние MAX_ITEMS
        if (history.length > this.MAX_ITEMS) {
            history = history.slice(0, this.MAX_ITEMS);
        }

        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(history));
    }
};

/**
 * Отображение истории подключений (экспорт для использования в login.js)
 */
ConnectionHistory.displayHistory = function() {
    const historyContainer = document.getElementById('connectionHistory');
    const historyList = document.getElementById('historyList');

    if (!historyContainer || !historyList) return;

    const history = this.getAll();

    if (history.length === 0) {
        historyContainer.style.display = 'none';
        return;
    }

    historyContainer.style.display = 'block';

    historyList.innerHTML = history.map((item, index) => {
        const timeAgo = this.getTimeAgo(item.timestamp);
        const statusClass = item.success ? 'success' : 'error';
        const statusText = item.success ? '✓ Успешно' : '✗ Ошибка';

        return `
            <div class="history-item" onclick="window.LOGIN.loadHistoryIP('${item.ip}')">
                <span class="history-item-ip">${item.ip}</span>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="history-item-status ${statusClass}">${statusText}</span>
                    <button type="button" class="history-item-remove" onclick="event.stopPropagation(); window.ConnectionHistory.removeHistoryItem(${index})" title="Удалить">×</button>
                </div>
            </div>
            <div style="font-size: 0.7rem; color: #888; margin-top: -4px; margin-bottom: 4px;">${timeAgo}</div>
        `;
    }).join('');
};

/**
 * Загрузить IP из истории в поле ввода (экспорт для login.js)
 */
ConnectionHistory.loadHistoryIP = function(ip) {
    ipInput.value = ip;
    ipInput.focus();
};

/**
 * Форматирование времени "N минут назад"
 */
ConnectionHistory.getTimeAgo = function(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;

    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Только что';
    if (minutes < 60) return `${minutes} мин. назад`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ч. назад`;

    const days = Math.floor(hours / 24);
    return `${days} дн. назад`;
};

/**
 * Удалить элемент из истории
 */
ConnectionHistory.removeHistoryItem = function(index) {
    let history = this.getAll();
    history.splice(index, 1);
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(history));
    this.displayHistory();
};

/**
 * Формирует URL для SQL-запроса к серверу
 * (как в Android ServerService: /query?sql=...)
 */
function buildQueryUrl(ip, sql) {
    // Очищаем IP от возможных http:// или портов
    const cleanIp = ip.replace(/^(https?:\/\/)?/, '').replace(/\/.*$/, '');
    const encodedSql = encodeURIComponent(sql.trim());
    return `http://${cleanIp}:${DEFAULT_PORT}/query?sql=${encodedSql}`;
}

/**
 * Показывает статус
 */
function showStatus(type, text, detail = '') {
    statusSection.style.display = 'block';
    statusIcon.className = `status-indicator ${type}`;
    statusText.textContent = text;
    statusDetails.textContent = detail;
}

function hideStatus() {
    statusSection.style.display = 'none';
}

/**
 * Показывает результат запроса
 */
function showResponse(text, isError = false) {
    responseSection.style.display = 'block';
    responseContainer.textContent = text;
    responseContainer.className = `response-container ${isError ? 'error' : ''}`;
}

function hideResponse() {
    responseSection.style.display = 'none';
    responseContainer.textContent = '';
}

/**
 * Блокирует/разблокирует кнопки
 * @param {boolean} loading - идёт ли загрузка
 * @param {boolean} connected - успешное ли подключение (только для checkConnection)
 */
function setButtonsLoading(loading, connected = null) {
    connectBtn.disabled = loading;
    testQueryBtn.disabled = loading;
    
    // Если не в режиме загрузки, разблокируем testQuery только если подключено
    if (!loading && connected !== null) {
        testQueryBtn.disabled = !connected;
    }

    if (loading) {
        connectBtn.querySelector('.btn-icon').textContent = '⏳';
        connectBtn.childNodes[connectBtn.childNodes.length - 1].textContent = ' Проверка...';
    } else {
        connectBtn.querySelector('.btn-icon').textContent = '🔍';
        connectBtn.childNodes[connectBtn.childNodes.length - 1].textContent = ' Проверить подключение';
    }
}

// ============================================================
// ОСНОВНАЯ ЛОГИКА
// ============================================================

/**
 * Проверка подключения — базовый GET-запрос
 * (возвращает "HTTP сервер работает")
 */
async function checkConnection() {
    const ip = ipInput.value.trim();
    
    if (!ip) {
        showStatus('error', 'Ошибка', 'Введите IP-адрес сервера');
        return;
    }

    setButtonsLoading(true);
    hideResponse();
    showStatus('loading', 'Подключение...', `Попытка connect к ${ip}:${DEFAULT_PORT}...`);

    const url = `http://${ip}:${DEFAULT_PORT}/`;
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONNECT_TIMEOUT);

        const response = await fetch(url, {
            method: 'GET',
            mode: 'cors',
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        let text = '';
        try { text = await response.text(); } catch(e) {}

        // Успех если: 200 OK ИЛИ ответ содержит "сервер" или "HTTP" (CORS cases)
        const isConnected = response.ok || text.toLowerCase().includes('сервер') || text.toLowerCase().includes('http');
        
        setButtonsLoading(false, isConnected);

        // Сохраняем в историю
        ConnectionHistory.save(ip, isConnected);

        // Разблокируем кнопку "К таблицам" при успехе
        goToTablesBtn.disabled = !isConnected;
        
        if (isConnected) {
            showStatus('success', `✅ Подключено!`, text || 'Сервер отвечает');
        } else {
            showStatus('error', `❌ Ошибка ${response.status}`, text || response.statusText);
        }
    } catch (error) {
        console.error('Connection error:', error);
        
        setButtonsLoading(false, false);
        goToTablesBtn.disabled = true;
        
        if (error.name === 'AbortError') {
            showStatus('error', '❌ Тайм-аут', `Нет ответа от ${ip}:${DEFAULT_PORT} за ${CONNECT_TIMEOUT}мс`);
        } else {
            showStatus('error', '❌ Не подключено', 
                `Не удалось соединиться с ${ip}:${DEFAULT_PORT}. ` +
                `Убедитесь что: 1) Сервер запущен 2) Устройства в одной сети 3) CORS разрешён`
            );
        }
    }
}

/**
 * Выполнение тестового SQL-запроса
 * (SELECT COUNT(*) FROM zakaz — как в checkDatabase Android-приложения)
 */
async function executeTestQuery() {
    const ip = ipInput.value.trim();
    const testQueries = [
        { name: 'Проверка таблицы zakaz', sql: 'SELECT COUNT(*) FROM zakaz' },
    ];

    testQueryBtn.disabled = true;
    testQueryBtn.querySelector('.btn-icon').textContent = '⏳';
    testQueryBtn.childNodes[testQueryBtn.childNodes.length - 1].textContent = ' Выполняется...';

    let results = '';
    let allSuccess = true;

    for (const query of testQueries) {
        results += `➤ Запрос: ${query.name}\n`;
        results += `SQL: ${query.sql}\n`;
        results += '─'.repeat(50) + '\n';

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONNECT_TIMEOUT);

            const response = await fetch(buildQueryUrl(ip, query.sql), {
                method: 'GET',
                mode: 'cors',
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                const text = await response.text();
                results += `✅ Ответ:\n${text || '(пустой результат)'}\n\n`;
            } else {
                results += `❌ Ошибка: ${await response.text()}\n\n`;
                allSuccess = false;
            }
        } catch (error) {
            results += `❌ Ошибка соединения: ${error.message}\n\n`;
            allSuccess = false;
        }
    }

    showResponse(results.trim(), !allSuccess);
    showStatus(
        allSuccess ? 'success' : 'error',
        allSuccess ? '✅ Запрос выполнен успешно' : '❌ Ошибка запроса',
        allSuccess ? 'Результат ниже' : 'Проверьте правильность IP и состояние сервера'
    );

    // Восстанавливаем кнопку
    testQueryBtn.disabled = false;
    testQueryBtn.querySelector('.btn-icon').textContent = '📊';
    testQueryBtn.childNodes[testQueryBtn.childNodes.length - 1].textContent = ' Тестовый запрос';
}

/**
 * Очистка формы
 */
function clearForm() {
    ipInput.value = '';
    hideStatus();
    hideResponse();
    testQueryBtn.disabled = true;
    ipInput.focus();
}

// ============================================================
// СОБЫТИЯ
// ============================================================

function bindEvents() {
    // Если это страница login.html (нет кнопки testQueryBtn), не привязываем события
    if (!document.getElementById('testQueryBtn')) return;

    if (!connectBtn) return;
    connectBtn.addEventListener('click', checkConnection);
    if (testQueryBtn) testQueryBtn.addEventListener('click', executeTestQuery);
    if (clearBtn) clearBtn.addEventListener('click', clearForm);

    if (goToTablesBtn) {
        goToTablesBtn.addEventListener('click', () => {
            const ip = ipInput.value.trim();
            if (ip) {
                window.location.href = `sql-editor.html?ip=${ip}`;
            }
        });
    }

    // Enter для подключения
    if (ipInput) {
        ipInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !connectBtn.disabled) {
                checkConnection();
            }
        });
    }
}

// ============================================================
// ЭКСПОРТ ДЛЯ ИСПОЛЬЗОВАНИЯ В ДРУГИХ ФАЙЛАХ
// ============================================================
window.ConnectionHistory = ConnectionHistory;

// Автоматическая подстановка локального IP (если устройства в одной сети)
async function detectLocalIp() {
    try {
        // Попытка получить IP через WebRTC (для локальной сети)
        const pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('');
        const offer = pc.createOffer();
        pc.onicecandidate = (e) => {
            if (!e.icecandidate) {
                pc.close();
                // IP можно извлечь из candidate
                return;
            }
            const match = /([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/.exec(e.icecandidate.candidate);
            if (match) {
                // ipInput.value = match[1];  // Раскомментировать для авто-подстановки
            }
        };
        pc.setLocalDescription(offer);
    } catch (e) {
        // Не поддерживается или недоступно
    }
}

// ============================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    cacheDOMElements();
    bindEvents();
    ConnectionHistory.displayHistory();
    if (ipInput) ipInput.focus();
    console.log('🔌 SQL Connection Check v1.0 загружен');
});
