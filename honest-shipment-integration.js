// ============================================================
// honest-shipment-integration.js
// Пример подключения честного знака к shipment.html
// 
// Встраивается в существующую логику SHIPMENT
// ============================================================

// =============================================================
// ДОБАВИТЬ В shipment.html:
// =============================================================
// В <head>:
//   <link rel="stylesheet" href="honest-shipment.css">
//
// В <main> перед кнопками действий — добавить секцию:
//   <div class="honest-shipment-section" id="honestShipmentSection">
//       <h3>🏷️ Честный знак — маркировка</h3>
//       
//       <!-- Покупатель (UID в ГМЧД) -->
//       <div class="form-row">
//           <label>Покупатель (UID в ГМЧД) *</label>
//           <input type="text" id="buyerUid" placeholder="GUID покупателя в системе ГМЧД">
//       </div>
//       
//       <!-- Договор -->
//       <div class="form-row">
//           <label>Тип договора</label>
//           <select id="honestContractType">
//               <option value="resale">Перепродажа</option>
//               <option value="own">Собственное использование</option>
//               <option value="rent">Аренда</option>
//           </select>
//           <input type="text" id="honestContractNumber" placeholder="Номер договора">
//           <input type="date" id="honestContractDate">
//       </div>
//       
//       <!-- Кнопки -->
//       <div class="honest-actions">
//           <button id="generateCodesBtn" class="btn btn-primary" disabled>
//               📦 Сгенерировать коды + Отгрузить
//           </button>
//           <button id="printLabelsBtn" class="btn btn-secondary" disabled>
//               🖨️ Печать стикеров
//           </button>
//           <button id="getDrawdownBtn" class="btn btn-ghost">
//               📋 Выписка по операциям
//           </button>
//       </div>
//       
//       <!-- Прогресс -->
//       <div id="honestProgress" class="honest-progress" style="display:none;">
//           <div class="progress-bar">
//               <div class="progress-fill" id="honestProgressFill"></div>
//           </div>
//           <div id="honestProgressText">Генерация кодов...</div>
//       </div>
//       
//       <!-- Результат -->
//       <div id="honestResult" class="honest-result" style="display:none;">
//           <h4>Результат</h4>
//           <div id="honestResultContent"></div>
//       </div>
//   </div>
//
// Перед </body>:
//   <script src="honest-sign.js"></script>
//   <script src="honest-shipment-integration.js"></script>

// =============================================================
// INTEGRATION OBJECT
// =============================================================

