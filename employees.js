// ============================================================
// EMPLOYEES PAGE - JavaScript
// ============================================================

const EMPLOYEES = {
    serverIp: '',
    currentData: { columns: [], rows: [] },
    translations: {},
    sortColumn: -1,
    sortDirection: 'asc',
    editingRow: null,       // индекс редактируемой строки
    isEditMode: false,
    tempFields: {},         // временные поля для редактирования

    // ============================================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================================
    init() {
        this.serverIp = localStorage.getItem('serverIp') || '';

        if (!this.serverIp) {
            window.location.href = 'login.html';
            return;
        }

        // Проверка доступа
        const userAccess = window.getUserAccess?.() || [];
        if (userAccess.length === 0 || (!userAccess.includes('*') && !userAccess.includes('Сотрудники'))) {
            window.location.href = 'login.html';
            return;
        }

        document.getElementById('serverIp').textContent = this.serverIp;

        this.bindEvents();
        this.loadTranslations();
        this.loadEmployeeList(); // Загружаем список сотрудников заранее
    },

    // ============================================================
    // ЗАГРУЗКА ПЕРЕВОДОВ
    // ============================================================
    async loadTranslations() {
        try {
            const sql = 'SELECT "original", "slovo" FROM "perevod"';
            const result = await this.query(sql);

            if (result) {
                const lines = result.trim().split('\n').filter(l => l);
                for (let i = 1; i < lines.length; i++) {
                    const parts = lines[i].split('\t');
                    if (parts.length >= 2) {
                        this.translations[parts[0].trim()] = parts[1].trim();
                    }
                }
            }

            await this.loadEmployees();
        } catch (error) {
            console.error('Ошибка загрузки переводов:', error);
            await this.loadEmployees();
        }
    },

    // ============================================================
    // ЗАГРУЗКА СОТРУДНИКОВ
    // ============================================================
    async loadEmployees() {
        const container = document.getElementById('employeesTableContainer');
        container.innerHTML = '<div class="loading-message">Загрузка сотрудников...</div>';

        try {
            const sql = 'SELECT * FROM "sotrud" ORDER BY "nomer"';
            const result = await this.query(sql);

            if (!result || result.includes('ОШИБКА') || result.includes('ERROR')) {
                container.innerHTML = `<div class="loading-message" style="color: #e74c3c;">Ошибка: ${result}</div>`;
                return;
            }

            const lines = result.trim().split('\n').filter(l => l);
            if (lines.length === 0) {
                container.innerHTML = '<div class="loading-message">Сотрудники не найдены</div>';
                return;
            }

            const rawColumns = lines[0].split('\t').map(c => c.trim());
            const columns = rawColumns.map(col => ({
                name: col,
                displayName: this.translations[col] || col
            }));

            const rows = lines.slice(1).map(line => line.split('\t'));

            this.currentData = { columns, rows };
            this.updateStats();
            this.renderTable(columns, rows);
        } catch (error) {
            console.error('Ошибка загрузки сотрудников:', error);
            container.innerHTML = `<div class="loading-message" style="color: #e74c3c;">
                Ошибка загрузки: ${error.message}
                <br><br>
                <button onclick="EMPLOYEES.loadEmployees()" style="padding: 8px 16px; background: #6c63ff; color: white; border: none; border-radius: 6px; cursor: pointer;">Повторить</button>
            </div>`;
        }
    },

    // ============================================================
    // ОБНОВЛЕНИЕ СТАТИСТИКИ
    // ============================================================
    updateStats() {
        const total = this.currentData.rows.length;
        const statusIndex = this.currentData.columns.findIndex(c => c.name === 'status');
        let active = 0;
        let inactive = 0;

        if (statusIndex !== -1) {
            this.currentData.rows.forEach(row => {
                const status = row[statusIndex] || '';
                if (status.toLowerCase() === 'работает' || status.toLowerCase() === 'активен' || status === '1') {
                    active++;
                } else {
                    inactive++;
                }
            });
        } else {
            active = total;
        }

        document.getElementById('totalCount').textContent = total;
        document.getElementById('activeCount').textContent = active;
        document.getElementById('inactiveCount').textContent = inactive;
    },

    // ============================================================
    // РЕНДЕР ТАБЛИЦЫ
    // ============================================================
    renderTable(columns, rows) {
        const container = document.getElementById('employeesTableContainer');

        if (rows.length === 0) {
            container.innerHTML = '<div class="loading-message">Нет данных</div>';
            return;
        }

        const html = `
            <table class="employees-table">
                <thead>
                    <tr>
                        <th style="width: 50px;">№</th>
                        ${columns.map((col, index) => {
                            const isActive = this.sortColumn === index;
                            const dirAttr = isActive ? ` data-dir="${this.sortDirection}"` : '';
                            return `<th class="sortable${isActive ? ' sortable-active' : ''}${dirAttr}" onclick="EMPLOYEES.sortData(${index})">${this.escapeHtml(col.displayName)}<span class="sort-indicator">${this.getSortIndicator(index)}</span></th>`;
                        }).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((row, index) => `
                        <tr class="clickable-row" onclick="EMPLOYEES.openEmployeeCard(${index})">
                            <td>${index + 1}</td>
                            ${columns.map((col, colIndex) => {
                                const value = row[colIndex] || '';
                                const displayValue = this.escapeHtml(value);
                                return `<td>${displayValue}</td>`;
                            }).join('')}
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        container.innerHTML = html;
    },

    // ============================================================
    // ОТКРЫТИЕ КАРТОЧКИ СОТРУДНИКА
    // ============================================================
    openEmployeeCard(rowIndex) {
        this.editingRow = rowIndex;
        const row = this.currentData.rows[rowIndex];
        const columns = this.currentData.columns;
        this.isEditMode = false;

        // Получаем данные
        const id = row[columns.findIndex(c => c.name === 'ID')] || '';
        const fio = row[columns.findIndex(c => c.name === 'fio')] || '';
        const status = row[columns.findIndex(c => c.name === 'status')] || '';
        const access = row[columns.findIndex(c => c.name === 'доступ')] || '';

        // Обновляем заголовок
        document.getElementById('cardModalTitle').textContent = 'Карточка сотрудника';
        document.getElementById('cardFio').textContent = fio || 'Не указано';

        // Фото (по ID) и инициалы
        const photo = document.getElementById('employeePhoto');
        const placeholder = document.querySelector('.employee-photo-placeholder');
        const initials = document.getElementById('photoInitials');

        // Инициалы из ФИО
        if (fio) {
            const parts = fio.split(' ');
            if (parts.length >= 2) {
                initials.textContent = (parts[0][0] + parts[1][0]).toUpperCase();
            } else {
                initials.textContent = fio.substring(0, 2).toUpperCase();
            }
        }

        photo.src = `http://${this.serverIp}:8080/photo/${id}`;
        photo.style.display = 'block';
        placeholder.style.display = 'none';

        // Бейджи
        document.getElementById('cardStatus').textContent = status || 'Не указано';
        document.getElementById('cardAccess').textContent = `Доступ: ${access}`;

        // Статус-бейдж с цветом
        const statusBadge = document.getElementById('cardStatus');
        if (status.toLowerCase() === 'работает' || status.toLowerCase() === 'активен' || status === '1') {
            statusBadge.className = 'status-badge status-active';
        } else {
            statusBadge.className = 'status-badge status-inactive';
        }

        // Поля карточки
        this.renderCardFields(columns, row);

        // Показываем модалку
        document.getElementById('employeeCardModal').style.display = 'flex';
    },

    // ============================================================
    // РЕНДЕР ПОЛЕЙ КАРТОЧКИ
    // ============================================================
    renderCardFields(columns, row) {
        const container = document.getElementById('cardFields');
        const self = this;

        const html = columns.map((col, index) => {
            const value = row[index] || '';
            const isNomer = col.name === 'nomer'; // nomer - первичный ключ

            return `
                <div class="field-item">
                    <label class="field-label">${this.escapeHtml(col.displayName)}</label>
                    <div class="field-value" data-field="${col.name}" data-index="${index}">
                        ${this.escapeHtml(value)}
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = html;
    },

    // ============================================================
    // РЕЖИМ РЕДАКТИРОВАНИЯ
    // ============================================================
    enableEdit() {
        const columns = this.currentData.columns;
        const row = this.currentData.rows[this.editingRow];
        const container = document.getElementById('cardFields');
        const self = this;

        this.isEditMode = true;

        // Сохраняем текущие значения
        columns.forEach((col, index) => {
            this.tempFields[col.name] = row[index] || '';
        });

        // Конвертируем поля в input
        const html = columns.map((col, index) => {
            const value = row[index] || '';
            const isNomer = col.name === 'nomer'; // PRIMARY KEY

            const inputType = col.name === 'stavka' || col.name === 'dostup' ? 'number' : 'text';

            return `
                <div class="field-item">
                    <label class="field-label">${this.escapeHtml(col.displayName)}</label>
                    <input 
                        type="${inputType}" 
                        class="field-input ${isNomer ? 'readonly' : ''}" 
                        data-field="${col.name}"
                        value="${this.escapeHtml(value)}"
                        ${isNomer ? 'disabled' : ''}
                    >
                </div>
            `;
        }).join('');

        container.innerHTML = html;

        // Меняем кнопки
        document.getElementById('cardModalTitle').textContent = 'Редактирование сотрудника';
        document.getElementById('unlockEditBtn').style.display = 'none';
        document.getElementById('saveEditBtn').style.display = 'inline-flex';
        document.getElementById('cancelEditBtn').style.display = 'inline-flex';
    },

    disableEdit() {
        this.isEditMode = false;
        this.renderCardFields(this.currentData.columns, this.currentData.rows[this.editingRow]);

        // Возвращаем кнопки
        document.getElementById('cardModalTitle').textContent = 'Карточка сотрудника';
        document.getElementById('unlockEditBtn').style.display = 'inline-flex';
        document.getElementById('saveEditBtn').style.display = 'none';
        document.getElementById('cancelEditBtn').style.display = 'none';
    },

    async saveChanges() {
        const columns = this.currentData.columns;
        const tableName = 'sotrud';

        // Находим PRIMARY KEY (nomer)
        const pkIndex = columns.findIndex(c => c.name === 'nomer');
        if (pkIndex === -1) {
            alert('❌ Не найден первичный ключ (nomer)');
            return;
        }

        const pkValue = this.currentData.rows[this.editingRow][pkIndex];

        // Формируем SET
        const sets = columns.map(col => {
            const input = document.querySelector(`input[data-field="${col.name}"]`);
            let value = input ? input.value : '';

            if (col.name === 'nomer') return `"${col.name}"=${value}`;
            if (col.name === 'stavka' || col.name === 'dostup' || col.name === 'rezerv2') {
                return `"${col.name}"=${parseInt(value) || 0}`;
            }
            const escaped = (value || '').replace(/'/g, "''");
            return `"${col.name}"='${escaped}'`;
        }).join(', ');

        const sql = `UPDATE "${tableName}" SET ${sets} WHERE "nomer"=${pkValue}`;

        try {
            await this.query(sql);
            alert('✅ Данные сохранены');
            this.disableEdit();
            await this.loadEmployees();
        } catch (error) {
            console.error('Ошибка сохранения:', error);
            alert(`❌ Ошибка сохранения: ${error.message}`);
        }
    },

    // ============================================================
    // ОТКРЫТИЕ ОКНА ДОБАВЛЕНИЯ
    // ============================================================
    openAddEmployeeModal() {
        const columns = this.currentData.columns;
        const container = document.getElementById('addEmployeeFields');
        const self = this;

        const html = columns.map(col => {
            const inputType = col.name === 'stavka' || col.name === 'dostup' || col.name === 'nomer' ? 'number' : 'text';

            return `
                <div class="field-item">
                    <label class="field-label">${this.escapeHtml(col.displayName)}</label>
                    <input 
                        type="${inputType}"
                        class="field-input" 
                        data-field="${col.name}"
                        placeholder="Введите значение"
                    >
                </div>
            `;
        }).join('');

        container.innerHTML = html;
        document.getElementById('addEmployeeModal').style.display = 'flex';
    },

    async addEmployee(formData) {
        const columns = this.currentData.columns;
        const tableName = 'sotrud';

        const columnNames = columns.map(c => `"${c.name}"`).join(', ');
        const values = columns.map(col => {
            const input = formData.get(col.name);
            if (col.name === 'nomer') return input || '0';
            if (col.name === 'stavka' || col.name === 'dostup' || col.name === 'rezerv2') {
                return parseInt(input) || 0;
            }
            return `'${(input || '').replace(/'/g, "''")}'`;
        }).join(', ');

        const sql = `INSERT INTO "${tableName}" (${columnNames}) VALUES (${values})`;

        try {
            await this.query(sql);
            alert('✅ Сотрудник добавлен');
            this.closeAddModal();
            await this.loadEmployees();
        } catch (error) {
            console.error('Ошибка добавления:', error);
            alert(`❌ Ошибка добавления: ${error.message}`);
        }
    },

    // ============================================================
    // ЗАКРЫТИЕ МОДАЛОК
    // ============================================================
    closeCardModal() {
        document.getElementById('employeeCardModal').style.display = 'none';
        this.isEditMode = false;
        this.editingRow = null;
    },

    closeAddModal() {
        document.getElementById('addEmployeeModal').style.display = 'none';
    },

    closeAllModals() {
        this.closeCardModal();
        this.closeAddModal();
        this.closeFinanceModal();
    },

    // ============================================================
    // ФИНАНСЫ
    // ============================================================
    currentFinanceUser: { id: '', name: '' },
    employeeList: [],

    async loadEmployeeList() {
        if (this.employeeList.length > 0) return;

        try {
            const sql = 'SELECT "ID", "NAME", "fio" FROM "sotrud" ORDER BY "NAME"';
            const result = await this.query(sql);

            if (result) {
                const lines = result.trim().split('\n').filter(l => l);
                for (let i = 1; i < lines.length; i++) {
                    const parts = lines[i].split('\t');
                    if (parts.length >= 3) {
                        this.employeeList.push({
                            id: parts[0].trim(),
                            name: parts[1].trim(),
                            fio: parts[2].trim()
                        });
                    }
                }
            }

            this.populateEmployeeSelect();
        } catch (error) {
            console.error('Ошибка загрузки списка сотрудников:', error);
        }
    },

    populateEmployeeList() {
        const select = document.getElementById('financeEmployee');
        select.innerHTML = '<option value="">-- Выберите сотрудника --</option>';

        this.employeeList.forEach(emp => {
            const displayName = emp.fio || emp.name || emp.id;
            const option = document.createElement('option');
            option.value = emp.id;
            option.textContent = displayName;
            select.appendChild(option);
        });
    },

    populateEmployeeSelect() {
        this.populateEmployeeList();
    },

    openFinanceModal(rowIndex) {
        if (rowIndex !== undefined && rowIndex !== null) {
            // Получаем данные сотрудника из строки таблицы
            const row = this.currentData.rows[rowIndex];
            const columns = this.currentData.columns;
            const idIndex = columns.findIndex(c => c.name === 'ID');
            const id = row[idIndex] || '';

            // Ищем в загруженном списке
            const found = this.employeeList.find(e => e.id === id);
            if (found) {
                document.getElementById('financeEmployee').value = found.id;
            }
        }

        // Сбрасываем форму — "Тип операции" = пусто
        document.getElementById('financeEmployee').value = '';
        document.getElementById('financeType').value = '';
        document.getElementById('financeSum').value = '';
        document.getElementById('financeKomm').value = '';

        // Заполняем список если не заполнен
        if (this.employeeList.length === 0) {
            this.populateEmployeeList();
        }

        document.getElementById('financeModal').style.display = 'flex';

        // Фокус на поле выбора сотрудника
        setTimeout(() => document.getElementById('financeEmployee').focus(), 100);
    },

    closeFinanceModal() {
        document.getElementById('financeModal').style.display = 'none';
    },

    updateFinanceSumField() {
        const type = document.getElementById('financeType').value;
        const kommInput = document.getElementById('financeKomm');
        kommInput.disabled = (type !== 'doppay' && type !== 'straf');
        if (type !== 'doppay' && type !== 'straf') {
            kommInput.value = '';
        }
    },

    async saveFinance() {
        const empId = document.getElementById('financeEmployee').value;
        if (!empId) {
            alert('❌ Выберите сотрудника');
            document.getElementById('financeEmployee').focus();
            return;
        }

        const type = document.getElementById('financeType').value;
        if (!type) {
            alert('❌ Выберите тип операции');
            document.getElementById('financeType').focus();
            return;
        }

        const summa = parseFloat(document.getElementById('financeSum').value) || 0;
        if (summa <= 0) {
            alert('❌ Введите сумму');
            document.getElementById('financeSum').focus();
            return;
        }

        // Для премии и штрафа автоматически заполняем comment
        const komm = (document.getElementById('financeKomm').value || '').replace(/'/g, "''");

        // Ищем сотрудника
        const emp = this.employeeList.find(e => e.id === empId);
        if (!emp) {
            alert('❌ Сотрудник не найден');
            return;
        }

        const today = new Date().toISOString().split('T')[0];

        // Формируем SQL в зависимости от типа
        let sql = '';
        if (type === 'pay') {
            sql = `INSERT INTO "zp" ("data", "user", "summa", "pay", "straf", "doppay", "komm") VALUES ('${today}', '${(emp.name || '').replace(/'/g, "''")}', ${summa}, '${summa}', '', '', '${komm}')`;
        } else if (type === 'doppay') {
            sql = `INSERT INTO "zp" ("data", "user", "summa", "pay", "straf", "doppay", "komm") VALUES ('${today}', '${(emp.name || '').replace(/'/g, "''")}', ${summa}, '', '', '${summa}', '${komm}')`;
        } else if (type === 'straf') {
            sql = `INSERT INTO "zp" ("data", "user", "summa", "pay", "straf", "doppay", "komm") VALUES ('${today}', '${(emp.name || '').replace(/'/g, "''")}', ${summa}, '', '${summa}', '', '${komm}')`;
        }

        try {
            await this.query(sql);
            alert('✅ Данные сохранены');
            this.closeFinanceModal();
        } catch (error) {
            console.error('Ошибка сохранения финансов:', error);
            alert(`❌ Ошибка сохранения: ${error.message}`);
        }
    },

    // ============================================================
    // СОРТИРОВКА
    // ============================================================
    sortData(columnIndex) {
        if (this.currentData.rows.length === 0) return;

        if (this.sortColumn === columnIndex) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortColumn = columnIndex;
            this.sortDirection = 'asc';
        }

        this.currentData.rows.sort((a, b) => {
            let valA = a[columnIndex] || '';
            let valB = b[columnIndex] || '';

            const numA = parseFloat(valA.replace(',', '.'));
            const numB = parseFloat(valB.replace(',', '.'));

            if (!isNaN(numA) && !isNaN(numB)) {
                return this.sortDirection === 'asc' ? numA - numB : numB - numA;
            }

            const strA = valA.toLowerCase();
            const strB = valB.toLowerCase();

            if (strA < strB) return this.sortDirection === 'asc' ? -1 : 1;
            if (strA > strB) return this.sortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        this.renderTable(this.currentData.columns, this.currentData.rows);
    },

    getSortIndicator(columnIndex) {
        if (this.sortColumn !== columnIndex) return '';
        return this.sortDirection === 'asc' ? ' ▲' : ' ▼';
    },

    // ============================================================
    // ПОИСК
    // ============================================================
    filterRows(query) {
        if (!query) {
            this.renderTable(this.currentData.columns, this.currentData.rows);
            return;
        }

        const lowerQuery = query.toLowerCase();
        const filtered = this.currentData.rows.filter(row => {
            return row.some(cell => cell.toLowerCase().includes(lowerQuery));
        });

        this.renderTable(this.currentData.columns, filtered);
    },

    // ============================================================
    // УТИЛИТЫ
    // ============================================================
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    async query(sql) {
        const encodedSql = encodeURIComponent(sql.trim());
        const url = `http://${this.serverIp}:8080/query?sql=${encodedSql}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        try {
            const response = await fetch(url, {
                method: 'GET',
                mode: 'cors',
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            return await response.text();
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    },

    // ============================================================
    // СОБЫТИЯ
    // ============================================================
    bindEvents() {
        document.getElementById('backBtn').addEventListener('click', () => {
            window.history.back();
        });

        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.loadEmployees();
        });

        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.filterRows(e.target.value);
        });

        // === Модальное окно карточки ===
        document.getElementById('closeCardModal').addEventListener('click', () => {
            this.closeCardModal();
        });

        document.getElementById('unlockEditBtn').addEventListener('click', () => {
            this.enableEdit();
        });

        document.getElementById('saveEditBtn').addEventListener('click', () => {
            this.saveChanges();
        });

        document.getElementById('cancelEditBtn').addEventListener('click', () => {
            this.disableEdit();
        });

        // === Модальное окно добавления ===
        document.getElementById('addEmployeeBtn').addEventListener('click', () => {
            this.openAddEmployeeModal();
        });

        document.getElementById('closeAddModal').addEventListener('click', () => {
            this.closeAddModal();
        });

        document.getElementById('addEmployeeForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            this.addEmployee(formData);
        });

        // === Модальное окно финансов ===
        document.getElementById('openFinanceBtn').addEventListener('click', () => {
            // Для кнопки на странице - открываем без выбора сотрудника
            this.openFinanceModal();
        });

        document.getElementById('closeFinanceModal').addEventListener('click', () => {
            this.closeFinanceModal();
        });

        document.getElementById('financeType').addEventListener('change', () => {
            this.updateFinanceSumField();
        });

        document.getElementById('financeEmployeeSearch').addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const select = document.getElementById('financeEmployee');
            const options = select.querySelectorAll('option');

            options.forEach(opt => {
                if (opt.value === '') {
                    opt.style.display = '';
                    return;
                }
                const text = opt.textContent.toLowerCase();
                opt.style.display = text.includes(query) ? '' : 'none';
            });
        });

        document.getElementById('financeForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveFinance();
        });

        // Закрытие по Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeAllModals();
            }
        });

        // Закрытие по клику на фон
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeAllModals();
                }
            });
        });
    }
};

// ============================================================
// ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    EMPLOYEES.init();
});
