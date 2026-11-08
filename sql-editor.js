// ============================================================
// SQL EDITOR - JavaScript
// ============================================================

const SQL_EDITOR = {
    serverIp: '',
    currentTable: null,
    currentData: { columns: [], rows: [] },
    editingRowIndex: null,
    sortColumn: -1,
    sortDirection: 'asc',

    // ============================================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================================
    init() {
        // Получаем IP из URL или localStorage
        const params = new URLSearchParams(window.location.search);
        this.serverIp = params.get('ip') || localStorage.getItem('serverIp') || '';

        if (!this.serverIp) {
            // Перенаправляем на страницу входа
            window.location.href = 'login.html';
            return;
        }

        // Сохраняем IP
        localStorage.setItem('serverIp', this.serverIp);
        document.getElementById('serverIp').textContent = this.serverIp;

        // Показываем список таблиц
        document.getElementById('tablesListSection').style.display = 'block';
        document.getElementById('tableEditorSection').style.display = 'none';

        // Привязываем события
        this.bindEvents();

        // Загружаем список таблиц
        this.loadTables();
    },

    // ============================================================
    // СОБЫТИЯ
    // ============================================================
    bindEvents() {
        document.getElementById('backBtn').addEventListener('click', () => {
            window.history.back();
        });

        document.getElementById('changeServerBtn').addEventListener('click', () => {
            window.location.href = 'login.html';
        });

        document.getElementById('backToTables').addEventListener('click', () => {
            this.showTablesList();
        });

        document.getElementById('addRecordBtn').addEventListener('click', () => {
            this.openAddRecordModal();
        });

        document.getElementById('addColumnBtn').addEventListener('click', () => {
            this.openAddColumnModal();
        });

        document.getElementById('addTableBtn').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.openAddTableModal();
        });

        document.getElementById('editHeadersBtn').addEventListener('click', () => {
            this.openEditHeadersModal();
        });

        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.loadTableData(this.currentTable);
        });

        document.getElementById('executeSqlBtn').addEventListener('click', () => {
            console.log('Кнопка SQL запрос нажата!');
            const container = document.getElementById('sqlFormContainer');
            const currentDisplay = window.getComputedStyle(container).display;
            container.style.display = currentDisplay === 'none' ? 'block' : 'none';
            console.log('Статус контейнера:', container.style.display);
        });

        document.getElementById('executeSqlQuery').addEventListener('click', () => {
            this.executeCustomSql();
        });

        document.getElementById('cancelSqlForm').addEventListener('click', () => {
            document.getElementById('sqlFormContainer').style.display = 'none';
        });

        document.getElementById('replaceCommaDot').addEventListener('click', () => {
            if (!this.currentTable) return;
            const tableName = this.currentTable;
            const sql = `UPDATE ${tableName} SET koli = REPLACE(koli, ',', '.');`;
            
            if (confirm(`Выполнить запрос?\n\n${sql}\n\nЭто заменит все запятые на точки в колонке koli.`)) {
                document.getElementById('sqlInput').value = sql;
                this.executeCustomSql();
            }
        });

        document.getElementById('closeModal').addEventListener('click', () => {
            this.closeModal();
        });

        document.getElementById('cancelForm').addEventListener('click', () => {
            this.closeModal();
        });

        document.getElementById('recordForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveRecord();
        });

        // Модальное окно добавления колонки
        document.getElementById('closeAddColumnModal').addEventListener('click', () => {
            this.closeAddColumnModal();
        });

        document.getElementById('cancelAddColumn').addEventListener('click', () => {
            this.closeAddColumnModal();
        });

        document.getElementById('addColumnForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addColumn();
        });

        // Модальное окно добавления таблицы
        document.getElementById('closeAddTableModal').addEventListener('click', () => {
            this.closeAddTableModal();
        });

        document.getElementById('cancelAddTable').addEventListener('click', () => {
            this.closeAddTableModal();
        });

        document.getElementById('addColumnRow').addEventListener('click', () => {
            this.addTableColumnRow();
        });

        // Обработчик чекбокса PRIMARY KEY
        document.getElementById('primaryKeyCheckbox').addEventListener('change', () => {
            const container = document.getElementById('tableColumnsContainer');
            const firstRow = container.querySelector('.table-column-row');
            if (firstRow) {
                const typeSelect = firstRow.querySelector('.tc-type');
                const isChecked = document.getElementById('primaryKeyCheckbox').checked;
                typeSelect.value = isChecked ? 'INTEGER' : 'TEXT';
            }
        });

        document.getElementById('addTableForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.createTable();
        });

        // Модальное окно редактирования заголовков
        document.getElementById('closeEditHeadersModal').addEventListener('click', () => {
            this.closeEditHeadersModal();
        });

        document.getElementById('cancelEditHeaders').addEventListener('click', () => {
            this.closeEditHeadersModal();
        });

        document.getElementById('editHeadersForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveHeaders();
        });

        // Закрытие модалки по Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeAllModals();
            }
        });

        // Закрытие модалки по клику на фон
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeAllModals();
                }
            });
        });
    },

    // ============================================================
    // API ЗАПРОСЫ
    // ============================================================
    async query(sql) {
        const encodedSql = encodeURIComponent(sql.trim());
        const url = `http://${this.serverIp}:8080/query?sql=${encodedSql}`;
        
        console.log('SQL Query:', sql);
        console.log('URL:', url);
        
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
    // ЗАГРУЗКА СПИСКА ТАБЛИЦ
    // ============================================================
    async loadTables() {
        const grid = document.getElementById('tableGrid');
        const stats = document.getElementById('tableStats');
        
        grid.innerHTML = '<div class="loading-message">Загрузка таблиц...</div>';
        stats.textContent = '';

        try {
            // Пробуем несколько вариантов запроса для получения таблиц
            const tableQueries = [
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
                "SELECT name FROM sqlite_master WHERE type='table' AND type NOT LIKE 'sqlite_%' AND type NOT LIKE 'android_%' ORDER BY name"
            ];
            
            let result = '';
            for (const q of tableQueries) {
                try {
                    result = await this.query(q);
                    if (result && !result.includes('ОШИБКА') && !result.includes('ERROR')) break;
                } catch(e) {
                    console.warn('Query failed:', q, e);
                }
            }

            if (!result || result.includes('ОШИБКА') || result.includes('ERROR')) {
                grid.innerHTML = `<div class="loading-message" style="color: #e74c3c;">Ошибка получения таблиц: ${result}</div>`;
                return;
            }

            // Парсим результат — формат: имя_таблицы\nимя_таблицы\n...
            // (заголовков нет, так как агрегация COUNT или simple select)
            let tableNames = result.trim().split('\n')
                .filter(line => line && !line.toLowerCase().includes('name'))
                .map(line => line.trim());

            if (tableNames.length === 0) {
                grid.innerHTML = '<div class="loading-message">Таблицы не найдены</div>';
                return;
            }

            stats.textContent = `Найдено таблиц: ${tableNames.length}`;

            // Загружаем количество записей для каждой таблицы параллельно
            const promises = tableNames.map(async (name) => {
                try {
                    const countResult = await this.query(`SELECT COUNT(*) FROM "${name}"`);
                    const lines = countResult.trim().split('\n');
                    const count = lines[lines.length - 1] || '?';
                    return { name, count };
                } catch {
                    return { name, count: '?' };
                }
            });

            const tables = await Promise.all(promises);

            grid.innerHTML = tables.map(table => `
                <div class="table-card" onclick="SQL_EDITOR.openTable('${table.name}')">
                    <div class="table-card-icon">📄</div>
                    <div class="table-card-name">${table.name}</div>
                    <div class="table-card-count">${table.count} записей</div>
                </div>
            `).join('');

        } catch (error) {
            console.error('Error loading tables:', error);
            grid.innerHTML = `<div class="loading-message" style="color: #e74c3c;">
                Ошибка загрузки таблиц: ${error.message}
            </div>`;
        }
    },

    // ============================================================
    // ОТКРЫТИЕ ТАБЛИЦЫ
    // ============================================================
    async openTable(tableName) {
        this.currentTable = tableName;
        
        document.getElementById('tablesListSection').style.display = 'none';
        document.getElementById('tableEditorSection').style.display = 'block';
        document.getElementById('currentTableName').textContent = tableName;
        document.getElementById('recordCount').textContent = '';

        await this.loadTableData(tableName);
    },

    // ============================================================
    // ЗАГРУЗКА ДАННЫХ ТАБЛИЦЫ
    // ============================================================
    async loadTableData(tableName) {
        const container = document.getElementById('tableContainer');
        container.innerHTML = '<div class="loading-message">Загрузка данных...</div>';

        try {
            // Получаем типы данных из sqlite_master (PRAGMA не работает на Android-сервере)
            const typeResult = await this.query(
                `SELECT sql FROM sqlite_master WHERE type='table' AND name='${tableName}'`
            );

            const columnsMap = this.parseTableTypes(typeResult);

            // Получаем заголовки колонок — LIMIT 1
            const headersResult = await this.query(
                `SELECT * FROM "${tableName}" LIMIT 1`
            );

            const headerLines = headersResult.trim().split('\n').filter(l => l);
            if (headerLines.length === 0) {
                container.innerHTML = '<div class="loading-message">Таблица пуста или не существует</div>';
                return;
            }

            // Первая строка — имена колонок
            const columnNames = headerLines[0].split('\t').map(name => ({
                name: name.trim(),
                type: columnsMap[name.trim()] || ''
            }));

            // Получаем ВСЕ данные — отдельно, LIMIT 10000
            const dataResult = await this.query(
                `SELECT * FROM "${tableName}" LIMIT 10000`
            );

            const dataLines = dataResult.trim().split('\n').filter(l => l);
            // Пропускаем первую строку (заголовок колонок)
            const rows = dataLines.slice(1).map(line => line.split('\t'));

            this.currentData = { columns: columnNames, rows };
            this.sortColumn = -1;
            this.sortDirection = 'asc';

            // Отображаем
            this.renderTable(columnNames, rows);
            document.getElementById('recordCount').textContent = `${rows.length} записей`;

        } catch (error) {
            console.error('Error loading table data:', error);
            container.innerHTML = `<div class="loading-message" style="color: #e74c3c;">
                Ошибка загрузки данных: ${error.message}
                <br><br>
                <small>Таблица: ${tableName}</small>
                <br><br>
                <button onclick="SQL_EDITOR.openTable('${tableName}')" style="padding: 8px 16px; background: #6c63ff; color: white; border: none; border-radius: 6px; cursor: pointer;">Повторить</button>
            </div>`;
        }
    },

    /**
     * Парсит CREATE TABLE SQL и извлекает типы данных колонок
     */
    parseTableTypes(sql) {
        const columnsMap = {};
        
        if (!sql) return columnsMap;

        // Ищем содержимое между последними скобками
        const lastOpen = sql.lastIndexOf('(');
        const lastClose = sql.lastIndexOf(')');
        
        if (lastOpen === -1 || lastClose === -1 || lastClose <= lastOpen) {
            return columnsMap;
        }

        const columnsStr = sql.substring(lastOpen + 1, lastClose);
        const columns = columnsStr.split(',');

        for (const col of columns) {
            const trimmed = col.trim();
            if (!trimmed) continue;

            // Пропускаем ограничения (PRIMARY KEY, UNIQUE, FOREIGN KEY, CONSTRAINT)
            const parts = trimmed.split(/\s+/);
            if (parts.length >= 2) {
                const colName = parts[0].replace(/"/g, '');
                const colType = parts[1].toUpperCase();
                
                // Проверяем, что это тип данных, а не ограничение
                const validTypes = ['TEXT', 'INTEGER', 'INT', 'REAL', 'BLOB', 'NUMERIC', 'DATE', 'TIME', 'TIMESTAMP', 'CLOB', 'VARCHAR', 'CHAR', 'BOOLEAN', 'DOUBLE', 'FLOAT'];
                if (validTypes.includes(colType)) {
                    columnsMap[colName] = colType;
                }
            }
        }

        return columnsMap;
    },

    // ============================================================
    // СОРТИРОВКА ДАННЫХ
    // ============================================================
    sortData(columnIndex) {
        if (this.currentData.rows.length === 0) return;

        // Если клик по той же колонке — меняем направление
        if (this.sortColumn === columnIndex) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortColumn = columnIndex;
            this.sortDirection = 'asc';
        }

        const colName = this.currentData.columns[columnIndex].name.toLowerCase();

        this.currentData.rows.sort((a, b) => {
            let valA = a[columnIndex] || '';
            let valB = b[columnIndex] || '';

            // Пытаемся сравнить как числа
            const numA = parseFloat(valA.replace(',', '.'));
            const numB = parseFloat(valB.replace(',', '.'));

            if (!isNaN(numA) && !isNaN(numB)) {
                return this.sortDirection === 'asc' ? numA - numB : numB - numA;
            }

            // Сравниваем как строки
            const strA = valA.toLowerCase();
            const strB = valB.toLowerCase();

            if (strA < strB) return this.sortDirection === 'asc' ? -1 : 1;
            if (strA > strB) return this.sortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        // Перерисовываем таблицу с обновлённой сортировкой
        this.renderTable(this.currentData.columns, this.currentData.rows);
    },

    getSortIndicator(columnIndex) {
        if (this.sortColumn !== columnIndex) return '';
        return this.sortDirection === 'asc' ? ' ▲' : ' ▼';
    },

    // ============================================================
    // ОТРИСОВКА ТАБЛИЦЫ
    // ============================================================
    renderTable(columns, rows) {
        const container = document.getElementById('tableContainer');
        const self = this;

        if (columns.length === 0) {
            container.innerHTML = '<div class="loading-message">Нет данных</div>';
            return;
        }

        const html = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th style="width: 50px;">№</th>
                        ${columns.map((col, index) => {
                            const indicator = self.getSortIndicator(index);
                            const isActive = self.sortColumn === index;
                            const dirAttr = isActive ? ` data-dir="${self.sortDirection}"` : '';
                            return `<th class="sortable${isActive ? ' sortable-active' : ''}${dirAttr}" onclick="SQL_EDITOR.sortData(${index})">${self.escapeHtml(col.name)}<span class="sort-indicator">${indicator}</span></th>`;
                        }).join('')}
                        <th style="width: 120px;">Действия</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((row, index) => `
                        <tr>
                            <td>${index + 1}</td>
                            ${columns.map((col, colIndex) => {
                                const value = row[colIndex] || '';
                                const displayValue = value.length > 50 ? value.substring(0, 50) + '...' : value;
                                return `<td title="${self.escapeHtml(value)}">${self.escapeHtml(displayValue)}</td>`;
                            }).join('')}
                            <td>
                                <div class="table-actions">
                                    <button class="btn-icon-only btn-edit" onclick="SQL_EDITOR.editRecord(${index})" title="Редактировать">✏️</button>
                                    <button class="btn-icon-only btn-delete" onclick="SQL_EDITOR.deleteRecord(${index})" title="Удалить">🗑️</button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        container.innerHTML = html;
    },

    // ============================================================
    // ДОБАВЛЕНИЕ ЗАПИСИ
    // ============================================================
    openAddRecordModal() {
        if (!this.currentTable || this.currentData.columns.length === 0) return;

        document.getElementById('modalTitle').textContent = `Добавить запись в ${this.currentTable}`;
        this.editingRowIndex = null;

        const fieldsContainer = document.getElementById('formFields');
        fieldsContainer.innerHTML = this.currentData.columns.map(col => `
            <div class="form-field">
                <label>${col.name} <small>(${col.type})</small></label>
                <input 
                    type="text" 
                    name="${col.name}" 
                    placeholder="${col.type === 'INTEGER' ? '0' : 'Значение'}"
                >
            </div>
        `).join('');

        document.getElementById('recordModal').style.display = 'flex';
    },

    // ============================================================
    // РЕДАКТИРОВАНИЕ ЗАПИСИ
    // ============================================================
    editRecord(rowIndex) {
        const row = this.currentData.rows[rowIndex];
        const columns = this.currentData.columns;

        document.getElementById('modalTitle').textContent = `Редактировать запись #${rowIndex + 1}`;
        this.editingRowIndex = rowIndex;

        const fieldsContainer = document.getElementById('formFields');
        fieldsContainer.innerHTML = columns.map((col, colIndex) => `
            <div class="form-field">
                <label>${col.name} <small>(${col.type})</small></label>
                <input 
                    type="text" 
                    name="${col.name}" 
                    value="${this.escapeHtml(row[colIndex] || '')}"
                >
            </div>
        `).join('');

        document.getElementById('recordModal').style.display = 'flex';
    },

    // ============================================================
    // СОХРАНЕНИЕ ЗАПИСИ
    // ============================================================
    async saveRecord() {
        const form = document.getElementById('recordForm');
        const formData = new FormData(form);
        const columns = this.currentData.columns;
        const tableName = this.currentTable;

        const values = columns.map(col => {
            const value = formData.get(col.name);
            if (col.type === 'INTEGER' && value !== '') return parseInt(value) || 0;
            // Экранируем одинарные кавычки
            const escaped = (value || '').replace(/'/g, "''");
            return `'${escaped}'`;
        });

        try {
            if (this.editingRowIndex === null) {
                // Добавление новой записи
                const columnsStr = columns.map(c => `"${c.name}"`).join(', ');
                const valuesStr = values.join(', ');
                const sql = `INSERT INTO "${tableName}" (${columnsStr}) VALUES (${valuesStr})`;
                
                console.log('INSERT:', sql);
                await this.query(sql);
                alert('✅ Запись успешно добавлена');
            } else {
                // Обновление существующей записи
                const sets = columns.map((col, index) => {
                    const value = formData.get(col.name);
                    const escaped = (value || '').replace(/'/g, "''");
                    const val = col.type === 'INTEGER' && value !== '' ? (parseInt(value) || 0) : `'${escaped}'`;
                    return `"${col.name}"=${val}`;
                }).join(', ');
                
                // Находим первичный ключ
                const pkColumn = columns.find(col => col.name.toLowerCase() === 'id') || columns[0];
                const pkValue = this.currentData.rows[this.editingRowIndex][columns.indexOf(pkColumn)];
                
                const sql = `UPDATE "${tableName}" SET ${sets} WHERE "${pkColumn.name}"=${pkValue}`;
                
                console.log('UPDATE:', sql);
                await this.query(sql);
                alert('✅ Запись успешно обновлена');
            }

            this.closeModal();
            await this.loadTableData(tableName);

        } catch (error) {
            console.error('Error saving record:', error);
            alert(`❌ Ошибка сохранения: ${error.message}`);
        }
    },

    // ============================================================
    // УДАЛЕНИЕ ЗАПИСИ
    // ============================================================
    async deleteRecord(rowIndex) {
        const row = this.currentData.rows[rowIndex];
        const columns = this.currentData.columns;
        const tableName = this.currentTable;

        if (!confirm(`Удалить запись #${rowIndex + 1}?\n\n${columns.map((col, i) => `${col.name}: ${row[i]}`).join('\n')}`)) {
            return;
        }

        try {
            // Находим первичный ключ
            const pkColumn = columns.find(col => col.name.toLowerCase() === 'id') || columns[0];
            const pkValue = row[columns.indexOf(pkColumn)];
            
            const sql = `DELETE FROM "${tableName}" WHERE "${pkColumn.name}"=${pkValue}`;
            
            console.log('DELETE:', sql);
            await this.query(sql);
            alert('✅ Запись удалена');
            
            await this.loadTableData(tableName);

        } catch (error) {
            console.error('Error deleting record:', error);
            alert(`❌ Ошибка удаления: ${error.message}`);
        }
    },

    // ============================================================
    // ВЫПОЛНЕНИЕ ПРОИЗВОЛЬНОГО SQL
    // ============================================================
    async executeCustomSql() {
        const sqlInput = document.getElementById('sqlInput');
        const sql = sqlInput.value.trim();

        if (!sql) {
            alert('Введите SQL-запрос');
            return;
        }

        const resultDiv = document.getElementById('sqlResult');
        resultDiv.style.display = 'block';
        resultDiv.className = 'sql-result';
        resultDiv.textContent = 'Выполняется запрос...';

        try {
            console.log('Custom SQL:', sql);
            const upperSql = sql.toUpperCase().trim();
            
            // Определяем тип запроса
            let isSelect = upperSql.startsWith('SELECT');
            let isModify = upperSql.startsWith('UPDATE') || upperSql.startsWith('INSERT') || upperSql.startsWith('DELETE');

            const result = await this.query(sql);
            
            if (isModify) {
                // Для изменяющих запросов (UPDATE, INSERT, DELETE)
                resultDiv.className = 'sql-result success';
                resultDiv.textContent = '✅ Запрос успешно выполнен!';
                
                // Обновляем данные таблицы если нужно
                await this.loadTableData(this.currentTable);
                
                // Очищаем поле ввода
                sqlInput.value = '';
            } else if (isSelect) {
                // Для SELECT запросов показываем результат в виде таблицы
                const lines = result.trim().split('\n').filter(l => l);
                if (lines.length > 0) {
                    const columns = lines[0].split('\t');
                    const dataLines = lines.slice(1);
                    
                    let html = `<div class="sql-result-table-wrapper">
                        <table class="data-table">
                            <thead><tr>${columns.map(c => `<th>${c.trim()}</th>`).join('')}</tr></thead>
                            <tbody>`;
                    
                    dataLines.forEach(line => {
                        const values = line.split('\t');
                        html += '<tr>';
                        values.forEach(val => {
                            const display = val.length > 50 ? val.substring(0, 50) + '...' : val;
                            html += `<td title="${this.escapeHtml(val)}">${this.escapeHtml(display)}</td>`;
                        });
                        html += '</tr>';
                    });
                    
                    html += `</tbody></table></div>`;
                    resultDiv.innerHTML = html;
                } else {
                    resultDiv.textContent = 'Запрос не вернул данных';
                }
            } else {
                // Для других запросов (CREATE, ALTER и т.д.)
                resultDiv.className = 'sql-result success';
                resultDiv.textContent = '✅ Запрос успешно выполнен!';
            }
        } catch (error) {
            resultDiv.className = 'sql-result error';
            resultDiv.textContent = `❌ Ошибка: ${error.message}`;
        }
    },

    // ============================================================
    // ДОБАВЛЕНИЕ КОЛОНКИ
    // ============================================================
    openAddColumnModal() {
        if (!this.currentTable) return;
        document.getElementById('addColumnModal').style.display = 'flex';
        document.getElementById('addColumnForm').reset();
    },

    closeAddColumnModal() {
        document.getElementById('addColumnModal').style.display = 'none';
    },

    async addColumn() {
        const form = document.getElementById('addColumnForm');
        const formData = new FormData(form);
        const columnName = formData.get('columnName').trim();
        const columnType = formData.get('columnType');

        if (!columnName) {
            alert('Введите имя колонки');
            return;
        }

        try {
            const sql = `ALTER TABLE "${this.currentTable}" ADD COLUMN "${columnName}" ${columnType}`;
            console.log('ADD COLUMN:', sql);
            await this.query(sql);
            alert(`✅ Колонка "${columnName}" успешно добавлена`);
            this.closeAddColumnModal();
            await this.loadTableData(this.currentTable);
        } catch (error) {
            console.error('Error adding column:', error);
            alert(`❌ Ошибка добавления колонки: ${error.message}`);
        }
    },

    // ============================================================
    // ДОБАВЛЕНИЕ ТАБЛИЦЫ
    // ============================================================
    openAddTableModal() {
        const modal = document.getElementById('addTableModal');
        if (!modal) {
            console.error('addTableModal not found!');
            alert('Ошибка: модальное окно не найдено!');
            return;
        }
        modal.style.display = 'flex';
        const form = document.getElementById('addTableForm');
        if (form) form.reset();
        const container = document.getElementById('tableColumnsContainer');
        if (container) container.innerHTML = '';
        // Сбрасываем чекбокс PRIMARY KEY
        const pkCheckbox = document.getElementById('primaryKeyCheckbox');
        if (pkCheckbox) pkCheckbox.checked = false;
        // Добавляем первую колонку по умолчанию
        this.addTableColumnRow();
    },

    closeAddTableModal() {
        document.getElementById('addTableModal').style.display = 'none';
    },

    addTableColumnRow() {
        const container = document.getElementById('tableColumnsContainer');
        const index = container.children.length;
        const isPrimaryKey = index === 0 && document.getElementById('primaryKeyCheckbox').checked;

        const row = document.createElement('div');
        row.className = 'table-column-row';
        row.style.cssText = 'display: flex; gap: 10px; margin-bottom: 10px; align-items: center;';

        const typeOptions = ['TEXT', 'INTEGER', 'REAL', 'BLOB'].map(t =>
            `<option value="${t}" ${t === (isPrimaryKey ? 'INTEGER' : 'TEXT') ? 'selected' : ''}>${t}</option>`
        ).join('');

        row.innerHTML = `
            <input type="text" placeholder="Имя колонки" class="tc-name" style="flex: 1;" required>
            <select class="tc-type" style="flex: 1;">
                ${typeOptions}
            </select>
            <button type="button" class="btn btn-ghost btn-tiny remove-col-btn" title="Удалить">🗑️</button>
        `;

        row.querySelector('.remove-col-btn').addEventListener('click', () => {
            if (container.children.length > 1) {
                row.remove();
            } else {
                alert('Должна быть хотя бы одна колонка');
            }
        });

        container.appendChild(row);
    },

    async createTable() {
        const form = document.getElementById('addTableForm');
        const tableName = form.querySelector('input[name="tableName"]').value.trim();

        if (!tableName) {
            alert('Введите имя таблицы');
            return;
        }

        // Собираем колонки
        const columnRows = document.querySelectorAll('.table-column-row');
        if (columnRows.length === 0) {
            alert('Добавьте хотя бы одну колонку');
            return;
        }

        const usePrimaryKey = document.getElementById('primaryKeyCheckbox').checked;
        const columns = [];
        for (let i = 0; i < columnRows.length; i++) {
            const name = columnRows[i].querySelector('.tc-name').value.trim();
            let type = columnRows[i].querySelector('.tc-type').value;
            if (name) {
                let columnDef = '';
                // Если это первая колонка и выбран PRIMARY KEY
                if (i === 0 && usePrimaryKey) {
                    // Для PRIMARY KEY всегда используем INTEGER (SQLite требует INTEGER для автоинкремента)
                    type = 'INTEGER';
                    columnDef = `"${name}" ${type} PRIMARY KEY AUTOINCREMENT`;
                } else {
                    columnDef = `"${name}" ${type}`;
                }
                columns.push(columnDef);
            }
        }

        if (columns.length === 0) {
            alert('Добавьте хотя бы одну колонку с именем');
            return;
        }

        try {
            const sql = `CREATE TABLE "${tableName}" (${columns.join(', ')})`;
            console.log('CREATE TABLE:', sql);
            await this.query(sql);
            alert(`✅ Таблица "${tableName}" успешно создана`);
            this.closeAddTableModal();
            await this.loadTables();
        } catch (error) {
            console.error('Error creating table:', error);
            alert(`❌ Ошибка создания таблицы: ${error.message}`);
        }
    },

    // ============================================================
    // РЕДАКТИРОВАНИЕ ЗАГОЛОВКОВ
    // ============================================================
    openEditHeadersModal() {
        if (!this.currentTable || this.currentData.columns.length === 0) return;
        
        const fieldsContainer = document.getElementById('headersFields');
        fieldsContainer.innerHTML = this.currentData.columns.map((col, index) => `
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                <div style="flex: 1;">
                    <label style="color: #a0a0c0; font-size: 0.85rem;">${col.name} <small>(ID: ${index})</small></label>
                    <input type="hidden" name="oldName${index}" value="${col.name}">
                </div>
                <div style="display: flex; gap: 8px; align-items: center; flex: 2;">
                    <input 
                        type="text" 
                        name="newName${index}" 
                        value="${col.name}" 
                        placeholder="Новое имя"
                        style="flex: 1; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 8px 12px; color: #fff; font-size: 0.9rem;"
                    >
                    <select 
                        name="newType${index}" 
                        style="flex: 1; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 8px 12px; color: #fff; font-size: 0.9rem;"
                    >
                        <option value="TEXT" ${col.type === 'TEXT' ? 'selected' : ''}>TEXT</option>
                        <option value="INTEGER" ${col.type === 'INTEGER' ? 'selected' : ''}>INTEGER</option>
                        <option value="REAL" ${col.type === 'REAL' ? 'selected' : ''}>REAL</option>
                        <option value="BLOB" ${col.type === 'BLOB' ? 'selected' : ''}>BLOB</option>
                    </select>
                </div>
                <button type="button" class="btn btn-ghost btn-tiny rename-col-btn" data-index="${index}" title="Применить переименование">✅</button>
                <button type="button" class="btn btn-ghost btn-tiny delete-col-btn" data-index="${index}" data-name="${col.name}" title="Удалить колонку">🗑️</button>
            </div>
        `).join('');

        // Навешиваем обработчики
        fieldsContainer.querySelectorAll('.rename-col-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = e.target.dataset.index;
                const oldName = fieldsContainer.querySelector(`input[name="oldName${index}"]`).value;
                const newName = fieldsContainer.querySelector(`input[name="newName${index}"]`).value.trim();
                const newType = fieldsContainer.querySelector(`select[name="newType${index}"]`).value;
                if (!newName) {
                    alert('Введите новое имя');
                    return;
                }
                this.saveColumnRename(index, oldName, newName, newType);
            });
        });

        fieldsContainer.querySelectorAll('.delete-col-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = e.target.dataset.index;
                const colName = e.target.dataset.name;
                if (confirm(`Удалить колонку "${colName}"? Все данные в этой колонке будут потеряны.`)) {
                    this.deleteColumn(colName);
                }
            });
        });

        document.getElementById('editHeadersModal').style.display = 'flex';
    },

    closeEditHeadersModal() {
        document.getElementById('editHeadersModal').style.display = 'none';
    },

    async renameColumn(oldName, newName) {
        try {
            const sql = `ALTER TABLE "${this.currentTable}" RENAME COLUMN "${oldName}" TO "${newName}"`;
            console.log('RENAME COLUMN:', sql);
            await this.query(sql);
            alert(`✅ Колонка переименована: "${oldName}" → "${newName}"`);
            this.openEditHeadersModal(); // Обновляем модальное окно
            await this.loadTableData(this.currentTable);
        } catch (error) {
            console.error('Error renaming column:', error);
            alert(`❌ Ошибка переименования: ${error.message}`);
        }
    },

    async saveColumnRename(index, oldName, newName, newType) {
        try {
            // Если имя не изменилось, ничего не делаем
            if (oldName === newName) {
                return;
            }

            // Для SQLite переименование + изменение типа — сложная операция
            // Сначала переименовываем колонку
            await this.renameColumn(oldName, newName);
            
            // Изменение типа в SQLite невозможно напрямую
            // Для этого нужно пересоздавать таблицу, но это сложно и рискованно
            // Поэтому просто показываем уведомление
            if (newType !== '') {
                alert(`⚠️ SQLite не поддерживает изменение типа данных колонок. Тип оставлен без изменений.`);
            }

            await this.loadTableData(this.currentTable);
        } catch (error) {
            console.error('Error saving column:', error);
            alert(`❌ Ошибка: ${error.message}`);
        }
    },

    async deleteColumn(columnName) {
        try {
            // SQLite не поддерживает DROP COLUMN для всех версий, но современные поддерживают
            const sql = `ALTER TABLE "${this.currentTable}" DROP COLUMN "${columnName}"`;
            console.log('DROP COLUMN:', sql);
            await this.query(sql);
            alert(`✅ Колонка "${columnName}" удалена`);
            this.closeEditHeadersModal();
            await this.loadTableData(this.currentTable);
        } catch (error) {
            console.error('Error deleting column:', error);
            alert(`❌ Ошибка удаления колонки: ${error.message}. Возможно, ваша версия SQLite не поддерживает DROP COLUMN.`);
        }
    },

    async saveHeaders() {
        // Массовое сохранение новых имён колонок
        const oldNames = [];
        const newNames = [];
        
        this.currentData.columns.forEach((col, index) => {
            const oldNameInput = document.querySelector(`input[name="oldName${index}"]`);
            const newNameInput = document.querySelector(`input[name="newName${index}"]`);
            if (oldNameInput && newNameInput) {
                const oldName = oldNameInput.value;
                const newName = newNameInput.value.trim();
                if (oldName !== newName && newName) {
                    oldNames.push(oldName);
                    newNames.push(newName);
                }
            }
        });

        if (oldNames.length === 0) {
            this.closeEditHeadersModal();
            return;
        }

        try {
            for (let i = 0; i < oldNames.length; i++) {
                await this.renameColumn(oldNames[i], newNames[i]);
            }
            this.closeEditHeadersModal();
        } catch (error) {
            console.error('Error saving headers:', error);
            alert(`❌ Ошибка сохранения: ${error.message}`);
        }
    },

    // ============================================================
    // УТИЛИТЫ
    // ============================================================
    closeAllModals() {
        document.getElementById('recordModal').style.display = 'none';
        document.getElementById('addColumnModal').style.display = 'none';
        document.getElementById('addTableModal').style.display = 'none';
        document.getElementById('editHeadersModal').style.display = 'none';
        this.editingRowIndex = null;
    },

    closeModal() {
        document.getElementById('recordModal').style.display = 'none';
        this.editingRowIndex = null;
    },

    showTablesList() {
        document.getElementById('tablesListSection').style.display = 'block';
        document.getElementById('tableEditorSection').style.display = 'none';
        document.getElementById('sqlFormContainer').style.display = 'none';
        this.currentTable = null;
        this.loadTables();
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

// ============================================================
// ЗАПУСК
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    SQL_EDITOR.init();
});