const HONEST_SHIPMENT_INTEGRATION = {
    serverIp: '',
    generatedCodes: [],   // коды из generateCodesForShipment
    lastResult: null,     // полный результат pipeline

    // =========================================================
    // ИНИЦИАЛИЗАЦИЯ
    // =========================================================
    init() {
        this.serverIp = localStorage.getItem('serverIp') || '';
        if (!this.serverIp) return;

        // Устанавливаем дату договора по умолчанию
        document.getElementById('honestContractDate').value = new Date().toISOString().split('T')[0];

        this.bindEvents();
    },

    // =========================================================
    // СВЯЗЬ С КНОПКОЙ "ОТГРУЗИТЬ" В ШИПМЕНТЕ
    // =========================================================

    /**
     * Переопределяем или дополняем существующую функцию shipOrder()
     * 
     * Вместо простого:
     *   SHIPMENT.shipOrder();
     * 
     * Делаем:
     *   1. Вызываем honest pipeline (коды + оборот)
     *   2. Затем shipOrder (списание со склада)
     */
    async enhancedShipOrder() {
        const buyerUid = document.getElementById('buyerUid').value.trim();
        
        if (!buyerUid) {
            alert('❗ Укажите UID покупателя в ГМЧД');
            document.getElementById('buyerUid').focus();
            return;
        }

        const contractType = document.getElementById('honestContractType').value;
        const contractNumber = document.getElementById('honestContractNumber').value.trim();
        const contractDate = document.getElementById('honestContractDate').value;

        if (!contractNumber) {
            alert('❗ Укажите номер договора');
            document.getElementById('honestContractNumber').focus();
            return;
        }

        // Включаем прогресс
        this.showProgress('Сбор данных отгрузки...');

        // =====================================================
        // ШАГ 1: Собираем товары из shipmentData
        // =====================================================
        try {
            const shipmentItems = this.collectShipmentItems();
            this.showProgress(`Найдено товаров: ${shipmentItems.length}`);

            // =====================================================
            // ШАГ 2: Запускаем полный пайплайн ГМЧД
            // =====================================================
            const orderData = {
                nomer: SHIPMENT.currentNomer,           // номер заказа из shipment
                buyerUid: buyerUid,
                items: shipmentItems,                    // [{ kod, quantity }]
                contract: {
                    type: contractType,
                    number: contractNumber,
                    date: contractDate
                },
                user: document.getElementById('infoUser')?.textContent || 'Админ'
            };

            this.showProgress('Генерация кодов маркировки в ГМЧД...');

            const result = await HONEST_SIGN.fullShipmentPipeline(orderData);
            this.lastResult = result;
            this.generatedCodes = result.generated || [];

            this.showProgress('Обработка результатов...');

            // =====================================================
            // ШАГ 3: Если всё успешно — отгружаем на складе
            // =====================================================
            if (result.errors.length === 0) {
                // Теперь вызываем оригинальную shipOrder для списания со склада
                this.showProgress('Списание со склада...');

                // Сохраняем сгенерированные коды в shipmentData для сканирования
                // (если используется проверка kodpod в startShipment)
                this.attachCodesToShipment(result.generated);

                // Запускаем оригинальное списание
                await SHIPMENT.shipOrder();

                // Отмечаем заказ как отгруженный
                await this.markOrderAsShipped(result);

                this.showProgress('✅ Готово!');
                this.showResult(result);

                // Активируем кнопку печати
                document.getElementById('printLabelsBtn').disabled = false;

                // Звук успеха
                if (SHIPMENT.playSound) SHIPMENT.playSound('ok');

            } else {
                // Были ошибки
                this.showProgress('⚠️ Завершено с ошибками');
                this.showResult(result);
            }

        } catch (error) {
            console.error('Ошибка enhanced ship:', error);
            this.showProgress('❌ Ошибка: ' + error.message);
            alert('❌ Ошибка отгрузки: ' + error.message);
        }
    },

    // =========================================================
    // СБОР ДАННЫХ ИЗ shipmentData
    // =========================================================

    /**
     * Собирает товары из SHIPMENT.shipmentData
     * Возвращает: [ { kod, quantity, skipCodes? } ]
     */
    collectShipmentItems() {
        // Группируем shipmentData по kod
        const grouped = {};

        for (const item of SHIPMENT.shipmentData) {
            // Пропускаем отмеченные (уже отгруженные)
            if (SHIPMENT.markedRows.includes(SHIPMENT.shipmentData.indexOf(item))) {
                continue;
            }

            // Пропускаем оптовики (опт списывается через sostav)
            if (item.isWholesale) {
                continue;
            }

            if (!grouped[item.kod]) {
                grouped[item.kod] = {
                    kod: item.kod,
                    quantity: 0,
                    skipCodes: false
                };
            }

            // Проверяем тип товара — если "Расходник" или "Внутрицех", то без кодов
            if (item.art === 'Расходник' || item.art === 'Внутрицех') {
                grouped[item.kod].skipCodes = true;
            }

            grouped[item.kod].quantity += 1; // каждый row = 1 единица
        }

        return Object.values(grouped);
    },

    // =========================================================
    // ПРИВЯЗКА СГЕНЕРИРОВАННЫХ КОДОВ К ЗАКАЗУ
    // =========================================================

    /**
     * Привязывает сгенерированные DataMatrix коды к текущей shipmentData
     * Чтобы checkKodpod находил их при сканировании
     */
    attachCodesToShipment(codes) {
        if (!codes || codes.length === 0) return;

        // Для каждого сгенерированного кода добавляем строку в shipmentData
        for (const code of codes) {
            SHIPMENT.shipmentData.push({
                kod: code.kod,
                art: code.art,
                koli: 1,
                isWholesale: false,
                datamatrix: code.kodpod,  // DataMatrix код
                isNew: true                // флаг "новый, сгенерирован сегодня"
            });
        }

        // Перерисовываем таблицу
        SHIPMENT.renderShipmentTable();
        SHIPMENT.renderModalArticles();
    },

    // =========================================================
    // ПОМЕТКА ЗАКАЗА КАК ОТПРАВЛЕННОГО
    // =========================================================

    async markOrderAsShipped(result) {
        const localServer = this.serverIp;
        const nomer = SHIPMENT.currentNomer;

        if (!nomer) return;

        try {
            // Обновляем статус заказа на "0" (отгружен)
            const sql = `UPDATE "zakaz" SET "status"='0' WHERE "nomer"='${nomer.replace(/'/g, "''")}'`;
            const encodedSql = encodeURIComponent(sql);
            const url = `http://${localServer}:8080/query?sql=${encodedSql}`;
            await fetch(url, { method: 'GET', mode: 'cors' });

            console.log(`✅ Заказ ${nomer} помечен как отгруженный`);
        } catch (error) {
            console.error('Ошибка пометки заказа:', error);
            throw error;
        }
    },

    // =========================================================
    // ПЕЧАТЬ СТИКЕРОВ
    // =========================================================

    /**
     * Открывает окно печати сгенерированных стикеров
     */
    printLabels() {
        if (!this.generatedCodes || this.generatedCodes.length === 0) {
            alert('Нет сгенерированных кодов для печати');
            return;
        }

        const labelReport = HONEST_SIGN.generateLabelReport(this.generatedCodes);
        openLabelPrintHtml(labelReport.html);
    },

    // =========================================================
    // ВЫПИСКА ПО ОПЕРАЦИЯМ
    // =========================================================

    async getDrawdown() {
        const dateFrom = prompt('Дата начала (YYYY-MM-DD):', new Date(Date.now() - 86400000).toISOString().split('T')[0]);
        if (!dateFrom) return;

        const dateTo = new Date().toISOString().split('T')[0];

        try {
            this.showProgress('Загрузка выписки из ГМЧД...');
            const result = await HONEST_SIGN.getDrawdown(dateFrom, dateTo);
            
            this.showProgress('✅ Выписка загружена');
            alert('Выписка за период ' + dateFrom + ' — ' + dateTo + '\n\n' + JSON.stringify(result, null, 2));
        } catch (error) {
            alert('Ошибка получения выписки: ' + error.message);
        }
    },

    // =========================================================
    // UI — ПРОГРЕСС И РЕЗУЛЬТАТЫ
    // =========================================================

    showProgress(text) {
        const progress = document.getElementById('honestProgress');
        const fill = document.getElementById('honestProgressFill');
        const textEl = document.getElementById('honestProgressText');

        if (!progress) return;

        progress.style.display = 'block';
        textEl.textContent = text;

        if (text.includes('✅')) {
            fill.style.width = '100%';
            fill.style.background = '#2ecc71';
        } else if (text.includes('❌')) {
            fill.style.width = '70%';
            fill.style.background = '#e74c3c';
        } else if (text.includes('⚠️')) {
            fill.style.width = '80%';
            fill.style.background = '#f39c12';
        } else {
            fill.style.width = '40%';
            fill.style.background = '#6c63ff';
        }
    },

    showResult(result) {
        const container = document.getElementById('honestResult');
        const content = document.getElementById('honestResultContent');

        if (!container || !content) return;

        container.style.display = 'block';

        let html = `
            <div class="result-summary">
                <p><strong>Заказ:</strong> ${result.nomer}</p>
                <p><strong>Сгенерировано кодов:</strong> ${result.generated.length}</p>
                <p><strong>Сохранено в podmena:</strong> ${result.saved?.inserted || 0} (${result.saved?.skipped || 0} пропущено)</p>
                <p><strong>Статус ГМЧД:</strong> ${result.circulation?.notifications?.[0]?.status === 'success' ? '✅ Принято' : '⚠️ ' + (result.circulation?.notifications?.[0]?.status || 'Неизвестно')}</p>
            </div>
        `;

        if (result.errors.length > 0) {
            html += `<div class="result-errors"><strong>Ошибки:</strong><ul>`;
            for (const err of result.errors) {
                html += `<li>${err.step}: ${err.error}</li>`;
            }
            html += `</ul></div>`;
        }

        content.innerHTML = html;
    },

    // =========================================================
    // СОБЫТИЯ
    // =========================================================
    bindEvents() {
        // Кнопка генерации кодов + отгрузки
        document.getElementById('generateCodesBtn').addEventListener('click', () => {
            this.enhancedShipOrder();
        });

        // Кнопка печати стикеров
        document.getElementById('printLabelsBtn').addEventListener('click', () => {
            this.printLabels();
        });

        // Кнопка выписки
        document.getElementById('getDrawdownBtn').addEventListener('click', () => {
            this.getDrawdown();
        });

        // Активируем кнопку генерации когда есть заказ
        const observer = new MutationObserver(() => {
            const hasOrder = SHIPMENT.currentNomer && SHIPMENT.shipmentData.length > 0;
            document.getElementById('generateCodesBtn').disabled = !hasOrder;
        });

        // Наблюдаем за изменениями shipmentData
        // (упрощённо — можно вызывать bindEvents при loadShipmentData)
    }
};

// =============================================================
// ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ СТРАНИЦЫ
// =============================================================
document.addEventListener('DOMContentLoaded', () => {
    HONEST_SHIPMENT_INTEGRATION.init();
});
