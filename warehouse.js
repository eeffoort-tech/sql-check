// ============================================================
// WAREHOUSE PAGE - JavaScript (OPTIMIZED)
// ============================================================

const WAREHOUSE = {
    serverIp: null,
    visibleColumns: [],
    sortColumn: null,
    sortDirection: 'asc',
    columnsDef: null, // структура колонок из БД
    imageData: {}, // { kod: base64data }
    foundItems: [], // Массив найденных товаров для принятия на склад
    currentOperator: '', // текущий оператор
    currentSessionNomer: null, // номер текущей сессии (персистируемый в localStorage по userId)
    reserveData: {}, // { kod: koli } — резерв из zakaz (status 1–4)
    availableData: {}, // { kod: available }
    isOptCached: {}, // { kod: boolean } — является ли оптовиком
    isSavingPlan: false, // флаг: идёт запись в БД из поля "План"
    planSaveTimeout: null, // debounce таймер для поля "План"
    isSavingAllPlan: false, // флаг: идёт массовое сохранение (saveAllPlanAndGo)
    planSaveMutex: {}, // mutex (замок) для защиты параллельных вызовов по kod
    pendingBlurPromises: [], // Массив Promise от blur событий

    // ============================================================
    // DEBOUNCE: loadReserve + recalcAllOptAvail вызываются 1 раз
    // через 300мс после последнего blur (не после каждого)
    // ============================================================
    schedulePlanSync() {
        if (this.planSyncTimeout) {
            clearTimeout(this.planSyncTimeout);
        }
        this.planSyncTimeout = setTimeout(async () => {
            this.planSyncTimeout = null;
            try {
                await this.loadReserve();
                this.updateAllRowsAvailability();
                await this.recalcAllOptAvail();
                console.log('[schedulePlanSync] sync completed');
            } catch (e) {
                console.error('[schedulePlanSync] sync error:', e);
            }
        }, 300);
    },

    async init() {
        this.serverIp = localStorage.getItem('serverIp');
        if (!this.serverIp) {
            window.location.href = 'login.html';
            return;
        }

        // Проверяем, что мы на странице склада
        const container = document.getElementById('warehouseTableContainer');
        if (!container) {
            console.log('[warehouse] Не найдён warehouseTableContainer — пропускаем инициализацию');
            return;
        }

        // Скрываем все модальные окна при загрузке страницы
        document.querySelectorAll('.warehouse-modal').forEach(modal => {
            modal.style.display = 'none';
        });

        // Скрываем модальные окна при возврате на страницу (из orders.html или других)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                document.querySelectorAll('.warehouse-modal').forEach(modal => {
                    modal.style.display = 'none';
                });
            }
        });

        // Загружаем имя пользователя из БД
        const userId = localStorage.getItem('userId');
        const userIdDisplay = document.getElementById('currentUserId');
        if (userIdDisplay && userId) {
            userIdDisplay.textContent = '...';
            await this.loadUserName(userId, userIdDisplay);
            // Сохраняем имя для записи в history
            try {
                const nameResult = await this.query(`SELECT "name" FROM "sotrud" WHERE "ID"='${userId.replace(/'/g, "''")}'`);
                if (nameResult?.trim()) {
                    const nameLines = nameResult.trim().split('\n').filter(l => l);
                    if (nameLines.length > 1) {
                        const nameParts = nameLines[1].split('\t');
                        const name = nameParts[0]?.trim();
                        if (name) localStorage.setItem('userName', name);
                    }
                }
            } catch (e) {
                console.error('Ошибка загрузки имени:', e);
            }
        }

        // Инициализация
        this.reserveData = {};
        this.availableData = {};

        this.bindEvents();

        // Кэширование DOM-элементов
        this.domCache = {};
        this.minCache = {};  // { kod: min }
        this.maxCache = {};  // { kod: max }

        // Фильтры по типу
        this.typeFilter = {
            Tov: localStorage.getItem('typeFilter_Tov') !== 'false',
            Vnut: localStorage.getItem('typeFilter_Vnut') !== 'false',
            Rash: localStorage.getItem('typeFilter_Rash') !== 'false',
            Upak: localStorage.getItem('typeFilter_Upak') !== 'false',
        };
        this.initTypeFilters(); // Инициализация фильтров

        // Получаем номер сессии и загружаем резерв перед загрузкой данных
        this.currentSessionNomer = await this.getDayNomer();
        console.log('Номер сессии:', this.currentSessionNomer);

        // Очищаем вчерашние планы (status=1,2)
        await this.cleanupOldPlans();

        await this.loadReserve();
        await this.loadData();

        // === ПЕРЕСЧЁТ ДОСТУПНОСТИ ПОСЛЕ ЗАГРУЗКИ СТРАНИЦЫ ===
        // Гарантирует, что reserveData загружен и доступность пересчитана
        console.log('[init] Пересчёт доступности после загрузки страницы...');
        console.log('[init] reserveData:', this.reserveData);
        console.log('[init] availableData:', this.availableData);

        // Рассчитываем высоту таблицы при загрузке и изменении размера окна
        this.adjustTableHeight();
        window.addEventListener('resize', () => this.adjustTableHeight());

        // Убираем подсветку при уходе со страницы
        window.addEventListener('beforeunload', () => {
            document.querySelectorAll('input[data-field="Сделано"][style*="background-color"]').forEach(input => {
                input.style.backgroundColor = '';
            });
        });
    },

    // ============================================================
    // НАСТРОЙКА ВЫСОТЫ ТАБЛИЦЫ
    // ============================================================
    adjustTableHeight() {
        const tableWrapper = document.querySelector('.guide-table-wrapper');
        const header = document.querySelector('.editor-header');
        const toolbar = document.querySelector('.guide-toolbar');

        if (!tableWrapper) return;

        const headerHeight = header ? header.offsetHeight : 60;
        const toolbarHeight = toolbar ? toolbar.offsetHeight : 50;

        // Используем dvh (dynamic viewport height) - учитывает панель задач Windows
        const dynamicHeight = window.innerHeight;
        const totalTopOffset = headerHeight + toolbarHeight + 80; // +80 на отступы

        tableWrapper.style.height = `${Math.max(400, dynamicHeight - totalTopOffset)}px`;
    },

    // ============================================================
    // ФИЛЬТРЫ ПО ТИПУ
    // ============================================================
    initTypeFilters() {
        const filters = document.querySelectorAll('#typeFilters input[type="checkbox"]');
        filters.forEach(cb => {
            // Устанавливаем начальное состояние из state
            const key = cb.id.replace('filter', '');
            cb.checked = this.typeFilter[key] !== false;
        });
        this.bindTypeFilters();
    },

    bindTypeFilters() {
        const filters = document.querySelectorAll('#typeFilters input[type="checkbox"]');
        filters.forEach(cb => {
            cb.addEventListener('change', (e) => {
                const key = e.target.id.replace('filter', '');
                this.typeFilter[key] = e.target.checked;

                // Сохраняем в localStorage
                localStorage.setItem('typeFilter_' + key, e.target.checked ? 'true' : 'false');

                // Перерисовываем таблицу
                this.renderFilteredTable();
            });
        });
    },

    renderFilteredTable() {
        // Перезагружаем данные с текущими фильтрами
        this.loadData();
    },

    // ============================================================
    // ЗАГРУЗКА ИМЕНИ ПОЛЬЗОВАТЕЛЯ
    // ============================================================
    async loadUserName(userId, displayElement) {
        try {
            const sql = `SELECT "name" FROM "sotrud" WHERE "ID"='${userId.replace(/'/g, "''")}'`;
            const result = await this.query(sql);
            if (result && !result.includes('ОШИБКА') && !result.includes('ERROR') && result.trim()) {
                const lines = result.trim().split('\n').filter(l => l);
                if (lines.length > 1) {
                    // Вторая строка - данные, ищем имя
                    const dataLine = lines[1];
                    const columns = dataLine.split('\t');
                    const headerLine = lines[0].split('\t').map(h => h.trim().toLowerCase());
                    const nameIndex = headerLine.findIndex(h => h === 'name' || h === 'наименование' || h === 'имя');
                    if (nameIndex >= 0 && columns[nameIndex]) {
                        displayElement.textContent = columns[nameIndex].trim();
                        return;
                    }
                }
                // Если не нашли имя, показываем ID
                displayElement.textContent = userId;
            } else {
                displayElement.textContent = userId;
            }
        } catch (e) {
            console.error('Ошибка загрузки имени:', e);
            displayElement.textContent = userId;
        }
    },

    // ============================================================
    // НОМЕР СЕССИИ (Z-XXXXX) — уникальный, генерируется при каждом открытии
    // ============================================================
    async getDayNomer() {
        return 'Z-' + Date.now();
    },

    // ============================================================
    // УДАЛЕНИЕ НОМЕРА СЕССИИ (после создания заказа или очистки)
    // ============================================================
    clearCurrentNomer() {
        this.currentSessionNomer = null;
    },
    
    // ============================================================
    // ОЧИСТКА СТАРЫХ ПЛАНОВ (status=1,2)
    // Удаляем планы, у которых дата != сегодня
    // ============================================================
    async cleanupOldPlans() {
        const today = new Date().toISOString().split('T')[0];
        console.log('[cleanupOldPlans] Сегодня:', today);

        try {
            const result = await this.query(
                `SELECT COUNT(*) as "cnt" FROM "zakaz" WHERE "status" IN (1, 2) AND "data" != '${today}'`
            );

            if (result?.trim()) {
                const lines = result.trim().split('\n').filter(l => l);
                if (lines.length > 1) {
                    const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
                    const cntIdx = headers.indexOf('cnt');
                    const parts = lines[1].split('\t');
                    const cnt = parseInt(parts[cntIdx]) || 0;

                    if (cnt > 0) {
                        await this.query(
                            `DELETE FROM "zakaz" WHERE "status" IN (1, 2) AND "data" != '${today}'`
                        );
                        console.log(`[cleanupOldPlans] Удалено ${cnt} старых планов`);
                    } else {
                        console.log('[cleanupOldPlans] Старых планов нет');
                    }
                }
            }
        } catch (e) {
            console.error('[cleanupOldPlans] Ошибка удаления:', e);
        }
    },

    // ============================================================
    // ЗАГРУЗКА РЕЗЕРВА ИЗ БД (SUM status=1,2,3,4 — общий для всех)
    // ============================================================
    async loadReserve() {
        try {
            // Загружаем все статусы для всех пользователей
            const result = await this.query(
                `SELECT "kod", SUM("koli") as "total" FROM "zakaz" WHERE "status" IN (1, 2, 3, 4) GROUP BY "kod"`
            );
            console.log('[loadReserve] SQL result:', result);

            this.reserveData = {};
            if (result && result.trim()) {
                const lines = result.trim().split('\n').filter(l => l);
                for (let i = 1; i < lines.length; i++) {
                    const parts = lines[i].split('\t');
                    const headerParts = lines[0].split('\t').map(h => h.trim().toLowerCase());
                    const kodIdx = headerParts.findIndex(h => h === 'kod');
                    const totalIdx = headerParts.findIndex(h => h.includes('total') || h === 'sum');
                    const kod = kodIdx >= 0 ? parts[kodIdx]?.trim() : '';
                    const total = totalIdx >= 0 ? parseInt(parts[totalIdx]) || 0 : 0;
                    if (kod) {
                        this.reserveData[kod] = total;
                    }
                }
            }
            console.log('[loadReserve] reserveData:', this.reserveData);
        } catch (e) {
            console.error('Ошибка загрузки резерва:', e);
            this.reserveData = {};
        }
    },

    // ============================================================
    // СОХРАНЕНИЕ В ZAKAZ (НЕОПТОВИК, status=1)
    // ============================================================
    async saveToZakaz(kod, koli, nomer, dataStr, timeStr) {
        try {
            const userId = localStorage.getItem('userId') || '';
            const userName = localStorage.getItem('userName') || userId;
            if (!nomer) return;

            console.log(`[saveToZakaz] kod=${kod}, koli=${koli}, nomer=${nomer}, status=1`);

            // Удаляем старую запись для текущего kod + nomer + user
            const deleteSql = `DELETE FROM "zakaz" WHERE "kod"='${kod.replace(/'/g, "''")}' AND "nomer"='${nomer.replace(/'/g, "''")}' AND "user"='${userName.replace(/'/g, "''")}' AND "status"=1`;
            console.log('[saveToZakaz] DELETE SQL (status=1):', deleteSql);
            await this.query(deleteSql);
            console.log('[saveToZakaz] DELETE выполнено');

            // Если koli > 0 — создаём новую запись со статусом 1
            if (koli > 0) {
                const insertSql = `INSERT INTO "zakaz" ("kod", "koli", "nomer", "user", "status", "data", "time") VALUES ('${kod.replace(/'/g, "''")}', ${koli}, '${nomer}', '${userName.replace(/'/g, "''")}', 1, '${dataStr}', '${timeStr}')`;
                console.log('[saveToZakaz] INSERT SQL (status=1):', insertSql);
                await this.query(insertSql);
                console.log('[saveToZakaz] INSERT выполнено (status=1)');
            }
        } catch (e) {
            console.error('Ошибка записи в zakaz:', e);
        }
    },

    // ============================================================
    // СОХРАНЕНИЕ ОПТОВОГО ТОВАРА (САМ + КОМПОНЕНТЫ)
    // Возвращает массив kod компонентов, которые были записаны
    // ============================================================
    async saveOptPlanToZakaz(kod, koli, nomer, dataStr, timeStr) {
        // Получаем блокировку — не даём параллельным вызовам дублировать запись
        await this.acquireLock(kod);
        console.log('[saveOptPlanToZakaz] БЛОКИРОВАНО kod=' + kod);

        try {
            const userId = localStorage.getItem('userId') || '';
            const userName = localStorage.getItem('userName') || userId;
            if (!nomer) return [];

            console.log('[saveOptPlanToZakaz] START kod=' + kod + ', koli=' + koli + ', nomer=' + nomer);

            // Загружаем ТОЛЬКО компоненты с type="Товар"
            const components = await this.getApprovedComponents(kod);
            console.log('[saveOptPlanToZakaz] Компоненты:', components.map(c => c.kod + '=' + c.koliPerUnit));

            // Удаляем ТОЛЬКО статус 2 для оптовика по kod + nomer + user
            const deleteOpt = `DELETE FROM "zakaz" WHERE "kod"='${kod.replace(/'/g, "''")}' AND "nomer"='${nomer.replace(/'/g, "''")}' AND "user"='${userName.replace(/'/g, "''")}' AND "status"=2`;
            console.log('[saveOptPlanToZakaz] DELETE оптовик SQL (по kod+nomer+user):', deleteOpt);
            await this.query(deleteOpt);

            // Удаляем старые записи компонентов (статус=2) по kod + nomer + user
            if (components.length > 0) {
                for (const comp of components) {
                    const deleteComp = `DELETE FROM "zakaz" WHERE "kod"='${comp.kod.replace(/'/g, "''")}' AND "nomer"='${nomer.replace(/'/g, "''")}' AND "user"='${userName.replace(/'/g, "''")}' AND "status"=2`;
                    console.log('[saveOptPlanToZakaz] DELETE компонент SQL (по kod+nomer+user):', deleteComp);
                    await this.query(deleteComp);
                }
            }

            // Если koli <= 0 — всё удалено, возвращаем список компонентов для обновления
            if (koli <= 0) {
                console.log(`[saveOptPlanToZakaz] koli=0, удаляем`);
                return components.map(c => c.kod);
            }

            // Записываем ТОЛЬКО оптовика (статус 2)
            // Компоненты вставляем автоматически со статусом 2
            console.log('[saveOptPlanToZakaz] Записываем оптовик (status=2)');
            const insertOpt = `INSERT INTO "zakaz" ("kod", "koli", "nomer", "user", "status", "data", "time") VALUES ('${kod.replace(/'/g, "''")}', ${koli}, '${nomer}', '${userName}', 2, '${dataStr}', '${timeStr}')`;
            await this.query(insertOpt);

            // Записываем компоненты (статус 2)
            const wroteKods = [];
            for (const comp of components) {
                const totalKoli = koli * comp.koliPerUnit;
                const insertComp = `INSERT INTO "zakaz" ("kod", "koli", "nomer", "user", "status", "data", "time") VALUES ('${comp.kod.replace(/'/g, "''")}', ${totalKoli}, '${nomer}', '${userName}', 2, '${dataStr}', '${timeStr}')`;
                console.log('[saveOptPlanToZakaz] INSERT компонент (status=2):', insertComp);
                await this.query(insertComp);
                wroteKods.push(comp.kod);
            }

            console.log(`[saveOptPlanToZakaz] Оптовик ${kod} записан с составом: koli=${koli}, comps=` + wroteKods);
            return wroteKods;
        } catch (e) {
            console.error('Ошибка записи оптовика:', e);
            return [];
        } finally {
            this.releaseLock(kod);
            console.log('[saveOptPlanToZakaz] РАЗБЛОКИРОВАНО kod=' + kod);
        }
    },

    // ============================================================
    // БЫСТРАЯ СИНХРОНИЗАЦИЯ ПЛАНА В БД (без пересчётов)
    // ============================================================
    async syncPlanToZakazFast(kod, newQuantity) {
        try {
            const userId = localStorage.getItem('userId') || '';
            const nomer = this.currentSessionNomer;
            if (!nomer) return;

            const now = new Date();
            const dataStr = now.toISOString().split('T')[0];
            const timeStr = now.toTimeString().split(' ')[0].slice(0, 5);
            const userName = localStorage.getItem('userName') || userId;

            // УДАЛЯЕМ ВСЕ status=1,2,4 для текущего nomer+user (а не только по kod)
            // Критично для оптовиков: при удалении только по kod компоненты оптовика
            // не удаляются (у них другой kod), и при INSERT они дублируются.
            // Решение: чистим всё по nomer+user перед записью нового плана.
            await this.query(
                `DELETE FROM "zakaz" WHERE "nomer"='${nomer.replace(/'/g, "''")}' AND "user"='${userName.replace(/'/g, "''")}' AND "status" IN (1, 2, 4)`
            );

            // Проверяем, является ли товар оптовым
            const optResult = await this.query(
                `SELECT "opt" FROM "guide" WHERE "kod"='${kod.replace(/'/g, "''")}' LIMIT 1`
            );

            const optLines = optResult?.trim().split('\n').filter(l => l);
            const isOpt = optLines?.length >= 2 && optLines[1]?.trim() === 'Сборка';

            if (isOpt && newQuantity > 0) {
                // Оптовик — записываем сам
                await this.query(
                    `INSERT INTO "zakaz" ("kod", "koli", "nomer", "user", "status", "data", "time") ` +
                    `VALUES ('${kod.replace(/'/g, "''")}', ${newQuantity}, '${nomer}', '${userName.replace(/'/g, "''")}', 2, '${dataStr}', '${timeStr}')`
                );

                // Записываем ТОЛЬКО компоненты с type="Товар"
                const components = await this.getApprovedComponents(kod);

                for (const comp of components) {
                    const totalKoli = newQuantity * comp.koliPerUnit;
                    await this.query(
                        `INSERT INTO "zakaz" ("kod", "koli", "nomer", "user", "status", "data", "time") ` +
                        `VALUES ('${comp.kod.replace(/'/g, "''")}', ${totalKoli}, '${nomer}', '${userName.replace(/'/g, "''")}', 2, '${dataStr}', '${timeStr}')`
                    );
                }
            } else if (newQuantity > 0) {
                // Обычный товар
                await this.query(
                    `INSERT INTO "zakaz" ("kod", "koli", "nomer", "user", "status", "data", "time") ` +
                    `VALUES ('${kod.replace(/'/g, "''")}', ${newQuantity}, '${nomer}', '${userName.replace(/'/g, "''")}', 2, '${dataStr}', '${timeStr}')`
                );
            }
        } catch (e) {
            console.error('Ошибка быстрой синхронизации:', e);
        }
    },

    // ============================================================
    // СИНХРОНИЗАЦИЯ ПЛАНА С ZAKAZ (ОПТИМИЗИРОВАННАЯ)
    // Только запись в БД — без loadReserve/recalc (делается 1 раз на все изменения)
    // ============================================================
    async syncPlanToZakaz(kod, newQuantity) {
        console.log('[syncPlanToZakaz] START kod=' + kod + ', koli=' + newQuantity);

        const userId = localStorage.getItem('userId') || '';
        const userName = localStorage.getItem('userName') || userId;
        const nomer = this.currentSessionNomer;
        if (!nomer) return;

        const now = new Date();
        const dataStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().split(' ')[0].slice(0, 5);

        // Проверяем, является ли товар оптовым
        const optResult = await this.query(
            `SELECT "opt" FROM "guide" WHERE "kod"='${kod.replace(/'/g, "''")}' LIMIT 1`
        );

        const optLines = optResult?.trim().split('\n').filter(l => l);
        const isOpt = optLines?.length >= 2 && optLines[1]?.trim() === 'Сборка';
        console.log('[syncPlanToZakaz] isOpt=' + isOpt);

        if (isOpt) {
            // Оптовик — записываем сам + состав
            await this.saveOptPlanToZakaz(kod, newQuantity, nomer, dataStr, timeStr);
        } else {
            // Обычный товар
            if (newQuantity > 0) {
                await this.saveToZakaz(kod, newQuantity, nomer, dataStr, timeStr);
            } else {
                await this.saveToZakaz(kod, 0, nomer, dataStr, timeStr);
            }
        }

        // ВЫЗЫВАЮЩИЙ должен вызвать loadReserve() + recalcAllOptAvail() ОДИН РАЗ ПОСЛЕ ВСЕХ ИЗМЕНЕНИЙ
        console.log('[syncPlanToZakaz] END kod=' + kod);
    },

    // ============================================================
    // ПЕРЕСЧЁТ ВСЕХ ОПТОВИКОВ
    // ============================================================
    async recalcAllOptAvail() {
        const dataLines = this.currentData?.dataLines;
        const headers = this.currentData?.headers;
        if (!dataLines || !headers) return;

        // Находим оптовики в таблице
        const optKodsInTable = new Set();
        for (let i = 1; i < dataLines.length; i++) {
            const values = dataLines[i].split('\t');
            const kod = values[headers.indexOf('kod')] || '';
            if (!kod) continue;
            const optIndex = headers.indexOf('opt');
            const optValue = optIndex >= 0 ? values[optIndex]?.trim() : '';
            if (optValue === 'Сборка') {
                optKodsInTable.add(kod);
            }
        }

        if (optKodsInTable.size === 0) return;

        // Загружаем состав всех оптовиков
        const optKodList = Array.from(optKodsInTable).map(k => `'${k.replace(/'/g, "''")}'`).join(',');
        const result = await this.query(
            `SELECT "kod", "kod2", "koli" FROM "sostav" WHERE "kod" IN (${optKodList})`
        );

        if (result?.trim()) {
            const sastavLines = result.trim().split('\n').filter(l => l);
            const sastavHeaders = sastavLines[0].split('\t').map(h => h.trim().toLowerCase());
            const optIdx = sastavHeaders.indexOf('kod');
            const compIdx = sastavHeaders.indexOf('kod2');
            const koliIdx = sastavHeaders.indexOf('koli');

            const sastavByOpt = {};
            for (let i = 1; i < sastavLines.length; i++) {
                const parts = sastavLines[i].split('\t');
                const optKod = optIdx >= 0 ? parts[optIdx]?.trim() : '';
                const compKod = compIdx >= 0 ? parts[compIdx]?.trim() : '';
                const koli = koliIdx >= 0 ? parseInt(parts[koliIdx]) || 1 : 1;

                if (optKod && compKod) {
                    if (!sastavByOpt[optKod]) sastavByOpt[optKod] = [];
                    sastavByOpt[optKod].push({ kod2: compKod, koli });
                }
            }

            // Пересчитываем каждый оптовик
            for (const optKod of optKodsInTable) {
                const components = sastavByOpt[optKod] || [];
                if (components.length === 0) {
                    this.availableData[optKod] = 0;
                    this.updateOptAvailInDOM(optKod, 0);
                    continue;
                }

                let minAvail = Infinity;
                for (const comp of components) {
                    const compTotal = this.warehouseCache?.[comp.kod2] || 0;
                    const compReserve = this.reserveData[comp.kod2] || 0;
                    const compAvailable = compTotal - compReserve;
                    const optAvail = compAvailable / comp.koli;
                    if (optAvail < minAvail) minAvail = optAvail;
                }

                const ownTotal = this.assembledWarehouse?.[optKod] || 0;
                const ownReserve = this.reserveData[optKod] || 0;
                const ownAvailable = ownTotal - ownReserve;
                if (ownAvailable < minAvail) minAvail = ownAvailable;

                const result = Math.floor(minAvail);
                this.availableData[optKod] = result;
                this.updateOptAvailInDOM(optKod, result);
            }
        }
    },

    // ============================================================
    // ПОЛУЧИТЬ СОСТАВ ОПТОВИКА (только компоненты с type="Товар")
    // ============================================================
    async getApprovedComponents(optKod) {
        const sastavResult = await this.query(
            `SELECT "kod2", "koli" FROM "sostav" WHERE "kod"='${optKod.replace(/'/g, "''")}'`
        );
        if (!sastavResult?.trim()) return [];

        const sastavLines = sastavResult.trim().split('\n').filter(l => l);
        const sastavHeaders = sastavLines[0].split('\t').map(h => h.trim().toLowerCase());
        const kod2Idx = sastavHeaders.indexOf('kod2');
        const koliIdx = sastavHeaders.indexOf('koli');

        // Собираем все kod2 компонентов
        const compKods = [];
        for (let i = 1; i < sastavLines.length; i++) {
            const parts = sastavLines[i].split('\t');
            const compKod = kod2Idx >= 0 ? parts[kod2Idx]?.trim() : '';
            if (compKod) compKods.push(compKod);
        }

        if (compKods.length === 0) return [];

        // Загружаем type для всех компонентов
        const kodListQuoted = compKods.map(k => `'${k.replace(/'/g, "''")}'`).join(',');
        const guideResult = await this.query(
            `SELECT "kod", "type" FROM "guide" WHERE "kod" IN (${kodListQuoted})`
        );

        const approvedTypes = new Set();
        if (guideResult?.trim()) {
            const guideLines = guideResult.trim().split('\n').filter(l => l);
            if (guideLines.length > 1) {
                const guideHeaders = guideLines[0].split('\t').map(h => h.trim().toLowerCase());
                const gKodIdx = guideHeaders.indexOf('kod');
                const gTypeIdx = guideHeaders.indexOf('type');
                for (let i = 1; i < guideLines.length; i++) {
                    const parts = guideLines[i].split('\t');
                    const k = gKodIdx >= 0 ? parts[gKodIdx]?.trim() : '';
                    const t = gTypeIdx >= 0 ? parts[gTypeIdx]?.trim() : '';
                    if (k && t === 'Товар') approvedTypes.add(k);
                }
            }
        }

        // Возвращаем только компоненты с type="Товар"
        const result = [];
        for (let i = 1; i < sastavLines.length; i++) {
            const parts = sastavLines[i].split('\t');
            const compKod = kod2Idx >= 0 ? parts[kod2Idx]?.trim() : '';
            const koli = koliIdx >= 0 ? parseInt(parts[koliIdx]) || 1 : 1;
            if (compKod && approvedTypes.has(compKod)) {
                result.push({ kod: compKod, koliPerUnit: koli });
            }
        }

        console.log(`[getApprovedComponents] Оптовик ${optKod}: ${result.length} компонентов с type="Товар"`);
        return result;
    },

    // ============================================================
    // ПОЛЯ ТАБЛИЦЫ (соответствие UI -> БД)
    // ============================================================
    getFields() {
        return [
            { key: 'Код', db: 'kod', type: 'text' },
            { key: 'Сортировка', db: 'sorti', type: 'text' },
            { key: 'Сделано', db: 'Сделано', type: 'number' },
            { key: 'Картинка', db: 'img', type: 'image' },
            { key: 'Артикул', db: 'art', type: 'text' },
            { key: 'Цвет', db: 'color', type: 'text' },
            { key: 'Размер', db: 'size', type: 'text' },
            { key: 'План', db: 'plan', type: 'number' },
            { key: 'Доступно', db: 'available', type: 'text' },
            { key: 'Всего склад', db: 'total_warehouse', type: 'text' },
            { key: 'Резерв', db: 'reserve', type: 'text' },
            { key: 'MIN', db: 'min', type: 'text' },
            { key: 'MAX', db: 'max', type: 'text' },
            { key: 'КИЗ', db: 'kiz', type: 'text' },
            { key: 'Всего КИЗ', db: 'total_kiz', type: 'text' }
        ];
    },

    // =========================================
    // ФУНКЦИЯ ПЕРЕНОСА ДАННЫХ НА СТРАНИЦУ "СДЕЛАНО"
    // =========================================
    async saveToSdelanoAndGo() {
        try {
            if (!this.currentData || !this.currentData.dataLines) {
                alert('Нет данных для переноса. Сначала обновите таблицу.');
                return;
            }
            const dataLines = this.currentData.dataLines;
            const headers = this.currentData.headers;
            const kodIndex = headers.findIndex(h => h.trim().toLowerCase() === 'код' || h.trim().toLowerCase() === 'kod');
            const artIndex = headers.findIndex(h => h.trim().toLowerCase() === 'артикул' || h.trim().toLowerCase() === 'art');
            const table = document.querySelector('.warehouse-table');
            if (!table) {
                alert('Таблица не найдена');
                return;
            }
            const rows = table.querySelectorAll('tbody tr');

            // 1. Собираем ВСЕ строки с input "Сделано" и маппим на DOM-строки
            const madeKods = [];
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const rowValues = dataLines[i + 1]?.split('\t') || [];
                const kod = kodIndex >= 0 ? rowValues[kodIndex]?.trim() : '';
                const art = artIndex >= 0 ? rowValues[artIndex]?.trim() : '';
                const madeInput = row.querySelector('input[data-field="Сделано"]');
                if (!kod || !madeInput) continue;
                const rawMade = madeInput.value.trim();
                const made = rawMade ? (parseInt(rawMade.replace(/[^0-9]/g, '')) || 0) : 0;
                madeKods.push({ kod, art, made, row, madeInput });
            }

            if (madeKods.length === 0) {
                alert('Нет записей со значением "Сделано" > 0');
                return;
            }

            // 2. Загружаем art, type, opt для всех кодов одним запросом
            const kodList = madeKods.map(k => `'${k.kod.replace(/'/g, "''")}'`).join(',');
            const guideResult = await this.query(
                `SELECT "kod", "art", "type", "opt" FROM "guide" WHERE "kod" IN (${kodList})`
            );

            const itemInfo = {}; // kod -> { art, type, opt }
            if (guideResult?.trim()) {
                const guideLines = guideResult.trim().split('\n').filter(l => l);
                if (guideLines.length > 1) {
                    const guideHeaders = guideLines[0].split('\t').map(h => h.trim().toLowerCase());
                    const gKodIdx = guideHeaders.indexOf('kod');
                    const gArtIdx = guideHeaders.indexOf('art');
                    const gTypeIdx = guideHeaders.indexOf('type');
                    const gOptIdx = guideHeaders.indexOf('opt');

                    for (let i = 1; i < guideLines.length; i++) {
                        const parts = guideLines[i].split('\t');
                        const k = gKodIdx >= 0 ? parts[gKodIdx]?.trim() : '';
                        const a = gArtIdx >= 0 ? parts[gArtIdx]?.trim() : '';
                        const t = gTypeIdx >= 0 ? parts[gTypeIdx]?.trim() : '';
                        const o = gOptIdx >= 0 ? parts[gOptIdx]?.trim() : '';
                        if (k) {
                            itemInfo[k] = { art: a, type: t, opt: o };
                        }
                    }
                }
            }

            // 3. Переносим все строки (независимо от значения в колонке "Сделано")
            const sdelanoData = [];
            const excludedItems = []; // { kod, art, row, madeInput }

            for (let i = 0; i < madeKods.length; i++) {
                const item = madeKods[i];
                const kod = item.kod;
                const info = itemInfo[kod] || {};
                const isOpt = info.opt === 'Сборка';
                const isTypeTov = info.type === 'Товар';
                const art = info.art || item.art || '—';
                const madeInput = item.madeInput;

                if (isOpt || !isTypeTov) {
                    excludedItems.push({ kod, art, row: item.row, madeInput });
                    continue;
                }

                // Добавляем все товары с type="Товар"
                sdelanoData.push({ kod, art: item.art, made: item.made });
            }

            // 4. Переносим все данные
            if (sdelanoData.length === 0) {
                alert('Нет подходящих записей для переноса в "Сделано"');
                return;
            }

            // 4. Нет ограничений — переносим все
            sessionStorage.setItem('sdelanoData', JSON.stringify(sdelanoData));
            window.location.href = 'sdelano.html';
        } catch (error) {
            console.error('Ошибка при переносе данных:', error);
            alert('Ошибка при переносе данных: ' + error.message);
        }
    },

    // ============================================================
    // СОБЫТИЯ
    // ============================================================
    bindEvents() {
        const safeAdd = (selector, event, handler) => {
            const el = document.querySelector(selector);
            if (el) el.addEventListener(event, handler);
        };

        safeAdd('#backBtn', 'click', () => {
            // Скрываем модальные окна перед возвратом
            const loadingModal = document.getElementById('loadingModal');
            if (loadingModal) loadingModal.style.display = 'none';

            // Скрываем другие модальные окна
            document.querySelectorAll('.warehouse-modal').forEach(modal => {
                if (modal.id !== 'loadingModal') {
                    modal.style.display = 'none';
                }
            });

            // Используем replace, чтобы кнопка "Назад" не возвращала к модальному окну
            window.history.back();
        });

        // === Очистка полей «План» при возврате из bfcache (кнопка «Назад» на orders.html) ===
        if (window.addEventListener) {
            window.addEventListener('pageshow', (event) => {
                // event.persisted === true означает восстановление из bfcache
                if (event.persisted) {
                    const planInputs = document.querySelectorAll('input[data-field="plan"]');
                    planInputs.forEach((input) => {
                        input.value = '';
                    });
                    console.log('[warehouse] Очищены поля «План» после возврата из bfcache');
                }
            });
        }

        safeAdd('#goToSalaryBtn', 'click', () => {
            window.location.href = 'my-salary.html';
        });

        safeAdd('#acceptStockBtn', 'click', () => {
            this.openAcceptStockModal();
        });

        safeAdd('#sdelanoBtn', 'click', () => {
            this.saveToSdelanoAndGo();
        });

        safeAdd('#columnsBtn', 'click', () => {
            this.openColumnsModal();
        });

        // Модальное окно сортировки
        safeAdd('#sortOkBtn', 'click', () => {
            this.saveSort();
        });

        safeAdd('#sortCancelBtn', 'click', () => {
            document.getElementById('sortModal').style.display = 'none';
        });

        safeAdd('#sortModal', 'click', (e) => {
            if (e.target.classList.contains('warehouse-modal-overlay')) {
                document.getElementById('sortModal').style.display = 'none';
            }
        });

        safeAdd('#massUploadBtn', 'click', () => {
            this.openMassUploadModal();
        });

        safeAdd('#massManageProfilesBtn', 'click', () => {
            window.location.href = 'column-config.html';
        });

        safeAdd('#saveColumnsBtn', 'click', () => {
            this.saveVisibleColumns();
        });

        safeAdd('#resetColumnsBtn', 'click', () => {
            this.resetColumns();
        });

        safeAdd('#closeColumnsBtn', 'click', () => {
            this.closeColumnsModal();
        });

        safeAdd('#columnsModal .btn-modal-close', 'click', () => {
            this.closeColumnsModal();
        });

        safeAdd('#columnsModal', 'click', (e) => {
            if (e.target.classList.contains('warehouse-modal-overlay')) {
                this.closeColumnsModal();
            }
        });

        safeAdd('#acceptWithoutShk', 'click', () => {
            this.addWithoutShopCode();
        });

        // Кнопки в модалке принятия на склад
        safeAdd('#checkShk', 'click', () => {
            this.openPrikhodModal();
        });

        // Модалка поиска по prihod
        safeAdd('#prikhodSearchBtn', 'click', () => {
            this.prikhodSearch();
        });

        safeAdd('#prikhodShopCode', 'keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.prikhodSearch();
            }
        });

        safeAdd('#closePrikhodBtn', 'click', () => {
            this.closePrikhodModal();
        });

        safeAdd('#prikhodSearchModal .btn-modal-close', 'click', () => {
            this.closePrikhodModal();
        });

        safeAdd('#prikhodSearchModal', 'click', (e) => {
            if (e.target.classList.contains('warehouse-modal-overlay')) {
                this.closePrikhodModal();
            }
        });

        safeAdd('#clearShopCodeBtn', 'click', () => {
            document.getElementById('acceptShopCode').value = '';
            document.getElementById('acceptShopCode').focus();
        });

        safeAdd('#acceptShopCode', 'keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.checkShk();
            }
        });

        safeAdd('#clearAcceptResultsBtn', 'click', () => {
            this.foundItems = [];
            this.buildAcceptStockTable();
        });

        // Модальное окно принятия на склад
        safeAdd('#acceptStockBtnFooter', 'click', () => {
            this.acceptAllItems();
        });

        safeAdd('#closeAcceptModal', 'click', () => {
            this.closeAcceptStockModal();
        });

        safeAdd('#acceptStockModal .btn-modal-close', 'click', () => {
            this.closeAcceptStockModal();
        });

        safeAdd('#acceptStockModal', 'click', (e) => {
            if (e.target.classList.contains('warehouse-modal-overlay')) {
                this.closeAcceptStockModal();
            }
        });

        // Модальное окно поиска по ШК
        safeAdd('#shkSearchInput', 'keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.shkSearch();
            }
        });

        safeAdd('#shkAddSelectedBtn', 'click', () => {
            this.addShkSelected();
        });

        safeAdd('#shkCancelBtn', 'click', () => {
            this.closeShkSearchModal();
        });

        safeAdd('#shkSearchModal .btn-modal-close', 'click', () => {
            this.closeShkSearchModal();
        });

        safeAdd('#shkSearchModal', 'click', (e) => {
            if (e.target.classList.contains('warehouse-modal-overlay')) {
                this.closeShkSearchModal();
            }
        });

        // Модальное окно "Без ШК"
        safeAdd('#manualAddBtn', 'click', () => {
            const kod = document.getElementById('manualKod').value.trim();
            const art = document.getElementById('manualArt').value.trim();
            const qty = parseInt(document.getElementById('manualQty').value);
            const unit = document.getElementById('manualUnit').value.trim();

            if (!art) {
                alert('Введите артикул');
                return;
            }

            if (!qty || qty <= 0) {
                alert('Введите количество больше 0');
                return;
            }

            // Добавляем в foundItems — НЕ заменяем существующие
            this.foundItems.push({ kod, art, kolich: qty, unit: unit || 'шт' });
            this.showAcceptResult(kod, art, qty, unit);
            document.getElementById('acceptResults').style.display = 'block';

            // Очищаем поля формы, но НЕ закрываем модалку — можно добавить ещё
            document.getElementById('manualKod').value = '';
            document.getElementById('manualArt').value = '';
            document.getElementById('manualQty').value = '';
            document.getElementById('manualUnit').value = '';
            document.getElementById('manualCategory').value = '';
            document.getElementById('manualKod').focus();
        });

        safeAdd('#manualCancelBtn', 'click', () => {
            document.getElementById('addWithoutShkModal').style.display = 'none';
        });

        safeAdd('#addWithoutShkModal .btn-modal-close', 'click', () => {
            document.getElementById('addWithoutShkModal').style.display = 'none';
        });

        safeAdd('#addWithoutShkModal', 'click', (e) => {
            if (e.target.classList.contains('warehouse-modal-overlay')) {
                document.getElementById('addWithoutShkModal').style.display = 'none';
            }
        });

        // Модальное окно "Не найдено"
        safeAdd('#notFoundAssignBtn', 'click', () => {
            this.assignNotFound();
        });

        safeAdd('#notFoundCancelBtn', 'click', () => {
            this.closeNotFoundModal();
        });

        safeAdd('#notFoundModal .btn-modal-close', 'click', () => {
            this.closeNotFoundModal();
        });

        safeAdd('#notFoundModal', 'click', (e) => {
            if (e.target.classList.contains('warehouse-modal-overlay')) {
                this.closeNotFoundModal();
            }
        });

        // Поиск
        safeAdd('#searchInput', 'input', () => {
            this.filterTable();
        });

        // =========================================
        // СОБЫТИЯ КНОПКИ "ЗАДАЧИ"
        // =========================================
        safeAdd('#tasksBtn', 'click', () => {
            this.openTasksModal();
        });

        safeAdd('#closeTasksBtn', 'click', () => {
            this.closeTasksModal();
        });

        safeAdd('#tasksModal .btn-modal-close', 'click', () => {
            this.closeTasksModal();
        });

        safeAdd('#tasksModal', 'click', (e) => {
            if (e.target.classList.contains('warehouse-modal-overlay')) {
                this.closeTasksModal();
            }
        });

        // Вкладки
        document.querySelectorAll('.task-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.getAttribute('data-tab');
                this.switchTaskTab(tab);
            });
        });

        // Кнопка "Добавить задачу" — добавляем во "Внутрицех"
        safeAdd('#tasksAddBtn', 'click', () => {
            // Переключаемся на вкладку "Внутрицех"
            this.tasksActiveTab = 'vnutriceh';
            document.querySelectorAll('.task-tab').forEach(btn => {
                btn.classList.toggle('active', btn.getAttribute('data-tab') === 'vnutriceh');
            });
            document.getElementById('tasksAddInline').style.display = 'flex';
            document.getElementById('tasksAddBtn').style.display = 'none';
            document.getElementById('tasksAddInput').value = '';
            document.getElementById('tasksAddInput').focus();
        });

        // Отмена добавления
        safeAdd('#tasksAddCancel', 'click', () => {
            document.getElementById('tasksAddInline').style.display = 'none';
            document.getElementById('tasksAddBtn').style.display = 'inline-flex';
        });

        // Подтверждение добавления
        safeAdd('#tasksAddConfirm', 'click', () => {
            const input = document.getElementById('tasksAddInput');
            const text = input.value.trim();
            if (text) {
                this.addCustomTask(text);
                document.getElementById('tasksAddInline').style.display = 'none';
                document.getElementById('tasksAddBtn').style.display = 'inline-flex';
            }
        });

        // Enter в поле ввода
        safeAdd('#tasksAddInput', 'keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const text = document.getElementById('tasksAddInput').value.trim();
                if (text) {
                    this.addCustomTask(text);
                    document.getElementById('tasksAddInline').style.display = 'none';
                    document.getElementById('tasksAddBtn').style.display = 'inline-flex';
                }
            } else if (e.key === 'Escape') {
                document.getElementById('tasksAddInline').style.display = 'none';
                document.getElementById('tasksAddBtn').style.display = 'inline-flex';
            }
        });

        // Кнопка "Заказы"
        safeAdd('#ordersBtn', 'click', () => {
            this.openOrdersModal();
        });

        // Кнопка "Все черновики"
        safeAdd('#showAllDraftsBtn', 'click', () => {
            this.openAllDraftsModal();
        });

        // Закрыть модалку всех черновиков
        safeAdd('#closeAllDraftsBtn', 'click', () => {
            this.closeAllDraftsModal();
        });

        safeAdd('#allDraftsModal .btn-modal-close', 'click', () => {
            this.closeAllDraftsModal();
        });

        safeAdd('#allDraftsModal', 'click', (e) => {
            if (e.target.classList.contains('warehouse-modal-overlay')) {
                this.closeAllDraftsModal();
            }
        });

        // Сохранить черновик
        safeAdd('#saveDraftBtn', 'click', () => {
            this.saveEditDraft();
        });

        // Отмена редактирования черновика
        safeAdd('#cancelEditDraftBtn', 'click', () => {
            this.closeEditDraftModal();
        });
        
        // Кнопка "Создать заказ" из черновика/плана
        safeAdd('#createOrderFromDraftBtn', 'click', () => {
            this.createOrderFromNommer(this.currentEditDraftNomer, this.currentEditDraftStatus);
        });
        
        // Кнопка "Удалить всё"
        safeAdd('#deleteAllBtn', 'click', () => {
            this.deleteAllEntries(this.currentEditDraftNomer, this.currentEditDraftStatus);
        });
        
        // Кнопка "Сохранить"
        safeAdd('#saveDraftBtn', 'click', () => {
            this.saveEditDraft();
        });

        // Закрытие модалки редактирования черновика по крестику
        safeAdd('#editDraftModal .btn-modal-close', 'click', () => {
            this.closeEditDraftModal();
        });

        safeAdd('#editDraftModal', 'click', (e) => {
            if (e.target.classList.contains('warehouse-modal-overlay')) {
                this.closeEditDraftModal();
            }
        });

        // Закрыть список заказов
        safeAdd('#closeOrdersBtn', 'click', () => {
            this.closeOrdersModal();
        });

        safeAdd('#ordersModal .btn-modal-close', 'click', () => {
            this.closeOrdersModal();
        });

        safeAdd('#ordersModal', 'click', (e) => {
            if (e.target.classList.contains('warehouse-modal-overlay')) {
                this.closeOrdersModal();
            }
        });

        // Кнопка "Создать заказ" → перейти на страницу заказов
        safeAdd('#createOrderBtn', 'click', () => {
            this.saveAllPlanAndGo();
        });

        // Кнопка "Очистить план"
        safeAdd('#clearPlanBtn', 'click', () => {
            this.clearPlan();
        });

        // Кнопка "Все заказы" → перейти на страницу заказов
        safeAdd('#showAllOrdersFromCreateBtn', 'click', () => {
            window.location.href = 'orders.html';
        });

        // Кнопка "План на сегодня" → перейти на страницу заказов
        safeAdd('#showTodayPlanBtn', 'click', () => {
            window.location.href = 'orders.html';
        });

        // Сохранить заказ (пока не используется, оставлю на всякий случай)
        safeAdd('#saveOrderBtn', 'click', () => {
            this.saveOrder();
        });

        // Сохранить как черновик (пока не используется)
        safeAdd('#saveAsDraftBtn', 'click', () => {
            this.saveAsDraft();
        });

        // Закрытие полноэкранного просмотра
        safeAdd('#imageFullview', 'click', () => {
            document.getElementById('imageFullview').classList.remove('active');
        });

        // === МАССОВАЯ ЗАГРУЗКА ===
        safeAdd('#closeMassUploadX', 'click', () => {
            this.closeMassUploadModal();
        });

        safeAdd('#massUploadModal', 'click', (e) => {
            if (e.target.classList.contains('warehouse-modal-overlay')) {
                this.closeMassUploadModal();
            }
        });
    },

    // ============================================================
    // ПЕРЕСЧЁТ ДОСТУПНОСТИ ИЗ РЕЗЕРВА (для loadData)
    // ============================================================
    async recalcAvailableFromReserve() {
        const dataLines = this.currentData?.dataLines;
        const headers = this.currentData?.headers;
        if (!dataLines || !headers) return;

        // Находим оптовики в таблице
        const optKodsInTable = new Set();
        for (let i = 1; i < dataLines.length; i++) {
            const values = dataLines[i].split('\t');
            const kod = values[headers.indexOf('kod')] || '';
            if (!kod) continue;
            const optIndex = headers.indexOf('opt');
            const optValue = optIndex >= 0 ? values[optIndex]?.trim() : '';
            if (optValue === 'Сборка') {
                optKodsInTable.add(kod);
            }
        }

        // Пересчитываем доступные остатки для оптовиков
        if (optKodsInTable.size > 0) {
            const optKodList = Array.from(optKodsInTable).map(k => `'${k.replace(/'/g, "''")}'`).join(',');
            const result = await this.query(
                `SELECT "kod", "kod2", "koli" FROM "sostav" WHERE "kod" IN (${optKodList})`
            );

            if (result?.trim()) {
                const sastavLines = result.trim().split('\n').filter(l => l);
                const sastavHeaders = sastavLines[0].split('\t').map(h => h.trim().toLowerCase());
                const optIdx = sastavHeaders.indexOf('kod');
                const compIdx = sastavHeaders.indexOf('kod2');
                const koliIdx = sastavHeaders.indexOf('koli');

                const sastavByOpt = {};
                for (let i = 1; i < sastavLines.length; i++) {
                    const parts = sastavLines[i].split('\t');
                    const optKod = optIdx >= 0 ? parts[optIdx]?.trim() : '';
                    const compKod = compIdx >= 0 ? parts[compIdx]?.trim() : '';
                    const koli = koliIdx >= 0 ? parseInt(parts[koliIdx]) || 1 : 1;

                    if (optKod && compKod) {
                        if (!sastavByOpt[optKod]) sastavByOpt[optKod] = [];
                        sastavByOpt[optKod].push({ kod2: compKod, koli });
                    }
                }

                for (const optKod of optKodsInTable) {
                    const components = sastavByOpt[optKod] || [];
                    if (components.length === 0) {
                        this.availableData[optKod] = 0;
                        continue;
                    }

                    let minAvail = Infinity;
                    for (const comp of components) {
                        const compTotal = this.warehouseCache?.[comp.kod2] || 0;
                        const compReserve = this.reserveData[comp.kod2] || 0;
                        const compAvailable = compTotal - compReserve;
                        const optAvail = compAvailable / comp.koli;
                        if (optAvail < minAvail) minAvail = optAvail;
                    }

                    const ownTotal = this.assembledWarehouse?.[optKod] || 0;
                    const ownReserve = this.reserveData[optKod] || 0;
                    const ownAvailable = ownTotal - ownReserve;
                    if (ownAvailable < minAvail) minAvail = ownAvailable;

                    this.availableData[optKod] = Math.floor(minAvail);
                }
            }
        }

        console.log(`[recalcAvailableFromReserve] availableData обновлён:`, this.availableData);
    },

    // ============================================================
    // ОЧИСТКА ПЛАНА
    // ============================================================
    async clearPlan() {
        const userId = localStorage.getItem('userId') || '';
        const userName = localStorage.getItem('userName') || userId;
        if (!confirm('Очистить мои планы?')) return;

        try {
            // Удаляем все записи status=1 и status=2 текущего пользователя (по ФИО — так же, как при INSERT)
            await this.query(
                `DELETE FROM "zakaz" WHERE "user"='${userName.replace(/'/g, "''")}' AND "status" IN (1, 2)`
            );
            this.clearCurrentNomer(); // Сбрасываем сессию
            alert('✅ Мои планы очищены');
            await this.loadReserve();
            await this.loadData();
        } catch (e) {
            console.error('Ошибка очистки планов:', e);
            alert('❌ Ошибка: ' + e.message);
        }
    },

    // ============================================================
    // ПЕРЕЙТИ НА СТРАНИЦУ ЗАКАЗОВ (с сохранением всех полей "План")
    // ============================================================
    async acquireLock(kod) {
        while (this.planSaveMutex[kod]) {
            console.log(`[lock] Ожидание замка для kod=${kod}`);
            await new Promise(r => setTimeout(r, 50));
        }
        this.planSaveMutex[kod] = true;
    },

    releaseLock(kod) {
        delete this.planSaveMutex[kod];
    },

    async saveAllPlanAndGo() {
        console.log('[plan] >>>>>>>>>> saveAllPlanAndGo');

        // Показываем модалку загрузки
        const loadingModal = document.getElementById('loadingModal');
        if (loadingModal) loadingModal.style.display = 'flex';

        // Ждём завершения всех pending blur (фокус может быть на одном из полей ввода)
        if (this.pendingBlurPromises.length > 0) {
            console.log(`[plan] Ждём завершения ${this.pendingBlurPromises.length} pending blur...`);
            await Promise.all(this.pendingBlurPromises);
            console.log('[plan] Все pending blur завершены');
            this.pendingBlurPromises = [];
        }

        // === Принудительно перезагружаем резерв из БД и пересчитываем «Доступно» ===
        console.log('[plan] Принудительный пересчёт резерва перед созданием заказа...');
        await this.loadReserve();
        await this.recalcAllOptAvail();
        // Пересчитываем доступное для ВСЕХ товаров (не только оптовиков)
        const dataLines = this.currentData?.dataLines;
        const headers = this.currentData?.headers;
        if (dataLines && headers) {
            for (let i = 1; i < dataLines.length; i++) {
                const values = dataLines[i].split('\t');
                const kod = values[headers.indexOf('kod')] || '';
                if (!kod) continue;
                const totalWh = this.assembledWarehouse?.[kod] || this.warehouseCache?.[kod] || 0;
                const reserve = this.reserveData[kod] || 0;
                this.availableData[kod] = totalWh - reserve;
            }
            console.log('[plan] availableData пересчитан:', this.availableData);
        }
        // === Конец пересчёта ===

        // === ПРОВЕРКА: товары с отрицательным «Доступно» и заполненным планом ===
        const planInputs = document.querySelectorAll('input[data-field="plan"]');
        const negativePlanItems = [];

        for (const input of planInputs) {
            const kod = input.getAttribute('data-kod');
            const planQty = parseInt(input.value) || 0;

            if (planQty > 0) {
                const available = this.availableData[kod] ?? 0;
                if (available < 0) {
                    // Получаем артикул и название из строки таблицы
                    const row = input.closest('tr');
                    const cells = row?.querySelectorAll('td');
                    let art = '';
                    let name = '';
                    // Ищем колонки по порядку: Kod, Art, Name и т.д.
                    const headersRow = document.querySelector('.warehouse-table thead tr');
                    const headerCells = headersRow?.querySelectorAll('th') || [];
                    const headerCellsVisible = Array.from(headerCells).map(th => th.getAttribute('data-column'));

                    const artIdx = headerCellsVisible.indexOf('art');
                    const nameIdx = headerCellsVisible.indexOf('name');
                    if (artIdx >= 0 && cells[artIdx]) art = cells[artIdx].textContent.trim();
                    if (nameIdx >= 0 && cells[nameIdx]) name = cells[nameIdx].textContent.trim();

                    negativePlanItems.push({
                        kod,
                        art: art || kod,
                        name,
                        available,
                        plan: planQty
                    });
                }
            }
        }

        if (negativePlanItems.length > 0) {
            const msg = negativePlanItems
                .map(i => `❌ ${i.art} (${i.name || i.kod}): Доступно = ${i.available}, План = ${i.plan}`)
                .join('\n');

            alert(
                `⛔ Нельзя создать заказ!\n\n` +
                `${negativePlanItems.length} товаров с отрицательным «Доступно» имеют заполненный План:\n\n` +
                msg +
                '\n\nУменьшите план для указанных позиций или дождитесь поступления товара на склад.'
            );

            console.warn('[plan] Создание заказа заблокировано: отрицательный остаток', negativePlanItems);
            if (loadingModal) loadingModal.style.display = 'none';
            return;
        }
        // === Конец проверки ===

        // Очищаем поля «План» перед переходом на страницу заказов
        const planClearInputs = document.querySelectorAll('input[data-field="plan"]');
        planClearInputs.forEach((input) => {
            input.value = '';
        });

        // Переходим на страницу заказов
        window.location.href = 'orders.html';
    },

    // ============================================================
    // ЗАКАЗЫ (ЧЕРНОВИКИ И ЗАКАЗЫ)
    // ============================================================
    currentEditDraftNomer: null,
    currentEditDraftStatus: null,
    isOrdersLoading: false,
    isAllDraftsLoading: false,

    async openOrdersModal() {
        // Если уже открыта или загружается — игнорируем
        if (this.isOrdersLoading) return;

        const ordersModal = document.getElementById('ordersModal');
        if (ordersModal.style.display === 'flex') return;

        this.isOrdersLoading = true;

        const userId = localStorage.getItem('userId') || '';

        // Загружаем заказы (status=3)
        const ordersResult = await this.query(
            `SELECT DISTINCT "nomer", "user", "data", "time" FROM "zakaz" WHERE "status"=3 ORDER BY "data" DESC, "time" DESC`
        );
        
        // Загружаем черновики (status=4)
        const draftsResult = await this.query(
            `SELECT DISTINCT "nomer", "user", "data", "time", "status" FROM "zakaz" WHERE "status"=4 ORDER BY "data" DESC, "time" DESC`
        );
        
        // Загружаем планы на сегодня (status=1,2)
        const plansResult = await this.query(
            `SELECT DISTINCT "nomer", "user", "data", "time", "status" FROM "zakaz" WHERE "status" IN (1, 2) ORDER BY "data" DESC, "time" DESC`
        );

        const plansLines = plansResult?.trim().split('\n').filter(l => l);

        // === РЕНДЕР ЗАКАЗОВ (status=3) ===
        const ordersTbody = document.getElementById('ordersListBody');
        ordersTbody.innerHTML = '';

        // Собираем всех уникальных пользователей для подгрузки имён
        const allUsers = new Set();
        if (ordersResult?.trim()) {
            const lines = ordersResult.trim().split('\n').filter(l => l);
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split('\t');
                const user = parts[1]?.trim();
                if (user) allUsers.add(user);
            }
        }
        if (draftsResult?.trim()) {
            const lines = draftsResult.trim().split('\n').filter(l => l);
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split('\t');
                const user = parts[1]?.trim();
                if (user) allUsers.add(user);
            }
        }
        if (plansLines?.length > 1) {
            for (let i = 1; i < plansLines.length; i++) {
                const parts = plansLines[i].split('\t');
                const user = parts[1]?.trim();
                if (user) allUsers.add(user);
            }
        }

        // Загружаем имена пользователей
        const userNames = {};
        if (allUsers.size > 0) {
            const userList = Array.from(allUsers).map(u => `'${u.replace(/'/g, "''")}'`).join(',');
            const nameResult = await this.query(`SELECT "ID", "name" FROM "sotrud" WHERE "ID" IN (${userList})`);
            if (nameResult?.trim()) {
                const nameLines = nameResult.trim().split('\n').filter(l => l);
                for (let i = 1; i < nameLines.length; i++) {
                    const parts = nameLines[i].split('\t');
                    const id = parts[0]?.trim();
                    const name = parts[1]?.trim();
                    if (id && name) userNames[id] = name;
                }
            }
        }

        const ordersLines = ordersResult?.trim().split('\n').filter(l => l);
        if (ordersLines?.length > 1) {
            const ordersHeaders = ordersLines[0].split('\t').map(h => h.trim().toLowerCase());
            const ordersNomerIdx = ordersHeaders.indexOf('nomer');
            const ordersUserIdx = ordersHeaders.indexOf('user');
            const ordersDataIdx = ordersHeaders.indexOf('data');
            const ordersTimeIdx = ordersHeaders.indexOf('time');

            for (let i = 1; i < ordersLines.length; i++) {
                const parts = ordersLines[i].split('\t');
                const nomer = ordersNomerIdx >= 0 ? parts[ordersNomerIdx]?.trim() : '';
                const user = ordersUserIdx >= 0 ? parts[ordersUserIdx]?.trim() : '';
                const data = ordersDataIdx >= 0 ? parts[ordersDataIdx]?.trim() : '';
                const time = ordersTimeIdx >= 0 ? parts[ordersTimeIdx]?.trim() : '';

                if (!nomer) continue;

                const userName = userNames[user] || user || '—';
                const dateStr = data ? new Date(data + ' ' + time).toLocaleString('ru-RU') : '—';
                const nomerJs = this.escapeJs(nomer);

                ordersTbody.innerHTML += `<tr class="order-row" data-nomer="${this.escapeHtml(nomer)}" style="cursor:pointer;" onclick="WAREHOUSE.openViewDraftModal('${nomerJs}', 3)">
                    <td><span style="color:#27ae60; font-weight:bold;">✅ Заказ</span></td>
                    <td><strong>${this.escapeHtml(nomer)}</strong></td>
                    <td>${this.escapeHtml(dateStr)}</td>
                    <td>${this.escapeHtml(userName)}</td>
                    <td style="text-align:center; white-space:nowrap;">
                        <span style="color:#666;">👁️</span>
                    </td>
                </tr>`;
            }
        }
        
        // === РЕНДЕР ЧЕРНОВИКОВ (status=4) ===
        const draftsLines = draftsResult?.trim().split('\n').filter(l => l);
        if (draftsLines?.length > 1) {
            const draftsHeaders = draftsLines[0].split('\t').map(h => h.trim().toLowerCase());
            const draftsNomerIdx = draftsHeaders.indexOf('nomer');
            const draftsUserIdx = draftsHeaders.indexOf('user');
            const draftsDataIdx = draftsHeaders.indexOf('data');
            const draftsTimeIdx = draftsHeaders.indexOf('time');

            for (let i = 1; i < draftsLines.length; i++) {
                const parts = draftsLines[i].split('\t');
                const nomer = draftsNomerIdx >= 0 ? parts[draftsNomerIdx]?.trim() : '';
                const user = draftsUserIdx >= 0 ? parts[draftsUserIdx]?.trim() : '';
                const data = draftsDataIdx >= 0 ? parts[draftsDataIdx]?.trim() : '';
                const time = draftsTimeIdx >= 0 ? parts[draftsTimeIdx]?.trim() : '';

                if (!nomer) continue;

                const userName = userNames[user] || user || '—';
                const dateStr = data ? new Date(data + ' ' + time).toLocaleString('ru-RU') : '—';
                const nomerJs = this.escapeJs(nomer);

                ordersTbody.innerHTML += `<tr class="order-row" data-nomer="${this.escapeHtml(nomer)}" style="cursor:pointer;" onclick="WAREHOUSE.openViewDraftModal('${nomerJs}', 4)">
                    <td><span style="color:#f39c12; font-weight:bold;">📝 Черновик</span></td>
                    <td><strong>${this.escapeHtml(nomer)}</strong></td>
                    <td>${this.escapeHtml(dateStr)}</td>
                    <td>${this.escapeHtml(userName)}</td>
                    <td style="text-align:center; white-space:nowrap;">
                        <button class="btn-create-order-btn" onclick="event.stopPropagation(); WAREHOUSE.createOrderFromNommer('${nomerJs}', 4)" title="Создать из черновика">📦</button>
                    </td>
                </tr>`;
            }
        }
        
        // === РЕНДЕР ПЛАНОВ НА СЕГОДНЯ (status=1,2) ===
        if (plansLines?.length > 1) {
            const plansHeaders = plansLines[0].split('\t').map(h => h.trim().toLowerCase());
            const plansNomerIdx = plansHeaders.indexOf('nomer');
            const plansUserIdx = plansHeaders.indexOf('user');
            const plansDataIdx = plansHeaders.indexOf('data');
            const plansTimeIdx = plansHeaders.indexOf('time');
            const plansStatusIdx = plansHeaders.indexOf('status');

            for (let i = 1; i < plansLines.length; i++) {
                const parts = plansLines[i].split('\t');
                const nomer = plansNomerIdx >= 0 ? parts[plansNomerIdx]?.trim() : '';
                const user = plansUserIdx >= 0 ? parts[plansUserIdx]?.trim() : '';
                const data = plansDataIdx >= 0 ? parts[plansDataIdx]?.trim() : '';
                const time = plansTimeIdx >= 0 ? parts[plansTimeIdx]?.trim() : '';
                const status = plansStatusIdx >= 0 ? parseInt(parts[plansStatusIdx]?.trim()) : 1;

                if (!nomer) continue;

                const userName = userNames[user] || user || '—';
                const dateStr = data ? new Date(data + ' ' + time).toLocaleString('ru-RU') : '—';
                const nomerJs = this.escapeJs(nomer);

                ordersTbody.innerHTML += `<tr class="order-row" data-nomer="${this.escapeHtml(nomer)}" style="cursor:pointer;" onclick="WAREHOUSE.openViewDraftModal('${nomerJs}', ${status})">
                    <td><span style="color:#3498db; font-weight:bold;">📋 План на сегодня</span></td>
                    <td><strong>${this.escapeHtml(nomer)}</strong></td>
                    <td>${this.escapeHtml(dateStr)}</td>
                    <td>${this.escapeHtml(userName)}</td>
                    <td style="text-align:center; white-space:nowrap;">
                        <button class="btn-create-order-btn" onclick="event.stopPropagation(); WAREHOUSE.createOrderFromNommer('${nomerJs}', ${status})" title="Создать этот заказ">📦</button>
                    </td>
                </tr>`;
            }
        }

        if (ordersTbody.innerHTML.trim() === '') {
            document.getElementById('ordersEmptyMsg').style.display = 'block';
            ordersTbody.closest('table').style.display = 'none';
        } else {
            document.getElementById('ordersEmptyMsg').style.display = 'none';
            ordersTbody.closest('table').style.display = '';
        }

        document.getElementById('ordersModal').style.display = 'flex';
        this.isOrdersLoading = false;
    },

    closeOrdersModal() {
        document.getElementById('ordersModal').style.display = 'none';
    },

    async openAllDraftsModal() {
        // Если уже загружается — игнорируем
        if (this.isAllDraftsLoading) return;
        
        const allDraftsModal = document.getElementById('allDraftsModal');
        if (allDraftsModal.style.display === 'flex') return;

        this.isAllDraftsLoading = true;

        const tbody = document.getElementById('allDraftsListBody');
        const emptyMsg = document.getElementById('allDraftsEmptyMsg');
        tbody.innerHTML = '';

        const userId = localStorage.getItem('userId') || '';

        // Загружаем все черновики (статус 1, 2, 4)
        const result = await this.query(
            `SELECT DISTINCT "nomer", "user", "data", "time", "status" FROM "zakaz" WHERE "status" IN (1, 2, 4) ORDER BY "data" DESC, "time" DESC`
        );

        if (!result || !result.trim()) {
            emptyMsg.style.display = 'block';
            document.getElementById('allDraftsListBody').closest('table').style.display = 'none';
            return;
        }

        const lines = result.trim().split('\n').filter(l => l);
        const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
        const nomerIdx = headers.indexOf('nomer');
        const userIdx = headers.indexOf('user');
        const dataIdx = headers.indexOf('data');
        const timeIdx = headers.indexOf('time');
        const statusIdx = headers.indexOf('status');

        if (lines.length <= 1) {
            emptyMsg.style.display = 'block';
            document.getElementById('allDraftsListBody').closest('table').style.display = 'none';
            return;
        }

        document.getElementById('allDraftsListBody').closest('table').style.display = '';

        // Загружаем имена пользователей
        const userNames = {};
        const userNamesSet = new Set();
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split('\t');
            const user = userIdx >= 0 ? parts[userIdx]?.trim() : '';
            if (user) userNamesSet.add(user);
        }

        if (userNamesSet.size > 0) {
            const userList = Array.from(userNamesSet).map(u => `'${u.replace(/'/g, "''")}'`).join(',');
            const nameResult = await this.query(`SELECT "ID", "name" FROM "sotrud" WHERE "ID" IN (${userList})`);
            if (nameResult?.trim()) {
                const nameLines = nameResult.trim().split('\n').filter(l => l);
                for (let i = 1; i < nameLines.length; i++) {
                    const parts = nameLines[i].split('\t');
                    const id = parts[0]?.trim();
                    const name = parts[1]?.trim();
                    if (id && name) userNames[id] = name;
                }
            }
        }

        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split('\t');
            const nomer = nomerIdx >= 0 ? parts[nomerIdx]?.trim() : '';
            const user = userIdx >= 0 ? parts[userIdx]?.trim() : '';
            const data = dataIdx >= 0 ? parts[dataIdx]?.trim() : '';
            const time = timeIdx >= 0 ? parts[timeIdx]?.trim() : '';
            const status = statusIdx >= 0 ? parseInt(parts[statusIdx]?.trim()) : 1;

            if (!nomer) continue;

            const userName = userNames[user] || user || '—';
            const dateStr = data ? new Date(data + ' ' + time).toLocaleString('ru-RU') : '—';

            // Кнопки только для своего черновика
            const isOwn = user === userId;
            const nomerJs = this.escapeJs(nomer);

            tbody.innerHTML += `<tr class="order-row" data-nomer="${this.escapeHtml(nomer)}" style="cursor:pointer;" title="${isOwn ? 'Нажмите для редактирования' : 'Нажмите для просмотра'}" onclick="WAREHOUSE.openViewDraftModal('${nomerJs}', ${status})">
                <td><strong>${this.escapeHtml(nomer)}</strong></td>
                <td>${this.escapeHtml(dateStr)}</td>
                <td>${this.escapeHtml(userName)}</td>
                <td style="text-align:center; white-space:nowrap;">
                    ${isOwn ? `<span onclick="event.stopPropagation(); WAREHOUSE.deleteOrder('${nomerJs}', ${status})" style="cursor:pointer; color:#ff9696; font-size:1.1rem;" title="Удалить">🗑️</span>` : '<span style="color:#666;">👁️</span>'}
                </td>
            </tr>`;
        }

        emptyMsg.style.display = 'none';
        document.getElementById('allDraftsModal').style.display = 'flex';
        this.isAllDraftsLoading = false;
    },

    closeAllDraftsModal() {
        document.getElementById('allDraftsModal').style.display = 'none';
    },

    async deleteOrder(nomer, status) {
        if (!confirm(`Удалить ${status === 3 ? 'заказ' : 'черновик'} ${nomer}?`)) return;

        try {
            await this.query(
                `DELETE FROM "zakaz" WHERE "nomer"='${nomer.replace(/'/g, "''")}' AND "status" IN (1, 2, 3, 4)`
            );
            alert('✅ Удалено');

            // Закрываем модалку просмотра/редактирования, если она открыта
            const editModal = document.getElementById('editDraftModal');
            if (editModal.style.display === 'flex') {
                editModal.style.display = 'none';
            }

            // Перезагружаем список заказов
            this.openOrdersModal();
        } catch (e) {
            console.error('Ошибка удаления:', e);
            alert('❌ Ошибка удаления: ' + e.message);
        }
    },

    async openEditDraftModal(nomer) {
        this.currentEditDraftNomer = nomer;
        document.getElementById('editDraftNomer').textContent = `[${nomer}]`;

        const tbody = document.getElementById('editDraftItemsBody');
        const emptyMsg = document.getElementById('editDraftEmptyMsg');
        tbody.innerHTML = '';

        // Собираем уникальные kod и сумму koli
        const result = await this.query(
            `SELECT "kod", SUM("koli") as "total" FROM "zakaz" WHERE "nomer"='${nomer.replace(/'/g, "''")}' AND "status" IN (1, 2, 4) GROUP BY "kod"`
        );

        if (!result || !result.trim()) {
            emptyMsg.style.display = 'block';
            document.getElementById('editDraftItemsBody').closest('table').style.display = 'none';
            return;
        }

        const lines = result.trim().split('\n').filter(l => l);
        const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
        const kodIdx = headers.indexOf('kod');
        const totalIdx = headers.findIndex(h => h.includes('total') || h === 'sum');

        if (lines.length <= 1) {
            emptyMsg.style.display = 'block';
            document.getElementById('editDraftItemsBody').closest('table').style.display = 'none';
            return;
        }

        document.getElementById('editDraftItemsBody').closest('table').style.display = '';
        emptyMsg.style.display = 'none';

        // Собираем kod для загрузки артикулов
        const kodList = [];
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split('\t');
            const kod = kodIdx >= 0 ? parts[kodIdx]?.trim() : '';
            if (kod) kodList.push(kod);
        }

        let artResult = {};
        if (kodList.length > 0) {
            const kodListQuoted = kodList.map(k => `'${k.replace(/'/g, "''")}'`).join(',');
            const artResult2 = await this.query(
                `SELECT "kod", "art" FROM "guide" WHERE "kod" IN (${kodListQuoted})`
            );
            if (artResult2?.trim()) {
                const artLines = artResult2.trim().split('\n').filter(l => l);
                const artHeaders = artLines[0].split('\t').map(h => h.trim().toLowerCase());
                const artKodIdx = artHeaders.indexOf('kod');
                const artIdx = artHeaders.indexOf('art');
                for (let i = 1; i < artLines.length; i++) {
                    const parts = artLines[i].split('\t');
                    const k = artKodIdx >= 0 ? parts[artKodIdx]?.trim() : '';
                    const a = artIdx >= 0 ? parts[artIdx]?.trim() : '';
                    if (k) artResult[k] = a || '—';
                }
            }
        }

        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split('\t');
            const kod = kodIdx >= 0 ? parts[kodIdx]?.trim() : '';
            const koli = totalIdx >= 0 ? parts[totalIdx]?.trim() : '0';
            if (!kod) continue;

            const art = artResult[kod] || '—';

            const kodJs = this.escapeJs(kod);
            tbody.innerHTML += `<tr data-kod="${this.escapeHtml(kod)}">
                <td>${this.escapeHtml(kod)}</td>
                <td>${this.escapeHtml(art)}</td>
                <td style="padding:4px;">
                    <input type="number" class="draft-qty-input" data-kod="${this.escapeHtml(kod)}" value="${this.escapeHtml(koli)}" style="width:100px; padding:6px; background:rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.1); border-radius:6px; color:#ffffff; font-size:16px;" min="0">
                </td>
                <td style="text-align:center;">
                    <button class="btn btn-ghost btn-small" onclick="WAREHOUSE.deleteDraftItem('${kodJs}')" style="color:#e74c3c;" title="Удалить строку">✕</button>
                </td>
            </tr>`;
        }

        document.getElementById('editDraftModal').style.display = 'flex';
    },

    closeEditDraftModal() {
        document.getElementById('editDraftModal').style.display = 'none';
        this.currentEditDraftNomer = null;
        this.currentEditDraftStatus = null;
        // Восстанавливаем состояние кнопок
        const saveBtn = document.getElementById('saveDraftBtn');
        const deleteAllBtn = document.getElementById('deleteAllBtn');
        const cancelBtn = document.getElementById('cancelEditDraftBtn');
        if (saveBtn) saveBtn.style.display = 'none';
        if (deleteAllBtn) deleteAllBtn.style.display = 'none';
        if (cancelBtn) cancelBtn.textContent = 'Отмена';
        // Обновляем колонку резерв
        this.loadReserve().then(() => {
            this.updateReserveColumn();
        });
    },

    updateReserveColumn() {
        const container = document.getElementById('warehouseTableContainer');
        if (!container) return;

        const reserveCells = container.querySelectorAll('td[data-field="reserve"]');
        reserveCells.forEach(cell => {
            const row = cell.closest('tr');
            const kod = row?.getAttribute('data-kod');
            if (!kod) return;

            const reserveVal = this.reserveData[kod] || 0;
            cell.textContent = reserveVal > 0 ? reserveVal : '';
        });
    },

    async openViewDraftModal(nomer, status) {
        this.currentEditDraftNomer = nomer;
        this.currentEditDraftStatus = status;
        const headerText = document.getElementById('editDraftNomer');

        const createOrderBtn = document.getElementById('createOrderFromDraftBtn');
        // Кнопка "Создать заказ" показываем для планов (1,2) и черновиков (4)
        if (status === 1 || status === 2 || status === 4) {
            createOrderBtn.style.display = '';
            createOrderBtn.textContent = '📦 Создать заказ';
        } else {
            createOrderBtn.style.display = 'none';
        }

        // Проверяем, свой ли черновик/заказ
        const userId = localStorage.getItem('userId') || '';
        const checkResult = await this.query(
            `SELECT "user" FROM "zakaz" WHERE "nomer"='${nomer.replace(/'/g, "''")}' LIMIT 1`
        );

        // Парсим результат - может быть "user\n123" или "user\t123"
        let isOwnDraft = false;
        if (checkResult && checkResult.trim()) {
            const lines = checkResult.trim().split('\n').filter(l => l);
            if (lines.length >= 2) {
                const userValue = lines[1].split('\t')[0]?.trim();
                isOwnDraft = userValue === userId;
            }
        }

        console.log('openViewDraftModal - nomer:', nomer, 'userId:', userId, 'isOwnDraft:', isOwnDraft);

        // Определяем права ДО заголовка
        const canEdit = isOwnDraft && (status === 1 || status === 2 || status === 4);

        // Устанавливаем заголовок модалки в зависимости от статуса и прав
        let statusLabel = '';
        const headerTitle = document.getElementById('editDraftHeaderTitle');
        switch (status) {
            case 1: case 2:
                statusLabel = '📋 План на сегодня';
                headerTitle.textContent = canEdit ? '✏️ Редактирование' : '👁️ Просмотр';
                break;
            case 3:
                statusLabel = '✅ Заказ';
                headerTitle.textContent = '👁️ Просмотр';
                break;
            case 4:
                statusLabel = '📝 Черновик';
                headerTitle.textContent = canEdit ? '✏️ Редактирование' : '👁️ Просмотр';
                break;
            default:
                statusLabel = '📦 Запись';
                headerTitle.textContent = canEdit ? '✏️ Редактирование' : '👁️ Просмотр';
        }

        headerText.textContent = `${statusLabel}`;

        // Загружаем данные ТОЛЬКО для текущего статуса
        const tbody = document.getElementById('editDraftItemsBody');
        const emptyMsg = document.getElementById('editDraftEmptyMsg');
        tbody.innerHTML = '';

        const result = await this.query(
            `SELECT "kod", SUM("koli") as "total" FROM "zakaz" WHERE "nomer"='${nomer.replace(/'/g, "''")}' AND "status"=${status} GROUP BY "kod"`
        );

        if (!result || !result.trim()) {
            emptyMsg.style.display = 'block';
            document.getElementById('editDraftItemsBody').closest('table').style.display = 'none';
            return;
        }

        const lines = result.trim().split('\n').filter(l => l);
        const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
        const kodIdx = headers.indexOf('kod');
        const totalIdx = headers.findIndex(h => h.includes('total') || h === 'sum');

        if (lines.length <= 1) {
            emptyMsg.style.display = 'block';
            document.getElementById('editDraftItemsBody').closest('table').style.display = 'none';
            return;
        }

        document.getElementById('editDraftItemsBody').closest('table').style.display = '';
        emptyMsg.style.display = 'none';

        // Определяем права
        const canDeleteAll = isOwnDraft; // удаляем только свои

        const saveBtn = document.getElementById('saveDraftBtn');
        const cancelBtn = document.getElementById('cancelEditDraftBtn');
        const deleteCol = document.getElementById('editDraftDeleteCol');
        const deleteAllBtn = document.getElementById('deleteAllBtn');

        // Кнопка "Сохранить" — только для редактируемых
        saveBtn.style.display = canEdit ? '' : 'none';

        // Кнопка "Удалить всё" — только для своих
        deleteAllBtn.style.display = canDeleteAll ? '' : 'none';

        if (canEdit) {
            cancelBtn.textContent = 'Отмена';
            deleteCol.textContent = '';
            deleteCol.style.display = '';
        } else {
            cancelBtn.textContent = 'Закрыть';
            deleteCol.textContent = '';
            deleteCol.style.display = 'none';
        }

        // Загружаем артикулы
        const kodList = [];
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split('\t');
            const kod = kodIdx >= 0 ? parts[kodIdx]?.trim() : '';
            if (kod) kodList.push(kod);
        }

        let artResult = {};
        if (kodList.length > 0) {
            const kodListQuoted = kodList.map(k => `'${k.replace(/'/g, "''")}'`).join(',');
            const artResult2 = await this.query(
                `SELECT "kod", "art" FROM "guide" WHERE "kod" IN (${kodListQuoted})`
            );
            if (artResult2?.trim()) {
                const artLines = artResult2.trim().split('\n').filter(l => l);
                const artHeaders = artLines[0].split('\t').map(h => h.trim().toLowerCase());
                const artKodIdx = artHeaders.indexOf('kod');
                const artIdx = artHeaders.indexOf('art');
                for (let i = 1; i < artLines.length; i++) {
                    const parts = artLines[i].split('\t');
                    const k = artKodIdx >= 0 ? parts[artKodIdx]?.trim() : '';
                    const a = artIdx >= 0 ? parts[artIdx]?.trim() : '';
                    if (k) artResult[k] = a || '—';
                }
            }
        }

        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split('\t');
            const kod = kodIdx >= 0 ? parts[kodIdx]?.trim() : '';
            const koli = totalIdx >= 0 ? parts[totalIdx]?.trim() : '0';
            if (!kod) continue;

            const art = artResult[kod] || '—';

            tbody.innerHTML += `<tr data-kod="${this.escapeHtml(kod)}">
                <td>${this.escapeHtml(kod)}</td>
                <td>${this.escapeHtml(art)}</td>
                <td style="padding:4px;">
                    <input type="number" class="draft-qty-input" data-kod="${this.escapeHtml(kod)}" value="${this.escapeHtml(koli)}" style="width:100px; padding:6px; background:${canEdit ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.1)'}; border:1px solid rgba(255,255,255,0.1); border-radius:6px; color:#ffffff; font-size:16px;" min="0" ${canEdit ? '' : 'disabled'}>
                </td>
                ${canEdit ? `<td style="text-align:center;">
                    <button class="btn btn-ghost btn-small" onclick="WAREHOUSE.deleteDraftItem('${this.escapeHtml(kod)}')" style="color:#e74c3c;" title="Удалить строку">✕</button>
                </td>` : ''}
            </tr>`;
        }

        document.getElementById('editDraftModal').style.display = 'flex';
    },

    async deleteDraftItem(kod) {
        if (!this.currentEditDraftNomer) return;
        if (!confirm(`Удалить ${kod} из записи?`)) return;

        try {
            await this.query(
                `DELETE FROM "zakaz" WHERE "nomer"='${this.currentEditDraftNomer.replace(/'/g, "''")}' AND "kod"='${kod.replace(/'/g, "''")}' AND "status"=${this.currentEditDraftStatus}`
            );
            await this.openViewDraftModal(this.currentEditDraftNomer, this.currentEditDraftStatus); // Перезагрузить
            await this.loadReserve(); // Обновить резерв
            this.updateReserveColumn();
        } catch (e) {
            console.error('Ошибка удаления товара:', e);
            alert('❌ Ошибка: ' + e.message);
        }
    },
    
    // Удалить ВСЕ записи с данным nomer и status
    async deleteAllEntries(nomer, status) {
        if (!nomer) return;
        const statusLabels = {1: 'план (оптовик)', 2: 'план', 3: 'заказ', 4: 'черновик'};
        const label = statusLabels[status] || 'запись';
        if (!confirm(`Удалить ВСЕ ${label} с номером ${nomer}?`)) return;

        try {
            await this.query(
                `DELETE FROM "zakaz" WHERE "nomer"='${nomer.replace(/'/g, "''")}' AND "status"=${status}`
            );
            alert('✅ Удалено');
            this.closeEditDraftModal();
            await this.loadReserve();
            await this.loadData();
            this.openOrdersModal(); // Обновить список
        } catch (e) {
            console.error('Ошибка удаления всех записей:', e);
            alert('❌ Ошибка удаления: ' + e.message);
        }
    },

    async saveEditDraft() {
        if (!this.currentEditDraftNomer) return;

        const container = document.getElementById('editDraftItemsBody');
        const rows = container.querySelectorAll('tr');

        try {
            // Удаляем старые записи
            await this.query(
                `DELETE FROM "zakaz" WHERE "nomer"='${this.currentEditDraftNomer.replace(/'/g, "''")}' AND "status"=${this.currentEditDraftStatus}`
            );

            // Перезаписываем с новыми значениями
            const now = new Date();
            const dataStr = now.toISOString().split('T')[0];
            const timeStr = now.toTimeString().split(' ')[0].slice(0, 5);
            const userId = localStorage.getItem('userId') || '';
            const userName = localStorage.getItem('userName') || userId;

            for (const row of rows) {
                const kod = row.getAttribute('data-kod');
                const qtyInput = row.querySelector('.draft-qty-input');
                const koli = parseInt(qtyInput?.value) || 0;

                await this.query(
                    `INSERT INTO "zakaz" ("kod", "koli", "nomer", "user", "status", "data", "time") ` +
                    `VALUES ('${kod.replace(/'/g, "''")}', ${koli}, '${this.currentEditDraftNomer.replace(/'/g, "''")}', '${userName.replace(/'/g, "''")}', ${this.currentEditDraftStatus}, '${dataStr}', '${timeStr}')`
                );
            }

            alert('✅ Сохранено');
            this.closeEditDraftModal();
            await this.loadReserve();
            await this.loadData();
            this.openOrdersModal(); // Обновить список
        } catch (e) {
            console.error('Ошибка сохранения:', e);
            alert('❌ Ошибка сохранения: ' + e.message);
        }
    },

    // ============================================================
    // СОЗДАНИЕ ЗАКАЗА ИЗ ЧЕРНОВИКА/ПЛАНА (с проверкой остатков)
    // ============================================================
    async createOrderFromNommer(nomer, oldStatus) {
        if (!nomer) return;
        console.log(`[createOrderFromNommer] nomer=${nomer}, oldStatus=${oldStatus}`);

        // 1. Загружаем все записи текущего документа
        const result = await this.query(
            `SELECT "kod", SUM("koli") as "total" FROM "zakaz" WHERE "nomer"='${nomer.replace(/'/g, "''")}' AND "status"=${oldStatus} GROUP BY "kod"`
        );

        if (!result?.trim()) {
            alert('❌ В документе нет записей');
            return;
        }

        // 2. Собираем товары документа
        const lines = result.trim().split('\n').filter(l => l);
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
            alert('❌ В документе нет товаров');
            return;
        }

        // 3. Проверка отрицательных остатков
        const kodList = items.map(i => `'${i.kod.replace(/'/g, "''")}'`).join(',');
        const kodListQuoted = items.map(i => `'${i.kod.replace(/'/g, "''")}'`).join(',');

        // Загружаем складские остатки из history (SUM quantity * prostuk)
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

        // Загружаем резерв по этим товарам (ВСЕ статусы)
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

        // Вычисляем доступное
        const availableData = {};
        for (const item of items) {
            const totalWh = warehouseCache[item.kod] || 0;
            const reserve = reserveData[item.kod] || 0;
            availableData[item.kod] = totalWh - reserve;
        }

        // Проверяем отрицательные
        const negativeItems = [];
        for (const item of items) {
            if (availableData[item.kod] < 0) {
                // Загружаем артикул и название
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
                    available: availableData[item.kod],
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

            console.warn('[createOrderFromNommer] Создание заказа заблокировано: отрицательный остаток', negativeItems);
            return;
        }

        // 4. Проверка пройдена — меняем статус на 3 (Заказ)
        try {
            await this.query(
                `UPDATE "zakaz" SET "status"=3 WHERE "nomer"='${nomer.replace(/'/g, "''")}' AND "status"=${oldStatus}`
            );

            alert('✅ Заказ создан!');

            // Закрываем модальные окна
            this.closeEditDraftModal();

            // Обновляем резерв и доступность
            await this.loadReserve();
            await this.loadData();
            await this.recalcAllOptAvail();
            this.updateAllRowsAvailability();
            this.openOrdersModal(); // Обновить список
        } catch (e) {
            console.error('Ошибка создания заказа:', e);
            alert('❌ Ошибка создания заказа: ' + e.message);
        }
    },

    // ============================================================
    // ЗАГРУЗКА ДАННЫХ
    // ============================================================
    async loadData() {
        const container = document.getElementById('warehouseTableContainer');
        container.innerHTML = '<div class="loading-message">Загрузка данных...</div>';

        try {
            // Загружаем структуру таблицы для определения типов
            const typeResult = await this.query(`SELECT sql FROM sqlite_master WHERE type='table' AND name='guide'`);
            const columnsMap = this.parseTableTypes(typeResult);
            this.columnsDef = columnsMap;

            // Загружаем данные guide (фильтр только по видимым товарам)
            const dataResult = await this.query(`SELECT * FROM "guide" WHERE "vidim" = 'ДА' LIMIT 1000`);

            // Обрабатываем пустой ответ
            if (!dataResult || !dataResult.trim()) {
                container.innerHTML = '<div class="no-data-message">Нет данных для отобрадения. Убедитесь, что сервер доступен и таблица "guide" содержит данные.</div>';
                return;
            }

            const dataLines = dataResult.trim().split('\n').filter(l => l);

            if (dataLines.length <= 1) {
                container.innerHTML = '<div class="no-data-message">Нет данных для отображения</div>';
                return;
            }

            // Загружаем картинки из IndexedDB (по kod)
            this.imageData = {};
            try {
                const db = await this.getDb();
                const images = await new Promise((resolve, reject) => {
                    const tx = db.transaction('images', 'readonly');
                    const request = tx.objectStore('images').getAll();
                    request.onsuccess = () => resolve(request.result || []);
                    request.onerror = () => reject(request.error);
                });
                this.imageData = {};
                images.forEach(item => {
                    this.imageData[item.kod] = item.data;
                });
                console.log('Загружено картинок из IndexedDB:', Object.keys(this.imageData).length);
            } catch (e) {
                console.error('Ошибка загрузки картинок:', e);
                this.imageData = {};
            }

            // Загружаем переводы
            const transResult = await this.query(`SELECT "original", "slovo" FROM "perevod"`);
            this.translations = {};
            if (transResult && transResult.trim()) {
                const lines = transResult.trim().split('\n').filter(l => l);
                for (let i = 1; i < lines.length; i++) {
                    const parts = lines[i].split('\t');
                    if (parts.length >= 2) {
                        this.translations[parts[0].trim()] = parts[1].trim();
                    }
                }
            }

            const headers = dataLines[0].split('\t').map(h => h.trim());
            // Сохраняем полные заголовки БД
            const fullDbHeaders = headers.slice();

            // === УСТАНОВИМ currentData РАНЬШЕ, чтобы recalcAvailableFromReserve мог работать ===
            this.currentData = { dataLines: dataLines, headers: headers };

            const fields = this.getFields();
            const visible = this.getVisibleColumns(fields);

            console.log('Заголовки:', headers);
            console.log('Видимые поля:', visible.map(f => f.db));
            console.log('headers.indexOf total_warehouse:', headers.indexOf('total_warehouse'));
            console.log('headers.indexOf plan:', headers.indexOf('plan'));

            // ===== ЗАГРУЗКА min/max значений =====
            this.minCache = {};
            this.maxCache = {};
            const minIndex = headers.indexOf('min');
            const maxIndex = headers.indexOf('max');
            if (minIndex >= 0 || maxIndex >= 0) {
                for (let i = 1; i < dataLines.length; i++) {
                    const values = dataLines[i].split('\t');
                    const kod = values[headers.indexOf('kod')] || '';
                    if (!kod) continue;
                    if (minIndex >= 0) this.minCache[kod] = parseFloat(values[minIndex]) || 0;
                    if (maxIndex >= 0) this.maxCache[kod] = parseFloat(values[maxIndex]) || 0;
                }
                console.log(`Загружено min/max: ${Object.keys(this.minCache).length} позиций`);
            }

            // ===== ФУНКЦИЯ ПОЛУЧЕНИЯ СТИЛЕЙ min/max =====
            const getMinMaxStyles = (kod, value) => {
                const minVal = this.minCache[kod] || 0;
                const maxVal = this.maxCache[kod] || 0;

                if (maxVal === 0) return { glowClass: '', color: '' };

                if (value < minVal) {
                    // Ниже min — оранжевый цвет, свечение
                    return { glowClass: 'glow-below-min', color: '#ff8800' };
                } else if (value <= maxVal) {
                    // В пределах min-max — зелёный цвет, свечение
                    return { glowClass: 'glow-in-range', color: '#4caf50' };
                } else {
                    // Выше max — синий цвет, свечение
                    return { glowClass: 'glow-above-max', color: '#2196f3' };
                }
            };

            // Проверяем что заголовки не пустые
            if (headers.length === 0 || (headers.length === 1 && !headers[0])) {
                container.innerHTML = '<div class="error-message">❌ Ошибка: неверный формат данных от сервера</div>';
                return;
            }

            // Собираем уникальные kod для запроса к history
            const uniqueKods = new Set();
            for (let i = 1; i < dataLines.length; i++) {
                const values = dataLines[i].split('\t');
                const kod = values[headers.indexOf('kod')] || '';
                if (kod) uniqueKods.add(kod);
            }

            // Загружаем данные из history для всех kod одним запросом
            const warehouseCache = {};
            if (uniqueKods.size > 0) {
                const kodList = Array.from(uniqueKods).map(k => `'${k.replace(/'/g, "''")}'`).join(',');
                try {
                    const historyResult = await this.query(`SELECT "kod", "quantity", "prostuk" FROM "history" WHERE "kod" IN (${kodList})`);
                    if (historyResult && historyResult.trim()) {
                        const histLines = historyResult.trim().split('\n').filter(l => l);
                        if (histLines.length > 1) {
                            const histHeaders = histLines[0].split('\t').map(h => h.trim().toLowerCase());
                            const kodIdx = histHeaders.findIndex(h => h === 'kod');
                            const qtyIdx = histHeaders.findIndex(h => h === 'quantity');
                            const prostukIdx = histHeaders.findIndex(h => h === 'prostuk');

                            for (let i = 1; i < histLines.length; i++) {
                                const histValues = histLines[i].split('\t');
                                const kod = kodIdx >= 0 ? histValues[kodIdx]?.trim() : '';
                                const qty = qtyIdx >= 0 ? parseFloat(histValues[qtyIdx]) || 0 : 0;
                                const prostuk = prostukIdx >= 0 ? parseFloat(histValues[prostukIdx]) || 0 : 0;

                                if (kod) {
                                    if (!warehouseCache[kod]) warehouseCache[kod] = 0;
                                    warehouseCache[kod] += qty * prostuk;
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error('Ошибка загрузки данных из history:', e);
                }
            }

            this.warehouseCache = warehouseCache;
            console.log('Загружено складов записей:', Object.keys(this.warehouseCache).length);

            // ============================================================
            // ВЫЧИСЛЕНИЕ КОЛИЧЕСТВА ДЛЯ ОПТОВЫХ (СБОРНЫХ) ТОВАРОВ
            // ============================================================
            const assembledWarehouse = {};

            // 1. Находим все оптовые товары (opt='Сборка')
            const optResult = await this.query(`SELECT "kod" FROM "guide" WHERE "opt"='Сборка'`);
            if (optResult && optResult.trim()) {
                const optLines = optResult.trim().split('\n').filter(l => l);

                if (optLines.length > 1) {
                    const optKods = optLines.slice(1).map(l => l.split('\t')[0]?.trim()).filter(Boolean);
                    console.log(`Найдено оптовых товаров: ${optKods.length}`);

                    // 2. Загружаем состав для всех оптовых товаров одним запросом
                    if (optKods.length > 0) {
                        const kodList = optKods.map(k => `'${k.replace(/'/g, "''")}'`).join(',');
                        const sastavResult = await this.query(`SELECT "kod", "kod2" FROM "sostav" WHERE "kod" IN (${kodList})`);

                        if (sastavResult && sastavResult.trim()) {
                            const sastavLines = sastavResult.trim().split('\n').filter(l => l);

                            // Собираем уникальные kod2 (компоненты) для проверки типа
                            const allComponentKods = new Set();
                            for (let i = 1; i < sastavLines.length; i++) {
                                const parts = sastavLines[i].split('\t');
                                const kod2 = parts[1]?.trim();
                                if (kod2) allComponentKods.add(kod2);
                            }

                            // 2a. Проверяем тип каждого компонента в guide (type='Товар')
                            const validComponentKods = new Set();
                            if (allComponentKods.size > 0) {
                                const compKodList = Array.from(allComponentKods)
                                    .map(k => `'${k.replace(/'/g, "''")}'`)
                                    .join(',');
                                const typeResult = await this.query(
                                    `SELECT "kod", "type" FROM "guide" WHERE "kod" IN (${compKodList})`
                                );
                                if (typeResult && typeResult.trim()) {
                                    const typeLines = typeResult.trim().split('\n').filter(l => l);
                                    for (let i = 1; i < typeLines.length; i++) {
                                        const parts = typeLines[i].split('\t');
                                        const k = parts[0]?.trim();
                                        const t = parts[1]?.trim();
                                        if (k && t === 'Товар') {
                                            validComponentKods.add(k);
                                        }
                                    }
                                    console.log(`Валидных компонентов (type='Товар'): ${validComponentKods.size}`);
                                }
                            }

                            // 2b. Группируем kod2 по kod и фильтруем по type='Товар'
                            const sastavMap = {};
                            for (let i = 1; i < sastavLines.length; i++) {
                                const parts = sastavLines[i].split('\t');
                                const kod = parts[0]?.trim();
                                const kod2 = parts[1]?.trim();
                                if (kod && kod2 && validComponentKods.has(kod2)) {
                                    if (!sastavMap[kod]) sastavMap[kod] = [];
                                    sastavMap[kod].push(kod2);
                                }
                            }

                            // 3. Для каждого оптового товара вычисляем минимум
                            for (const kod of optKods) {
                                const partsList = sastavMap[kod];
                                if (!partsList || partsList.length === 0) continue;

                                let minVal = Infinity;
                                let hasValue = false;

                                for (const kod2 of partsList) {
                                    const val = warehouseCache[kod2] || 0;
                                    if (val > 0) {
                                        if (val < minVal) minVal = val;
                                        hasValue = true;
                                    }
                                }

                                if (hasValue) {
                                    assembledWarehouse[kod] = Math.round(minVal);
                                    console.log(`Оптовый товар ${kod}: min=${minVal}, составных=${partsList.length}`);
                                }
                            }

                            console.log(`Вычислено оптовых товаров: ${Object.keys(assembledWarehouse).length}`);
                        }
                    }
                }
            }

            this.assembledWarehouse = assembledWarehouse;

            // Устанавливаем начальные значения available = total_warehouse - reserve
            for (let i = 1; i < dataLines.length; i++) {
                const values = dataLines[i].split('\t');
                const kod = values[headers.indexOf('kod')] || '';
                if (!kod) continue;

                let totalWh = this.assembledWarehouse?.[kod] || this.warehouseCache[kod] || 0;
                const reserve = this.reserveData[kod] || 0;
                this.availableData[kod] = Math.floor(totalWh - reserve);
            }

            // Пересчитываем доступность для оптовиков С УЧЁТОМ резерва
            await this.recalcAvailableFromReserve();
            console.log('Доступно рассчитано (вкл. оптовиков с учётом reserve):', this.availableData);

            // Загружаем type/opt для всех kod чтобы определить неактивные строки
            const allKods = dataLines.slice(1).map(l => l.split('\t')[0]?.trim()).filter(Boolean);
            const typeOptMap = {};
            if (allKods.length > 0) {
                const kodList = allKods.map(k => `'${k.replace(/'/g, "''")}'`).join(',');
                const typeResult = await this.query(`SELECT "kod", "type", "opt" FROM "guide" WHERE "kod" IN (${kodList})`);
                if (typeResult?.trim()) {
                    const typeLines = typeResult.trim().split('\n').filter(l => l);
                    for (let i = 1; i < typeLines.length; i++) {
                        const parts = typeLines[i].split('\t');
                        const k = parts[0]?.trim();
                        const t = parts[1]?.trim();
                        const o = parts[2]?.trim();
                        if (k) typeOptMap[k] = { type: t, opt: o };
                    }
                }
            }
            console.log('[Warehouse] typeOptMap:', typeOptMap);

            // Загружаем sorti для всех kod
            const sortiMap = {};
            if (allKods.length > 0) {
                const kodList = allKods.map(k => `'${k.replace(/'/g, "''")}'`).join(',');
                const sortiResult = await this.query(`SELECT "kod", "sorti" FROM "guide" WHERE "kod" IN (${kodList})`);
                if (sortiResult?.trim()) {
                    const sortiLines = sortiResult.trim().split('\n').filter(l => l);
                    for (let i = 1; i < sortiLines.length; i++) {
                        const parts = sortiLines[i].split('\t');
                        const k = parts[0]?.trim();
                        const s = parts[1]?.trim();
                        if (k) sortiMap[k] = s || '';
                    }
                }
            }
            console.log('[Warehouse] sortiMap:', sortiMap);

            // Рендерим таблицу (с учётом фильтров)
            const allRows = [];
            for (let i = 1; i < dataLines.length; i++) {
                const values = dataLines[i].split('\t');
                const rowKod = values[headers.indexOf('kod')] || '';
                allRows.push({ kod: rowKod, values, typeOpt: typeOptMap[rowKod] || {} });
            }

            // Применяем фильтр по типу
            const filteredRows = allRows.filter(row => {
                const rowTypeInfo = row.typeOpt || {};
                const rowType = rowTypeInfo.type || '';
                const maps = {
                    'Товар': 'Tov',
                    'Внутрицех': 'Vnut',
                    'Расходник': 'Rash',
                    'Упаковка': 'Upak',
                };
                const filterKey = maps[rowType];
                if (filterKey && this.typeFilter[filterKey] !== undefined) {
                    return this.typeFilter[filterKey];
                }
                return true;
            });

            // Сохраняем данные
            this.currentData = { dataLines, headers, rows: allRows, filteredRows };

            console.log(`[loadData] Всего строк: ${allRows.length}, после фильтрации: ${filteredRows.length}`);

            let html = `<table class="warehouse-table"><thead><tr>`;
            visible.forEach(col => {
                const translated = this.translations[col.db] || col.key;
                html += `<th data-column="${col.db}" class="${this.sortColumn === col.db ? (this.sortDirection === 'asc' ? 'sort-asc' : 'sort-desc') : ''}">${translated}</th>`;
            });
            html += `</tr></thead><tbody>`;

            for (const row of filteredRows) {
                const { kod: rowKod, values, typeOpt } = row;
                
                // Проверяем type/opt: input в колонке "Сделано" только для type='Товар' и opt!='Сборка'
                const rowTypeInfo = typeOptMap[rowKod] || {};
                const isTypeTov = rowTypeInfo.type === 'Товар';
                const isOpt = rowTypeInfo.opt === 'Сборка';

                html += `<tr data-kod="${rowKod}">`;
                visible.forEach(col => {
                    if (col.type === 'image') {
                        const imgData = this.imageData[rowKod];
                        if (imgData) {
                            html += `<td class="col-image"><img class="warehouse-thumbnail" src="${imgData}" data-kod="${rowKod}" alt="" title="Клик — просмотр, двойной — загрузка"></td>`;
                        } else {
                            html += `<td class="col-image" style="cursor:pointer;" title="Нажмите для загрузки изображения"><span class="no-image" data-kod="${rowKod}">+</span></td>`;
                        }
                    } else {
                        const colIndex = headers.indexOf(col.db);
                        const val = colIndex >= 0 ? (values[colIndex] || '') : '';

                        if (col.db === 'available') {
                            // Доступно берём из this.availableData (уже учтён reserve)
                            const available = Math.floor(this.availableData[rowKod] ?? 0);
                            const totalWh = this.assembledWarehouse?.[rowKod] || warehouseCache[rowKod] || 0;

                            const minVal = this.minCache[rowKod] || 0;
                            const maxVal = this.maxCache[rowKod] || 0;

                            let extraStyle = '';
                            let extraClass = '';

                            if (available <= 0) {
                                extraStyle = '; color: #ff4444';
                                extraClass = ' zero-glow';
                            } else if (maxVal > 0) {
                                const mnStyles = getMinMaxStyles(rowKod, available);
                                if (mnStyles.color) extraStyle = `; color: ${mnStyles.color}`;
                                if (mnStyles.glowClass) extraClass = ' ' + mnStyles.glowClass;
                            }

                            html += `<td data-field="available" title="${available}" style="font-size:28px; font-weight:bold; text-align:center;${extraStyle}" class="${extraClass}">${available}</td>`;
                        } else if (col.db === 'reserve') {
                            const reserveVal = this.reserveData[rowKod] || 0;
                            html += `<td data-field="reserve" style="font-size:16px; font-weight:bold; text-align:center;">${reserveVal > 0 ? reserveVal : ''}</td>`;
                        } else if (col.db === 'plan') {
                            const planVal = colIndex >= 0 ? parseInt(values[colIndex]) || 0 : 0;
                            html += `<td data-field="plan" style="padding: 0;">
                                <input class="editable-input" type="text" value="${planVal > 0 ? planVal : ''}" data-kod="${rowKod}" data-field="plan" autocomplete="off" inputmode="numeric">
                            </td>`;
                        } else if (col.db === 'Сделано') {
                            // Показываем input только если type='Товар' и opt!='Сборка'
                            if (!isTypeTov || isOpt) {
                                html += `<td data-field="Сделано" style="padding: 0; text-align:center; color:#a0a0c0;">—</td>`;
                            } else {
                                const madeVal = colIndex >= 0 ? parseInt(values[colIndex]) || 0 : 0;
                                // Ищем comment в sessionStorage
                                let commentText = '';
                                const sdelanoData = sessionStorage.getItem('sdelanoData');
                                if (sdelanoData) {
                                    try {
                                        const data = JSON.parse(sdelanoData);
                                        const found = data.find(item => item.kod === rowKod);
                                        if (found && found.comment) {
                                            commentText = found.comment;
                                        }
                                    } catch (e) {
                                        // ignore
                                    }
                                }

                                let madeDisplay = madeVal > 0 ? madeVal : '';
                                let extraInfo = '';
                                if (commentText) {
                                    extraInfo += `<span class="sdelano-comment-display" style="margin-left:8px;color:#8b5cf6;font-size:0.85rem;" title="${this.escapeHtml(commentText)}">💬</span>`;
                                }

                                html += `<td data-field="Сделано" style="padding: 0;">
                                    <input class="editable-input made-input" type="text" value="${madeDisplay}" data-kod="${rowKod}" data-field="Сделано" autocomplete="off" inputmode="numeric">
                                    ${extraInfo}
                                </td>`;
                            }
                        } else if (col.db === 'sorti') {
                            const sortiVal = sortiMap[rowKod] || '';
                            if (sortiVal && sortiVal.trim()) {
                                html += `<td data-field="Сортировка" style="text-align:center;font-weight:bold;">${this.escapeHtml(sortiVal)}</td>`;
                            } else {
                                html += `<td data-field="Сортировка" style="text-align:center;">
                                    <span class="sort-plus" data-kod="${rowKod}" style="cursor:pointer;font-size:24px;color:#8b5cf6;" title="Нажмите для добавления">+</span>
                                </td>`;
                            }
                        } else if (col.db === 'total_warehouse') {
                            let totalWh = Math.floor(this.assembledWarehouse?.[rowKod] || warehouseCache[rowKod] || 0);
                            const minVal = this.minCache[rowKod] || 0;
                            const maxVal = this.maxCache[rowKod] || 0;

                            let extraStyle = '';
                            let extraClass = '';
                            if (totalWh <= 0) {
                                extraStyle = '; color: #ff4444';
                                extraClass = ' zero-glow';
                            } else if (maxVal > 0) {
                                const mnStyles = getMinMaxStyles(rowKod, totalWh);
                                if (mnStyles.color) extraStyle = `; color: ${mnStyles.color}`;
                                if (mnStyles.glowClass) extraClass = ' ' + mnStyles.glowClass;
                            }

                            html += `<td data-field="total_warehouse" class="total-warehouse-cell${extraClass}" style="font-size:28px;${extraStyle}" title="${totalWh}">${totalWh}</td>`;
                        } else {
                            // ===== ОБРАБОТКА ОСТАЛЬНЫХ КОЛОНОК =====
                            let fontSize = 'inherit';
                            let extraClass = '';
                            let extraStyle = '';

                            if (col.db === 'reserve') {
                                fontSize = '16px';
                            }

                            html += `<td data-field="${col.db}" title="${this.escapeHtml(val)}" class="${extraClass}" style="font-size:${fontSize}; font-weight:bold; text-align:center;${extraStyle}">${this.escapeHtml(val)}</td>`;
                        }
                    }
                });
                html += '</tr>';
            }

            html += '</tbody></table>';
            container.innerHTML = html;

            // Сохраняем DOM-строки и рендерим таблицу
            // ===== ОПТИМИЗАЦИЯ: кэшируем DOM-строки таблицы =====
            this.domCache.tableRows = {};
            container.querySelectorAll('tbody tr').forEach(row => {
                const kod = row.getAttribute('data-kod');
                if (kod) this.domCache.tableRows[kod] = row;
            });
            console.log(`DOM-кэш обновлён: ${Object.keys(this.domCache.tableRows).length} строк`);

            // Привязываем события картинок
            this.bindImageEvents(container);

            // Привязываем события редактируемых полей
            this.bindEditableInputs(container);

            // Привязываем события сортировки "+"
            this.bindSortEvents(container);

            // Обновляем input[data-field="Сделано"] из sessionStorage (если вернулись со страницы "Сделано")
            this.updateMadeFromSdelano();

            // Привязываем сортировку
            this.bindSortEvents(container);

        } catch (error) {
            console.error('Ошибка загрузки данных:', error);
            container.innerHTML = `<div class="error-message">❌ Ошибка: ${error.message}. Проверьте IP сервера и доступность.</div>`;
        }
    },

    openImageUpload(kod, thumbElement) {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const compressed = await this.compressImage(file);
                await this.saveImageToDB(kod, compressed);

                // Обновляем картинку в таблице
                if (thumbElement) {
                    thumbElement.src = compressed;
                } else {
                    // Если элемента нет (не было картинки), заменяем "+" на картинку
                    const noImageSpans = document.querySelectorAll('.no-image[data-kod]');
                    noImageSpans.forEach(span => {
                        if (span.getAttribute('data-kod') === kod) {
                            const newImg = document.createElement('img');
                            newImg.className = 'warehouse-thumbnail';
                            newImg.src = compressed;
                            newImg.setAttribute('data-kod', kod);
                            newImg.alt = '';
                            newImg.title = 'Клик — просмотр, двойной — загрузка';
                            span.parentElement.replaceChild(newImg, span);
                        }
                    });
                    // Перепривязываем события
                    const container = document.getElementById('warehouseTableContainer');
                    if (container) {
                        this.bindImageEvents(container);
                    }
                }
            } catch (err) {
                console.error('Ошибка загрузки изображения:', err);
                alert('Не удалось загрузить изображение');
            }
            fileInput.value = '';
        });

        fileInput.click();
        document.body.removeChild(fileInput);
    },

    // ============================================================
    // ПРИВЯЗКА СОБЫТИЙ КАРТИНОК
    // ============================================================
    bindImageEvents(container) {
        // Обработка ячеек без изображения (знак "+")
        container.querySelectorAll('.no-image[data-kod]').forEach(span => {
            const kod = span.getAttribute('data-kod');
            span.addEventListener('click', () => {
                this.openImageUpload(kod, null);
            });
        });

        // Обработка ячеек с картинкой — click fullscreen
        container.querySelectorAll('.warehouse-thumbnail').forEach(thumb => {
            const kod = thumb.getAttribute('data-kod');
            thumb.addEventListener('click', () => {
                this.showImageFullview(kod);
            });
        });
    },

    async showImageFullview(kod) {
        const imgData = this.imageData[kod];
        if (!imgData) return;

        const imgSrc = `data:image/png;base64,${imgData}`;
        document.getElementById('fullviewImg').src = imgSrc;
        document.getElementById('imageFullview').classList.add('active');
    },

    // ============================================================
    // РЕДАКТИРУЕМЫЕ ПОЛЯ
    // ============================================================
    bindEditableInputs(container) {
        container.querySelectorAll('.editable-input').forEach(input => {
            // ===== СЛУШАЕМ ИЗМЕНЕНИЯ "СДЕЛАНО" ДЛЯ ОЧИСТКИ ПОДСВЕТКИ =====
            if (input.getAttribute('data-field') === 'Сделано') {
                input.addEventListener('input', (e) => {
                    const raw = e.target.value.trim();
                    const made = raw ? (parseInt(raw.replace(/[^0-9]/g, '')) || 0) : 0;

                    // Если значение стало 0 или пустое — убираем подсветку
                    if (made <= 0 && e.target.style.backgroundColor) {
                        e.target.style.backgroundColor = '';
                        e.target.style.color = '';
                    }
                });
            }

            input.addEventListener('blur', async (e) => {
                // Отменяем debounce если уже есть pending
                if (this.planSaveTimeout) {
                    clearTimeout(this.planSaveTimeout);
                    this.planSaveTimeout = null;
                }

                const kod = e.target.getAttribute('data-kod');
                const field = e.target.getAttribute('data-field');
                const raw = e.target.value.trim();
                const value = raw ? (parseInt(raw) || 0) : 0;

                if (!kod) {
                    console.error('Не найден kod для input', e.target);
                    return;
                }

                // Не сохраняем 0 — это значит "пусто"
                if (value === 0) {
                    // Очищаем визуально
                    e.target.value = '';

                    // Удаляем из IndexedDB если было
                    try {
                        const db = await this.getDb();
                        const tx = db.transaction('warehouse_cache', 'readwrite');
                        const store = tx.objectStore('warehouse_cache');
                        store.delete(kod);
                    } catch (error) {
                        console.error('Ошибка удаления:', error);
                    }

                    // Если "План" — удаляем из zakaz
                    if (field === 'plan') {
                        this.isSavingPlan = true;
                        e.target.disabled = true;
                        e.target.style.opacity = '0.5';
                        try {
                            await this.syncPlanToZakaz(kod, 0);
                        } finally {
                            this.isSavingPlan = false;
                            e.target.disabled = false;
                            e.target.style.opacity = '1';
                        }
                        this.schedulePlanSync();
                    }

                    return;
                }

                // Сохраняем в IndexedDB для передачи на страницу "Сделано"
                try {
                    const db = await this.getDb();
                    const tx = db.transaction('warehouse_cache', 'readwrite');
                    const store = tx.objectStore('warehouse_cache');
                    store.put({ kod, value, timestamp: Date.now() });

                    console.log(`Сохранено значение ${field} для ${kod}: ${value}`);
                } catch (error) {
                    console.error('Ошибка сохранения:', error);
                }

                // Если "План" — записываем в zakaz со статусом 1
                if (field === 'plan') {
                    this.isSavingPlan = true;
                    e.target.disabled = true;
                    e.target.style.opacity = '0.5';
                    try {
                        // Сохраняем Promise в массив для ожидания в saveAllPlanAndGo
                        const promise = this.syncPlanToZakaz(kod, value);
                        this.pendingBlurPromises.push(promise);
                        await promise;
                        console.log(`[plan] Сохранён план: kod=${kod}, koli=${value}`);
                    } catch (e) {
                        console.error('[plan] Ошибка сохранения:', e);
                    } finally {
                        this.isSavingPlan = false;
                        e.target.disabled = false;
                        e.target.style.opacity = '1';
                    }
                    // Запускаем debounce для loadReserve + recalc (сброс предыдущего таймера)
                    this.schedulePlanSync();
                    return;
                }
            });

            // Разрешаем только целые числа
            input.addEventListener('keydown', (e) => {
                const controlKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Enter', 'Backspace', 'Delete', 'Home', 'End', 'Select', 'All'];
                if (controlKeys.includes(e.key) || e.ctrlKey || e.altKey || e.metaKey) return;
                if (!/^[0-9]$/.test(e.key)) {
                    e.preventDefault();
                }
            });

            // Предотвращаем потерю фокуса — при потере фокуса сразу сохраняем
            input.addEventListener('focus', (e) => {
                // Сохраняем текущее значение перед редактированием
                if (this.planSaveTimeout) {
                    clearTimeout(this.planSaveTimeout);
                    this.planSaveTimeout = null;
                }
            });
        });
    },

    // ============================================================
    // ОБНОВЛЕНИЕ input[data-field="Сделано"] ИЗ SESSIONSTORAGE
    // Вызывается при возврате со страницы "Сделано"
    // ============================================================
    updateMadeFromSdelano() {
        const sdelanoData = sessionStorage.getItem('sdelanoData');
        if (!sdelanoData) return;

        try {
            const data = JSON.parse(sdelanoData);
            const madeInputs = document.querySelectorAll('.made-input');

            let updated = 0;
            madeInputs.forEach(input => {
                const kod = input.getAttribute('data-kod');
                const found = data.find(item => item.kod === kod);
                if (found) {
                    const val = found.made > 0 ? found.made : '';
                    if (input.value !== String(val)) {
                        input.value = val;
                        updated++;
                    }
                }
            });

            if (updated > 0) {
                console.log(`[updateMadeFromSdelano] Обновлено ${updated} ячеек "Сделано"`);
            }
        } catch (e) {
            console.error('[updateMadeFromSdelano] Ошибка:', e);
        }
    },

    // ============================================================
    // ПЕРЕСЧЁТ ОПТОВИКОВ ПРИ ИЗМЕНЕНИИ КОНКРЕТНОГО КОДА
    // ============================================================
    async recalcOptAvailForKod(changedKod) {
        console.log(`[recalcOptAvailForKod] вызван для: ${changedKod}`);
        console.log(`[recalcOptAvailForKod] warehouseCache[key]:`, this.warehouseCache[changedKod]);
        console.log(`[recalcOptAvailForKod] reserveData[key]:`, this.reserveData[changedKod]);

        // Находим все оптовики, использующие changedKod как компонент
        const sastavResult = await this.query(
            `SELECT DISTINCT "kod" FROM "sostav" WHERE "kod2"='${changedKod.replace(/'/g, "''")}'`
        );

        console.log(`[recalcOptAvailForKod] Результат SQL (оптовики для ${changedKod}):`, sastavResult);

        if (!sastavResult || !sastavResult.trim()) {
            console.log(`[recalcOptAvailForKod] Нет оптовиков для компонента ${changedKod}`);
            return;
        }

        const lines = sastavResult.trim().split('\n').filter(l => l);
        console.log(`[recalcOptAvailForKod] Строк в result: ${lines.length}`, lines);

        if (lines.length < 2) {
            console.log(`[recalcOptAvailForKod] Нет данных оптовиков`);
            return;
        }

        const optKods = [];
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split('\t');
            const k = parts[0]?.trim();
            if (k) optKods.push(k);
        }

        if (optKods.length === 0) {
            console.log(`[recalcOptAvailForKod] Оптовики не найдены`);
            return;
        }

        console.log(`[recalcOptAvailForKod] Пересчёт оптовиков:`, optKods);

        // BATCH: загружаем СОСТАВ ВСЕХ оптовиков ОДНИМ запросом
        const optKodList = optKods.map(k => `'${k.replace(/'/g, "''")}'`).join(',');
        const sastavBatch = await this.query(
            `SELECT "kod", "kod2", "koli" FROM "sostav" WHERE "kod" IN (${optKodList})`
        );

        // Группируем компоненты по optKod
        const compsByOpt = {};
        for (const optKod of optKods) {
            compsByOpt[optKod] = [];
        }

        if (sastavBatch?.trim()) {
            const sastavLines = sastavBatch.trim().split('\n').filter(l => l);
            if (sastavLines.length > 1) {
                const sh = sastavLines[0].split('\t').map(h => h.trim().toLowerCase());
                const kodIdx = sh.indexOf('kod');
                const kod2Idx = sh.indexOf('kod2');
                const koliIdx = sh.indexOf('koli');
                for (let i = 1; i < sastavLines.length; i++) {
                    const parts = sastavLines[i].split('\t');
                    const k = kodIdx >= 0 ? parts[kodIdx]?.trim() : '';
                    const k2 = kod2Idx >= 0 ? parts[kod2Idx]?.trim() : '';
                    const koli = koliIdx >= 0 ? parseInt(parts[koliIdx]) || 1 : 1;
                    if (k && k2 && compsByOpt[k]) {
                        compsByOpt[k].push({ kod2: k2, koli });
                    }
                }
            }
        }

        // Пересчитываем каждый оптовик (только DOM, без запросов)
        for (const optKod of optKods) {
            const components = compsByOpt[optKod] || [];

            let minAvail = Infinity;
            let hasComp = false;

            for (const comp of components) {
                if (!comp.kod2) continue;

                hasComp = true;
                const compTotal = this.warehouseCache?.[comp.kod2] || 0;
                const compReserve = this.reserveData[comp.kod2] || 0;
                const compAvailable = compTotal - compReserve;
                const optAvail = compAvailable / comp.koli;
                console.log(`[recalcOptAvailForKod]   Компонент ${comp.kod2}: total=${compTotal}, reserve=${compReserve}, avail=${compAvailable}, koli=${comp.koli}, optAvail=${optAvail}`);

                if (optAvail < minAvail) minAvail = optAvail;
            }

            // Свое собственное тоже учитываем
            const ownTotal = this.assembledWarehouse?.[optKod] || 0;
            const ownReserve = this.reserveData[optKod] || 0;
            const ownAvailable = ownTotal - ownReserve;
            console.log(`[recalcOptAvailForKod]   Свой ownAvailable=${ownAvailable}`);
            if (ownAvailable < minAvail) minAvail = ownAvailable;

            const result = hasComp ? Math.floor(minAvail) : 0;
            this.availableData[optKod] = result;
            console.log(`[recalcOptAvailForKod] Оптовик ${optKod}: available=${result}`);
            this.updateOptAvailInDOM(optKod, result);
        }
    },

    // ============================================================
    // ОБНОВЛЕНИЕ "ДОСТУПНО" ОПТОВИКА В DOM
    // ============================================================
    updateOptAvailInDOM(optKod, available) {
        const rowEl = this.domCache.tableRows?.[optKod];
        if (!rowEl) return;

        const cells = rowEl.querySelectorAll('td');
        const fields = this.getFields();
        const visible = this.getVisibleColumns(fields);
        const availIdx = visible.findIndex(c => c.db === 'available');

        if (availIdx >= 0 && cells[availIdx]) {
            const minVal = this.minCache[optKod] || 0;
            const maxVal = this.maxCache[optKod] || 0;

            let extraStyle = '';
            let extraClass = '';

            if (available <= 0) {
                extraStyle = '; color: #ff4444';
                extraClass = ' zero-glow';
            } else if (maxVal > 0) {
                if (available < minVal) {
                    extraStyle = '; color: #ff8800';
                    extraClass = ' glow-below-min';
                } else if (available <= maxVal) {
                    extraStyle = '; color: #4caf50';
                    extraClass = ' glow-in-range';
                } else {
                    extraStyle = '; color: #2196f3';
                    extraClass = ' glow-above-max';
                }
            }

            cells[availIdx].textContent = available;
            cells[availIdx].style.fontSize = '28px';
            cells[availIdx].style.fontWeight = 'bold';
            cells[availIdx].style.textAlign = 'center';
            if (extraStyle) cells[availIdx].style.color = extraStyle.replace(/; color: /, '');
            cells[availIdx].classList.remove('glow-below-min', 'glow-in-range', 'glow-above-max', 'zero-glow');
            if (extraClass) cells[availIdx].classList.add(extraClass.trim());
            cells[availIdx].setAttribute('title', available);
        }
    },

    // ============================================================
    // ОБНОВЛЕНИЕ СТРОКИ ПО КОНКРЕТНОМУ KOD
    // ============================================================
    updateRowAvailability(kod, reserveValue) {
        const rowEl = this.domCache.tableRows?.[kod];
        if (!rowEl) return;

        const cells = rowEl.querySelectorAll('td');
        const fields = this.getFields();
        const visible = this.getVisibleColumns(fields);
        const availIdx = visible.findIndex(c => c.db === 'available');
        const reserveIdx = visible.findIndex(c => c.db === 'reserve');
        const totalWhIdx = visible.findIndex(c => c.db === 'total_warehouse');

        // Считаем total_warehouse
        let totalWh = this.assembledWarehouse?.[kod] || this.warehouseCache[kod] || 0;
        const reserve = reserveValue || 0;
        const available = totalWh - reserve;

        const minVal = this.minCache[kod] || 0;
        const maxVal = this.maxCache[kod] || 0;

        // ===== Обновляем "Доступно" =====
        if (availIdx >= 0 && cells[availIdx]) {
            let extraStyle = '';
            let extraClass = '';

            if (available <= 0) {
                extraStyle = '; color: #ff4444';
                extraClass = ' zero-glow';
            } else if (maxVal > 0) {
                if (available < minVal) {
                    extraStyle = '; color: #ff8800';
                    extraClass = ' glow-below-min';
                } else if (available <= maxVal) {
                    extraStyle = '; color: #4caf50';
                    extraClass = ' glow-in-range';
                } else {
                    extraStyle = '; color: #2196f3';
                    extraClass = ' glow-above-max';
                }
            }

            cells[availIdx].textContent = available;
            cells[availIdx].style.fontSize = '28px';
            cells[availIdx].style.fontWeight = 'bold';
            cells[availIdx].style.textAlign = 'center';
            if (extraStyle) cells[availIdx].style.color = extraStyle.replace(/; color: /, '');
            cells[availIdx].classList.remove('glow-below-min', 'glow-in-range', 'glow-above-max', 'zero-glow');
            if (extraClass) cells[availIdx].classList.add(extraClass.trim());
            cells[availIdx].setAttribute('title', available);
        }

        // ===== Обновляем "Резерв" =====
        if (reserveIdx >= 0 && cells[reserveIdx]) {
            const reserveInput = cells[reserveIdx].querySelector('input');
            if (reserveInput) {
                reserveInput.value = reserve > 0 ? reserve : '';
            } else {
                cells[reserveIdx].textContent = reserve === 0 ? '' : reserve;
            }
        }

        console.log(`Обновлена строка ${kod}: Доступно=${available}, Резерв=${reserve}, Всего=${totalWh}`);
    },

    // ============================================================
    // ОБНОВЛЕНИЕ ВСЕХ ВИДИМЫХ СТРОК (после массовой загрузки / loadReserve)
    // ============================================================
    updateAllRowsAvailability() {
        const rows = this.domCache.tableRows;
        if (!rows) return;

        const kods = Object.keys(rows);
        for (const kod of kods) {
            this.updateRowAvailability(kod, this.reserveData[kod] || 0);
        }
        console.log(`[updateAllRowsAvailability] Обновлено ${kods.length} строк`);
    },

    // ============================================================
    // ЗАГРУЗКА РЕЗЕРВА ИЗ БД (без обновления DOM) — status 1, 2, 3, 4
    // ============================================================
    async loadReserveFromDB() {
        const reserveResult = await this.query(
            `SELECT "kod", SUM("koli") as "total" FROM "zakaz" WHERE "status" IN (1, 2, 3, 4) GROUP BY "kod"`
        );
        const reserveData = {};
        if (reserveResult && reserveResult.trim()) {
            const lines = reserveResult.trim().split('\n').filter(l => l);
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split('\t');
                const headerParts = lines[0].split('\t').map(h => h.trim().toLowerCase());
                const kodIdx = headerParts.findIndex(h => h === 'kod');
                const totalIdx = headerParts.findIndex(h => h.includes('total') || h === 'sum');
                const kod = kodIdx >= 0 ? parts[kodIdx]?.trim() : '';
                const total = totalIdx >= 0 ? parseInt(parts[totalIdx]) || 0 : 0;
                if (kod) reserveData[kod] = total;
            }
        }
        this.reserveData = reserveData;
        console.log('Резерв загружен из БД:', reserveData);
    },

    // ============================================================
    // ПЕРЕСЧЁТ ДОСТУПНОСТИ ПРИ ИЗМЕНЕНИИ ЛЮБОЙ КОЛОНКИ
    // ============================================================
    async recalcAllAvailability() {
        // reserveData уже загружен через loadReserveFromDB()

        // Пересчитываем availableData только для НЕ-оптовых товаров
        const dataLines = this.currentData?.dataLines;
        const headers = this.currentData?.headers;
        if (!dataLines || !headers) return;

        // Находим оптовики в таблице
        const optKodsInTable = new Set();
        for (let i = 1; i < dataLines.length; i++) {
            const values = dataLines[i].split('\t');
            const kod = values[headers.indexOf('kod')] || '';
            if (!kod) continue;
            const optIndex = headers.indexOf('opt');
            const optValue = optIndex >= 0 ? values[optIndex]?.trim() : '';
            if (optValue === 'Сборка') {
                optKodsInTable.add(kod);
            }
        }

        // Пересчитываем availableData для обычных товаров
        for (let i = 1; i < dataLines.length; i++) {
            const values = dataLines[i].split('\t');
            const rowKod = values[headers.indexOf('kod')] || '';
            if (!rowKod || optKodsInTable.has(rowKod)) continue;

            let totalWh = this.assembledWarehouse?.[rowKod] || this.warehouseCache[rowKod] || 0;
            const reserve = this.reserveData[rowKod] || 0;
            this.availableData[rowKod] = totalWh - reserve;
        }

        // Обновляем DOM для обычных товаров
        this.updateNonOptAvailabilityInDOM(optKodsInTable);
    },

    // ============================================================
    // ОБНОВЛЕНИЕ "ДОСТУПНО" ДЛЯ НЕ-ОПТОВЫХ ТОВАРОВ
    // ============================================================
    updateNonOptAvailabilityInDOM(optKods) {
        const domRows = this.domCache.tableRows;
        if (!domRows) return;

        for (const kod of Object.keys(domRows)) {
            // Пропускаем оптовиков — их обновляет recalcOptAvailForKod
            if (optKods.has(kod)) continue;

            this.updateSingleAvailabilityInDOM(kod);
        }
    },

    // ============================================================
    // ОБНОВЛЕНИЕ "ДОСТУПНО" ДЛЯ ОДНОГО ТОВАРА
    // ============================================================
    updateSingleAvailabilityInDOM(kod) {
        const rowEl = this.domCache.tableRows?.[kod];
        if (!rowEl) return;

        const cells = rowEl.querySelectorAll('td');
        const fields = this.getFields();
        const visible = this.getVisibleColumns(fields);
        const availIdx = visible.findIndex(c => c.db === 'available');
        const totalWhIdx = visible.findIndex(c => c.db === 'total_warehouse');
        const reserveIdx = visible.findIndex(c => c.db === 'reserve');

        const available = this.availableData[kod] ?? 0;
        const reserve = this.reserveData[kod] || 0;
        let totalWh = this.assembledWarehouse?.[kod] || this.warehouseCache[kod] || 0;

        const minVal = this.minCache[kod] || 0;
        const maxVal = this.maxCache[kod] || 0;

        // ===== Обновляем "Доступно" =====
        if (availIdx >= 0 && cells[availIdx]) {
            let extraStyle = '';
            let extraClass = '';

            if (available <= 0) {
                extraStyle = '; color: #ff4444';
                extraClass = ' zero-glow';
            } else if (maxVal > 0) {
                if (available < minVal) {
                    extraStyle = '; color: #ff8800';
                    extraClass = ' glow-below-min';
                } else if (available <= maxVal) {
                    extraStyle = '; color: #4caf50';
                    extraClass = ' glow-in-range';
                } else {
                    extraStyle = '; color: #2196f3';
                    extraClass = ' glow-above-max';
                }
            }

            cells[availIdx].textContent = available;
            cells[availIdx].style.fontSize = '28px';
            cells[availIdx].style.fontWeight = 'bold';
            cells[availIdx].style.textAlign = 'center';
            if (extraStyle) cells[availIdx].style.color = extraStyle.replace(/; color: /, '');
            cells[availIdx].classList.remove('glow-below-min', 'glow-in-range', 'glow-above-max', 'zero-glow');
            if (extraClass) cells[availIdx].classList.add(extraClass.trim());
            cells[availIdx].setAttribute('title', available);
        }

        // ===== Обновляем "Всего склад" =====
        if (totalWhIdx >= 0 && cells[totalWhIdx]) {
            let extraStyle = '';
            let extraClass = '';

            if (totalWh <= 0) {
                extraStyle = '; color: #ff4444';
                extraClass = ' zero-glow';
            } else if (maxVal > 0) {
                if (totalWh < minVal) {
                    extraStyle = '; color: #ff8800';
                    extraClass = ' glow-below-min';
                } else if (totalWh <= maxVal) {
                    extraStyle = '; color: #4caf50';
                    extraClass = ' glow-in-range';
                } else {
                    extraStyle = '; color: #2196f3';
                    extraClass = ' glow-above-max';
                }
            }

            cells[totalWhIdx].textContent = totalWh;
            cells[totalWhIdx].style.fontSize = '28px';
            cells[totalWhIdx].classList.remove('glow-below-min', 'glow-in-range', 'glow-above-max', 'zero-glow');
            if (extraClass) cells[totalWhIdx].classList.add(extraClass.trim());
            cells[totalWhIdx].setAttribute('title', totalWh);
        }

        // ===== Обновляем "Резерв" =====
        if (reserveIdx >= 0 && cells[reserveIdx]) {
            const reserveInput = cells[reserveIdx].querySelector('input');
            if (reserveInput) {
                reserveInput.value = reserve > 0 ? reserve : '';
            } else {
                cells[reserveIdx].textContent = reserve === 0 ? '' : reserve;
            }
        }
    },

    // ============================================================
    // СОРТИРОВКА
    // ============================================================
    async openSortModal(kod) {
        this.currentSortKod = kod;

        // Загружаем уникальные sorti из guide
        try {
            const result = await this.query(`SELECT DISTINCT "sorti" FROM "guide" WHERE "sorti" != '' ORDER BY "sorti"`);
            const sortList = document.getElementById('sortList');
            sortList.innerHTML = '';

            if (result?.trim()) {
                const lines = result.trim().split('\n').filter(l => l);
                for (let i = 1; i < lines.length; i++) {
                    const parts = lines[i].split('\t');
                    const sorti = parts[0]?.trim();
                    if (sorti) {
                        const option = document.createElement('option');
                        option.value = sorti;
                        sortList.appendChild(option);
                    }
                }
            }
        } catch (e) {
            console.error('Ошибка загрузки sorti:', e);
        }

        document.getElementById('sortInput').value = '';
        document.getElementById('sortModal').style.display = 'flex';
    },

    async saveSort() {
        const kod = this.currentSortKod;
        const sortiVal = document.getElementById('sortInput').value.trim();

        if (!kod) {
            alert('❌ Не найден kod');
            return;
        }

        if (!sortiVal) {
            alert('❌ Введите значение');
            return;
        }

        try {
            // Записываем в guide
            await this.query(`UPDATE "guide" SET "sorti"='${sortiVal.replace(/'/g, "''")}' WHERE "kod"='${kod.replace(/'/g, "''")}'`);
            console.log('[Sort] Сохранено:', kod, '=', sortiVal);

            // Обновляем UI
            this.updateSortInTable(kod, sortiVal);

            // Закрываем модалку
            document.getElementById('sortModal').style.display = 'none';
        } catch (error) {
            console.error('Ошибка сохранения сортировки:', error);
            alert('❌ Ошибка: ' + error.message);
        }
    },

    updateSortInTable(kod, sortiVal) {
        const row = document.querySelector(`tr[data-kod="${kod}"]`);
        if (!row) return;

        // Находим ячейку Сортировка
        const sortCell = row.querySelector('td[data-field="Сортировка"]');
        if (sortCell) {
            sortCell.textContent = sortiVal;
            sortCell.style.textAlign = 'center';
            sortCell.style.fontWeight = 'bold';
        }
    },

    bindSortEvents(container) {
        // События для "+"
        container.querySelectorAll('.sort-plus').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const kod = e.target.getAttribute('data-kod');
                await this.openSortModal(kod);
            });
        });

        // События для заголовков колонок
        container.querySelectorAll('.warehouse-table th[data-column]').forEach(th => {
            th.addEventListener('click', () => {
                const column = th.getAttribute('data-column');
                if (this.sortColumn === column) {
                    this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    this.sortColumn = column;
                    this.sortDirection = 'asc';
                }
                this.sortTable();
            });
        });
    },

    sortTable() {
        const table = document.querySelector('.warehouse-table');
        const tbody = table.querySelector('tbody');
        const rows = Array.from(tbody.querySelectorAll('tr'));
        const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.getAttribute('data-column'));
        const colIndex = headers.indexOf(this.sortColumn);

        if (colIndex === null) return;

        rows.sort((a, b) => {
            const aVal = a.children[colIndex]?.textContent.trim() || '';
            const bVal = b.children[colIndex]?.textContent.trim() || '';
            const aNum = parseFloat(aVal);
            const bNum = parseFloat(bVal);

            let cmp = 0;
            if (!isNaN(aNum) && !isNaN(bNum)) {
                cmp = aNum - bNum;
            } else {
                cmp = aVal.localeCompare(bVal, 'ru');
            }

            return this.sortDirection === 'asc' ? cmp : -cmp;
        });

        rows.forEach(row => tbody.appendChild(row));

        table.querySelectorAll('th').forEach(th => th.classList.remove('sort-asc', 'sort-desc'));
        const activeTh = table.querySelector(`th[data-column="${this.sortColumn}"]`);
        if (activeTh) activeTh.classList.add(this.sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
    },

    // ============================================================
    // ПОИСК/ФИЛЬТР
    // ============================================================
    filterTable() {
        const query = document.getElementById('searchInput').value.toLowerCase().trim();
        const rows = document.querySelectorAll('.warehouse-table tbody tr');

        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            let match = false;
            cells.forEach(cell => {
                if (cell.textContent.toLowerCase().includes(query)) {
                    match = true;
                }
            });
            row.style.display = match ? '' : 'none';
        });
    },

    // ============================================================
    // НАСТРОЙКА КОЛОНОК
    // ============================================================
    getVisibleColumns(fields) {
        const saved = localStorage.getItem('warehouseVisibleColumns');
        if (saved) {
            try {
                let visible = JSON.parse(saved);
                // Добавляем 'sorti' если его нет в списке
                if (!visible.includes('sorti')) {
                    visible.push('sorti');
                    localStorage.setItem('warehouseVisibleColumns', JSON.stringify(visible));
                }
                return fields.filter(f => visible.includes(f.db));
            } catch (e) {
                console.error('Ошибка чтения настроек колонок:', e);
            }
        }
        return fields;
    },

    saveVisibleColumns() {
        const checkboxes = document.querySelectorAll('#columnsList input[type="checkbox"]');
        const visible = [];
        checkboxes.forEach(cb => {
            if (cb.checked) visible.push(cb.value);
        });
        localStorage.setItem('warehouseVisibleColumns', JSON.stringify(visible));
        this.closeColumnsModal();
        this.loadData();
    },

    resetColumns() {
        const checkboxes = document.querySelectorAll('#columnsList input[type="checkbox"]');
        checkboxes.forEach(cb => cb.checked = true);
    },

    openColumnsModal() {
        const fields = this.getFields();
        const list = document.getElementById('columnsList');
        list.innerHTML = '';

        fields.forEach(field => {
            const div = document.createElement('div');
            div.className = 'column-item';
            const translated = this.translations[field.db] || field.key;
            div.innerHTML = `
                <input type="checkbox" value="${field.db}" ${this.getVisibleColumns(fields).some(c => c.db === field.db) ? 'checked' : ''}>
                <span class="col-name">${translated}</span>
                <span class="col-type">(${field.db})</span>
            `;
            list.appendChild(div);
        });

        document.getElementById('columnsModal').style.display = 'flex';
    },

    closeColumnsModal() {
        document.getElementById('columnsModal').style.display = 'none';
    },

    // ============================================================
    // УТИЛИТЫ
    // ============================================================
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

            const text = await response.text();
            // Возвращаем пустую строку если ответ пустой
            return text || '';
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('Таймаут запроса (15 сек)');
            }
            if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
                throw new Error('CORS ошибка или сервер недоступен');
            }
            throw error;
        }
    },

    parseTableTypes(sql) {
        const lines = sql.split('\n');
        const columns = [];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            const match = line.match(/^(\s*"?(\w+)"?\s+([\w\(\)\s]+)\s*,?\s*)$/);
            if (match) {
                const name = match[2].replace(/"/g, '');
                const type = match[3].trim().toUpperCase();
                if (!['PRIMARY', 'UNIQUE', 'INDEX', 'FOREIGN'].includes(type)) {
                    columns.push({ name, type });
                }
            }
        }
        return columns;
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    escapeJs(text) {
        // Безопасная вставка строки в JS-контекст (onclick, etc.)
        if (typeof text !== 'string') return text;
        return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
    },

    // ============================================================
    // IMAGE HANDLING - IndexedDB
    // ============================================================
    getDb() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('ImageDB', 4);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                // Удаляем старые object stores если есть конфликт
                for (const name of db.objectStoreNames) {
                    db.deleteObjectStore(name);
                }
                // Создаём нужные stores
                db.createObjectStore('images', { keyPath: 'kod' });
                db.createObjectStore('warehouse_cache', { keyPath: 'kod' });
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async saveImageToDB(kod, dataUrl) {
        try {
            const db = await this.getDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('images', 'readwrite');
                tx.objectStore('images').put({ kod, data: dataUrl });
                tx.oncomplete = () => {
                    this.imageData[kod] = dataUrl;
                    resolve();
                };
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) {
            console.error('Ошибка сохранения изображения:', e);
        }
    },

    compressImage(file, maxWidth = 800, quality = 0.8) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    if (width > maxWidth) {
                        height = (height * maxWidth) / width;
                        width = maxWidth;
                    }

                    canvas.width = width;
                    canvas.height = height;

                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    resolve(canvas.toDataURL('image/jpeg', quality));
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    },

    initImageUpload(kod, thumbnailElement) {
        // Создаём скрытый input для загрузки файла
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);

        thumbnailElement.style.cursor = 'pointer';

        thumbnailElement.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const compressed = await this.compressImage(file);
                await this.saveImageToDB(kod, compressed);

                // Обновляем картинку в таблице
                thumbnailElement.src = compressed;
                console.log('Изображение сохранено для кода:', kod);
            } catch (err) {
                console.error('Ошибка загрузки изображения:', err);
                alert('Не удалось загрузить изображение');
            }

            // Очищаем input чтобы можно было загрузить тот же файл
            fileInput.value = '';
        });
    },

    // ============================================================
    // ПРИНЯТЬ НА СКЛАД - МОДАЛЬНОЕ ОКНО
    // ============================================================

    addWithoutShopCode() {
        console.log('[addWithoutShopCode] Вызвана');
        
        // Открываем модальное окно для ручного ввода
        document.getElementById('manualKod').value = '';
        document.getElementById('manualCategory').value = '';
        document.getElementById('manualArt').value = '';
        document.getElementById('manualQty').value = '';
        document.getElementById('manualUnit').value = '';

        // Загружаем все категории
        this.loadManualCategories();

        const modal = document.getElementById('addWithoutShkModal');
        console.log('[addWithoutShopCode] Модалка найдена:', !!modal);
        modal.style.display = 'flex';
        document.getElementById('manualKod').focus();

        // Привязываем события
        this.bindManualModalEvents();
        console.log('[addWithoutShopCode] Модалка открыта');
    },

    // ============================================================
    // МОДАЛЬНОЕ ОКНО "НЕ НАЙДЕНО"
    // ============================================================
    async openNotFoundModal(code, kolich) {
        // Устанавливаем ненайденный код
        document.getElementById('notFoundCode').value = code;
        document.getElementById('notFoundKod').value = '';
        document.getElementById('notFoundQty').value = '';
        document.getElementById('notFoundUnit').value = '';
        document.getElementById('notFoundCategory').value = '';
        document.getElementById('notFoundArt').value = '';

        // Загружаем категории
        await this.loadNotFoundCategories();

        document.getElementById('notFoundModal').style.display = 'flex';
        document.getElementById('notFoundKod').focus();

        // Привязываем события
        this.bindNotFoundModalEvents();
    },

    closeNotFoundModal() {
        document.getElementById('notFoundModal').style.display = 'none';
    },

    // ============================================================
    // МОДАЛЬНОЕ ОКНО ПОИСКА ПО PRIHOD
    // ============================================================
    prikhodResults: [], // Результаты поиска по prihod

    openPrikhodModal() {
        console.log('[openPrikhodModal] Вызвана');
        // Сбрасываем модалку
        document.getElementById('prikhodShopCode').value = '';
        document.getElementById('prikhodResults').style.display = 'none';
        document.getElementById('prikhodResultsBody').innerHTML = '';
        this.prikhodResults = [];
        
        // Открываем модалку и фокусируем поле ввода
        const modal = document.getElementById('prikhodSearchModal');
        console.log('[openPrikhodModal] Модалка найдена:', !!modal);
        modal.style.display = 'flex';
        
        // Фокус через небольшую задержку чтобы DOM обновился
        setTimeout(() => {
            document.getElementById('prikhodShopCode').focus();
        }, 50);
    },

    closePrikhodModal() {
        document.getElementById('prikhodSearchModal').style.display = 'none';
    },

    async prikhodSearch() {
        const shopCode = document.getElementById('prikhodShopCode').value.trim();
        if (!shopCode) {
            document.getElementById('prikhodShopCode').focus();
            return;
        }

        console.log('[prikhodSearch] Ищем kodmagaz =', shopCode);

        try {
            const sql = `SELECT "kodnas", "kolich", "kodmagaz" FROM "prihod" WHERE "kodmagaz"='${shopCode.replace(/'/g, "''")}'`;
            console.log('[prikhodSearch] SQL:', sql);

            const result = await this.query(sql);
            console.log('[prikhodSearch] Результат:', result);

            this.prikhodResults = [];
            document.getElementById('prikhodResultsBody').innerHTML = '';

            if (result && result.trim()) {
                const lines = result.trim().split('\n').filter(l => l);
                console.log('[prikhodSearch] Строк:', lines.length);

                if (lines.length > 1) {
                    const headers = lines[0].split('\t').map(h => h.trim().toLowerCase().replace(/"/g, ''));
                    const kodnasIdx = headers.indexOf('kodnas');
                    const kolichIdx = headers.indexOf('kolich');
                    const kodmagazIdx = headers.indexOf('kodmagaz');

                    for (let i = 1; i < lines.length; i++) {
                        const parts = lines[i].split('\t');
                        const kodnas = kodnasIdx >= 0 ? parts[kodnasIdx]?.trim() : '';
                        const kolich = kolichIdx >= 0 ? parts[kolichIdx]?.trim() : '';
                        const kodmagaz = kodmagazIdx >= 0 ? parts[kodmagazIdx]?.trim() : '';

                        if (kodnas && kolich) {
                            this.prikhodResults.push({ kodnas, kolich, kodmagaz });
                        }
                    }
                }
            }

            console.log('[prikhodSearch] Итого найдено:', this.prikhodResults.length);

            if (this.prikhodResults.length > 0) {
                this.buildPrikhodTable();
                document.getElementById('prikhodResults').style.display = 'block';
            } else {
                document.getElementById('prikhodResults').style.display = 'none';
                alert('Не найдено в базе');
            }
        } catch (error) {
            console.error('Ошибка поиска по prihod:', error);
            alert('Ошибка поиска: ' + error.message);
        }
    },

    buildPrikhodTable() {
        const tbody = document.getElementById('prikhodResultsBody');
        tbody.innerHTML = '';

        this.prikhodResults.forEach((item, index) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${this.escapeHtml(item.kodnas)}</td>
                <td>${this.escapeHtml(item.kodmagaz)}</td>
                <td>${this.escapeHtml(item.kolich)}</td>
                <td style="text-align:center; white-space:nowrap;">
                    <button class="btn btn-ghost btn-small" onclick="WAREHOUSE.deletePrikhodEntry(${index})" style="color:#e74c3c;" title="Удалить из prihod">🗑️</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    async deletePrikhodEntry(index) {
        const item = this.prikhodResults[index];
        if (!item) return;
        if (!confirm(`Удалить запись kodmagaz="${item.kodmagaz}" из prihod?`)) return;

        try {
            await this.query(
                `DELETE FROM "prihod" WHERE "kodmagaz"='${item.kodmagaz.replace(/'/g, "''")}'`
            );
            console.log(`[deletePrikhodEntry] Удалено: ${item.kodmagaz}`);

            // Удаляем из результатов
            this.prikhodResults.splice(index, 1);

            if (this.prikhodResults.length > 0) {
                this.buildPrikhodTable();
            } else {
                document.getElementById('prikhodResults').style.display = 'none';
            }

            alert('✅ Запись удалена из prihod');
        } catch (error) {
            console.error('Ошибка удаления:', error);
            alert('Ошибка удаления: ' + error.message);
        }
    },

    async loadNotFoundCategories() {
        try {
            const sql = `SELECT DISTINCT "type" FROM "guide" WHERE "type" != '' ORDER BY "type"`;
            const result = await this.query(sql);
            const select = document.getElementById('notFoundCategory');
            select.innerHTML = '<option value="" disabled selected hidden></option>';
            if (result && result.trim()) {
                const lines = result.trim().split('\n').filter(l => l);
                for (let i = 1; i < lines.length; i++) {
                    const val = lines[i].trim();
                    if (val !== 'Товар') {
                        select.innerHTML += `<option value="${val}">${val}</option>`;
                    }
                }
            }
            this.loadNotFoundArts(null);
        } catch (error) {
            console.error('Ошибка загрузки категорий:', error);
        }
    },

    async loadNotFoundArts(category) {
        try {
            let sql = `SELECT DISTINCT "art" FROM "guide" WHERE "art" != '' AND "type" != 'Товар'`;
            if (category) {
                sql += ` AND "type" = '${category.replace(/'/g, "''")}'`;
            }
            sql += ` ORDER BY "art"`;

            const result = await this.query(sql);
            const select = document.getElementById('notFoundArt');
            const currentValue = select.value;
            select.innerHTML = '<option value="" disabled selected hidden></option>';
            if (result && result.trim()) {
                const lines = result.trim().split('\n').filter(l => l);
                for (let i = 1; i < lines.length; i++) {
                    const val = lines[i].trim();
                    select.innerHTML += `<option value="${val}"${val === currentValue ? ' selected' : ''}>${val}</option>`;
                }
            }
            if (currentValue) {
                select.value = currentValue;
            }
        } catch (error) {
            console.error('Ошибка загрузки артикулов:', error);
        }
    },

    bindNotFoundModalEvents() {
        const categorySelect = document.getElementById('notFoundCategory');
        const artSelect = document.getElementById('notFoundArt');
        const unitInput = document.getElementById('notFoundUnit');

        categorySelect.addEventListener('change', () => {
            const cat = categorySelect.value;
            this.loadNotFoundArts(cat);
            artSelect.value = '';
            unitInput.value = '';
        });

        artSelect.addEventListener('change', async () => {
            const art = artSelect.value;
            if (!art) {
                unitInput.value = '';
                return;
            }

            try {
                const cat = categorySelect.value;
                const sql = `SELECT "kod", "type", "edizm" FROM "guide" WHERE "art"='${art.replace(/'/g, "''")}' LIMIT 1`;
                const result = await this.query(sql);

                if (result && result.trim()) {
                    const lines = result.trim().split('\n').filter(l => l);
                    if (lines.length >= 2) {
                        const parts = lines[1].split('\t');
                        const kodIndex = lines[0].split('\t').indexOf('kod');
                        const typeIndex = lines[0].split('\t').indexOf('type');
                        const edizmIndex = lines[0].split('\t').indexOf('edizm');

                        if (kodIndex >= 0) {
                            document.getElementById('notFoundKod').value = parts[kodIndex].trim();
                        }
                        if (typeIndex >= 0) {
                            const catValue = parts[typeIndex].trim();
                            const catSelect = document.getElementById('notFoundCategory');
                            let found = false;
                            for (let opt of catSelect.options) {
                                if (opt.value === catValue) {
                                    found = true;
                                    break;
                                }
                            }
                            if (!found) {
                                catSelect.innerHTML += `<option value="${catValue}">${catValue}</option>`;
                            }
                            catSelect.value = catValue;
                            this.loadNotFoundArts(catValue);
                        }
                        if (edizmIndex >= 0) {
                            unitInput.value = parts[edizmIndex].trim();
                        }
                    }
                }
            } catch (error) {
                console.error('Ошибка поиска данных по артикулу:', error);
            }
        });
    },

    async assignNotFound() {
        const code = document.getElementById('notFoundCode').value.trim();
        const kod = document.getElementById('notFoundKod').value.trim();
        const art = document.getElementById('notFoundArt').value.trim();
        const qty = parseInt(document.getElementById('notFoundQty').value);
        const unit = document.getElementById('notFoundUnit').value.trim();
        const cat = document.getElementById('notFoundCategory').value;

        if (!art) {
            alert('Выберите артикул');
            return;
        }

        if (!qty || qty <= 0) {
            alert('Введите количество больше 0');
            return;
        }

        try {
            // Проверяем, есть ли уже запись в prihod с таким kodmagaz
            const checkSql = `SELECT "kodnas" FROM "prihod" WHERE "kodmagaz"='${code.replace(/'/g, "''")}' LIMIT 1`;
            const checkResult = await this.query(checkSql);

            let insertSql = '';
            if (checkResult && checkResult.trim() && checkResult.trim().split('\n').length > 1) {
                // Обновляем существующую запись
                insertSql = `UPDATE "prihod" SET "kodnas"='${kod.replace(/'/g, "''")}', "kolich"=${qty} WHERE "kodmagaz"='${code.replace(/'/g, "''")}'`;
            } else {
                // Создаём новую запись
                insertSql = `INSERT INTO "prihod" ("kodmagaz", "kodnas", "kolich") VALUES ('${code.replace(/'/g, "''")}', '${kod.replace(/'/g, "''")}', ${qty})`;
            }

            await this.query(insertSql);

            // Добавляем в foundItems
            this.foundItems.push({ kod, art, kolich: qty, unit: unit || 'шт' });
            this.rebuildAcceptTable();

            alert('✅ Запись добавлена в prihod');
            this.closeNotFoundModal();

        } catch (error) {
            console.error('Ошибка сохранения:', error);
            alert('Ошибка сохранения: ' + error.message);
        }
    },

    async loadManualCategories() {
        try {
            const sql = `SELECT DISTINCT "type" FROM "guide" WHERE "type" != '' ORDER BY "type"`;
            const result = await this.query(sql);
            const select = document.getElementById('manualCategory');
            select.innerHTML = '<option value="" disabled selected hidden></option>';
            if (result && result.trim()) {
                const lines = result.trim().split('\n').filter(l => l);
                for (let i = 1; i < lines.length; i++) {
                    const val = lines[i].trim();
                    if (val !== 'Товар') {
                        select.innerHTML += `<option value="${val}">${val}</option>`;
                    }
                }
            }
            // Загружаем все артикулы (без фильтра)
            this.loadManualArts(null);
        } catch (error) {
            console.error('Ошибка загрузки категорий:', error);
        }
    },

    async loadManualArts(category) {
        try {
            let sql = `SELECT DISTINCT "art" FROM "guide" WHERE "art" != '' AND "type" != 'Товар'`;
            if (category) {
                sql += ` AND "type" = '${category.replace(/'/g, "''")}'`;
            }
            sql += ` ORDER BY "art"`;

            const result = await this.query(sql);
            const select = document.getElementById('manualArt');
            const currentValue = select.value;
            select.innerHTML = '<option value="" disabled selected hidden></option>';
            if (result && result.trim()) {
                const lines = result.trim().split('\n').filter(l => l);
                for (let i = 1; i < lines.length; i++) {
                    const val = lines[i].trim();
                    select.innerHTML += `<option value="${val}"${val === currentValue ? ' selected' : ''}>${val}</option>`;
                }
            }
            // Восстанавливаем выбранное значение если оно есть
            if (currentValue) {
                select.value = currentValue;
            }
        } catch (error) {
            console.error('Ошибка загрузки артикулов:', error);
        }
    },

    async manualLookupByKod(kod) {
        if (!kod) {
            document.getElementById('manualCategory').value = '';
            document.getElementById('manualArt').value = '';
            document.getElementById('manualUnit').value = '';
            // Перезагружаем список артикулов без фильтра
            this.loadManualArts(null);
            return;
        }

        try {
            const sql = `SELECT "type", "art", "edizm" FROM "guide" WHERE "kod"='${kod.replace(/'/g, "''")}' LIMIT 1`;
            const result = await this.query(sql);

            if (result && result.trim()) {
                const lines = result.trim().split('\n').filter(l => l);
                if (lines.length >= 2) {
                    const parts = lines[1].split('\t');
                    const typeIndex = lines[0].split('\t').indexOf('type');
                    const artIndex = lines[0].split('\t').indexOf('art');
                    const edizmIndex = lines[0].split('\t').indexOf('edizm');

                    const type = (typeIndex >= 0 ? parts[typeIndex] : '').trim();
                    const art = (artIndex >= 0 ? parts[artIndex] : '').trim();
                    const edizm = (edizmIndex >= 0 ? parts[edizmIndex] : '').trim();

                    if (type) {
                        document.getElementById('manualCategory').value = type;
                        // Фильтруем артикулы по категории
                        this.loadManualArts(type);
                    }
                    if (art) {
                        document.getElementById('manualArt').value = art;
                    }
                    if (edizm) {
                        document.getElementById('manualUnit').value = edizm;
                    }
                }
            }
        } catch (error) {
            console.error('Ошибка поиска по коду:', error);
        }
    },

    async manualLookupByArt(art) {
        if (!art) {
            document.getElementById('manualKod').value = '';
            return;
        }

        try {
            const cat = document.getElementById('manualCategory').value;
            let sql = `SELECT "kod" FROM "guide" WHERE "art"='${art.replace(/'/g, "''")}'`;
            if (cat) {
                sql += ` AND "type"='${cat.replace(/'/g, "''")}'`;
            }
            sql += ` LIMIT 1`;

            const result = await this.query(sql);
            if (result && result.trim()) {
                const lines = result.trim().split('\n').filter(l => l);
                if (lines.length >= 2) {
                    const parts = lines[1].split('\t');
                    const kodIndex = lines[0].split('\t').indexOf('kod');
                    if (kodIndex >= 0) {
                        document.getElementById('manualKod').value = parts[kodIndex].trim();
                    }
                }
            }
        } catch (error) {
            console.error('Ошибка поиска kod по art:', error);
        }
    },

    bindManualModalEvents() {
        const kodInput = document.getElementById('manualKod');
        const categorySelect = document.getElementById('manualCategory');
        const artSelect = document.getElementById('manualArt');
        const unitInput = document.getElementById('manualUnit');

        kodInput.addEventListener('input', async () => {
            const kod = kodInput.value.trim();
            if (kod) {
                this.manualLookupByKod(kod);
            }
        });

        artSelect.addEventListener('change', async () => {
            const art = artSelect.value;
            if (!art) {
                unitInput.value = '';
                return;
            }

            try {
                const cat = categorySelect.value;
                const sql = `SELECT "kod", "type", "edizm" FROM "guide" WHERE "art"='${art.replace(/'/g, "''")}' LIMIT 1`;
                const result = await this.query(sql);

                if (result && result.trim()) {
                    const lines = result.trim().split('\n').filter(l => l);
                    if (lines.length >= 2) {
                        const parts = lines[1].split('\t');
                        const kodIndex = lines[0].split('\t').indexOf('kod');
                        const typeIndex = lines[0].split('\t').indexOf('type');
                        const edizmIndex = lines[0].split('\t').indexOf('edizm');

                        if (kodIndex >= 0) {
                            kodInput.value = parts[kodIndex].trim();
                        }
                        if (typeIndex >= 0) {
                            const catValue = parts[typeIndex].trim();
                            categorySelect.value = catValue;
                            this.loadManualArts(catValue);
                        }
                        if (edizmIndex >= 0) {
                            unitInput.value = parts[edizmIndex].trim();
                        }
                    }
                }
            } catch (error) {
                console.error('Ошибка поиска данных по артикулу:', error);
            }
        });

        categorySelect.addEventListener('change', () => {
            const cat = categorySelect.value;
            this.loadManualArts(cat);
            artSelect.value = '';
            unitInput.value = '';
        });

        artSelect.addEventListener('change', async () => {
            const art = artSelect.value;
            if (!art) {
                unitInput.value = '';
                return;
            }

            try {
                const cat = categorySelect.value;
                const sql = `SELECT "kod", "type", "edizm" FROM "guide" WHERE "art"='${art.replace(/'/g, "''")}' LIMIT 1`;
                const result = await this.query(sql);

                if (result && result.trim()) {
                    const lines = result.trim().split('\n').filter(l => l);
                    if (lines.length >= 2) {
                        const parts = lines[1].split('\t');
                        const kodIndex = lines[0].split('\t').indexOf('kod');
                        const typeIndex = lines[0].split('\t').indexOf('type');
                        const edizmIndex = lines[0].split('\t').indexOf('edizm');

                        if (kodIndex >= 0) {
                            kodInput.value = parts[kodIndex].trim();
                        }
                        if (typeIndex >= 0) {
                            const catValue = parts[typeIndex].trim();
                            categorySelect.value = catValue;
                            this.loadManualArts(catValue);
                        }
                        if (edizmIndex >= 0) {
                            unitInput.value = parts[edizmIndex].trim();
                        }
                    }
                }
            } catch (error) {
                console.error('Ошибка поиска данных по артикулу:', error);
            }
        });
    },

    // ============================================================
    // ПРИНЯТЬ НА СКЛАД
    // ============================================================

    buildAcceptStockTable() {
        // Очистка таблицы результатов
        const tbody = document.getElementById('acceptResultsBody');
        tbody.innerHTML = '';

        this.foundItems.forEach((item, index) => {
            const tr = document.createElement('tr');

            // Картинка
            let imgHtml = '';
            if (this.imageData[item.kod]) {
                imgHtml = `<img class="accept-thumbnail" src="${this.imageData[item.kod]}" alt="" title="Клик — просмотр">`;
            } else {
                imgHtml = `<span class="no-accept-img">+</span>`;
            }

            tr.innerHTML = `
                <td class="accept-img-cell">${imgHtml}</td>
                <td>${this.escapeHtml(item.kod)}</td>
                <td>${this.escapeHtml(item.art)}</td>
                <td>${item.kolich}</td>
                <td>${this.escapeHtml(item.unit)}</td>
                <td>
                    <button class="btn-delete-accept" data-index="${index}">🗑️</button>
                </td>
            `;

            tbody.appendChild(tr);
        });

        // Привязываем картинки
        tbody.querySelectorAll('.accept-thumbnail').forEach(thumb => {
            thumb.addEventListener('click', () => {
                const src = thumb.src;
                document.getElementById('fullviewImg').src = src;
                document.getElementById('imageFullview').classList.add('active');
            });
        });

        // Привязываем "+" для загрузки картинок
        tbody.querySelectorAll('.no-accept-img').forEach(span => {
            span.addEventListener('click', () => {
                const row = span.closest('tr');
                const kod = row.children[1].textContent.trim();
                const thumbCell = row.querySelector('.accept-img-cell');
                this.openImageUpload(kod, thumbCell.querySelector('img'));
            });
        });

        // Привязываем удаление
        tbody.querySelectorAll('.btn-delete-accept').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.getAttribute('data-index'));
                this.foundItems.splice(index, 1);
                this.buildAcceptStockTable();
            });
        });

        // Показываем/скрываем результаты
        document.getElementById('acceptResults').style.display =
            this.foundItems.length > 0 ? 'block' : 'none';
    },

    showAcceptResult(kod, art, koli, unit) {
        // Если таблица уже отображается — добавляем строку
        const tbody = document.getElementById('acceptResultsBody');
        const row = document.createElement('tr');

        // Картинка
        let imgHtml = '';
        if (this.imageData[kod]) {
            imgHtml = `<img class="accept-thumbnail" src="${this.imageData[kod]}" alt="" title="Клик — просмотр">`;
        } else {
            imgHtml = `<span class="no-accept-img">+</span>`;
        }

        row.innerHTML = `
            <td class="accept-img-cell">${imgHtml}</td>
            <td>${this.escapeHtml(kod)}</td>
            <td>${this.escapeHtml(art)}</td>
            <td>${koli}</td>
            <td>${this.escapeHtml(unit)}</td>
            <td>
                <button class="btn-delete-accept" data-index="${this.foundItems.length - 1}">🗑️</button>
            </td>
        `;

        tbody.appendChild(row);

        // Привязываем картинки
        const thumb = row.querySelector('.accept-thumbnail');
        if (thumb) {
            thumb.addEventListener('click', () => {
                const src = thumb.src;
                document.getElementById('fullviewImg').src = src;
                document.getElementById('imageFullview').classList.add('active');
            });
        }

        const noImg = row.querySelector('.no-accept-img');
        if (noImg) {
            noImg.addEventListener('click', () => {
                const thumbCell = row.querySelector('.accept-img-cell');
                this.openImageUpload(kod, null);
            });
        }

        const index = this.foundItems.length - 1;
        row.querySelector('.btn-delete-accept').addEventListener('click', () => {
            this.foundItems.splice(index, 1);
            this.buildAcceptStockTable();
        });
    },

    rebuildAcceptTable() {
        this.buildAcceptStockTable();
    },

    openAcceptStockModal() {
        this.foundItems = [];
        document.getElementById('acceptShopCode').value = '';
        document.getElementById('acceptResults').style.display = 'none';
        document.getElementById('acceptStockModal').style.display = 'flex';
    },

    closeAcceptStockModal() {
        document.getElementById('acceptStockModal').style.display = 'none';
    },

    async checkShk() {
        const shopCode = document.getElementById('acceptShopCode').value.trim();
        if (!shopCode) {
            alert('Введите код магазина');
            return;
        }

        console.log('[checkShk] Ищем kodmagaz =', shopCode);

        try {
            // Сначала ищем kodnas в prihod по kodmagaz
            const sql = `SELECT "kodnas", "kolich" FROM "prihod" WHERE "kodmagaz"='${shopCode.replace(/'/g, "''")}'`;
            console.log('[checkShk] SQL prihod:', sql);

            const prihodResult = await this.query(sql);
            console.log('[checkShk] Результат prihod:', prihodResult);

            // НЕ очищаем foundItems — каждый поиск добавляет к существующим
            if (prihodResult && prihodResult.trim()) {
                const lines = prihodResult.trim().split('\n').filter(l => l);
                console.log('[checkShk] Строк результатов:', lines.length);

                if (lines.length > 1) {
                    const headers = lines[0].split('\t').map(h => h.trim().toLowerCase().replace(/"/g, ''));
                    console.log('[checkShk] Заголовки:', headers);

                    const kodnasIdx = headers.indexOf('kodnas');
                    const kolichIdx = headers.indexOf('kolich');

                    // Сначала собираем все kodnas
                    const items = [];
                    for (let i = 1; i < lines.length; i++) {
                        const parts = lines[i].split('\t');

                        const kodnas = kodnasIdx >= 0 ? parts[kodnasIdx]?.trim() : '';
                        const kolich = kolichIdx >= 0 ? parseInt(parts[kolichIdx]) || 0 : 0;

                        if (!kodnas) continue;
                        items.push({ kod: kodnas, kolich });
                    }

                    // Одним запросом подтягиваем art и edizm из guide для всех kodnas
                    if (items.length > 0) {
                        const kodList = items.map(it => `'${it.kod.replace(/'/g, "''")}'`).join(',');
                        const guideSql = `SELECT "kod", "art", "edizm" FROM "guide" WHERE "kod" IN (${kodList})`;
                        const guideResult = await this.query(guideSql);
                        console.log('[checkShk] SQL guide:', guideSql);

                        const guideData = {};
                        if (guideResult && guideResult.trim()) {
                            const guideLines = guideResult.trim().split('\n').filter(l => l);
                            if (guideLines.length > 1) {
                                const guideHeaders = guideLines[0].split('\t').map(h => h.trim().toLowerCase().replace(/"/g, ''));
                                const gKodIdx = guideHeaders.indexOf('kod');
                                const gArtIdx = guideHeaders.indexOf('art');
                                const gEdizmIdx = guideHeaders.indexOf('edizm');

                                for (let i = 1; i < guideLines.length; i++) {
                                    const gp = guideLines[i].split('\t');
                                    const gKod = gKodIdx >= 0 ? gp[gKodIdx]?.trim() : '';
                                    if (gKod) {
                                        guideData[gKod] = {
                                            art: gArtIdx >= 0 ? (gp[gArtIdx]?.trim() || '—') : '—',
                                            edizm: gEdizmIdx >= 0 ? (gp[gEdizmIdx]?.trim() || 'шт') : 'шт'
                                        };
                                    }
                                }
                            }
                        }
                        console.log('[checkShk] Данные guide:', guideData);

                        // Формируем foundItems
                        for (const item of items) {
                            const g = guideData[item.kod];
                            const art = g?.art || '—';
                            const edizm = g?.edizm || 'шт';

                            console.log('[checkShk] Добавлен товар:', item.kod, art, item.kolich, edizm);
                            this.foundItems.push({ kod: item.kod, art, kolich: item.kolich, unit: edizm });
                        }
                    }
                }
            }

            console.log('[checkShk] Итого найдено:', this.foundItems.length);

            this.buildAcceptStockTable();

            // Очищаем поле и ставим фокус для следующего поиска
            document.getElementById('acceptShopCode').value = '';
            document.getElementById('acceptShopCode').focus();

            if (this.foundItems.length === 0) {
                // Не найдено — открываем модальное окно "Не найдено"
                this.openNotFoundModal(shopCode, 0);
            }
        } catch (error) {
            console.error('Ошибка при проверке ШК:', error);
            alert('Ошибка при проверке ШК: ' + error.message);
        }
    },

    acceptWithoutShk() {
        this.foundItems = [];
        this.buildAcceptStockTable();
    },

    async acceptAllItems() {
        if (this.foundItems.length === 0) {
            alert('Нет товаров для принятия');
            return;
        }

        const now = new Date();
        const dataStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().split(' ')[0].slice(0, 8);
        const userId = localStorage.getItem('userId') || '';
        const userName = localStorage.getItem('userName') || userId;

        try {
            let totalQty = 0;
            for (const item of this.foundItems) {
                totalQty += item.kolich;
            }

            // BATCH INSERT — один запрос вместо N
            const values = this.foundItems.map(item =>
                `('${item.kod.replace(/'/g, "''")}', '${dataStr}', '${timeStr}', '1', '${item.kolich}', '${userName.replace(/'/g, "''")}', '${userId.replace(/'/g, "''")}')`
            ).join(', ');

            await this.query(
                `INSERT INTO "history" ("kod", "data", "time", "quantity", "prostuk", "user", "ID_user") VALUES ${values}`
            );

            console.log(`✅ Записано в history: ${this.foundItems.length} товаров, всего ${totalQty} шт`);
            this.closeAcceptStockModal();

            // Обновляем таблицу склада
            await this.loadData();
        } catch (error) {
            console.error('Ошибка записи в history:', error);
            alert('Ошибка записи: ' + error.message);
        }
    },

    // ============================================================
    // ПОИСК ПО ШК
    // ============================================================

    shkSearch() {
        const query = document.getElementById('shkSearchInput').value.trim();
        if (!query) {
            alert('Введите код магазина');
            return;
        }

        // Показываем результаты
        document.getElementById('shkSearchResults').style.display = 'block';

        // Ищем в prihod
        const sql = `SELECT "kodnas", "art", "kolich", "kodmagaz" FROM "prihod" WHERE "kodmagaz" LIKE '${query}%' LIMIT 50`;
        this.query(sql).then(result => {
            const tbody = document.getElementById('shkSearchResultsBody');
            tbody.innerHTML = '';

            if (result && result.trim()) {
                const lines = result.trim().split('\n').filter(l => l);
                if (lines.length > 1) {
                    const headers = lines[0].split('\t');

                    for (let i = 1; i < lines.length; i++) {
                        const parts = lines[i].split('\t');
                        const kodnas = (headers.indexOf('kodnas') >= 0 ? parts[headers.indexOf('kodnas')] : '').trim();
                        const art = (headers.indexOf('art') >= 0 ? parts[headers.indexOf('art')] : '').trim();
                        const kolich = (headers.indexOf('kolich') >= 0 ? parseInt(parts[headers.indexOf('kolich')]) || 0 : 0);
                        const kodmagaz = (headers.indexOf('kodmagaz') >= 0 ? parts[headers.indexOf('kodmagaz')] : '').trim();

                        if (kodnas && art) {
                            const tr = document.createElement('tr');
                            tr.innerHTML = `
                                <td>${this.escapeHtml(kodmagaz)}</td>
                                <td>${this.escapeHtml(kodnas)}</td>
                                <td>${this.escapeHtml(art)}</td>
                                <td>${kolich}</td>
                                <td>
                                    <button class="btn btn-primary btn-small shk-add-btn"
                                        data-kod="${this.escapeHtml(kodnas)}"
                                        data-art="${this.escapeHtml(art)}"
                                        data-kolich="${kolich}">
                                        ➕ Добавить
                                    </button>
                                </td>
                            `;
                            tbody.appendChild(tr);
                        }
                    }

                    // Привязываем кнопки "Добавить"
                    tbody.querySelectorAll('.shk-add-btn').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const kod = btn.getAttribute('data-kod');
                            const art = btn.getAttribute('data-art');
                            const kolich = parseInt(btn.getAttribute('data-kolich'));

                            this.foundItems.push({ kod, art, kolich, unit: 'шт' });

                            // Активируем кнопку "Добавить выбранное"
                            document.getElementById('shkAddSelectedBtn').disabled = false;

                            // Обновляем счётчик
                            const counter = document.getElementById('shkSelectedCounter');
                            if (counter) {
                                counter.textContent = `(${this.foundItems.length})`;
                            }
                        });
                    });
                }
            }
        });
    },

    addShkSelected() {
        if (this.foundItems.length === 0) {
            alert('Выберите товары для добавления');
            return;
        }

        this.buildAcceptStockTable();
        this.closeShkSearchModal();
    },

    closeShkSearchModal() {
        document.getElementById('shkSearchModal').style.display = 'none';
        document.getElementById('shkSearchResults').style.display = 'none';
        document.getElementById('shkSearchInput').value = '';
        document.getElementById('shkAddSelectedBtn').disabled = true;
        this.foundItems = [];
    },

    // ============================================================
    // ПРИНЯТЬ НА СКЛАД - МОДАЛЬНОЕ ОКНО
    // ============================================================

    async checkShkAndSearch() {
        const shopCode = document.getElementById('acceptShopCode').value.trim();
        if (!shopCode) {
            alert('Введите код магазина');
            return;
        }

        // Открываем модальное окно поиска по ШК
        document.getElementById('shkSearchInput').value = shopCode;
        document.getElementById('shkSearchModal').style.display = 'flex';
        document.getElementById('shkSearchResults').style.display = 'none';
        this.foundItems = [];
        document.getElementById('shkAddSelectedBtn').disabled = true;

        // Автоматически выполняем поиск
        this.shkSearch();
    },

    // ============================================================
    // ЗАДАЧИ (РАСХОДНИКИ, УПАКОВКА)
    // ============================================================
    tasksData: { rashodnik: [], upakovka: [], vnutriceh: [] },
    tasksActiveTab: 'rashodnik',
    tasksOrdered: {}, // { taskId: { ordered, date, time, user, taskType } }
    customTasksBd: [], // [{ id, text, ordered, date, time, user }]
    tasksIsLoading: false,

    openTasksModal: function() {
        var self = this;
        if (this.tasksIsLoading) return;
        var modal = document.getElementById('tasksModal');
        if (modal.style.display === 'flex') return;

        this.tasksIsLoading = true;

        // Создаём таблицу если нет
        this.createTasksTable().then(function() {
            // Загружаем роль текущего пользователя
            return self.getCurrentUserRole().then(function(role) {
                self.currentUserRole = role;
                self.currentUserUserId = localStorage.getItem('userId') || '';

                // Показываем загрузку
                document.getElementById('tasksLoading').style.display = 'flex';
                document.getElementById('tasksContent').style.display = 'none';
                modal.style.display = 'flex';

                // Загружаем данные из БД
                return self.loadTasksData();
            });
        }).then(function() {
            self.tasksIsLoading = false;
        }).catch(function(e) {
            console.error('[tasks] Ошибка открытия модалки:', e);
            self.tasksIsLoading = false;
        });
    },

    getCurrentUserRole: function() {
        var self = this;
        var userId = localStorage.getItem('userId') || '';
        return this.query(
            'SELECT "status" FROM "sotrud" WHERE "ID"=\'' + userId.replace(/'/g, "''") + '\''
        ).then(function(result) {
            if (result && result.trim()) {
                var lines = result.trim().split('\n');
                if (lines.length >= 2) {
                    var parts = lines[1].split('\t');
                    var statusIdx = lines[0].split('\t').indexOf('status');
                    if (statusIdx >= 0) {
                        return (parts[statusIdx] || '').trim();
                    }
                }
            }
            return '';
        }).catch(function() {
            return '';
        });
    },

    createTasksTable: function() {
        return this.query(
            'CREATE TABLE IF NOT EXISTS "tasks_order" (' +
            '"id" TEXT PRIMARY KEY, ' +
            '"user" TEXT NOT NULL, ' +
            '"task_id" TEXT NOT NULL, ' +
            '"task_text" TEXT, ' +
            '"task_type" TEXT DEFAULT \'custom\', ' +
            '"ordered" INTEGER DEFAULT 0, ' +
            '"date" TEXT, ' +
            '"time" TEXT)'
        ).then(function() {
            console.log('[tasks] Таблица tasks_order готова');
        }).catch(function(e) {
            console.error('[tasks] Ошибка создания таблицы:', e);
        });
    },

    loadTasksData: function() {
        var self = this;
        return this.query(
            'SELECT "kod", "art", "min", "type" FROM "guide" ' +
            "WHERE \"type\" IN ('Расходник', 'Упаковка', 'Внутрицех')"
        ).then(function(result) {
            // Собираем guide-данные
            var guideMap = {};
            var allKods = [];

            if (result && result.trim()) {
                var lines = result.trim().split('\n');
                if (lines.length > 1) {
                    var headers = lines[0].split('\t');
                    var kodIdx = headers.indexOf('kod');
                    var artIdx = headers.indexOf('art');
                    var minIdx = headers.indexOf('min');
                    var typeIdx = headers.indexOf('type');

                    for (var i = 1; i < lines.length; i++) {
                        var parts = lines[i].split('\t');
                        var kod = kodIdx >= 0 ? (parts[kodIdx] || '').trim() : '';
                        if (!kod) continue;

                        guideMap[kod] = {
                            art: artIdx >= 0 ? (parts[artIdx] || '').trim() : '',
                            min: minIdx >= 0 ? parseInt(parts[minIdx]) || 0 : 0,
                            type: typeIdx >= 0 ? (parts[typeIdx] || '').trim() : ''
                        };
                        allKods.push(kod);
                    }
                }
            }

            // Загружаем остатки из history
            var warehouseCache = {};
            if (allKods.length > 0) {
                var kodList = allKods.map(function(k) { return "'" + k.replace(/'/g, "''") + "'"; }).join(',');
                return self.query(
                    'SELECT "kod", "quantity", "prostuk" FROM "history" WHERE "kod" IN (' + kodList + ')'
                ).then(function(histResult) {
                    if (histResult && histResult.trim()) {
                        var histLines = histResult.trim().split('\n');
                        if (histLines.length > 1) {
                            var histHeaders = histLines[0].split('\t');
                            var hkIdx = histHeaders.indexOf('kod');
                            var hqIdx = histHeaders.indexOf('quantity');
                            var hpIdx = histHeaders.indexOf('prostuk');

                            for (var j = 1; j < histLines.length; j++) {
                                var hv = histLines[j].split('\t');
                                var hk = hkIdx >= 0 ? (hv[hkIdx] || '').trim() : '';
                                if (hk) {
                                    if (!warehouseCache[hk]) warehouseCache[hk] = 0;
                                    warehouseCache[hk] += (hqIdx >= 0 ? parseFloat(hv[hqIdx]) || 0 : 0) * (hpIdx >= 0 ? parseFloat(hv[hpIdx]) || 0 : 0);
                                }
                            }
                        }
                    }

                    // Загружаем задачи из tasks_order
                    var tasksOrdered = {};
                    var customTasks = [];
                    var userIds = [];

                    return self.query(
                        'SELECT "id", "user", "task_id", "task_text", "task_type", "ordered", "date", "time" FROM "tasks_order" ORDER BY "date" DESC, "time" DESC'
                    ).then(function(tasksResult) {
                        if (tasksResult && tasksResult.trim()) {
                            var tLines = tasksResult.trim().split('\n');
                            if (tLines.length > 1) {
                                var tHeaders = tLines[0].split('\t');
                                var tiIdx = tHeaders.indexOf('id');
                                var tuIdx = tHeaders.indexOf('user');
                                var ttIdx = tHeaders.indexOf('task_id');
                                var ttxIdx = tHeaders.indexOf('task_text');
                                var ttpIdx = tHeaders.indexOf('task_type');
                                var torIdx = tHeaders.indexOf('ordered');
                                var tdIdx = tHeaders.indexOf('date');
                                var tmIdx = tHeaders.indexOf('time');

                                for (var k = 1; k < tLines.length; k++) {
                                    var tp = tLines[k].split('\t');
                                    var tid = tiIdx >= 0 ? (tp[tiIdx] || '').trim() : '';
                                    if (tid) {
                                        var userId = tuIdx >= 0 ? (tp[tuIdx] || '') : '';
                                        if (userId) userIds.push(userId);

                                        tasksOrdered[tid] = {
                                            ordered: torIdx >= 0 ? (parseInt(tp[torIdx]) || 0) === 1 : false,
                                            date: tdIdx >= 0 ? (tp[tdIdx] || '') : '',
                                            time: tmIdx >= 0 ? (tp[tmIdx] || '') : '',
                                            user: userId,
                                            taskType: ttpIdx >= 0 ? (tp[ttpIdx] || '') : ''
                                        };

                                        if (ttpIdx >= 0 && (tp[ttpIdx] || '') === 'custom') {
                                            customTasks.push({
                                                id: tid,
                                                text: ttxIdx >= 0 ? (tp[ttxIdx] || '') : '',
                                                ordered: torIdx >= 0 ? (parseInt(tp[torIdx]) || 0) === 1 : false,
                                                date: tdIdx >= 0 ? (tp[tdIdx] || '') : '',
                                                time: tmIdx >= 0 ? (tp[tmIdx] || '') : '',
                                                user: userId
                                            });
                                        }
                                    }
                                }
                            }
                        }

                        // Загружаем имена пользователей
                        var userNames = {};
                        if (userIds.length > 0) {
                            var userIdsList = userIds.map(function(u) { return "'" + u.replace(/'/g, "''") + "'"; }).join(',');
                            return self.query(
                                'SELECT "ID", "NAME" FROM "sotrud" WHERE "ID" IN (' + userIdsList + ')'
                            ).then(function(namesResult) {
                                if (namesResult && namesResult.trim()) {
                                    var nLines = namesResult.trim().split('\n');
                                    if (nLines.length > 1) {
                                        var nHeaders = nLines[0].split('\t');
                                        var nIdIdx = nHeaders.indexOf('ID');
                                        // Ищем 'name' или 'NAME' или 'name' в нижнем регистре
                                        var nNameIdx = -1;
                                        for (var h = 0; h < nHeaders.length; h++) {
                                            if (nHeaders[h].toLowerCase() === 'name') {
                                                nNameIdx = h;
                                                break;
                                            }
                                        }

                                        console.log('[tasks] Заголовки:', nHeaders);
                                        console.log('[tasks] ID индекс:', nIdIdx, 'Name индекс:', nNameIdx);

                                        for (var n = 1; n < nLines.length; n++) {
                                            var np = nLines[n].split('\t');
                                            var nId = nIdIdx >= 0 ? (np[nIdIdx] || '').trim() : '';
                                            var nName = nNameIdx >= 0 ? (np[nNameIdx] || '').trim() : '';
                                            console.log('[tasks] Строка:', nId, '->', nName);
                                            if (nId) userNames[nId] = nName || nId;
                                        }
                                    }
                                }

                                console.log('[tasks] Загружены имена пользователей:', userNames);
                                console.log('[tasks] self.userNames:', userNames);

                                // Сохраняем имена пользователей
                                self.userNames = userNames;

                                // history уже загружена выше, не делаем повторный запрос
                                return namesResult;
                            });
                        } else {
                            self.userNames = {};
                            // history уже загружена выше, не делаем повторный запрос
                            return null;
                        }
                    }).then(function(namesResult) {
                        // namesResult здесь — это результат запроса к sotrud (или null),
                        // history уже распаршена выше, warehouseCache уже готов

                        self.tasksOrdered = tasksOrdered;
                        self.customTasksBd = customTasks;

                        // Собираем задачи
                        self.tasksData = { rashodnik: [], upakovka: [], vnutriceh: [] };
                        var currentDbTaskIds = [];

                        for (var kod in guideMap) {
                            if (guideMap.hasOwnProperty(kod)) {
                                var info = guideMap[kod];
                                var current = warehouseCache[kod] || 0;

                                if (current < info.min) {
                                    var tab = null;
                                    if (info.type === 'Расходник') tab = 'rashodnik';
                                    else if (info.type === 'Упаковка') tab = 'upakovka';
                                    else if (info.type === 'Внутрицех') tab = 'vnutriceh';

                                    if (tab) {
                                        var dbTaskId = 'db-' + kod + '-' + info.art;
                                        self.tasksData[tab].push({
                                            id: dbTaskId,
                                            kod: kod,
                                            art: info.art,
                                            current: current,
                                            min: info.min,
                                            type: info.type,
                                            isCustom: false
                                        });
                                        currentDbTaskIds.push(dbTaskId);
                                    }
                                }
                            }
                        }

                        // Добавляем кастомные задачи
                        customTasks.forEach(function(ct) {
                            self.tasksData.vnutriceh.push({
                                id: ct.id,
                                text: ct.text,
                                isCustom: true,
                                customId: ct.id,
                                ordered: ct.ordered,
                                bdDate: ct.date,
                                bdTime: ct.time,
                                bdUser: ct.user
                            });
                        });

                        // Удаляем из БД задачи, которые больше не дефицитны (current >= min)
                        var tasksOrderedKeys = Object.keys(tasksOrdered);
                        var tasksToDelete = [];
                        for (var t = 0; t < tasksOrderedKeys.length; t++) {
                            var taskId = tasksOrderedKeys[t];
                            // Если это DB-задача и её нет в текущем списке дефицита
                            if (taskId.indexOf('db-') === 0 && tasksOrdered[taskId].taskType === 'db') {
                                var found = false;
                                for (var d = 0; d < currentDbTaskIds.length; d++) {
                                    if (currentDbTaskIds[d] === taskId) {
                                        found = true;
                                        break;
                                    }
                                }
                                if (!found) {
                                    tasksToDelete.push(taskId);
                                    // Удаляем из локального кэша
                                    delete tasksOrdered[taskId];
                                }
                            }
                        }

                        // Удаляем из БД задачи, которые больше не дефицитны
                        if (tasksToDelete.length > 0) {
                            console.log('[tasks] Удаляем задачи, которые больше не дефицитны:', tasksToDelete);
                            var deletePromises = [];
                            for (var t = 0; t < tasksToDelete.length; t++) {
                                (function(taskId) {
                                    deletePromises.push(
                                        self.query(
                                            'DELETE FROM "tasks_order" WHERE "id"=\'' + taskId.replace(/'/g, "''") + '\''
                                        )
                                    );
                                })(tasksToDelete[t]);
                            }
                        }

                        // Показываем контент
                        document.getElementById('tasksLoading').style.display = 'none';
                        document.getElementById('tasksContent').style.display = 'block';

                        self.renderTasksList();
                        self.updateTaskCounts();
                    });
                });
            }
        }).catch(function(e) {
            console.error('Ошибка загрузки задач:', e);
            document.getElementById('tasksLoading').innerHTML = '<div class="error-message">Ошибка загрузки данных</div>';
        });
    },

    renderTasksList: function() {
        if (!this.tasksData || !this.tasksActiveTab) return;
        var self = this;
        var tab = this.tasksActiveTab;
        var items = this.tasksData[tab] || [];
        var listEl = document.getElementById(tab + 'List');
        if (!listEl) return;
        var emptyEl = document.getElementById('tasksEmptyMsg');

        var isAdmin = self.currentUserRole === 'Админ';

        // Скрываем все секции
        document.querySelectorAll('.task-list-section').forEach(function(section) {
            section.classList.remove('active');
        });

        listEl.innerHTML = '';

        if (items.length === 0) {
            emptyEl.style.display = 'block';
        } else {
            emptyEl.style.display = 'none';

            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                var tr = document.createElement('div');
                tr.className = 'task-item' + (item.isCustom ? ' task-item-custom' : '');

                if (item.isCustom) {
                    var isChecked = self.tasksOrdered[item.id] && self.tasksOrdered[item.id].ordered;
                    var dateTime = item.bdDate && item.bdTime
                        ? item.bdDate + ' ' + item.bdTime
                        : '\u2014';
                    
                    // Показываем имя пользователя
                    var userName = item.bdUser || '\u2014';
                    if (self.userNames && self.userNames[item.bdUser]) {
                        userName = self.userNames[item.bdUser];
                    }
                    
                    var isAuthor = item.bdUser === self.currentUserUserId;
                    var canDelete = isAdmin || isAuthor;

                    var statusBtn = isChecked
                        ? '<button class="btn-order ordered" data-task-id="' + item.id + '" disabled>\u2713 \u0412 \u0440\u0430\u0431\u043e\u0442\u0435</button>'
                        : '';

                    var removeBtn = canDelete
                        ? '<button class="task-item-remove" data-custom-id="' + item.id + '" title="Удалить">🗑️</button>'
                        : '';

                    tr.innerHTML =
                        '<input type="checkbox" class="task-order-checkbox" data-task-id="' + item.id + '"' + (isChecked && isAdmin ? ' checked' : '') + (isAdmin ? '' : ' disabled style="opacity:0.3;pointer-events:none;"') + '>' +
                        '<div class="task-item-info">' +
                            '<div class="task-item-art">' + self.escapeHtml(item.text) + '</div>' +
                            '<div class="task-item-meta" style="font-size:0.95rem;">' + self.escapeHtml(userName) + ' \u2014 ' + dateTime + '</div>' +
                        '</div>' +
                        statusBtn +
                        removeBtn;
                } else {
                    var isChecked2 = self.tasksOrdered[item.id] && self.tasksOrdered[item.id].ordered;
                    var statusBtn2 = isChecked2
                        ? '<button class="btn-order ordered" data-task-id="' + item.id + '" disabled>\u2713 \u0417\u0430\u043a\u0430\u0437\u0430\u043d\u043e</button>'
                        : '';

                    var metaHtml = 'Код: ' + self.escapeHtml(item.kod) + ' | \u041e\u0441\u0442\u0430\u0442\u043e\u043a: ' + Math.floor(item.current) + ' | Min: ' + Math.floor(item.min);

                    tr.innerHTML =
                        '<input type="checkbox" class="task-order-checkbox" data-task-id="' + item.id + '"' + (isChecked2 && isAdmin ? ' checked' : '') + (isAdmin ? '' : ' disabled style="opacity:0.3;pointer-events:none;"') + '>' +
                        '<div class="task-item-info">' +
                            '<div class="task-item-art">' + self.escapeHtml(item.art) + '</div>' +
                            '<div class="task-item-meta" style="font-size:0.95rem;">' + metaHtml + '</div>' +
                        '</div>' +
                        statusBtn2;
                }

                listEl.appendChild(tr);
            }

            // Привязываем чекбоксы (только для админов)
            listEl.querySelectorAll('.task-order-checkbox:not([disabled])').forEach(function(cb) {
                cb.addEventListener('change', function(e) {
                    var taskId = e.target.getAttribute('data-task-id');
                    self.toggleOrderTask(taskId, e.target.checked);
                });
            });

            // Привязываем удаление пользовательских задач
            listEl.querySelectorAll('.task-item-remove').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var taskId = btn.getAttribute('data-custom-id');
                    self.removeCustomTask(taskId);
                });
            });
        }

        // Показываем текущую секцию
        var activeSection = document.querySelector('.task-list-section[data-tab="' + tab + '"]');
        if (activeSection) {
            activeSection.classList.add('active');
        }
    },

    toggleOrderTask: function(taskId, checked) {
        var self = this;
        var userId = localStorage.getItem('userId') || '';
        var now = new Date();
        var dateStr = now.toISOString().split('T')[0];
        var timeStr = now.toTimeString().split(' ')[0].slice(0, 5);

        if (checked) {
            // Записываем заказ
            this.query(
                'INSERT INTO "tasks_order" ("id", "user", "task_id", "ordered", "date", "time") ' +
                "VALUES ('" + taskId.replace(/'/g, "''") + "', '" + userId.replace(/'/g, "''") + "', '" + taskId.replace(/'/g, "''") + "', 1, '" + dateStr + "', '" + timeStr + "')" +
                ' ON CONFLICT("id") DO UPDATE SET "ordered"=1, "user"=\'' + userId.replace(/'/g, "''") + '\', "date"=\'' + dateStr + '\', "time"=\'' + timeStr + '\''
            ).then(function() {
                self.tasksOrdered[taskId] = {
                    ordered: true,
                    date: dateStr,
                    time: timeStr,
                    user: userId
                };
                self.renderTasksList();
            }).catch(function(e) {
                console.error('[tasks] Ошибка сохранения статуса:', e);
                alert('Ошибка сохранения: ' + e.message);
            });
        } else {
            // Снимаем заказ
            this.query(
                'UPDATE "tasks_order" SET "ordered"=0, "user"=\'' + userId.replace(/'/g, "''") + '\', "date"=\'' + dateStr + '\', "time"=\'' + timeStr + '\' WHERE "task_id"=\'' + taskId.replace(/'/g, "''") + '\''
            ).then(function() {
                self.tasksOrdered[taskId] = {
                    ordered: false,
                    date: dateStr,
                    time: timeStr,
                    user: userId
                };
                self.renderTasksList();
            }).catch(function(e) {
                console.error('[tasks] Ошибка сохранения статуса:', e);
                alert('Ошибка сохранения: ' + e.message);
            });
        }
    },

    updateTaskCounts: function() {
        var self = this;
        var tabs = ['rashodnik', 'upakovka', 'vnutriceh'];
        tabs.forEach(function(tab) {
            var countEl = document.getElementById(tab + 'Count');
            if (countEl) {
                countEl.textContent = (self.tasksData[tab] || []).length;
            }
        });
    },

    switchTaskTab: function(tabName) {
        var self = this;
        self.tasksActiveTab = tabName;

        // Обновляем кнопки вкладок
        document.querySelectorAll('.task-tab').forEach(function(btn) {
            if (btn.getAttribute('data-tab') === tabName) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        self.renderTasksList();
    },

    addCustomTask: function(text) {
        var self = this;
        var userId = localStorage.getItem('userId') || '';
        var now = new Date();
        var dateStr = now.toISOString().split('T')[0];
        var timeStr = now.toTimeString().split(' ')[0].slice(0, 5);
        var id = 'custom-' + Date.now().toString(36);

        try {
            // Записываем в БД
            this.query(
                'INSERT INTO "tasks_order" ("id", "user", "task_id", "task_text", "task_type", "ordered", "date", "time") ' +
                "VALUES ('" + id.replace(/'/g, "''") + "', '" + userId.replace(/'/g, "''") + "', '" + id.replace(/'/g, "''") + "', '" + text.trim().replace(/'/g, "''") + "', 'custom', 0, '" + dateStr + "', '" + timeStr + "')"
            ).then(function() {
                // Добавляем в список "Внутрицех"
                if (!self.tasksData.vnutriceh) {
                    self.tasksData.vnutriceh = [];
                }
                self.tasksData.vnutriceh.push({
                    id: id,
                    text: text.trim(),
                    isCustom: true,
                    customId: id,
                    ordered: false,
                    bdDate: dateStr,
                    bdTime: timeStr,
                    bdUser: userId
                });

                document.getElementById('tasksAddInline').style.display = 'none';
                document.getElementById('tasksAddBtn').style.display = 'inline-flex';
                self.renderTasksList();
                self.updateTaskCounts();
            }).catch(function(e) {
                console.error('[tasks] Ошибка добавления задачи:', e);
                alert('Ошибка добавления: ' + e.message);
            });
        } catch (e) {
            console.error('[tasks] Ошибка добавления задачи:', e);
            alert('Ошибка добавления: ' + e.message);
        }
    },

    removeCustomTask: function(taskId) {
        var self = this;
        if (!confirm('Удалить задачу?')) return;

        try {
            // Удаляем из БД
            this.query(
                'DELETE FROM "tasks_order" WHERE "id"=\'' + taskId.replace(/'/g, "''") + '\''
            ).then(function() {
                // Удаляем из списка
                if (self.tasksData.vnutriceh) {
                    self.tasksData.vnutriceh = self.tasksData.vnutriceh.filter(function(item) {
                        return item.id !== taskId;
                    });
                }
                self.renderTasksList();
                self.updateTaskCounts();
            }).catch(function(e) {
                console.error('[tasks] Ошибка удаления:', e);
                alert('Ошибка удаления: ' + e.message);
            });
        } catch (e) {
            console.error('[tasks] Ошибка удаления:', e);
            alert('Ошибка удаления: ' + e.message);
        }
    },

    closeTasksModal: function() {
        document.getElementById('tasksModal').style.display = 'none';
    },

    openShkSearchModal() {
        document.getElementById('shkSearchInput').value = '';
        document.getElementById('shkSearchResults').style.display = 'none';
        document.getElementById('shkAddSelectedBtn').disabled = true;
        this.foundItems = [];
        document.getElementById('shkSearchModal').style.display = 'flex';
    },

    closeShkSearchModal() {
        document.getElementById('shkSearchModal').style.display = 'none';
        document.getElementById('shkSearchResults').style.display = 'none';
        document.getElementById('shkSearchInput').value = '';
        document.getElementById('shkAddSelectedBtn').disabled = true;
        this.foundItems = [];
    },

    // ============================================================
    // МАССОВАЯ ЗАГРУЗКА (МОДАЛЬНОЕ ОКНО)
    // ============================================================
    massUploadData: {
        currentFile: null,
        csvHeaders: [],
        csvRows: [],
        analyzedData: [],
        isBlocked: false,
        blockReason: '',
        conflicts: [],
        // Duplicate check state
        duplicateCheck: {
            checkByName: true,
            checkByFileDate: true,
            duplicateFound: false,
            duplicateReason: '',
            allowedByUser: false,
        },
    },

    openMassUploadModal() {
        document.getElementById('massUploadModal').style.display = 'flex';
        this.massUploadReset();

        // Восстанавливаем состояние чекбоксов из localStorage при открытии
        const chkByName = document.getElementById('massChkCheckByName');
        const chkByFileDate = document.getElementById('massChkCheckByFileDate');
        if (chkByName) {
            const saved = localStorage.getItem('mass_upload_checkByName');
            chkByName.checked = saved === null ? true : (saved === 'true');
            this.massUploadData.duplicateCheck.checkByName = chkByName.checked;
        }
        if (chkByFileDate) {
            const saved = localStorage.getItem('mass_upload_checkByFileDate');
            chkByFileDate.checked = saved === null ? true : (saved === 'true');
            this.massUploadData.duplicateCheck.checkByFileDate = chkByFileDate.checked;
        }

        this.massUploadBindEvents();
    },

    massUploadBindEvents() {
        // Вешаем обработчики на чекбоксы дубликатов (чтобы работало при любом открытии модалки)
        const chkByName = document.getElementById('massChkCheckByName');
        const chkByFileDate = document.getElementById('massChkCheckByFileDate');
        if (chkByName) {
            chkByName.onchange = () => {
                this.massUploadData.duplicateCheck.checkByName = chkByName.checked;
                localStorage.setItem('mass_upload_checkByName', chkByName.checked.toString());
            };
        }
        if (chkByFileDate) {
            chkByFileDate.onchange = () => {
                this.massUploadData.duplicateCheck.checkByFileDate = chkByFileDate.checked;
                localStorage.setItem('mass_upload_checkByFileDate', chkByFileDate.checked.toString());
            };
        }

        // Файл change
        const massFileInput = document.getElementById('massFileInput');
        if (massFileInput) {
            massFileInput.onchange = (e) => {
                if (e.target.files.length > 0) {
                    this.massUploadHandleFile(e.target.files[0]);
                    e.target.value = '';
                }
            };
        }

        // DropZone click — открывает выбор файла при клике на весь контейнер
        const dropZone = document.getElementById('dropZone');
        if (dropZone) {
            dropZone.onclick = () => {
                document.getElementById('massFileInput').click();
            };

            // Drag & Drop
            dropZone.ondragover = (e) => {
                e.preventDefault();
                dropZone.classList.add('dragover');
            };
            dropZone.ondragleave = () => {
                dropZone.classList.remove('dragover');
            };
            dropZone.ondrop = (e) => {
                e.preventDefault();
                dropZone.classList.remove('dragover');
                if (e.dataTransfer.files.length > 0) this.massUploadHandleFile(e.dataTransfer.files[0]);
            };
        }

        // Кнопка "Да, я знаю, загружаю дубликат"
        const massDuplicateConfirmBtn = document.getElementById('massDuplicateConfirmBtn');
        if (massDuplicateConfirmBtn) {
            massDuplicateConfirmBtn.onclick = () => {
                this.massUploadAllowDuplicate();
            };
        }

        // Remove file
        const massRemoveFile = document.getElementById('massRemoveFile');
        if (massRemoveFile) {
            massRemoveFile.onclick = () => {
                this.massUploadReset();
            };
        }

        // Auto-transition checkbox
        const autoTransitionCheck = document.getElementById('autoTransitionCheck');
        if (autoTransitionCheck) {
            const saved = localStorage.getItem('mass_upload_autoTransition');
            autoTransitionCheck.checked = saved === null ? true : (saved === 'true');
            autoTransitionCheck.onchange = () => {
                localStorage.setItem('mass_upload_autoTransition', autoTransitionCheck.checked.toString());
            };
        }

        // Analyze
        const massAnalyzeBtn = document.getElementById('massAnalyzeBtn');
        if (massAnalyzeBtn) {
            massAnalyzeBtn.onclick = () => {
                this.massUploadRunAnalysis();
            };
        }

        // Cancel step 2
        const massCancelStep2 = document.getElementById('massCancelStep2');
        if (massCancelStep2) {
            massCancelStep2.onclick = () => {
                this.massUploadReset();
            };
        }

        // Разрешить конфликт
        const massResolveConflictBtn = document.getElementById('massResolveConflictBtn');
        if (massResolveConflictBtn) {
            massResolveConflictBtn.onclick = () => {
                this.massUploadOpenConflictModal();
            };
        }

        // View file
        const massViewFileBtn = document.getElementById('massViewFileBtn');
        if (massViewFileBtn) {
            massViewFileBtn.onclick = () => {
                // Скрываем модалку массовой загрузки
                const massModal = document.getElementById('massUploadModal');
                if (massModal) massModal.style.display = 'none';
                
                this.massUploadOpenViewFileModal();
            };
        }

        // Confirm upload
        const massConfirmUpload = document.getElementById('massConfirmUpload');
        if (massConfirmUpload) {
            massConfirmUpload.onclick = () => {
                this.massUploadConfirm();
            };
        }

        // Cancel upload
        const massCancelUpload = document.getElementById('massCancelUpload');
        if (massCancelUpload) {
            massCancelUpload.onclick = () => {
                this.closeMassUploadModal();
            };
        }

        // Закрытие модалки просмотра файла
        const closeViewFileX = document.getElementById('closeViewFileX');
        if (closeViewFileX) {
            closeViewFileX.onclick = () => {
                this.massUploadCloseViewFileModal();
            };
        }

        const closeViewFileBtn = document.getElementById('closeViewFileBtn');
        if (closeViewFileBtn) {
            closeViewFileBtn.onclick = () => {
                this.massUploadCloseViewFileModal();
            };
        }

        const viewFileModal = document.getElementById('massViewFileModal');
        if (viewFileModal) {
            viewFileModal.onclick = (e) => {
                if (e.target.classList.contains('warehouse-modal-overlay')) {
                    this.massUploadCloseViewFileModal();
                }
            };
        }

        // Поиск по файлу
        const viewFileSearchInput = document.getElementById('viewFileSearch');
        const viewFileSearchClear = document.getElementById('viewFileSearchClear');
        if (viewFileSearchInput) {
            viewFileSearchInput.addEventListener('input', () => {
                this.massUploadFilterViewFile();
            });
        }
        if (viewFileSearchClear) {
            viewFileSearchClear.addEventListener('click', () => {
                viewFileSearchInput.value = '';
                this.massUploadFilterViewFile();
            });
        }

        // Изменение выбора колонок
        ['viewCol1', 'viewCol2', 'viewCol3'].forEach(id => {
            const select = document.getElementById(id);
            if (select) {
                select.addEventListener('change', () => {
                    this.massUploadRenderViewFileTable();
                });
            }
        });

        // === МОДАЛКА ПРИСВОЕНИЯ ===
        const massAssignCancelBtn = document.getElementById('massAssignCancelBtn');
        if (massAssignCancelBtn) {
            massAssignCancelBtn.onclick = () => this.massUploadCloseAssignModal();
        }

        const massAssignSaveBtn = document.getElementById('massAssignSaveBtn');
        if (massAssignSaveBtn) {
            massAssignSaveBtn.onclick = () => this.massUploadSaveAssign();
        }

        const massAssignTrigger = document.getElementById('massAssignArtSelectTrigger');
        if (massAssignTrigger) {
            massAssignTrigger.onclick = (e) => {
                e.stopPropagation();
                const options = document.getElementById('massAssignArtSelectOptions');
                options.style.display = options.style.display === 'none' ? 'block' : 'none';
            };
        }

        const massAssignModal = document.getElementById('massAssignModal');
        if (massAssignModal) {
            massAssignModal.onclick = (e) => {
                if (e.target.classList.contains('warehouse-modal-overlay')) {
                    this.massUploadCloseAssignModal();
                }
            };
        }

        document.addEventListener('click', (e) => {
            const options = document.getElementById('massAssignArtSelectOptions');
            if (options && options.style.display === 'block') {
                if (!e.target.closest('#massAssignArtSelectOptions') && !e.target.closest('#massAssignArtSelectTrigger')) {
                    options.style.display = 'none';
                }
            }
        });
    },

    closeMassUploadModal() {
        // Убираем overlay если был
        const overlay = document.getElementById('massSuccessOverlay');
        if (overlay) overlay.remove();
        document.getElementById('massUploadModal').style.display = 'none';
        this.massUploadReset();
    },

    massUploadReset() {
        this.massUploadData = {
            currentFile: null,
            csvHeaders: [],
            csvRows: [],
            analyzedData: [],
            isBlocked: false,
            blockReason: '',
            conflicts: [],
            duplicateCheck: {
                checkByName: true,
                checkByFileDate: true,
                duplicateFound: false,
                duplicateReason: '',
                allowedByUser: false,
            },
        };
        document.getElementById('massStep1').style.display = 'block';
        document.getElementById('massStep2').style.display = 'none';
        document.getElementById('massStep3').style.display = 'none';
        document.getElementById('massFileName').style.display = 'none';
        document.getElementById('massFileInput').value = '';
        document.getElementById('massStoreInfo').style.display = 'none';
        document.getElementById('massBlockWarning').style.display = 'none';
        document.getElementById('massConflictWarning').style.display = 'none';
        document.getElementById('massDuplicateWarning').style.display = 'none';
        // Показываем чекбоксы при сбросе
        const dupSettings = document.getElementById('massDuplicateSettings');
        if (dupSettings) dupSettings.style.display = 'block';
        document.getElementById('massPreviewBody').innerHTML = '';
    },

    // ============================================================
    // ЗАГРУЗКА И АНАЛИЗ ФАЙЛА (МАССОВАЯ ЗАГРУЗКА)
    // ============================================================
    async massUploadHandleFile(file) {
        this.massUploadData.currentFile = file;

        // Показываем имя файла
        const fileNameEl = document.getElementById('massFileName');
        if (fileNameEl) {
            fileNameEl.style.display = 'flex';
            const textEl = fileNameEl.querySelector('.file-name-text');
            if (textEl) textEl.textContent = file.name;
            const removeBtn = document.getElementById('massRemoveFile');
            if (removeBtn) removeBtn.style.display = 'inline-flex';
        }

        // Загружаем настройки чекбоксов
        this.massUploadLoadDuplicateSettings();

        // Показываем Шаг 1
        document.getElementById('massStep1').style.display = 'block';
        document.getElementById('massStep2').style.display = 'none';
        document.getElementById('massStep3').style.display = 'none';
        // Настройки дубликатов видны только на Шаге 1
        if (document.getElementById('massDuplicateSettings')) {
            document.getElementById('massDuplicateSettings').style.display = 'block';
        }

        const ext = '.' + file.name.split('.').pop().toLowerCase();

        if (ext === '.xlsx' || ext === '.xls') {
            // Excel файл
            const reader = new FileReader();
            reader.onload = (e) => {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                this.massUploadParseExcel(workbook);
            };
            reader.readAsArrayBuffer(file);
        } else {
            // CSV файл
            const reader = new FileReader();
            reader.onload = (e) => {
                this.massUploadParseCSV(e.target.result);
            };
            reader.readAsText(file, 'UTF-8');
        }
    },

    massUploadParseCSV(text) {
        const lines = text.split(/\r?\n/).filter(line => line.trim());
        if (lines.length < 2) {
            alert('Файл пуст или содержит менее 2 строк.');
            return;
        }

        this.massUploadData.csvHeaders = this.massUploadParseCSVLine(lines[0]);
        this.massUploadData.csvRows = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = this.massUploadParseCSVLine(lines[i]);
            if (cols.length >= 1) {
                this.massUploadData.csvRows.push(cols);
            }
        }

        if (this.massUploadData.csvRows.length === 0) {
            alert('Файл не содержит данных.');
            return;
        }

        console.log('[massUpload] CSV загружен. Заголовки:', this.massUploadData.csvHeaders);
        console.log('[massUpload] Всего строк:', this.massUploadData.csvRows.length);

        this.massUploadPopulateSelectors();

        // Показываем Шаг 1 по умолчанию — автоопределение решит что дальше
        document.getElementById('massStep1').style.display = 'block';
        document.getElementById('massStep2').style.display = 'none';
        document.getElementById('massStep3').style.display = 'none';

        console.log('[massUpload] Запускаем autoMatchStore...');
        console.log('[massUpload] type of massUploadAutoMatchStore:', typeof this.massUploadAutoMatchStore);
        this.massUploadAutoMatchStore()
            .then(() => {
                // Если автоопределение не переключило на Шаг 3 — покажем Шаг 2
                if (document.getElementById('massStep3').style.display !== 'block') {
                    console.log('[massUpload] AutoMatchStore завершён, Шаг 3 не показан → показываем Шаг 2');
                    document.getElementById('massStep1').style.display = 'block';
                    document.getElementById('massStep2').style.display = 'block';
                    // Настройки дубликатов видны когда Шаг 1 видим
                    if (document.getElementById('massDuplicateSettings')) {
                        document.getElementById('massDuplicateSettings').style.display = 'block';
                    }
                }
            })
            .catch(err => {
                console.error('[massUpload] Ошибка massUploadAutoMatchStore:', err);
                document.getElementById('massStep1').style.display = 'block';
                document.getElementById('massStep2').style.display = 'block';
                if (document.getElementById('massDuplicateSettings')) {
                    document.getElementById('massDuplicateSettings').style.display = 'block';
                }
            });
    },

    massUploadParseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ';' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());
        return result;
    },

    // ============================================================
    // МАССОВАЯ ЗАГРУЗКА: ПРОВЕРКА ДУБЛИКАТОВ
    // ============================================================
    massUploadLoadDuplicateSettings() {
        // Просто читаем текущее состояние чекбоксов (обработчики вешаются в massUploadBindEvents)
        const chkByName = document.getElementById('massChkCheckByName');
        const chkByFileDate = document.getElementById('massChkCheckByFileDate');

        if (chkByName) {
            this.massUploadData.duplicateCheck.checkByName = chkByName.checked;
        }

        if (chkByFileDate) {
            this.massUploadData.duplicateCheck.checkByFileDate = chkByFileDate.checked;
        }
    },

    async massUploadCheckDuplicate() {
        const dc = this.massUploadData.duplicateCheck;
        const warningEl = document.getElementById('massDuplicateWarning');
        const titleEl = document.getElementById('massDuplicateWarningTitle');
        const textEl = document.getElementById('massDuplicateWarningText');

        if (!warningEl || !titleEl || !textEl) return;

        // Сбрасываем только состояние дубликата (не allowedByUser!)
        dc.duplicateFound = false;
        dc.duplicateReason = '';

        console.log('🔍massUploadCheckDuplicate:', {
            checkByName: dc.checkByName,
            checkByFileDate: dc.checkByFileDate,
            fileName: this.massUploadData.currentFile?.name
        });

        // Если оба чекбокса выключены — сразу разрешаем
        if (!dc.checkByName && !dc.checkByFileDate) {
            console.log('✅ Оба чекбокса выключены — разрешаем');
            dc.allowedByUser = true;
            warningEl.style.display = 'none';
            this.massUploadUpdateConfirmButton();
            return;
        }

        const result = await this.massUploadCheckDuplicateSilent();
        if (!result.allowed) {
            dc.duplicateFound = true;
            dc.duplicateReason = result.reason;
            this.massUploadShowDuplicateWarning(titleEl, textEl);
        } else {
            dc.allowedByUser = true;
            warningEl.style.display = 'none';
            this.massUploadUpdateConfirmButton();
        }
    },

    async massUploadCheckDuplicateSilent() {
        const dc = this.massUploadData.duplicateCheck;
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const fileName = String(this.massUploadData.currentFile?.name || '');
        const file = this.massUploadData.currentFile;

        // Если оба выключены — никаких проверок нет
        if (!dc.checkByName && !dc.checkByFileDate) {
            console.log('✅ Оба чекбокса выключены — без проверок');
            return { allowed: true, duplicateType: null };
        }

        // 1. Проверка по имени файла за сегодня
        let nameDuplicate = false;
        if (dc.checkByName && fileName) {
            const safeFileName = fileName.replace(/'/g, "''");
            const sqlName = `SELECT "upload_date", "record_count" FROM "mass_upload" WHERE "filename"='${safeFileName}' AND "upload_date"='${todayStr}' AND "type"='upload' LIMIT 1`;
            console.log('🔍 Проверка по имени (сегодня):', sqlName);
            const resultName = await this.query(sqlName);
            const linesName = resultName.trim().split('\n').filter(l => l);

            if (linesName.length > 1) {
                const cols = linesName[1].split('\t');
                const recordCount = cols[1] || '?';
                nameDuplicate = true;
                console.log('⛔ Дубликат по имени найден:', recordCount, 'записей сегодня');
            } else {
                console.log('ℹ️ Дубликат по имени не найден');
            }
        }

        // 2. Проверка по дате создания (старый документ)
        let dateDuplicate = false;
        if (dc.checkByFileDate && file?.lastModifiedDate) {
            const fileDateStr = file.lastModifiedDate.toISOString().split('T')[0];

            // Если дата файла != сегодня — это старый документ
            if (fileDateStr !== todayStr) {
                dateDuplicate = true;
                console.log('⛔ Старый документ. Дата файла:', fileDateStr);
            } else {
                console.log('ℹ️ Файл сегодняшний');
            }
        } else if (dc.checkByFileDate) {
            console.log('ℹ️ File API не поддерживает lastModifiedDate — пропускаем');
        }

        // Определяем есть ли дубликат
        if (nameDuplicate || dateDuplicate) {
            let reason = '';
            if (nameDuplicate && dateDuplicate) {
                reason = '⚠️ Файл с таким именем уже загружен сегодня И дата файла не сегодняшняя!';
            } else if (nameDuplicate) {
                reason = '⚠️ Файл с таким именем уже загружен сегодня!';
            } else if (dateDuplicate) {
                reason = '⚠️ Дата создания файла не сегодняшняя — старый документ!';
            }

            console.log('⚠️ Дубликат обнаружен:', reason);
            return {
                allowed: true, // Разрешаем, но помечаем
                duplicateType: nameDuplicate ? 'name' : 'date',
                reason
            };
        }

        console.log('✅ Дубликат не обнаружен');
        return { allowed: true, duplicateType: null };
    },

    massUploadShowDuplicateWarning(titleEl, textEl) {
        const dc = this.massUploadData.duplicateCheck;
        const reason = dc.duplicateReason || '';

        // Определяем тип дубликата для заголовка
        if (reason.includes('уже загружен сегодня')) {
            titleEl.textContent = '⚠️ Дубликат по имени';
        } else if (reason.includes('уже загружен ранее')) {
            titleEl.textContent = '⚠️ Дубликат по дате';
        } else {
            titleEl.textContent = '⚠️ Обнаружен дубликат';
        }
        titleEl.style.color = '#f59e0b';

        textEl.textContent = dc.duplicateReason;
        textEl.style.whiteSpace = 'pre-line';

        const warningEl = document.getElementById('massDuplicateWarning');
        warningEl.style.display = 'flex';
    },

    massUploadAllowDuplicate() {
        const dc = this.massUploadData.duplicateCheck;
        dc.allowedByUser = true;

        const warningEl = document.getElementById('massDuplicateWarning');
        if (warningEl) {
            const titleEl = document.getElementById('massDuplicateWarningTitle');
            const textEl = document.getElementById('massDuplicateWarningText');
            const confirmBtn = document.getElementById('massDuplicateConfirmBtn');

            if (titleEl) {
                titleEl.textContent = '✓ Дубликат подтверждён';
                titleEl.style.color = '#22c55e';
            }
            if (textEl) textEl.textContent = 'Загрузка будет выполнена несмотря на дубликат.';
            if (confirmBtn) {
                confirmBtn.textContent = '✓ Загружаю';
                confirmBtn.disabled = true;
                confirmBtn.style.opacity = '0.5';
                confirmBtn.style.cursor = 'default';
            }
        }

        // Явно разблокируем кнопку "Подтвердить загрузку"
        const uploadBtn = document.getElementById('massConfirmUpload');
        if (uploadBtn) {
            uploadBtn.disabled = false;
            uploadBtn.style.opacity = '1';
        }

        console.log('✅ massUploadAllowDuplicate вызван — разблокируем кнопку загрузки');
        console.log('🔘 allowedByUser:', dc.allowedByUser);
        this.massUploadUpdateConfirmButton();
    },

    async massUploadParseExcel(workbook) {
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
            alert('Файл не содержит листов!');
            return;
        }

        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

        if (jsonData.length < 2) {
            alert('Файл пуст или содержит менее 2 строк.');
            return;
        }

        this.massUploadData.csvHeaders = jsonData[0]
            .map(h => String(h !== undefined && h !== null ? h : '').trim())
            .filter(h => h);

        if (this.massUploadData.csvHeaders.length === 0) {
            alert('Не удалось найти заголовки колонок!');
            return;
        }

        this.massUploadData.csvRows = [];
        for (let i = 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            if (row && row.length > 0) {
                const rowStrings = row.map(cell => {
                    if (cell === undefined || cell === null) return '';
                    if (cell instanceof Date) return cell.toLocaleDateString('ru-RU');
                    return String(cell).trim();
                });
                this.massUploadData.csvRows.push(rowStrings);
            }
        }

        if (this.massUploadData.csvRows.length === 0) {
            alert('Файл не содержит данных!');
            return;
        }

        console.log('[massUpload] Excel загружен. Заголовки:', this.massUploadData.csvHeaders);
        console.log('[massUpload] Всего строк:', this.massUploadData.csvRows.length);

        this.massUploadPopulateSelectors();

        // Показываем Шаг 1 по умолчанию — автоопределение решит что дальше
        document.getElementById('massStep1').style.display = 'block';
        document.getElementById('massStep2').style.display = 'none';
        document.getElementById('massStep3').style.display = 'none';

        console.log('[massUpload] Селекторы заполнены. Запускаем автоопределение...');
        this.massUploadAutoMatchStore()
            .then(() => {
                if (document.getElementById('massStep3').style.display !== 'block') {
                    console.log('[massUpload] Excel autoMatchStore завершён, Шаг 3 не показан → показываем Шаг 2');
                    document.getElementById('massStep1').style.display = 'block';
                    document.getElementById('massStep2').style.display = 'block';
                    if (document.getElementById('massDuplicateSettings')) {
                        document.getElementById('massDuplicateSettings').style.display = 'block';
                    }
                }
            })
            .catch(err => {
                console.error('[massUpload] Ошибка autoMatchStore:', err);
                document.getElementById('massStep1').style.display = 'block';
                document.getElementById('massStep2').style.display = 'block';
                if (document.getElementById('massDuplicateSettings')) {
                    document.getElementById('massDuplicateSettings').style.display = 'block';
                }
            });
    },

    massUploadPopulateSelectors() {
        const kodSelect = document.getElementById('massKodColumnSelect');
        const qtySelect = document.getElementById('massQtyColumnSelect');

        kodSelect.innerHTML = '<option value="">— Выберите —</option>';
        qtySelect.innerHTML = '<option value="">Нет (по умолчанию = 1)</option>';

        this.massUploadData.csvHeaders.forEach((header, index) => {
            kodSelect.innerHTML += `<option value="${index}">${this.escapeHtml(header)}</option>`;
            qtySelect.innerHTML += `<option value="${index}">${this.escapeHtml(header)}</option>`;
        });

        // Не переключаем шаги — автоопределение решит что показывать
    },

    // ============================================================
    // АВТО-ОПРЕДЕЛЕНИЕ МАГАЗИНА ПО СОВПАДЕНИЮ КОЛОНОК
    // ============================================================
    async massUploadAutoMatchStore() {
        console.log('[massUploadAutoMatchStore] >>>>>>>>>> ЗАПУСК');
        try {
            console.log('[massUploadAutoMatchStore] Запрашиваем магазины из БД...');
            const result = await this.query(`SELECT "id", "store_name", "kod_col", "name_col", "qty_col" FROM "mass_upload" WHERE "type"='config' ORDER BY "store_name"`);
            console.log('[massUploadAutoMatchStore] Получен результат из БД:', result);
            
            const lines = result.trim().split('\n').filter(l => l);
            console.log('[massUploadAutoMatchStore] Строк в результате:', lines.length);
            
            if (lines.length <= 1) {
                console.log('[massUploadAutoMatchStore] Нет конфигурации магазинов — показываем Шаг 1 и Шаг 2');
                // Нет конфигурации магазинов — показываем Шаг 1 и Шаг 2 для ручной настройки
                document.getElementById('massStep1').style.display = 'block';
                document.getElementById('massStep2').style.display = 'block';
                return;
            }

            let bestMatch = null;
            let bestScore = 0;

            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split('\t');
                const store = {
                    id: parseInt(cols[0]),
                    name: cols[1] || `Магазин #${cols[0]}`,
                    kod_col: cols[2] || '',
                    name_col: cols[3] || '',
                    qty_col: cols[4] || ''
                };

                let score = 0;
                if (store.kod_col) score += this.massUploadMatchColumn(store.kod_col);
                if (store.name_col) score += this.massUploadMatchColumn(store.name_col);
                if (store.qty_col) score += this.massUploadMatchColumn(store.qty_col);

                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = store;
                }
            }

            const autoTransition = document.getElementById('autoTransitionCheck')?.checked;

            if (bestMatch && bestScore > 0) {
                // Магазин определен — автозаполняем колонки
                document.getElementById('massStoreInfo').style.display = 'block';
                document.querySelector('#massStoreInfo .store-name').textContent = bestMatch.name;

                if (bestMatch.kod_col) this.massUploadAutoSelectColumn('massKodColumnSelect', bestMatch.kod_col);
                if (bestMatch.qty_col) this.massUploadAutoSelectColumn('massQtyColumnSelect', bestMatch.qty_col);

                if (autoTransition) {
                    // Магазин найден — пропускаем Шаг 2, сразу запускаем анализ
                    console.log('[massUpload] Магазин найден, автопереход → Шаг 3 (анализ)');
                    await this.massUploadRunAnalysis();
                    return;
                } else {
                    // Автопереход выключен — показываем Шаг 2 для ручной проверки
                    console.log('[massUpload] Магазин найден, автопереход выключен → Шаг 2');
                    document.getElementById('massStep1').style.display = 'none';
                    document.getElementById('massStep2').style.display = 'block';
                    return;
                }
            } else {
                // Магазин НЕ определен — показываем Шаг 2 для ручной настройки
                console.log('[massUpload] Магазин не найден → Шаг 2');
                if (autoTransition) {
                    alert('⚠️ Магазин не определен автоматически. Для продолжения настройте колонки вручную.');
                }
            }

            // Показываем Шаг 1 и Шаг 2 для ручной настройки
            document.getElementById('massStep1').style.display = 'block';
            document.getElementById('massStep2').style.display = 'block';
            if (document.getElementById('massDuplicateSettings')) {
                document.getElementById('massDuplicateSettings').style.display = 'block';
            }
        } catch (error) {
            console.error('Ошибка автоопределения магазина:', error);
            // Показываем Шаг 1 и Шаг 2 при ошибке
            document.getElementById('massStep1').style.display = 'block';
            document.getElementById('massStep2').style.display = 'block';
            if (document.getElementById('massDuplicateSettings')) {
                document.getElementById('massDuplicateSettings').style.display = 'block';
            }
        }
    },

    // ============================================================
    // ЗАПУСК АНАЛИЗА (общая функция для шага 2 и автоматического перехода)
    // ============================================================
    async massUploadRunAnalysis() {
        console.log('[massUploadRunAnalysis] >>>>>>>>>> ЗАПУСК АНАЛИЗА');

        // Скрываем шаг 2, показываем шаг 3
        console.log('[massUploadRunAnalysis] Скрываем шаг 2, показываем шаг 3');
        document.getElementById('massStep1').style.display = 'none';
        document.getElementById('massStep2').style.display = 'none';
        document.getElementById('massStep3').style.display = 'block';
        // Настройки дубликатов видны только на Шаге 1
        if (document.getElementById('massDuplicateSettings')) {
            document.getElementById('massDuplicateSettings').style.display = 'none';
        }
        document.getElementById('massBlockWarning').style.display = 'none';
        document.getElementById('massConflictWarning').style.display = 'none';
        document.getElementById('massPreviewBody').innerHTML = '<tr><td colspan="6" class="loading-state">Анализ...</td></tr>';

        console.log('[massUploadRunAnalysis] massStep3 style.display:', document.getElementById('massStep3').style.display);

        // Запускаем анализ и проверку дубликата параллельно
        const analysisPromise = this.massUploadPerformAnalysis();
        const duplicatePromise = this.massUploadCheckDuplicateSilent();

        try {
            const [analyzed, duplicateResult] = await Promise.all([analysisPromise, duplicatePromise]);

            // Устанавливаем результаты анализа
            this.massUploadData.analyzedData = analyzed.analyzedData;
            this.massUploadData.conflicts = analyzed.conflicts;

            // Обновляем UI
            this.massUploadRenderPreview();
            document.getElementById('massTotalRows').textContent = analyzed.totalRows;
            document.getElementById('massFoundRows').textContent = analyzed.foundCount;
            document.getElementById('massNotFoundRows').textContent = analyzed.notFoundCount;

            if (this.massUploadData.conflicts.length > 0) {
                document.getElementById('massConflictWarning').style.display = 'flex';
            } else {
                document.getElementById('massConflictWarning').style.display = 'none';
            }

                // Проверяем дубликат
                const dc = this.massUploadData.duplicateCheck;
                if (duplicateResult.duplicateType) {
                    dc.duplicateFound = true;
                    dc.duplicateReason = duplicateResult.reason;
                    this.massUploadShowDuplicateWarning(
                        document.getElementById('massDuplicateWarningTitle'),
                        document.getElementById('massDuplicateWarningText')
                    );
                    const warningEl = document.getElementById('massDuplicateWarning');
                    if (warningEl) warningEl.style.display = 'flex';
                    // Блокируем кнопку "Подтвердить загрузку"
                    dc.allowedByUser = false;

                    // Гарантируем, что кнопка подтверждения дубликата активна
                    const confirmBtn = document.getElementById('massDuplicateConfirmBtn');
                    if (confirmBtn) {
                        confirmBtn.disabled = false;
                        confirmBtn.style.opacity = '1';
                        confirmBtn.style.cursor = 'pointer';
                        confirmBtn.style.pointerEvents = 'auto';
                        console.log('🔘 Кнопка подтверждения дубликата активирована');
                    }
                } else {
                    dc.duplicateFound = false;
                    dc.allowedByUser = true;
                    document.getElementById('massDuplicateWarning').style.display = 'none';
                }

            this.massUploadUpdateConfirmButton();

        } catch (error) {
            console.error('Ошибка анализа массовой загрузки:', error);
            document.getElementById('massPreviewBody').innerHTML = `<tr><td colspan="6" style="color: #ef4444; padding: 20px;">❌ Ошибка: ${error.message}</td></tr>`;
        }
    },

    async massUploadPerformAnalysis() {
        const kodColIndex = parseInt(document.getElementById('massKodColumnSelect').value) || 0;
        const qtyColIndex = document.getElementById('massQtyColumnSelect').value !== '' ? parseInt(document.getElementById('massQtyColumnSelect').value) : -1;

        if (document.getElementById('massKodColumnSelect').value === '') {
            alert('Укажите колонку с кодом товара!');
            return { analyzedData: [], conflicts: [], totalRows: 0, foundCount: 0, notFoundCount: 0 };
        }

        try {
            const wneskodMap = await this.massUploadGetAllWnesKod();

            const analyzedData = [];
            let foundCount = 0;
            let notFoundCount = 0;

            for (let i = 0; i < this.massUploadData.csvRows.length; i++) {
                const row = this.massUploadData.csvRows[i];
                const csvKod = row[kodColIndex] || '';
                if (!csvKod) continue;

                const wneskodRecord = wneskodMap[csvKod] || null;

                let qty = 1;
                if (qtyColIndex >= 0 && row[qtyColIndex]) {
                    const parsed = parseInt(row[qtyColIndex].replace(',', '.'));
                    if (!isNaN(parsed) && parsed > 0) qty = parsed;
                }

                if (wneskodRecord) {
                    analyzedData.push({
                        csvKod: csvKod,
                        ourKod: wneskodRecord.ourKod,
                        art: wneskodRecord.art,
                        qty: qty,
                        status: 'found'
                    });
                    foundCount++;
                } else {
                    analyzedData.push({
                        csvKod: csvKod,
                        ourKod: null,
                        art: null,
                        qty: qty,
                        status: 'not-found'
                    });
                    notFoundCount++;
                }
            }

            // Конфликты
            const ourKodToCsvKods = {};
            for (const item of analyzedData) {
                if (item.ourKod) {
                    if (!ourKodToCsvKods[item.ourKod]) {
                        ourKodToCsvKods[item.ourKod] = [];
                    }
                    if (!ourKodToCsvKods[item.ourKod].includes(item.csvKod)) {
                        ourKodToCsvKods[item.ourKod].push(item.csvKod);
                    }
                }
            }

            const conflicts = [];
            for (const [ourKod, csvKods] of Object.entries(ourKodToCsvKods)) {
                if (csvKods.length > 1) {
                    conflicts.push({ ourKod, csvKods });
                }
            }

            return { analyzedData, conflicts, totalRows: this.massUploadData.csvRows.length, foundCount, notFoundCount };

        } catch (error) {
            console.error('Ошибка анализа массовой загрузки:', error);
            throw error;
        }
    },

    massUploadGetAllWnesKod() {
        return this.query(`
            SELECT w.kod, w.wkod, g.art
            FROM "wneshkod" w
            LEFT JOIN "guide" g ON w.kod = g.kod
        `).then(result => {
            const lines = result.trim().split('\n').filter(l => l);
            const map = {};
            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split('\t');
                if (cols.length >= 3) {
                    map[cols[1].trim()] = { ourKod: cols[0], art: cols[2] };
                }
            }
            return map;
        });
    },

    massUploadRenderPreview() {
        const tbody = document.getElementById('massPreviewBody');
        const data = this.massUploadData.analyzedData.slice(0, 200);
        tbody.innerHTML = data.map((item, index) => `
            <tr class="${item.status}">
                <td>${index + 1}</td>
                <td>${this.escapeHtml(item.csvKod)}</td>
                <td>${item.ourKod || '—'}</td>
                <td>${item.art || '—'}</td>
                <td>${item.qty}</td>
                <td>
                    ${item.status === 'found'
                        ? `<span class="status-badge found">Найдено</span>`
                        : `<span class="status-badge not-found">Не найдено</span>
                           <button class="btn-mass-assign" data-row="${index}" style="margin-top: 4px; padding:4px 8px; background:rgba(52,152,219,0.2); border:1px solid rgba(52,152,219,0.4); border-radius:4px; color:#3498db; cursor:pointer; font-size:0.8rem;">🔗 Присвоить</button>`
                    }
                </td>
            </tr>
        `).join('');

        // Привязываем кнопки "Присвоить"
        tbody.querySelectorAll('.btn-mass-assign').forEach(btn => {
            btn.onclick = () => {
                const rowIndex = parseInt(btn.dataset.row);
                this.massUploadOpenAssignModal(rowIndex);
            };
        });
    },

    async massUploadConfirm() {
        const foundItems = this.massUploadData.analyzedData.filter(d => d.status === 'found');
        if (foundItems.length === 0) {
            alert('Нет найденных товаров для загрузки.');
            return;
        }

        try {
            // Суммируем количество по kod
            const planData = {};
            for (const item of foundItems) {
                planData[item.ourKod] = (planData[item.ourKod] || 0) + item.qty;
            }

            const userId = localStorage.getItem('userId') || '';
            const userName = localStorage.getItem('userName') || userId;
            const now = new Date();
            const todayStr = now.toISOString().split('T')[0];
            const dataStr = now.toISOString().split('T')[0];
            const timeStr = now.toTimeString().split(' ')[0].slice(0, 5);
            const nomer = this.currentSessionNomer || '';

            if (!nomer) {
                console.warn('⚠️ Номер сессии не определён, используем дефолтный');
            }

            // Собираем все kod из planData
            const allKods = Object.keys(planData);
            if (allKods.length === 0) {
                alert('Нет товаров для загрузки.');
                return;
            }

            // Безопасная защита от SQL-инъекций
            const safeNomer = String(nomer || '').replace(/'/g, "''");
            const safeUserName = String(userName || '').replace(/'/g, "''");

            // Проверяем, какие из них оптовики (1 batch-запрос вместо N)
            const optKodList = allKods.map(k => `'${k.replace(/'/g, "''")}'`).join(',');
            const optResult = await this.query(
                `SELECT "kod", "opt" FROM "guide" WHERE "kod" IN (${optKodList})`
            );

            const optSet = new Set(); // kod оптовиков
            const regularSet = new Set(); // kod обычных
            if (optResult?.trim()) {
                const optLines = optResult.trim().split('\n').filter(l => l);
                if (optLines.length > 1) {
                    const optHeaders = optLines[0].split('\t').map(h => h.trim().toLowerCase());
                    const kodIdx = optHeaders.indexOf('kod');
                    const optIdx = optHeaders.indexOf('opt');
                    for (let i = 1; i < optLines.length; i++) {
                        const parts = optLines[i].split('\t');
                        const k = kodIdx >= 0 ? parts[kodIdx]?.trim() : '';
                        const o = optIdx >= 0 ? parts[optIdx]?.trim() : '';
                        if (k && o === 'Сборка') {
                            optSet.add(k);
                        } else if (k) {
                            regularSet.add(k);
                        }
                    }
                }
            }

            // 1. DELETE старых плановых записей для этих kod + nomer + user
            const deleteRegular = `DELETE FROM "zakaz" WHERE "kod" IN (${optKodList}) AND "nomer"='${safeNomer}' AND "user"='${safeUserName}' AND "status"=1`;
            await this.query(deleteRegular);

            // Для оптовиков — удаляем самих оптовиков + компоненты
            if (optSet.size > 0) {
                for (const optKod of optSet) {
                    const safeOptKod = String(optKod || '').replace(/'/g, "''");
                    // Удаляем оптовика
                    await this.query(
                        `DELETE FROM "zakaz" WHERE "kod"='${safeOptKod}' AND "nomer"='${safeNomer}' AND "user"='${safeUserName}' AND "status"=2`
                    );
                    // Удаляем компоненты
                    const compResult = await this.getApprovedComponents(optKod);
                    if (compResult.length > 0) {
                        const compKodList = compResult.map(c => `'${String(c.kod || '').replace(/'/g, "''")}'`).join(',');
                        await this.query(
                            `DELETE FROM "zakaz" WHERE "kod" IN (${compKodList}) AND "nomer"='${safeNomer}' AND "user"='${safeUserName}' AND "status"=2`
                        );
                    }
                }
            }

            // 2. INSERT обычных товаров
            let copiedCount = 0;
            const regularInserts = [];
            for (const [kod, koli] of Object.entries(planData)) {
                if (!regularSet.has(kod) || koli <= 0) continue;
                const safeKod = String(kod || '').replace(/'/g, "''");
                regularInserts.push(
                    `('${safeKod}', ${koli}, '${safeNomer}', '${safeUserName}', 1, '${dataStr}', '${timeStr}')`
                );
                copiedCount++;
                // Обновляем DOM
                const input = document.querySelector(`input[data-kod="${kod}"][data-field="plan"]`);
                if (input) {
                    input.value = koli > 0 ? koli : '';
                }
            }
            if (regularInserts.length > 0) {
                await this.query(
                    `INSERT INTO "zakaz" ("kod", "koli", "nomer", "user", "status", "data", "time") VALUES ${regularInserts.join(', ')}`
                );
            }

            // 3. INSERT оптовиков и компонентов
            for (const [optKod, koli] of Object.entries(planData)) {
                if (!optSet.has(optKod) || koli <= 0) continue;
                const safeOptKod = String(optKod || '').replace(/'/g, "''");
                // Оптовик
                await this.query(
                    `INSERT INTO "zakaz" ("kod", "koli", "nomer", "user", "status", "data", "time") VALUES ('${safeOptKod}', ${koli}, '${safeNomer}', '${safeUserName}', 2, '${dataStr}', '${timeStr}')`
                );
                // Компоненты
                const components = await this.getApprovedComponents(optKod);
                const compInserts = [];
                for (const comp of components) {
                    const totalKoli = koli * comp.koliPerUnit;
                    const safeCompKod = String(comp.kod || '').replace(/'/g, "''");
                    compInserts.push(
                        `('${safeCompKod}', ${totalKoli}, '${safeNomer}', '${safeUserName}', 2, '${dataStr}', '${timeStr}')`
                    );
                    // Обновляем DOM компонента
                    const compInput = document.querySelector(`input[data-kod="${comp.kod}"][data-field="plan"]`);
                    if (compInput) {
                        compInput.value = totalKoli > 0 ? totalKoli : '';
                    }
                }
                if (compInserts.length > 0) {
                    await this.query(
                        `INSERT INTO "zakaz" ("kod", "koli", "nomer", "user", "status", "data", "time") VALUES ${compInserts.join(', ')}`
                    );
                }
                copiedCount++;
                // Обновляем DOM оптовика
                const optInput = document.querySelector(`input[data-kod="${optKod}"][data-field="plan"]`);
                if (optInput) {
                    optInput.value = koli > 0 ? koli : '';
                }
            }

            // Записываем информацию о загрузке в mass_upload
            const fileName = String(this.massUploadData.currentFile?.name || 'unknown').replace(/'/g, "''");
            const recordCount = this.massUploadData.analyzedData.length;
            const safeUserId = String(this.userId || 'unknown').replace(/'/g, "''");

            // Получаем дату создания/изменения файла из File API
            let fileDateStr = todayStr;
            if (this.massUploadData.currentFile?.lastModifiedDate) {
                fileDateStr = this.massUploadData.currentFile.lastModifiedDate.toISOString().split('T')[0];
            }

            // Генерируем простой хэш содержимого файла
            const fileContent = this.massUploadData.analyzedData.map(item =>
                `${item.csvKod}|${item.ourKod}|${item.art}|${item.qty}`
            ).join('\n');
            let fileHash = 0;
            for (let i = 0; i < fileContent.length; i++) {
                const char = fileContent.charCodeAt(i);
                fileHash = ((fileHash << 5) - fileHash) + char;
                fileHash = fileHash & fileHash; // Convert to 32bit integer
            }
            const fileHashStr = Math.abs(fileHash).toString(16);

            // Записываем в mass_upload (type='upload')
            // upload_date = дата создания файла (из File API)
            const insertSql = `INSERT INTO "mass_upload" ("type", "filename", "upload_date", "file_hash", "record_count", "user_id") VALUES ('upload', '${fileName}', '${fileDateStr}', '${fileHashStr}', ${recordCount}, '${safeUserId}')`;
            await this.query(insertSql);
            console.log('📝 Запись в mass_upload:', insertSql);
            console.log('📅 Дата создания файла:', fileDateStr);

            // ОБНОВЛЕНИЕ DOM: loadReserve + recalc 1 раз на ВСЕ изменения
            try {
                await this.loadReserve();
                this.updateAllRowsAvailability();
                await this.recalcAllOptAvail();
            } catch (e) {
                console.error('Ошибка обновления после массовой загрузки:', e);
            }

            console.log('✅ Массовая загрузка успешна, copiedCount:', copiedCount);
            this.closeMassUploadModal();
            this.massUploadShowSuccessAnimation(copiedCount);

        } catch (error) {
            console.error('Ошибка копирования в план:', error);
            alert('Ошибка: ' + error.message);
        }
    },

    // ============================================================
    // АНИМАЦИЯ УСПЕШНОЙ ЗАГРУЗКИ
    // ============================================================
    massUploadShowSuccessAnimation(count) {
        // Убираем старый оверлей если есть
        const oldToast = document.getElementById('massSuccessToast');
        if (oldToast) oldToast.remove();

        // Создаём компактный toast сверху
        const toast = document.createElement('div');
        toast.id = 'massSuccessToast';
        toast.style.cssText = `
            position: fixed;
            top: -80px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 100001;
            background: #0f172a;
            border: 2px solid #22c55e;
            border-radius: 12px;
            padding: 12px 32px;
            display: flex;
            align-items: center;
            gap: 12px;
            box-shadow: 0 4px 24px rgba(34, 197, 94, 0.4);
            transition: top 0.4s cubic-bezier(0.22, 1, 0.36, 1);
        `;

        toast.innerHTML = `
            <div style="
                width: 28px;
                height: 28px;
                border-radius: 50%;
                background: #22c55e;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 16px;
                font-weight: bold;
                color: #fff;
                flex-shrink: 0;
            ">✓</div>
            <div style="
                font-size: 1rem;
                font-weight: 600;
                color: #22c55e;
            ">Загружено <strong style="color: #4ade80;">${count}</strong> записей в план</div>
        `;

        document.body.appendChild(toast);

        // Запускаем анимацию появления
        requestAnimationFrame(() => {
            toast.style.top = '24px';
        });

        // Скрываем через 3 секунды
        setTimeout(() => {
            toast.style.top = '-80px';
            setTimeout(() => {
                toast.remove();
            }, 400);
        }, 3000);
    },

    massUploadMatchColumn(columnName) {
        if (!columnName) return 0;
        const normalized = columnName.toLowerCase().trim();
        for (const header of this.massUploadData.csvHeaders) {
            const h = header.toLowerCase().trim();
            if (h === normalized || h.includes(normalized) || normalized.includes(h)) return 1;
        }
        return 0;
    },

    massUploadAutoSelectColumn(selectId, columnName) {
        const select = document.getElementById(selectId);
        if (!select) return;
        const normalized = columnName.toLowerCase().trim();
        for (let i = 0; i < select.options.length; i++) {
            const opt = select.options[i].text.toLowerCase().trim();
            if (opt === normalized || opt.includes(normalized) || normalized.includes(opt)) {
                select.selectedIndex = i;
                break;
            }
        }
    },

    async massUploadGetColumnSettings() {
        try {
            const result = await this.query('SELECT "kod_col", "name_col", "qty_col" FROM "mass_upload" WHERE "type"=\'config\' LIMIT 1');
            if (result && result.trim()) {
                const cols = result.trim().split('\n')[1].split('\t');
                return { kod_col: cols[0] || '', name_col: cols[1] || '', qty_col: cols[2] || '' };
            }
        } catch (e) {}
        return { kod_col: '', name_col: '', qty_col: '' };
    },

    massUploadRenderFilePreview() {
        const thead = document.getElementById('massFilePreviewHead');
        const tbody = document.getElementById('massFilePreviewBody');
        if (!thead || !tbody) return;

        thead.innerHTML = this.massUploadData.csvHeaders.map(h => `<th>${this.escapeHtml(h)}</th>`).join('');
        tbody.innerHTML = this.massUploadData.csvRows.slice(0, 500).map(row => 
            `<tr>${row.map(cell => `<td>${this.escapeHtml(cell)}</td>`).join('')}</tr>`
        ).join('');
    },

    // ============================================================
    // ОБНОВЛЕНИЕ СОСТОЯНИЯ КНОПКИ ПОДТВЕРЖДЕНИЯ
    // ============================================================
    massUploadUpdateConfirmButton() {
        const btn = document.getElementById('massConfirmUpload');
        const status = document.getElementById('massConfirmStatus');
        if (!btn) return;

        const allItems = this.massUploadData.analyzedData;
        const foundCount = allItems.filter(d => d.status === 'found').length;
        const notFoundCount = allItems.filter(d => d.status === 'not-found').length;
        const hasConflicts = this.massUploadData.conflicts.length > 0;

        // Проверяем дубликат
        const dc = this.massUploadData.duplicateCheck;
        const hasDuplicateBlocked = dc.duplicateFound && !dc.allowedByUser;

        // Кнопка активна если: все найдены, нет конфликтов, и дубликат разрешён
        const isReady = notFoundCount === 0 && !hasConflicts && !hasDuplicateBlocked;

        btn.disabled = !isReady;
        btn.style.opacity = isReady ? '1' : '0.5';

        // Показываем статус
        if (status) {
            const messages = [];
            if (notFoundCount > 0) messages.push(`❌ Не найдено: ${notFoundCount}`);
            if (hasConflicts) messages.push(`❌ Конфликтов: ${this.massUploadData.conflicts.length}`);
            if (hasDuplicateBlocked) messages.push(`⚠️ Обнаружен дубликат — подтвердите кнопку "Да, я знаю"`);
            if (isReady) messages.push('✅ Все товары найдены, готовы к загрузке');

            status.textContent = messages.join(' | ');
            status.style.color = isReady ? '#4caf50' : '#a0a0c0';
        }
    },

    // ============================================================
    // ПРОСМОТР ФАЙЛА (модалка с 3 колонками)
    // ============================================================
    filteredRows: [],

    // ============================================================
    // ПРИСВОЕНИЕ ТОВАРА (модалка)
    // ============================================================
    massAssignRowIndex: null,

    massUploadOpenAssignModal(rowIndex) {
        const item = this.massUploadData.analyzedData[rowIndex];
        if (!item || item.status !== 'not-found') return;

        this.massAssignRowIndex = rowIndex;
        document.getElementById('massAssignForeignKod').textContent = item.csvKod;

        this.massUploadLoadGuideProducts();
        document.getElementById('massAssignModal').style.display = 'flex';
    },

    massUploadCloseAssignModal() {
        document.getElementById('massAssignModal').style.display = 'none';
        this.massAssignRowIndex = null;
    },

    async massUploadLoadGuideProducts() {
        const optionsContainer = document.getElementById('massAssignArtSelectOptions');
        optionsContainer.innerHTML = '';

        try {
            const sql = `SELECT "kod", "art", "NAME" FROM "guide" WHERE "type"='Товар' ORDER BY "art"`;
            const result = await this.query(sql);
            const lines = result.trim().split('\n').filter(l => l);

            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split('\t');
                const kod = cols[0];
                const art = cols[1];
                const name = cols[2] || '';

                const option = document.createElement('div');
                option.style.cssText = 'padding:10px 14px; cursor:pointer; color:#fff; border-bottom:1px solid rgba(255,255,255,0.05); font-size:0.9rem;';
                option.textContent = `${art} — ${name}`;
                option.setAttribute('data-kod', kod);
                option.setAttribute('data-art', art);
                option.setAttribute('data-name', name);

                option.onmouseenter = () => option.style.background = 'rgba(139,92,246,0.2)';
                option.onmouseleave = () => option.style.background = 'transparent';
                option.onclick = (e) => {
                    e.stopPropagation();
                    this.massUploadSelectGuideProduct(kod, art, name, option);
                };

                optionsContainer.appendChild(option);
            }
        } catch (error) {
            console.error('Ошибка загрузки товаров:', error);
        }
    },

    massUploadSelectGuideProduct(kod, art, name, optionEl) {
        // Снимаем выделение
        document.querySelectorAll('#massAssignArtSelectOptions div').forEach(o => {
            o.style.background = 'transparent';
            o.style.fontWeight = 'normal';
        });

        // Выделяем текущий
        optionEl.style.background = 'rgba(139,92,246,0.3)';
        optionEl.style.fontWeight = '600';

        // Заполняем поля
        document.getElementById('massAssignArtSelect').value = kod;
        document.getElementById('massAssignArtSelectTrigger').textContent = `${art} — ${name}`;
        document.getElementById('massAssignKodInput').value = kod;
        document.getElementById('massAssignNameInput').value = name;

        // Закрываем список
        document.getElementById('massAssignArtSelectOptions').style.display = 'none';

        // Показываем картинку если есть
        this.massUploadLoadProductImage(kod);
    },

    async massUploadLoadProductImage(kod) {
        try {
            const db = await this.getDb();
            const tx = db.transaction('images', 'readonly');
            const request = tx.objectStore('images').get(kod);
            request.onsuccess = () => {
                if (request.result && request.result.data) {
                    document.getElementById('massAssignImage').src = request.result.data;
                    document.getElementById('massAssignImage').style.display = 'block';
                    document.getElementById('massAssignImagePlaceholder').style.display = 'none';
                } else {
                    // Картинка не найдена - показываем крестик
                    document.getElementById('massAssignImage').style.display = 'none';
                    document.getElementById('massAssignImagePlaceholder').style.display = 'flex';
                    document.getElementById('massAssignImagePlaceholder').textContent = '❌';
                    document.getElementById('massAssignImagePlaceholder').style.fontSize = '1.5rem';
                    document.getElementById('massAssignImagePlaceholder').style.color = '#e74c3c';
                }
            };
        } catch (e) {
            console.error('Ошибка загрузки картинки:', e);
        }
    },

    async massUploadSaveAssign() {
        const rowIndex = this.massAssignRowIndex;
        const item = this.massUploadData.analyzedData[rowIndex];
        if (!item) return;

        const kod = document.getElementById('massAssignKodInput').value.trim();
        const art = document.getElementById('massAssignArtSelect').value.trim();

        if (!kod || !art) {
            alert('Заполните обязательные поля!');
            return;
        }

        try {
            // Проверяем, существует ли уже запись в wnes kod
            const escapedCsvKod = item.csvKod.replace(/'/g, "''");
            const checkSql = `SELECT "id", "kod" FROM "wneshkod" WHERE "wkod"='${escapedCsvKod}'`;
            const checkResult = await this.query(checkSql);
            const checkLines = checkResult.trim().split('\n').filter(l => l);

            if (checkLines.length > 1) {
                // Обновляем существующую запись
                const id = checkLines[1].split('\t')[0];
                await this.query(`UPDATE "wneshkod" SET "kod"=${kod} WHERE "id"=${id}`);
            } else {
                // Создаём новую запись
                await this.query(`INSERT INTO "wneshkod" ("kod", "wkod") VALUES (${kod}, '${escapedCsvKod}')`);
            }

            // Обновляем локальные данные
            item.ourKod = kod;
            item.art = art;
            item.status = 'found';

            this.massUploadCloseAssignModal();
            await this.massUploadRunAnalysis();
            this.massUploadUpdateConfirmButton();

        } catch (error) {
            console.error('Ошибка присвоения:', error);
            alert('Ошибка: ' + error.message);
        }
    },

    // ============================================================

    massUploadOpenViewFileModal() {
        if (this.massUploadData.csvHeaders.length === 0) {
            alert('Файл не загружен.');
            return;
        }

        const modal = document.getElementById('massViewFileModal');
        if (!modal) {
            console.error('massViewFileModal not found!');
            return;
        }

        console.log('Открываю просмотр файла...', this.massUploadData.csvHeaders);

        // Сброс поиска
        const searchInput = document.getElementById('viewFileSearch');
        const searchClear = document.getElementById('viewFileSearchClear');
        if (searchInput) searchInput.value = '';
        if (searchClear) searchClear.style.display = 'none';
        this.filteredRows = [...this.massUploadData.csvRows];

        this.massUploadPopulateViewFileSelectors();
        this.massUploadRenderViewFileTable();

        modal.style.display = 'block';
        console.log('Модалка открыта:', modal.style.display);
    },

    massUploadCloseViewFileModal() {
        const modal = document.getElementById('massViewFileModal');
        if (modal) modal.style.display = 'none';
    },

    massUploadFilterViewFile() {
        const query = document.getElementById('viewFileSearch').value.trim().toLowerCase();
        const searchClear = document.getElementById('viewFileSearchClear');
        if (searchClear) {
            searchClear.style.display = query ? 'inline-flex' : 'none';
        }

        if (!query) {
            this.filteredRows = [...this.massUploadData.csvRows];
        } else {
            this.filteredRows = this.massUploadData.csvRows.filter(row => {
                return row.some(cell => (cell || '').toLowerCase().includes(query));
            });
        }

        this.massUploadRenderViewFileTable();
    },

    massUploadPopulateViewFileSelectors() {
        console.log('Заполняю селекторы колонок...');

        const col1 = document.getElementById('viewCol1');
        const col2 = document.getElementById('viewCol2');
        const col3 = document.getElementById('viewCol3');

        console.log('Найдено select\'ы:', !!col1, !!col2, !!col3);

        const fillSelect = (select, headers) => {
            if (!select) return;
            select.innerHTML = '';
            const defaultOpt = document.createElement('option');
            defaultOpt.value = '';
            defaultOpt.textContent = '— Выберите колонку —';
            select.appendChild(defaultOpt);

            headers.forEach((header, index) => {
                if (!header) return;
                const option = document.createElement('option');
                option.value = index;
                option.textContent = header;
                select.appendChild(option);
            });
            console.log(`Заполнено опций: ${select.options.length}`);
        };

        fillSelect(col1, this.massUploadData.csvHeaders);
        fillSelect(col2, this.massUploadData.csvHeaders);
        fillSelect(col3, this.massUploadData.csvHeaders);
    },

    massUploadRenderViewFileTable() {
        const col1Idx = document.getElementById('viewCol1').value;
        const col2Idx = document.getElementById('viewCol2').value;
        const col3Idx = document.getElementById('viewCol3').value;

        const col1Selected = col1Idx !== '';
        const col2Selected = col2Idx !== '';
        const col3Selected = col3Idx !== '';

        // Показываем/скрываем столбцы в шапке и обновляем заголовки
        const th1 = document.getElementById('viewCol1Header');
        const th2 = document.getElementById('viewCol2Header');
        const th3 = document.getElementById('viewCol3Header');

        if (th1) {
            th1.style.display = col1Selected ? '' : 'none';
            if (col1Selected) {
                const label = th1.querySelector('label');
                if (label) label.textContent = this.massUploadData.csvHeaders[parseInt(col1Idx)];
            }
        }
        if (th2) {
            th2.style.display = col2Selected ? '' : 'none';
            if (col2Selected) {
                const label = th2.querySelector('label');
                if (label) label.textContent = this.massUploadData.csvHeaders[parseInt(col2Idx)];
            }
        }
        if (th3) {
            th3.style.display = col3Selected ? '' : 'none';
            if (col3Selected) {
                const label = th3.querySelector('label');
                if (label) label.textContent = this.massUploadData.csvHeaders[parseInt(col3Idx)];
            }
        }

        const tbody = document.getElementById('viewFileBody');
        if (!tbody) return;

        const rows = this.filteredRows.slice(0, 500);

        tbody.innerHTML = rows.map(row => {
            let html = '<tr>';
            if (col1Selected) html += `<td style="padding:8px; border-bottom:1px solid rgba(255,255,255,0.05); color:#fff;">${this.escapeHtml(row[parseInt(col1Idx)] || '')}</td>`;
            if (col2Selected) html += `<td style="padding:8px; border-bottom:1px solid rgba(255,255,255,0.05); color:#fff;">${this.escapeHtml(row[parseInt(col2Idx)] || '')}</td>`;
            if (col3Selected) html += `<td style="padding:8px; border-bottom:1px solid rgba(255,255,255,0.05); color:#fff;">${this.escapeHtml(row[parseInt(col3Idx)] || '')}</td>`;
            html += '</tr>';
            return html;
        }).join('');
    },

    // ============================================================
    // РАЗРЕШЕНИЕ КОНФЛИКТОВ
    // ============================================================
    massDeletedConflictCodes: [],

    massUploadOpenConflictModal() {
        const modal = document.getElementById('massConflictModal');
        if (!modal) return;

        const conflictsList = document.getElementById('massConflictsList');
        conflictsList.innerHTML = '<div style="text-align:center; padding:20px; color:#a0a0c0;">Загрузка данных...</div>';
        modal.style.display = 'flex';
        this.massDeletedConflictCodes = [];

        this.massUploadLoadConflictData();
    },

    massUploadCloseConflictModal() {
        const modal = document.getElementById('massConflictModal');
        if (modal) modal.style.display = 'none';
    },

    async massUploadLoadConflictData() {
        const conflictsList = document.getElementById('massConflictsList');

        if (this.massUploadData.conflicts.length === 0) {
            conflictsList.innerHTML = '<div style="text-align:center; padding:20px; color:#a0a0c0;">Конфликтов не найдено</div>';
            return;
        }

        let html = '';
        for (let c = 0; c < this.massUploadData.conflicts.length; c++) {
            const conflict = this.massUploadData.conflicts[c];
            const { ourKod, csvKods } = conflict;

            html += `<div class="mass-conflict-item" data-conflict-id="${c}">`;
            html += `<div style="margin-bottom:12px;">`;
            html += `<div style="color:#a0a0c0; font-size:0.85rem; margin-bottom:4px;">Наш товар:</div>`;
            html += `<div style="padding:10px; background:rgba(139,92,246,0.1); border-radius:8px;">`;
            html += `Код: <strong style="color:#fff;">${this.escapeHtml(ourKod)}</strong>`;
            html += `</div></div>`;

            html += `<div style="margin-bottom:12px;">`;
            html += `<div style="color:#a0a0c0; font-size:0.85rem; margin-bottom:4px;">Вражеские коды (нажмите "×" чтобы удалить):</div>`;

            for (let k = 0; k < csvKods.length; k++) {
                const csvKod = csvKods[k];
                html += `<div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">`;
                html += `<span style="flex:1; padding:8px; background:rgba(0,0,0,0.2); border-radius:6px; color:#fff;">${this.escapeHtml(csvKod)}</span>`;
                html += `<button type="button" class="btn-mass-delete" data-conflict-id="${c}" data-kod-index="${k}" data-code="${this.escapeHtml(csvKod)}" style="padding:6px 12px; background:rgba(231,76,60,0.2); border:1px solid rgba(231,76,60,0.4); border-radius:6px; color:#e74c3c; cursor:pointer; font-size:0.85rem;">× Удалить</button>`;
                html += `</div>`;
            }

            html += `</div></div>`;
        }

        conflictsList.innerHTML = html;
        this.massUploadBindConflictButtons();
    },

    massUploadBindConflictButtons() {
        const deleteButtons = document.querySelectorAll('.btn-mass-delete');
        console.log('Найдено кнопок удаления:', deleteButtons.length);

        deleteButtons.forEach(btn => {
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);

            newBtn.addEventListener('click', (e) => {
                const conflictId = parseInt(newBtn.dataset.conflictId);
                const kodIndex = parseInt(newBtn.dataset.kodIndex);
                const code = newBtn.dataset.code;

                if (!newBtn.disabled) {
                    this.massUploadDeleteConflictCode(conflictId, kodIndex, code);
                }
            });
        });

        const closeBtn = document.getElementById('closeMassConflictX');
        if (closeBtn) {
            closeBtn.onclick = () => this.massUploadCloseConflictModal();
        }

        const closeBottomBtn = document.getElementById('closeMassConflictBtn');
        if (closeBottomBtn) {
            closeBottomBtn.onclick = () => this.massUploadCloseConflictModal();
        }

        const saveBtn = document.getElementById('saveMassConflictBtn');
        if (saveBtn) {
            saveBtn.onclick = () => this.massUploadSaveConflictResolution();
        }

        const conflictModal = document.getElementById('massConflictModal');
        if (conflictModal) {
            conflictModal.onclick = (e) => {
                if (e.target.classList.contains('warehouse-modal-overlay')) {
                    this.massUploadCloseConflictModal();
                }
            };
        }
    },

    massUploadDeleteConflictCode(conflictId, kodIndex, code) {
        console.log('Удаляем код:', code);

        const buttons = document.querySelectorAll('.btn-mass-delete');
        buttons.forEach(btn => {
            if (btn.dataset.conflictId == conflictId && btn.dataset.kodIndex == kodIndex) {
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.innerHTML = '✓ Удалён';
            }
        });

        this.massDeletedConflictCodes.push({
            conflictId: conflictId,
            kodIndex: kodIndex,
            code: code
        });

        console.log('Удалённые коды:', this.massDeletedConflictCodes);
    },

    async massUploadSaveConflictResolution() {
        if (this.massDeletedConflictCodes.length === 0) {
            alert('Удалите хотя бы один код, затем нажмите "Сохранить".');
            return;
        }

        try {
            for (const item of this.massDeletedConflictCodes) {
                // Удаляем из БД wneshkod
                const escapedCode = item.code.replace(/'/g, "''");
                await this.query(`DELETE FROM "wneshkod" WHERE "wkod"='${escapedCode}'`);

                // Помечаем как not-found в текущем анализе
                const index = this.massUploadData.analyzedData.findIndex(d => d.csvKod === item.code);
                if (index !== -1) {
                    this.massUploadData.analyzedData[index].ourKod = null;
                    this.massUploadData.analyzedData[index].art = null;
                    this.massUploadData.analyzedData[index].status = 'not-found';
                }
            }

            // Очищаем конфликты после разрешения
            this.massUploadData.conflicts = [];

            // Закрываем модалку
            this.massUploadCloseConflictModal();
            document.getElementById('massConflictWarning').style.display = 'none';

            // Перезапускаем анализ
            await this.massUploadRunAnalysis();
            this.massUploadUpdateConfirmButton();

        } catch (error) {
            console.error('Ошибка сохранения разрешения конфликтов:', error);
            alert('Ошибка: ' + error.message);
        }
    },

    // ============================================================
};

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    WAREHOUSE.init();
});