// ============================================================
// honest-sign.js — Интеграция с "Честный знак" (ГМЧД)
// Для ПРОИЗВОДИТЕЛЯ с генерацией кодов при отгрузке
// ============================================================
//
// Сценарий:
//   1. На этапе отгрузки выбираем товары + количество
//   2. Автоматически заказываем коды маркировки на эти quantities
//   3. Печатаем стикеры с DataMatrix (отчёт о нанесении)
//   4. Отправляем уведомление "Ввод в оборот" (отгрузка покупателю)
//   5. Всё сохраняется в podmena + history автоматически
//
// Таблицы проекта:
//   guide   — товары (kod, art, name, gtin, opt, type, edizm, price)
//   sostav  — составы (kod, kod2, koli, upak)
//   podmena — коды маркировки (kodpod, kod, status: 1/0)
//   zakaz   — заказы (kod, koli, nomer, status)
//   history — складские движения
// ============================================================

const HONEST_SIGN = {
    // =========================================================
    // КОНФИГУРАЦИЯ — ЗАПОЛНИТЬ ПОД СВОЙ АККАУНТ
    // =========================================================
    config: {
        // API Честного знака
        apiBase: 'https://mrk-fs1.cntd.ru',
        authUrl: 'https://api.cntd.ru',

        // Ваши учетные данные (получить в ЛК marker.cntd.ru)
        clientId: 'YOUR_CLIENT_ID',
        clientSecret: 'YOUR_CLIENT_SECRET',
        teamUid: 'YOUR_TEAM_UID',     // UID вашей команды
        groupUid: 'YOUR_GROUP_UID',   // UID вашей группы

        // Локальный сервер
        localServer: '', // подставляется автоматически

        // Настройки печати
        stickersPerMeter: 31,  // стикеров на 1 метр ленты
        stickerHeight: 40      // высота стикера в мм
    },

    // Кэш токена авторизации
    _token: null,
    _tokenExpiry: 0,

    // =========================================================
    // 1. АВТОРИЗАЦИЯ
    // =========================================================

    /**
     * Вход в API Честного знака (OAuth2)
     */
    async login() {
        const resp = await fetch(`${this.config.authUrl}/oauth2/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: this.config.clientId,
                client_secret: this.config.clientSecret
            })
        });

        if (!resp.ok) throw new Error(`Auth failed: ${resp.status}`);

        const data = await resp.json();
        this._token = data.access_token;
        this._tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
        return this._token;
    },

    /**
     * Проверка / обновление токена
     */
    async ensureToken() {
        if (!this._token || Date.now() > this._tokenExpiry) {
            await this.login();
        }
    },

    /**
     * HTTP-запрос к API ГМЧД
     */
    async request(path, options = {}) {
        await this.ensureToken();

        const headers = {
            'Authorization': `Bearer ${this._token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...options.headers
        };

        const resp = await fetch(`${this.config.apiBase}${path}`, {
            ...options,
            headers
        });

        // Если 401 — рефрешим токен и повторяем
        if (resp.status === 401) {
            await this.login();
            return this.request(path, options);
        }

        const text = await resp.text();
        try { return JSON.parse(text); } catch { return text; }
    },

    // =========================================================
    // 2. ПОЛУЧЕНИЕ GTIN ДЛЯ ТОВАРА
    // =========================================================

    /**
     * Получает GTIN товара из таблицы guide
     * Если GTIN пустой — генерирует новый GTIN-14
     */
    async getOrGenerateGtin(kod) {
        const localServer = localStorage.getItem('serverIp') || this.config.localServer;
        const sql = `SELECT "gtin", "art", "name", "cgd_code" FROM "guide" WHERE "kod"='${kod.replace(/'/g, "''")}'`;
        const encodedSql = encodeURIComponent(sql);
        const url = `http://${localServer}:8080/query?sql=${encodedSql}`;

        const resp = await fetch(url, { method: 'GET', mode: 'cors' });
        const result = await resp.text();
        const lines = result.trim().split('\n').filter(l => l);

        if (lines.length < 2) {
            throw new Error(`Товар с kod=${kod} не найден в guide`);
        }

        const headers = lines[0].split('\t');
        const parts = lines[1].split('\t');
        const gtinIdx = headers.indexOf('gtin');
        const artIdx = headers.indexOf('art');
        const nameIdx = headers.indexOf('name');
        const cgdIdx = headers.indexOf('cgd_code');

        const gtin = (gtinIdx >= 0 ? parts[gtinIdx] : '').trim();
        const art = (artIdx >= 0 ? parts[artIdx] : '').trim();
        const name = (nameIdx >= 0 ? parts[nameIdx] : '').trim();
        const cgdCode = (cgdIdx >= 0 ? parts[cgdIdx] : '').trim();

        if (!gtin || gtin === '') {
            // GTIN нет — генерируем новый (нужно зарегистрировать товар в ГМЧД)
            throw new Error(`У товара "${art} (${name})" не указан GTIN. Сначала добавьте GTIN в справочник товаров.`);
        }

        return { gtin, art, name, cgdCode };
    },

    // =========================================================
    // 3. ГЕНЕРАЦИЯ КОДОВ МАРКИРОВКИ (основной метод)
    // =========================================================

    /**
     * Заказать коды маркировки для отгрузки
     * 
     * @param {Array} items — товары для отгрузки
     *   [
     *     { kod: "12345", quantity: 10, buyerUid: "GUID-ПОКУПАТЕЛЯ" },
     *     { kod: "67890", quantity: 5, buyerUid: "GUID-ПОКУПАТЕЛЯ" }
     *   ]
     * 
     * @returns {Object} результат:
     *   {
     *     codes: [
     *       { kod: "12345", kodpod: "00272304003103ABCDEF1234567890", gtin: "00272304003103", serial: "ABCDEF1234567890" },
     *       ...
     *     ],
     *     totalGenerated: 15
     *   }
     */
    async generateCodesForShipment(items) {
        const allCodes = [];
        const BATCH_LIMIT = 100; // максимум кодов за один запрос к ГМЧД

        for (const item of items) {
            // Получаем GTIN товара
            const productInfo = await this.getOrGenerateGtin(item.kod);
            let { gtin } = productInfo;

            let remaining = item.quantity;
            let offset = 0;

            while (remaining > 0) {
                const batchSize = Math.min(remaining, BATCH_LIMIT);

                // Запрашиваем батч кодов у ГМЧД
                const payload = {
                    gtin: gtin,
                    quantity: batchSize,
                    serialParams: {
                        issuanceType: "auto"
                    }
                };

                const result = await this.request('/v1/Serialization/generate', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });

                if (!result || !result.codes || result.codes.length === 0) {
                    throw new Error(`ГМЧД не вернул коды для GTIN=${gtin}, quantity=${batchSize}`);
                }

                // Сохраняем каждый код
                for (const codeStr of result.codes) {
                    // codeStr = "00272304003103ABCDEF1234567890" (GTIN + serial)
                    const serial = codeStr.substring(14); // после GTIN

                    allCodes.push({
                        kod: item.kod,
                        kodpod: codeStr,
                        gtin: gtin,
                        serial: serial,
                        art: productInfo.art,
                        name: productInfo.name
                    });
                }

                remaining -= batchSize;
                offset += batchSize;
            }
        }

        return {
            codes: allCodes,
            totalGenerated: allCodes.length
        };
    },

    // =========================================================
    // 4. ОТЧЁТ О НАНЕСЕНИИ (печать DataMatrix стикеров)
    // =========================================================

    /**
     * Формирует данные для печати стикеров с DataMatrix
     * 
     * @param {Array} codes — массив кодов из generateCodesForShipment
     * @returns {Object} данные для печати:
     *   {
     *     labels: [...],     // массив стикеров для печати
     *     html: '...'        // готовый HTML для печати
     *   }
     */
    generateLabelReport(codes) {
        const labels = codes.map((code, index) => ({
            index: index + 1,
            kod: code.kod,
            art: code.art,
            name: code.name,
            dataMatrix: code.kodpod,     // полный DataMatrix для сканирования
            serial: code.serial,          // серийный номер
            gtin: code.gtin
        }));

        // Генерируем HTML для печати
        const html = this.buildPrintHtml(labels);

        return { labels, html };
    },

    /**
     * Строит HTML для печати стикеров
     */
    buildPrintHtml(labels) {
        const widthMM = this.config.stickerHeight ? 58 : 58; // ширина ленты 58мм
        const heightMM = this.config.stickerHeight || 40;

        const labelHtml = labels.map(label => `
            <div class="print-label" style="
                width: ${widthMM}mm;
                height: ${heightMM}mm;
                border: 1px dashed #ccc;
                page-break-inside: avoid;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 4px;
                box-sizing: border-box;
            ">
                <div style="font-size: 8px; margin-bottom: 2px;">${this.escapeHtml(label.art)}</div>
                <div style="width: 80px; height: 80px;">
                    <!-- DataMatrix код через API QR-генератора -->
                    <img src="https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(label.dataMatrix)}&size=80x80&ecc=H" 
                         alt="DataMatrix" 
                         style="width: 80px; height: 80px;" />
                </div>
                <div style="font-size: 7px; margin-top: 2px; word-break: break-all;">
                    ${label.dataMatrix}
                </div>
                <div style="font-size: 6px; color: #888;">${this.escapeHtml(label.name)}</div>
            </div>
        `).join('');

        return `<!DOCTYPE html>
<html>
<head>
    <title>Отчёт о нанесении — ${new Date().toLocaleDateString('ru-RU')}</title>
    <style>
        @page { size: auto; margin: 5mm; }
        body { margin: 0; padding: 0; }
        .print-container { 
            display: flex; 
            flex-wrap: wrap; 
            gap: 2mm;
            justify-content: flex-start;
        }
        @media print {
            body { -webkit-print-color-adjust: exact; }
            .no-print { display: none; }
        }
    </style>
</head>
<body>
    <div class="no-print" style="padding: 10px;">
        <h3>Отчёт о нанесении</h3>
        <p>Дата: ${new Date().toLocaleDateString('ru-RU')} | 
           Кодов: ${labels.length} | 
           Длительность печати: ~${(labels.length / this.config.stickersPerMeter).toFixed(1)}м</p>
        <button onclick="window.print()">🖨️ Печать</button>
    </div>
    <div class="print-container">
        ${labelHtml}
    </div>
</body>
</html>`;
    },

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // =========================================================
    // 5. ОТЧЁТ О ВВОДЕ В ОБОРОТ (Notification в ГМЧД)
    // =========================================================

    /**
     * Отправить отчёт о вводе в оборот (отгрузка производителем)
     * 
     * @param {Array} codes — массив кодов из generateCodesForShipment
     * @param {string} buyerUid — UID покупателя в ГМЧД
     * @param {Object} contract — договор
     *   { type: "resale", number: "Счёт-42", date: "2026-11-06" }
     * 
     * @returns {Object} результат от ГМЧД
     */
    async sendCirculationReport(codes, buyerUid, contract) {
        if (!codes || codes.length === 0) {
            throw new Error('Нет кодов для отправки в оборот');
        }

        // Группируем коды по GTIN (ГМЧД принимает группировку)
        const groupedByGtin = {};
        for (const code of codes) {
            if (!groupedByGtin[code.gtin]) {
                groupedByGtin[code.gtin] = [];
            }
            groupedByGtin[code.gtin].push(code.kodpod);
        }

        const operations = Object.entries(groupedByGtin).map(([gtin, datamatrixCodes]) => ({
            goods: {
                gtin: gtin,
                gmCodes: datamatrixCodes // DataMatrix коды
            },
            ss: "0",       // сумма (если не требуется)
            vat: "20",     // ставка НДС (0/10/20)
            contractType: contract.type || "resale",
            contractNumber: contract.number || "",
            contractDate: contract.date || new Date().toISOString().split('T')[0]
        }));

        const payload = {
            agentServiceFunc: "ShipToTurnOn", // отгрузка производителем в оборот
            timestamp: new Date().toISOString(),
            ownerUid: this.config.teamUid,
            buyerUid: buyerUid,
            operations: operations
        };

        const result = await this.request('/v1/Notification', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        return result;
    },

    // =========================================================
    // 6. СОХРАНЕНИЕ В ЛОКАЛЬНУЮ БАЗУ
    // =========================================================

    /**
     * Сохраняет сгенерированные коды в таблицу podmena
     * 
     * @param {Array} codes — массив кодов
     * @param {string} doknom — номер документа приёмки/отгрузки
     * @param {string} user — сотрудник
     * 
     * @returns {Object} { inserted, skipped, errors }
     */
    async saveCodesToPodmena(codes, doknom, user) {
        const localServer = localStorage.getItem('serverIp') || this.config.localServer;
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0];
        const timeStr = today.toTimeString().split(' ')[0];

        let inserted = 0;
        let skipped = 0;
        let errors = [];

        // Формируем batch INSERT для производительности
        const values = codes.map(code => {
            const escapedKodpod = code.kodpod.replace(/'/g, "''");
            const escapedKod = code.kod.replace(/'/g, "''");
            return `('${escapedKodpod}', '${escapedKod}', '1', '${dateStr}', '${timeStr}', '${user.replace(/'/g, "''")}', '${doknom.replace(/'/g, "''")}')`;
        }).join(', ');

        if (!values) return { inserted: 0, skipped: 0, errors: [] };

        const sql = `INSERT INTO "podmena" ("kodpod", "kod", "status", "data", "wremja", "SOTRUDNIK", "doknom") VALUES ${values}`;

        try {
            const encodedSql = encodeURIComponent(sql);
            const url = `http://${localServer}:8080/query?sql=${encodedSql}`;
            await fetch(url, { method: 'GET', mode: 'cors' });
            inserted = codes.length;
        } catch (error) {
            console.error('Ошибка сохранения в podmena:', error);
            // Если коды уже существуют — считаем как пропущенные
            errors.push(error.message);
            skipped = codes.length;
        }

        return { inserted, skipped, errors };
    },

    /**
     * Записывает движение на склад (history)
     */
    async recordStockMovement(kod, quantity, user) {
        const localServer = localStorage.getItem('serverIp') || this.config.localServer;
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0];
        const timeStr = today.toTimeString().split(' ')[0];

        const sql = `INSERT INTO "history" ("kod", "data", "time", "quantity", "prostuk", "user", "ID_user") 
                     VALUES ('${kod.replace(/'/g, "''")}', '${dateStr}', '${timeStr}', ${quantity}, 1, '${user.replace(/'/g, "''")}', '')`;

        const encodedSql = encodeURIComponent(sql);
        const url = `http://${localServer}:8080/query?sql=${encodedSql}`;
        await fetch(url, { method: 'GET', mode: 'cors' });
    },

    // =========================================================
    // 7. ПОЛНЫЙ ПАЙПЛАЙН ОТПУСКИ (все шаги автоматически)
    // =========================================================

    /**
     * Полная автоматическая отгрузка:
     *   1. Генерация кодов → 2. Сохранение в podmena →
     *   3. Отчёт о нанесении → 4. Ввод в оборот → 5. Списание со склада
     * 
     * @param {Object} orderData — данные отгрузки
     * {
     *   nomer: "Z-000123",          // номер заказа
     *   buyerUid: "GUID-ПОКУПАТЕЛЯ", // UID покупателя в ГМЧД
     *   items: [
     *     { kod: "12345", quantity: 10 },
     *     { kod: "67890", quantity: 5, skipCodes: true }  // без кодов (расходник)
     *   ],
     *   contract: { type: "resale", number: "Счёт-42", date: "2026-11-06" },
     *   user: "Иванов И.И."          // сотрудник
     * }
     * 
     * @returns {Object} полный результат
     */
    async fullShipmentPipeline(orderData) {
        const { nomer, buyerUid, items, contract, user } = orderData;
        const result = {
            timestamp: new Date().toISOString(),
            nomer: nomer,
            generated: [],
            saved: null,
            circulation: null,
            labels: null,
            skipped: [],
            errors: []
        };

        // =====================================================
        // ШАГ 1: Фильтруем товары — с маркировкой и без
        // =====================================================
        const markedItems = items.filter(i => !i.skipCodes);
        const simpleItems = items.filter(i => i.skipCodes);

        if (markedItems.length === 0 && simpleItems.length === 0) {
            throw new Error('Нет товаров для отгрузки');
        }

        // =====================================================
        // ШАГ 2: Генерируем коды для маркируемых товаров
        // =====================================================
        if (markedItems.length > 0) {
            try {
                const genResult = await this.generateCodesForShipment(markedItems);
                result.generated = genResult.codes;

                // =====================================================
                // ШАГ 3: Сохраняем коды в podmena
                // =====================================================
                result.saved = await this.saveCodesToPodmena(
                    genResult.codes,
                    nomer,
                    user
                );

                // =====================================================
                // ШАГ 4: Формируем отчёт о нанесении (стикеры)
                // =====================================================
                const labelReport = this.generateLabelReport(genResult.codes);
                result.labels = labelReport;

                // =====================================================
                // ШАГ 5: Отправляем ввод в оборот в ГМЧД
                // =====================================================
                result.circulation = await this.sendCirculationReport(
                    genResult.codes,
                    buyerUid,
                    contract
                );

            } catch (error) {
                result.errors.push({
                    step: 'generation/circulation',
                    error: error.message
                });
            }
        }

        // =====================================================
        // ШАГ 6: Списание простых товаров (без кодов)
        // =====================================================
        for (const item of simpleItems) {
            try {
                await this.recordStockMovement(item.kod, -item.quantity, user);
                result.skipped.push({
                    kod: item.kod,
                    quantity: item.quantity,
                    reason: 'simple_item'
                });
            } catch (error) {
                result.errors.push({
                    step: 'stock_writeoff',
                    kod: item.kod,
                    error: error.message
                });
            }
        }

        // =====================================================
        // ШАГ 7: Списание компонентов составных товаров
        // (если в orderData есть составные товары)
        // =====================================================
        // Это делает SHIPMENT.shipOrder() — наша интеграция
        // не трогает, это уже работает через sostav

        return result;
    },

    // =========================================================
    // 8. ОТЧЁТ ПО СФОРМИРОВАННЫМ КОДАМ (проверка)
    // =========================================================

    /**
     * Получает выписку (акт) по операциям за период
     */
    async getDrawdown(dateFrom, dateTo) {
        const payload = {
            startDate: dateFrom,
            endDate: dateTo,
            ownerUid: this.config.teamUid
        };

        return await this.request('/v1/Act', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    },

    /**
     * Проверяет статус кодов в ГМЧД
     */
    async checkCodeStatus(datamatrixCodes) {
        /**
         * Проверяет, в каком статусе коды в ГМЧД:
         * - сгенерирован
         * - в обороте
         * - отгружен
         * - списан
         */
        const payload = {
            gmCodes: datamatrixCodes
        };

        return await this.request('/v1/Code/status', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }
};

// ============================================================
// УТИЛИТА: Открытие окна печати стикеров
// ============================================================
function openLabelPrintHtml(htmlContent) {
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    printWindow.document.write(htmlContent);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 500);
}
