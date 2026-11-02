// ============================================================
// GUIDE ADD PAGE - JavaScript
// ============================================================

const GUIDE_ADD = {
    serverIp: '',
    currentTable: 'guide',
    currentData: { columns: [], rows: [] },
    editingRecordId: null,
    currentKod: null,
    columnTranslations: {},

    async init() {
        this.checkAuth();

        const params = new URLSearchParams(window.location.search);
        const kod = params.get('kod');
        if (kod) {
            this.currentKod = kod;
            document.getElementById('pageTitle').textContent = 'Редактирование';
        } else {
            this.currentKod = Math.floor(Date.now() / 1000);
        }

        await this.loadTranslations();
        
        // Привязываем события ДО загрузки данных
        this.bindEvents();
        this.bindAutocomplete();
        this.bindImageEvents();
        this.bindCompositionEvents();
        this.bindCategorySelect();
        this.bindArtSelect();
        this.bindNameSelect();
        
        // Загружаем данные после привязки событий
        await this.loadGuideData();
    },

    checkAuth() {
        const serverIp = localStorage.getItem('serverIp');
        if (!serverIp || !localStorage.getItem('userId')) {
            window.location.href = 'login.html';
            return;
        }
        this.serverIp = serverIp;
    },

    async loadTranslations() {
        try {
            const sql = `SELECT "original", "slovo" FROM "perevod"`;
            const result = await this.query(sql);
            const lines = result.trim().split('\n').filter(l => l);
            if (lines.length > 1) {
                for (let i = 1; i < lines.length; i++) {
                    const parts = lines[i].split('\t');
                    if (parts.length >= 2) {
                        this.columnTranslations[parts[0].trim()] = parts[1].trim();
                    }
                }
            }
        } catch (error) {
            console.warn('Не удалось загрузить переводы:', error);
        }
    },

    getColumnName(originalName) {
        return this.columnTranslations[originalName] || originalName;
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

    async loadGuideData() {
        try {
            const typeResult = await this.query(`SELECT sql FROM sqlite_master WHERE type='table' AND name='guide'`);
            const columnsMap = this.parseTableTypes(typeResult);
            const headersResult = await this.query(`SELECT * FROM "guide" LIMIT 1`);
            const headerLines = headersResult.trim().split('\n').filter(l => l);
            if (headerLines.length === 0) return;

            const columnNames = headerLines[0].split('\t').map(name => ({
                name: name.trim(),
                type: columnsMap[name.trim()] || ''
            }));

            const dataResult = await this.query(`SELECT * FROM "guide" LIMIT 1000`);
            const dataLines = dataResult.trim().split('\n').filter(l => l);
            const rows = dataLines.slice(1).map(line => line.split('\t'));

            this.currentData = { columns: columnNames, rows };
            if (this.currentKod) {
                const record = this.findRecordByKod(columnNames, rows, this.currentKod);
                this.renderFormRows(columnNames, record);
                await this.loadCompositionFromDB(this.currentKod);
                await this.loadImageFromLocalStorage(this.currentKod);
            } else {
                this.renderFormRows(columnNames);
                this.renderCompositionRows(0);
            }
            this.updateKodField();
        } catch (error) {
            console.error('Ошибка загрузки данных:', error);
        }
    },

    parseTableTypes(sql) {
        const columnsMap = {};
        if (!sql) return columnsMap;
        const lastOpen = sql.lastIndexOf('(');
        const lastClose = sql.lastIndexOf(')');
        if (lastOpen === -1 || lastClose === -1 || lastClose <= lastOpen) return columnsMap;

        const columnsStr = sql.substring(lastOpen + 1, lastClose);
        const columns = columnsStr.split(',');

        for (const col of columns) {
            const trimmed = col.trim();
            if (!trimmed) continue;
            const parts = trimmed.split(/\s+/);
            if (parts.length >= 2) {
                const colName = parts[0].replace(/"/g, '');
                const colType = parts[1].toUpperCase();
                const validTypes = ['TEXT', 'INTEGER', 'REAL', 'BLOB', 'NUMERIC', 'VARCHAR', 'CHAR'];
                if (validTypes.includes(colType)) {
                    columnsMap[colName] = colType;
                }
            }
        }
        return columnsMap;
    },

    findRecordByKod(columns, rows, kod) {
        const kodIndex = columns.findIndex(c => c.name.toLowerCase() === 'kod');
        if (kodIndex === -1) return null;
        const row = rows.find(r => r[kodIndex] === kod);
        if (!row) return null;
        const record = {};
        columns.forEach((col, i) => {
            record[col.name] = row[i] || '';
        });
        return record;
    },

    renderFormRows(columns, record = null) {
        const container = document.getElementById('formRows');
        const requiredKeys = ['art', 'kiz', 'vidim', 'type', 'kod'];
        const yesNoValues = ['ДА', 'НЕТ'];
        const isEditing = !!record;
        container.innerHTML = columns.map(col => {
            const val = record ? (record[col.name] || '') : '';
            const isType = col.name.toLowerCase() === 'type';
            const isVidim = col.name.toLowerCase() === 'vidim';
            const isKiz = col.name.toLowerCase() === 'kiz';
            const isName = col.name.toLowerCase() === 'name';
            const isKod = col.name.toLowerCase() === 'kod';
            const isOpt = col.name.toLowerCase() === 'opt';
            const isKat = /^kat\d$/i.test(col.name);
            const isAutocomplete = ['color', 'size', 'edizm'].includes(col.name.toLowerCase());
            const isRequired = requiredKeys.includes(col.name.toLowerCase());
            const requiredAttr = isRequired && !isKod ? ' required' : '';
            const readonlyAttr = (isKod && isEditing) || isOpt ? ' readonly style="opacity: 0.5; cursor: not-allowed;"' : '';
            const disabledAttr = !isEditing && isKat ? ' disabled style="opacity: 0.5; cursor: not-allowed;"' : '';
            const label = isRequired && !isKod ? `${this.escapeHtml(this.getColumnName(col.name))} <span style="color:red">*</span>` : this.escapeHtml(this.getColumnName(col.name));

            const html = isType ? `
                <select name="${col.name}"${requiredAttr} class="type-select">
                    <option value="" disabled selected hidden></option>
                    <option value="Товар"${val === 'Товар' ? ' selected' : ''}>Товар</option>
                    <option value="Расходник"${val === 'Расходник' ? ' selected' : ''}>Расходник</option>
                    <option value="Упаковка"${val === 'Упаковка' ? ' selected' : ''}>Упаковка</option>
                    <option value="Внутрицех"${val === 'Внутрицех' ? ' selected' : ''}>Внутрицех</option>
                </select>
            ` : isVidim ? `
                <select name="${col.name}"${requiredAttr}>
                    ${yesNoValues.map(v => `<option value="${v}"${val === v ? ' selected' : ''}>${v}</option>`).join('')}
                </select>
            ` : isKiz ? `
                <select name="${col.name}"${requiredAttr}>
                    <option value="" disabled selected hidden></option>
                    ${yesNoValues.map(v => `<option value="${v}"${val === v ? ' selected' : ''}>${v}</option>`).join('')}
                </select>
            ` : isName || isKat || isAutocomplete ? `
                <div class="autocomplete-wrapper" data-column="${col.name}" data-table="guide">
                    <input type="text" name="${col.name}" value="${this.escapeHtml(val)}"${requiredAttr}${readonlyAttr}${disabledAttr} autocomplete="off">
                    <div class="autocomplete-list"></div>
                </div>
            ` : isKod ? `
                <div class="kod-field-wrapper">
                    <input type="text" name="${col.name}" value="${this.escapeHtml(val)}"${requiredAttr}${readonlyAttr} class="kod-input">
                    <button type="button" class="btn-refresh-kod" onclick="GUIDE_ADD.refreshKodField()" title="Обновить">↻</button>
                </div>
            ` : `
                <input type="text" name="${col.name}" value="${this.escapeHtml(val)}"${requiredAttr}${readonlyAttr}>
            `;
            return `
            <div class="form-row-add">
                <div class="form-row-label">${label}</div>
                <div class="form-row-input">${html}</div>
            </div>
        `;
        }).join('');

        // Привязываем автозаполнение для всех полей
        this.bindAllAutocomplete();
        this.bindTypeDependence();
    },

    updateKodField() {
        const kodInput = document.querySelector('input[name="kod"]');
        if (kodInput) {
            kodInput.value = this.currentKod || '';
        }
    },

    refreshKodField() {
        const kodInput = document.querySelector('input[name="kod"]');
        if (!kodInput || kodInput.readOnly) return;
        this.currentKod = Math.floor(Date.now() / 1000);
        this.updateKodField();
    },

    syncCostToPrice() {
        const costPrice = document.getElementById('costPrice');
        const priceInput = document.querySelector('input[name="price"]');
        const compTbody = document.getElementById('compositionBody');

        if (costPrice && priceInput) {
            // Если таблица состава пуста — не обновляем цену
            if (!compTbody || compTbody.rows.length === 0) return;

            const calculatedCost = parseFloat(costPrice.value) || 0;
            const currentPrice = parseFloat(priceInput.value) || 0;

            if (Math.abs(calculatedCost - currentPrice) > 0.001) {
                // Если себестоимость отличается от цены, обновляем поле цены
                priceInput.value = calculatedCost;
            }
        }
    },

    bindTypeDependence() {
        const typeSelect = document.querySelector('.type-select');
        if (!typeSelect) return;

        typeSelect.addEventListener('change', () => {
            // Если type изменён на пустой - очищаем все kat
            if (!typeSelect.value) {
                for (let i = 1; i <= 5; i++) {
                    const input = document.querySelector(`input[name="kat${i}"]`);
                    const wrapper = input?.closest('.autocomplete-wrapper');
                    const list = wrapper?.querySelector('.autocomplete-list');
                    if (input) input.value = '';
                    if (list) list.innerHTML = '';
                }
            }
            this.toggleKatFields();
        });

        // Инициализация при загрузке записи
        this.toggleKatFields();
    },

    toggleKatFields() {
        const typeSelect = document.querySelector('.type-select');
        const typeValue = typeSelect?.value;

        // Определяем сколько kat полей заполнено
        let filledCount = 0;
        for (let i = 1; i <= 5; i++) {
            const input = document.querySelector(`input[name="kat${i}"]`);
            if (input && input.value.trim()) {
                filledCount++;
            } else {
                break;
            }
        }

        for (let i = 1; i <= 5; i++) {
            const input = document.querySelector(`input[name="kat${i}"]`);
            if (!input) continue;

            const wrapper = input.closest('.autocomplete-wrapper');
            const list = wrapper?.querySelector('.autocomplete-list');

            // Активно если type выбран и это следующее поле после заполненных
            const isActive = typeValue && (i <= filledCount || i === filledCount + 1);

            if (isActive) {
                input.removeAttribute('disabled');
                input.style.opacity = '1';
                input.style.cursor = 'text';
            } else {
                input.setAttribute('disabled', '');
                input.style.opacity = '0.5';
                input.style.cursor = 'not-allowed';
                if (i > filledCount && list) {
                    list.innerHTML = '';
                }
            }
        }
    },

    renderCompositionRows(count) {
        const tbody = document.getElementById('compositionBody');
        tbody.innerHTML = '';
        if (count > 0) {
            for (let i = 0; i < count; i++) {
                this.addCompositionRow(tbody, i);
            }
            this.bindCompositionAutocomplete();
        }
    },

    bindCompositionAutocomplete() {
        const tbody = document.getElementById('compositionBody');
        const categoryInputs = tbody.querySelectorAll('input[name^="comp_category_"]');
        
        categoryInputs.forEach((input, index) => {
            const wrapper = input.closest('.autocomplete-wrapper');
            if (!wrapper) return;
            
            const list = wrapper.querySelector('.autocomplete-list');
            let debounceTimer = null;
            let selectedIndex = -1;

            const fetchSuggestions = async (query) => {
                try {
                    const typeSelect = document.querySelector('.type-select');
                    const typeValue = typeSelect?.value || '';
                    
                    if (typeValue && !query) {
                        // Если type выбран, показываем только его значение
                        list.innerHTML = `<div class="autocomplete-item" data-value="${typeValue}">${typeValue}</div>`;
                    } else if (query) {
                        const sql = `SELECT DISTINCT "type" FROM "guide" WHERE "type" LIKE '${query.replace(/'/g, "''")}%' LIMIT 50`;
                        const result = await this.query(sql);
                        const lines = result.trim().split('\n').filter(l => l);
                        const suggestions = [...new Set(lines.slice(1).map(l => l.split('\t')[0]).filter(Boolean))];

                        if (suggestions.length === 0) {
                            list.innerHTML = '';
                            return;
                        }

                        list.innerHTML = suggestions.map(s =>
                            `<div class="autocomplete-item" data-value="${this.escapeHtml(s)}">${s}</div>`
                        ).join('');
                    } else {
                        // Показываем все доступные типы
                        const sql = `SELECT DISTINCT "type" FROM "guide" LIMIT 50`;
                        const result = await this.query(sql);
                        const lines = result.trim().split('\n').filter(l => l);
                        const suggestions = [...new Set(lines.slice(1).map(l => l.split('\t')[0]).filter(Boolean))];

                        if (suggestions.length === 0) {
                            list.innerHTML = '';
                            return;
                        }

                        list.innerHTML = suggestions.map(s =>
                            `<div class="autocomplete-item" data-value="${this.escapeHtml(s)}">${s}</div>`
                        ).join('');
                    }
                } catch (error) {
                    console.error('Ошибка поиска категории:', error);
                    list.innerHTML = '';
                }
            };

            input.addEventListener('focus', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(async () => {
                    const typeSelect = document.querySelector('.type-select');
                    if (typeSelect && typeSelect.value) {
                        await fetchSuggestions(typeSelect.value);
                    } else {
                        await fetchSuggestions('');
                    }
                }, 100);
            });

            input.addEventListener('input', () => {
                clearTimeout(debounceTimer);
                const query = input.value.trim();
                selectedIndex = -1;

                if (query.length < 1) {
                    list.innerHTML = '';
                    return;
                }

                debounceTimer = setTimeout(async () => {
                    await fetchSuggestions(query);
                }, 300);
            });

            input.addEventListener('keydown', (e) => {
                const items = list.querySelectorAll('.autocomplete-item');
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
                    items.forEach((it, i) => it.classList.toggle('active', i === selectedIndex));
                    if (selectedIndex >= 0) input.value = items[selectedIndex].dataset.value;
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    selectedIndex = Math.max(selectedIndex - 1, 0);
                    items.forEach((it, i) => it.classList.toggle('active', i === selectedIndex));
                    if (selectedIndex >= 0) input.value = items[selectedIndex].dataset.value;
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    list.innerHTML = '';
                }
            });

            wrapper.addEventListener('click', (e) => {
                const item = e.target.closest('.autocomplete-item');
                if (item) {
                    input.value = item.dataset.value;
                    list.innerHTML = '';
                }
            });

            input.addEventListener('blur', () => {
                setTimeout(() => {
                    list.innerHTML = '';
                }, 200);
            });
        });
    },

    async loadCompositionFromDB(kod) {
        try {
            const sql = `SELECT "kod2", "koli", "upak" FROM "sostav" WHERE "kod"='${kod.replace(/'/g, "''")}'`;
            const result = await this.query(sql);
            const lines = result.trim().split('\n').filter(l => l);

            if (lines.length <= 1) {
                this.renderCompositionRows(0);
                return;
            }

            const dataLines = lines.slice(1);
            this.renderCompositionRows(dataLines.length);

            const tbody = document.getElementById('compositionBody');

            // Загружаем данные из guide, создаём словарь по полю kod
            let guideData = {};
            const guideSql = `SELECT "kod", "art", "type", "edizm", "price", "name" FROM "guide"`;
            const guideResult = await this.query(guideSql);
            const guideLines = guideResult.trim().split('\n').filter(l => l);

            if (guideLines.length > 1) {
                const headerParts = guideLines[0].split('\t');
                const kodIndex = headerParts.findIndex(h => h.trim().toLowerCase() === 'kod');
                const artIndex = headerParts.findIndex(h => h.trim().toLowerCase() === 'art');
                const typeIndex = headerParts.findIndex(h => h.trim().toLowerCase() === 'type');
                const edizmIndex = headerParts.findIndex(h => h.trim().toLowerCase() === 'edizm');
                const priceIndex = headerParts.findIndex(h => h.trim().toLowerCase() === 'price');
                const nameIndex = headerParts.findIndex(h => h.trim().toLowerCase() === 'name');

                for (let i = 1; i < guideLines.length; i++) {
                    const parts = guideLines[i].split('\t');
                    const gKod = (kodIndex >= 0 && parts[kodIndex]) ? parts[kodIndex].trim() : '';
                    if (gKod) {
                        guideData[gKod.toLowerCase()] = {
                            art: (artIndex >= 0 && parts[artIndex]) ? parts[artIndex].trim() : '',
                            type: (typeIndex >= 0 && parts[typeIndex]) ? parts[typeIndex].trim() : '',
                            edizm: (edizmIndex >= 0 && parts[edizmIndex]) ? parts[edizmIndex].trim() : '',
                            price: (priceIndex >= 0 && parts[priceIndex]) ? parts[priceIndex].trim() : '0',
                            name: (nameIndex >= 0 && parts[nameIndex]) ? parts[nameIndex].trim() : ''
                        };
                    }
                }
            }

            // Заполняем таблицу состава
            dataLines.forEach((line, index) => {
                const values = line.split('\t');
                const kod2 = values[0] ? values[0].trim() : '';
                const koli = values[1] || '0';
                const upakVal = values[2] || 'Нет';

                const codeInput = tbody.rows[index].querySelector(`input[name="comp_code_${index}"]`);
                const nameInput = tbody.rows[index].querySelector(`input[name="comp_name_${index}"]`);
                const categoryInput = tbody.rows[index].querySelector(`input[name="comp_category_${index}"]`);
                const qtyInput = tbody.rows[index].querySelector(`input[name="comp_qty_${index}"]`);
                const unitInput = tbody.rows[index].querySelector(`input[name="comp_unit_${index}"]`);
                const priceInput = tbody.rows[index].querySelector(`input[name="comp_price_${index}"]`);
                const sumInput = tbody.rows[index].querySelector(`input[name="comp_sum_${index}"]`);
                const labelInput = tbody.rows[index].querySelector(`input[name="comp_label_${index}"]`);
                const upakCb = tbody.rows[index].querySelector('.upak-row-cb');

                // Ищем точное совпадение, потом частичное
                let guideInfo = guideData[kod2.toLowerCase()] || {};
                let notFound = Object.keys(guideInfo).length === 0;
                if (notFound) {
                    for (const [key, val] of Object.entries(guideData)) {
                        if (key.includes(kod2.toLowerCase()) || kod2.toLowerCase().includes(key)) {
                            guideInfo = val;
                            notFound = false;
                            break;
                        }
                    }
                }
                const price = parseFloat(guideInfo.price) || 0;
                const koliNum = parseFloat(koli) || 0;
                const sum = Math.round(price * koliNum * 100) / 100;

                const artValue = guideInfo.art || kod2;
                if (codeInput) codeInput.value = kod2;
                if (nameInput) {
                    nameInput.value = notFound ? 'Не найдено в базе' : artValue;
                    nameInput.title = nameInput.value;
                    nameInput.style.background = notFound ? 'rgba(255, 0, 0, 0.15)' : '';
                }
                if (categoryInput) categoryInput.value = guideInfo.type || '';
                if (qtyInput) qtyInput.value = koli;
                if (unitInput) unitInput.value = guideInfo.edizm || '';
                if (priceInput) priceInput.value = guideInfo.price || '';
                if (sumInput) sumInput.value = sum;
                if (labelInput) labelInput.value = guideInfo.name || '';

                // Устанавливаем title для всплывающих подсказок
                [codeInput, categoryInput, qtyInput, unitInput, priceInput, sumInput, labelInput].forEach(input => {
                    if (input && input.value) input.title = input.value;
                });

                if (upakCb) upakCb.checked = (upakVal === 'Да');
                const cat = guideInfo.type || '';
                tbody.rows[index].setAttribute('data-cat', cat);
                tbody.rows[index].setAttribute('data-kod2', kod2); // для удаления из БД
                tbody.rows[index].querySelector('.upak-row-cb').disabled = (cat !== 'Упаковка');
            });
        } catch (error) {
            console.error('Ошибка загрузки состава:', error);
            this.renderCompositionRows(0);
        }
        this.calculateCost();
    },

    addCompositionRow(tbody, index) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align:center;"><input type="checkbox" class="upak-row-cb" title="Упакован?"></td>
            <td><input type="text" name="comp_code_${index}" placeholder="Код" readonly title=""></td>
            <td><input type="text" name="comp_name_${index}" placeholder="Состав" readonly title=""></td>
            <td><input type="text" name="comp_category_${index}" placeholder="Категория" readonly title=""></td>
            <td><input type="number" name="comp_qty_${index}" placeholder="Кол-во" step="any" title=""></td>
            <td><input type="text" name="comp_unit_${index}" placeholder="Ед." readonly title=""></td>
            <td><input type="number" name="comp_price_${index}" placeholder="Цена" step="any" readonly title=""></td>
            <td><input type="number" name="comp_sum_${index}" placeholder="Сумма" step="any" readonly title=""></td>
            <td><input type="text" name="comp_label_${index}" placeholder="Имя" readonly title=""></td>
            <td style="text-align:center;"><button type="button" class="col-del-btn" onclick="GUIDE_ADD.removeCompositionRow(this)">✕</button></td>
        `;
        tbody.appendChild(tr);
    },

    async removeCompositionRow(btn) {
        const tbody = document.getElementById('compositionBody');
        const row = btn.closest('tr');
        const kod2 = row.getAttribute('data-kod2');
        const parentKod = document.querySelector('input[name="kod"]')?.value || this.currentKod;

        if (kod2) {
            // Удаляем из БД sostav
            try {
                const deleteSql = `DELETE FROM "sostav" WHERE "kod"='${parentKod.replace(/'/g, "''")}' AND "kod2"='${kod2.replace(/'/g, "''")}'`;
                await this.query(deleteSql);
            } catch (e) {
                console.error('Ошибка удаления из sostav:', e);
                alert('Не удалось удалить запись из базы');
                return; // Если не получилось удалить из БД — не удаляем UI
            }
        }

        row.remove();
        this.calculateCost();
    },

    async saveRecord() {
        // Синхронизируем себестоимость с ценой перед сбором данных
        this.syncCostToPrice();
        const form = document.getElementById('recordForm');
        const formData = new FormData(form);
        const columns = this.currentData.columns;
        const tableName = this.currentTable;

        // Проверяем таблицу "Состав": если в колонке "Категория" есть хотя бы одна "Товар", то opt="Сборка"
        const tbody = document.getElementById('compositionBody');
        for (let i = 0; i < tbody.rows.length; i++) {
            const catInput = tbody.rows[i].querySelector(`input[name="comp_category_${i}"]`);
            if (catInput && catInput.value.trim() === 'Товар') {
                formData.set('opt', 'Сборка');
                break;
            }
        }

        // Проверка обязательных полей
        const requiredFields = [
            { key: 'art', name: 'art' },
            { key: 'kiz', name: 'kiz' },
            { key: 'vidim', name: 'vidim' },
            { key: 'type', name: 'type' },
            { key: 'kod', name: 'kod' }
        ];

        for (const field of requiredFields) {
            const value = formData.get(field.key);
            if (!value || value.trim() === '') {
                alert(`Поле "${field.name}" обязательно для заполнения`);
                return;
            }
        }

        const values = columns.map(col => {
            let value = formData.get(col.name);
            // Заменяем запятые на точки
            value = value ? value.toString().replace(',', '.') : value;
            
            if (col.type === 'INTEGER' && value !== '') return parseInt(value) || 0;
            const escaped = (value || '').replace(/'/g, "''");
            return `'${escaped}'`;
        });

        const kodColumn = columns.find(c => c.name.toLowerCase() === 'kod');
        let kod = kodColumn ? formData.get(kodColumn.name) : null;

        try {
            if (kodColumn && !kod) {
                kod = Math.floor(Date.now() / 1000);
            }
            this.currentKod = kod;

            // Сохраняем изображение в localStorage, привязанное к kod
            await this.saveImageToLocalStorage(kod);

            // Проверяем, есть ли такое kod в БД
            const checkSql = `SELECT * FROM "${tableName}" WHERE "kod"='${kod.replace(/'/g, "''")}' LIMIT 1`;
            const checkResult = await this.query(checkSql);
            const checkLines = checkResult.trim().split('\n').filter(l => l);
            const exists = checkLines.length > 1; // больше 1 строки = есть заголовок + данные

            if (exists) {
                // Обновляем существующую запись
                const sets = columns.map(col => {
                    let value = formData.get(col.name);
                    // Заменяем запятые на точки
                    value = value ? value.toString().replace(',', '.') : value;

                    const escaped = (value || '').replace(/'/g, "''");
                    const val = col.type === 'INTEGER' && value !== '' ? (parseInt(value) || 0) : `'${escaped}'`;
                    return `"${col.name}"=${val}`;
                }).join(', ');

                const safeKod = kod.replace(/'/g, "''");
                const sql = `UPDATE "${tableName}" SET ${sets} WHERE "kod"='${safeKod}'`;
                await this.query(sql);
                alert('✅ Запись обновлена');
            } else {
                // Добавляем новую запись
                const columnsStr = columns.map(c => `"${c.name}"`).join(', ');
                const valuesStr = values.join(', ');
                const sql = `INSERT INTO "${tableName}" (${columnsStr}) VALUES (${valuesStr})`;
                await this.query(sql);
                alert('✅ Запись добавлена');
            }

            // Сохраняем состав в таблицу sostav
            await this.saveComposition(kod);

            window.location.href = 'guide.html';
        } catch (error) {
            console.error('Ошибка сохранения:', error);
            alert(`❌ Ошибка: ${error.message}`);
        }
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    async saveComposition(parentKod) {
        try {
            // Удаляем старые записи состава для этого kod
            const deleteSql = `DELETE FROM "sostav" WHERE "kod"='${parentKod.replace(/'/g, "''")}'`;
            await this.query(deleteSql);

            const tbody = document.getElementById('compositionBody');

            for (let i = 0; i < tbody.rows.length; i++) {
                const row = tbody.rows[i];
                const codeInput = row.querySelector(`input[name="comp_code_${i}"]`);
                const qtyInput = row.querySelector(`input[name="comp_qty_${i}"]`);
                const upakCb = row.querySelector('.upak-row-cb');
                const rowCat = row.getAttribute('data-cat') || '';
                const isRowPacked = upakCb?.checked || false;

                const kod2 = codeInput?.value?.trim();
                const koli = qtyInput?.value?.trim();

                if (kod2) {
                    // Заменяем запятую на точку для корректного парсинга
                    const koliClean = koli ? koli.replace(',', '.') : '0';
                    const koliVal = parseFloat(koliClean) || 0;

                    // upak: Товар → 'Товар', Упаковка → от чекбокса, остальные → 'Да'
                    let upak = 'Нет';
                    if (rowCat === 'Товар') {
                        upak = 'Товар';
                    } else if (rowCat === 'Упаковка') {
                        upak = isRowPacked ? 'Да' : 'Нет';
                    } else {
                        upak = 'Да';
                    }

                    // Добавляем новую запись в sostav с upak
                    const insertSql = `INSERT INTO "sostav" ("kod", "kod2", "koli", "upak") VALUES ('${parentKod.replace(/'/g, "''")}', '${kod2.replace(/'/g, "''")}', ${koliVal}, '${upak}')`;
                    await this.query(insertSql);
                }
            }
        } catch (error) {
            console.error('Ошибка сохранения состава:', error);
        }
    },

    bindAutocomplete() {
        // Уже настроено в renderFormRows через bindAllAutocomplete
    },

    bindAllAutocomplete() {
        const wrappers = document.querySelectorAll('.autocomplete-wrapper');
        wrappers.forEach(wrapper => {
            if (wrapper.dataset.bound) return;
            wrapper.dataset.bound = 'true';

            const input = wrapper.querySelector('input');
            const columnName = wrapper.dataset.column;
            const tableName = wrapper.dataset.table;
            if (!input || !columnName || !tableName) return;

            const list = wrapper.querySelector('.autocomplete-list');
            let debounceTimer = null;
            let selectedIndex = -1;

            const getConditions = () => {
                const conditions = [];
                const typeSelect = document.querySelector('.type-select');
                if (typeSelect && typeSelect.value) {
                    conditions.push(`"type"='${typeSelect.value.replace(/'/g, "''")}'`);
                }
                const katNum = parseInt(columnName.replace('kat', ''));
                for (let i = 1; i < 5; i++) {
                    const prevKat = document.querySelector(`input[name="kat${i}"]`);
                    if (prevKat && prevKat.value.trim()) {
                        if (i === katNum) {
                            const escaped = prevKat.value.trim().replace(/'/g, "''");
                            conditions.push(`"${columnName}" LIKE '${escaped}%'`);
                        } else {
                            conditions.push(`"kat${i}"='${prevKat.value.trim().replace(/'/g, "''")}'`);
                        }
                    }
                }
                return conditions;
            };

            input.addEventListener('focus', () => {
                if (input.disabled) return;
                debounceTimer = setTimeout(async () => {
                    try {
                        const conditions = getConditions();
                        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
                        const sql = `SELECT DISTINCT "${columnName}" FROM "${tableName}" ${whereClause} LIMIT 100`;
                        const result = await this.query(sql);
                        let lines = result.trim().split('\n').filter(l => l);

                        if (lines.length <= 1) {
                            const sql2 = `SELECT "${columnName}" FROM "${tableName}" ${whereClause} LIMIT 100`;
                            const result2 = await this.query(sql2);
                            lines = result2.trim().split('\n').filter(l => l);
                        }

                        const suggestions = [...new Set(lines.slice(1).map(l => l.split('\t')[0]).filter(Boolean))];

                        if (suggestions.length === 0) {
                            list.innerHTML = '';
                            return;
                        }

                        list.innerHTML = suggestions.map(s =>
                            `<div class="autocomplete-item" data-value="${this.escapeHtml(s)}">${s}</div>`
                        ).join('');
                    } catch (error) {
                        list.innerHTML = '';
                    }
                }, 100);
            });

            input.addEventListener('blur', () => {
                setTimeout(() => {
                    list.innerHTML = '';
                }, 200);
            });

            input.addEventListener('input', async () => {
                if (input.disabled) return;
                clearTimeout(debounceTimer);
                const query = input.value.trim();
                selectedIndex = -1;

                if (query.length < 1) {
                    list.innerHTML = '';
                    return;
                }

                debounceTimer = setTimeout(async () => {
                    try {
                        const conditions = getConditions();
                        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
                        const sql = `SELECT DISTINCT "${columnName}" FROM "${tableName}" ${whereClause} LIMIT 50`;
                        const result = await this.query(sql);
                        let lines = result.trim().split('\n').filter(l => l);

                        if (lines.length <= 1) {
                            const sql2 = `SELECT "${columnName}" FROM "${tableName}" ${whereClause} LIMIT 50`;
                            const result2 = await this.query(sql2);
                            lines = result2.trim().split('\n').filter(l => l);
                        }

                        const suggestions = [...new Set(lines.slice(1).map(l => l.split('\t')[0]).filter(Boolean))];

                        if (suggestions.length === 0) {
                            list.innerHTML = '';
                            return;
                        }

                        list.innerHTML = suggestions.map(s =>
                            `<div class="autocomplete-item" data-value="${this.escapeHtml(s)}">${s}</div>`
                        ).join('');
                    } catch (error) {
                        list.innerHTML = '';
                    }
                }, 300);
            });

            // Клик по элементу списка
            wrapper.addEventListener('click', (e) => {
                const item = e.target.closest('.autocomplete-item');
                if (item && !input.disabled) {
                    input.value = item.dataset.value;
                    list.innerHTML = '';
                    this.toggleKatFields();
                }
            });

            input.addEventListener('keydown', (e) => {
                const items = list.querySelectorAll('.autocomplete-item');
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
                    items.forEach((it, i) => it.classList.toggle('active', i === selectedIndex));
                    if (selectedIndex >= 0) {
                        input.value = items[selectedIndex].dataset.value;
                        this.toggleKatFields();
                    }
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    selectedIndex = Math.max(selectedIndex - 1, 0);
                    items.forEach((it, i) => it.classList.toggle('active', i === selectedIndex));
                    if (selectedIndex >= 0) {
                        input.value = items[selectedIndex].dataset.value;
                        this.toggleKatFields();
                    }
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    list.innerHTML = '';
                }
            });

            input.addEventListener('blur', () => {
                this.toggleKatFields();
            });
        });
    },

    // ============================================================
    // ADD COMPOSITION FROM GUIDE
    // ============================================================
    currentEditRowIndex: null,
    currentEditKod: null,
    kodDebounceTimer: null,
    gtinDebounceTimer: null,
    currentKodMatches: [],
    currentArtKod: null, // kod выбранного артикула

    async openAddCompositionModal() {
        // Очищаем поля
        document.getElementById('editGtin').value = '';
        document.getElementById('editGtin').classList.remove('not-found');
        document.getElementById('gtinResults').innerHTML = '';
        document.getElementById('editKod').value = '';
        document.getElementById('editCategory').value = '';
        document.getElementById('editName').value = '';
        document.getElementById('editQty').value = '';
        document.getElementById('kodResults').innerHTML = '';

        // Сбрасываем изображение
        const editImg = document.getElementById('editPreviewImage');
        const editContainer = document.getElementById('editImageContainer');
        editImg.src = '';
        editContainer.classList.remove('has-image');

        // Загружаем уникальные категории, наименования и артикулы
        await this.loadUniqueCategories();
        await this.loadUniqueNames('');
        await this.loadUniqueArts();

        // Привязываем события (кроме bindCategorySelect, bindArtSelect, bindNameSelect — они уже привязаны в init)
        this.bindGtinSearch();
        this.bindKodSearch();
        this.bindEditImageEvents();

        // Инициализируем поле количество
        document.getElementById('editQty').step = 'any';
        document.getElementById('editQty').pattern = '';

        // Показываем модальное окно
        document.getElementById('addCompositionModal').style.display = 'flex';
    },

    clearSelect(id) {
        const select = document.getElementById(id);
        select.innerHTML = '<option value="" disabled selected hidden></option>';
    },

    fillFieldsNotFound() {
        const notFoundText = 'Не найдено';
        const notFoundColor = 'rgba(255, 150, 150, 0.15)';

        // Заполняем все поля "Не найдено" и подсвечиваем
        document.getElementById('editKod').value = notFoundText;
        document.getElementById('editKod').style.background = notFoundColor;

        const catSelect = document.getElementById('editCategory');
        this.clearSelect('editCategory');
        const catOpt = document.createElement('option');
        catOpt.value = notFoundText;
        catOpt.textContent = notFoundText;
        catOpt.selected = true;
        catSelect.appendChild(catOpt);
        catSelect.style.background = notFoundColor;

        const nameSelect = document.getElementById('editName');
        this.clearSelect('editName');
        const nameOpt = document.createElement('option');
        nameOpt.value = notFoundText;
        nameOpt.textContent = notFoundText;
        nameOpt.selected = true;
        nameSelect.appendChild(nameOpt);
        nameSelect.style.background = notFoundColor;

        const artSelect = document.getElementById('editArt');
        this.clearSelect('editArt');
        const artOpt = document.createElement('option');
        artOpt.value = notFoundText;
        artOpt.textContent = notFoundText;
        artOpt.selected = true;
        artSelect.appendChild(artOpt);
        artSelect.style.background = notFoundColor;

        this.currentArtKod = null;
    },

    clearNotFoundHighlight() {
        const fields = ['editKod', 'editCategory', 'editName', 'editArt'];
        fields.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.style.background = '';
            }
        });
    },

    bindGtinSearch() {
        const gtinInput = document.getElementById('editGtin');
        const gtinResults = document.getElementById('gtinResults');

        gtinInput.addEventListener('input', () => {
            clearTimeout(this.gtinDebounceTimer);
            const query = gtinInput.value.trim();

            if (query.length < 1) {
                gtinResults.innerHTML = '';
                this.clearNotFoundHighlight();
                this.clearSelect('editCategory');
                this.clearSelect('editArt');
                this.clearSelect('editName');
                document.getElementById('editKod').value = '';
                document.getElementById('editGtin').classList.remove('not-found');
                return;
            }

            this.gtinDebounceTimer = setTimeout(async () => {
                try {
                    const escapedQuery = query.replace(/'/g, "''");
                    const sql = `SELECT "kod", "gtin", "art", "type", "name" FROM "guide" WHERE "gtin" LIKE '%${escapedQuery}%' LIMIT 100`;
                    const result = await this.query(sql);
                    const lines = result.trim().split('\n').filter(l => l);

                    if (lines.length <= 1) {
                        // Не найдено - заполняем поля "Не найдено" и подсвечиваем
                        gtinResults.innerHTML = '<div class="search-no-results">Ничего не найдено</div>';
                        gtinInput.classList.add('not-found');
                        this.fillFieldsNotFound();
                        return;
                    }

                    // Нашли - снимаем подсветку "не найдено"
                    gtinInput.classList.remove('not-found');
                    this.clearNotFoundHighlight();

                    // Парсим заголовки
                    const headerParts = lines[0].split('\t');
                    const kodIndex = headerParts.findIndex(h => h.trim().toLowerCase() === 'kod');
                    const gtinIndex = headerParts.findIndex(h => h.trim().toLowerCase() === 'gtin');
                    const artIndex = headerParts.findIndex(h => h.trim().toLowerCase() === 'art');
                    const typeIndex = headerParts.findIndex(h => h.trim().toLowerCase() === 'type');
                    const nameIndex = headerParts.findIndex(h => h.trim().toLowerCase() === 'name');

                    gtinResults.innerHTML = lines.slice(1).map((line) => {
                        const parts = line.split('\t');
                        const kod = (kodIndex >= 0 ? parts[kodIndex] : '') || '';
                        const gtin = (gtinIndex >= 0 ? parts[gtinIndex] : '') || '';
                        const art = (artIndex >= 0 ? parts[artIndex] : '') || '';
                        const name = (nameIndex >= 0 ? parts[nameIndex] : '') || '';
                        const type = (typeIndex >= 0 ? parts[typeIndex] : '') || '';

                        return `
                            <div class="search-result-item" data-kod="${kod}" data-gtin="${gtin}" data-type="${type}" data-art="${art}" data-name="${name}">
                                <div class="search-result-kod">Код: ${kod}</div>
                                <div class="search-result-art">GTIN: ${gtin}</div>
                                <div class="search-result-art">Артикул: ${art}</div>
                                <div class="search-result-name">Наименование: ${name}</div>
                                <div class="search-result-type">Категория: ${type}</div>
                            </div>
                        `;
                    }).join('');

                    // Привязываем клик по результатам
                    gtinResults.querySelectorAll('.search-result-item').forEach(item => {
                        item.addEventListener('click', () => {
                            this.selectGtinFromResults(item);
                        });
                    });
                } catch (error) {
                    console.error('Ошибка поиска по GTIN:', error);
                    gtinResults.innerHTML = '<div class="search-no-results">Ошибка поиска</div>';
                }
            }, 300);
        });

        // Клик вне зоны поиска закрывает результаты
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.edit-product-field')) {
                gtinResults.innerHTML = '';
            }
        });
    },

    selectGtinFromResults(item) {
        const kod = item.dataset.kod;
        const gtin = item.dataset.gtin;
        const type = item.dataset.type;
        const art = item.dataset.art;
        const name = item.dataset.name;

        // Заполняем GTIN
        document.getElementById('editGtin').value = gtin;

        // Заполняем Код
        document.getElementById('editKod').value = kod;

        // Заполняем Категорию в select
        const catSelect = document.getElementById('editCategory');
        this.clearSelect('editCategory');
        if (type) {
            const opt = document.createElement('option');
            opt.value = type;
            opt.textContent = type;
            opt.selected = true;
            catSelect.appendChild(opt);
        }

        // Обновляем Наименования по категории
        this.loadUniqueNames(type);

        // Обновляем Артикулы по наименованию и категории
        this.loadUniqueArtsByName(name, type);

        // Заполняем Артикул в select
        const artSelect = document.getElementById('editArt');
        this.clearSelect('editArt');
        if (art) {
            const artOpt = document.createElement('option');
            artOpt.value = art;
            artOpt.textContent = art;
            artOpt.selected = true;
            artSelect.appendChild(artOpt);
        }

        // Заполняем Наименование в select
        const nameSelect = document.getElementById('editName');
        this.clearSelect('editName');
        if (name) {
            const nameOpt = document.createElement('option');
            nameOpt.value = name;
            nameOpt.textContent = name;
            nameOpt.selected = true;
            nameSelect.appendChild(nameOpt);
        }

        // Показываем/скрываем чекбокс упаковки
        this.updateModalPackCheckbox(type);

        // Загружаем изображение по коду
        this.loadProductImage(kod);

        // Закрываем список
        document.getElementById('gtinResults').innerHTML = '';
    },

    updateModalPackCheckbox(type) {
        const packCheckboxField = document.querySelector('.pack-checkbox-field');
        const modalPackCheckbox = document.getElementById('modalPackCheckbox');

        const isPackaging = type === 'Упаковка';
        if (packCheckboxField) {
            packCheckboxField.style.display = isPackaging ? 'block' : 'none';
        }
        if (modalPackCheckbox) {
            modalPackCheckbox.checked = isPackaging;
        }
    },

    async loadUniqueCategories() {
        try {
            const select = document.getElementById('editCategory');
            this.clearSelect('editCategory');

            const sql = `SELECT DISTINCT "type" FROM "guide" WHERE "type" != '' ORDER BY "type"`;
            const result = await this.query(sql);
            const lines = result.trim().split('\n').filter(l => l);

            if (lines.length > 1) {
                const categories = lines.slice(1).map(l => l.split('\t')[0]).filter(Boolean);
                categories.forEach(cat => {
                    const opt = document.createElement('option');
                    opt.value = cat;
                    opt.textContent = cat;
                    select.appendChild(opt);
                });
            }
        } catch (error) {
            console.error('Ошибка загрузки категорий:', error);
        }
    },

    async loadUniqueArts(category) {
        try {
            const select = document.getElementById('editArt');
            this.clearSelect('editArt');

            let sql;
            if (category) {
                const escapedCat = category.replace(/'/g, "''");
                sql = `SELECT DISTINCT "art" FROM "guide" WHERE "type"='${escapedCat}' AND "art" != '' ORDER BY "art"`;
            } else {
                sql = `SELECT DISTINCT "art" FROM "guide" WHERE "art" != '' ORDER BY "art"`;
            }

            const result = await this.query(sql);
            const lines = result.trim().split('\n').filter(l => l);

            if (lines.length > 1) {
                const arts = lines.slice(1).map(l => l.split('\t')[0]).filter(Boolean);
                arts.forEach(art => {
                    const opt = document.createElement('option');
                    opt.value = art;
                    opt.textContent = art;
                    select.appendChild(opt);
                });
            }
        } catch (error) {
            console.error('Ошибка загрузки артикулов:', error);
        }
    },

    clearSelect(id) {
        const select = document.getElementById(id);
        select.innerHTML = '<option value="" disabled selected hidden></option>';
    },

    clearAddCompositionModal() {
        // Очищаем все поля (без вызова closeDuplicateModal — нет рекурсии!)
        document.getElementById('editGtin').value = '';
        document.getElementById('editGtin').classList.remove('not-found');
        document.getElementById('editKod').value = '';
        document.getElementById('editQty').value = '';
        document.getElementById('gtinResults').innerHTML = '';
        document.getElementById('kodResults').innerHTML = '';

        // Сбрасываем select на первое значение, но не очищаем опции
        const selects = ['editCategory', 'editArt', 'editName'];
        selects.forEach(id => {
            const select = document.getElementById(id);
            if (select) select.selectedIndex = 0;
        });

        // Сбрасываем изображение
        const editImg = document.getElementById('editPreviewImage');
        const editContainer = document.getElementById('editImageContainer');
        editImg.src = '';
        editContainer.classList.remove('has-image');

        // Сбрасываем подсветку
        this.clearNotFoundHighlight();

        // Сбрасываем поле количество
        document.getElementById('editQty').type = 'number';
        document.getElementById('editQty').step = 'any';
        document.getElementById('editQty').pattern = '';
    },

    closeAddCompositionModal() {
        document.getElementById('addCompositionModal').style.display = 'none';
        this.currentEditRowIndex = null;
        this.currentEditKod = null;
        clearTimeout(this.kodDebounceTimer);
    },

    bindCategorySelect() {
        const categorySelect = document.getElementById('editCategory');
        const modalPackCheckbox = document.getElementById('modalPackCheckbox');
        const packCheckboxField = document.querySelector('.pack-checkbox-field');

        // При изменении категории - фильтруем наименования и артикулы
        categorySelect.addEventListener('change', () => {
            const category = categorySelect.value;

            // Очищаем наименования и артикулы при смене категории
            this.clearSelect('editName');
            this.clearSelect('editArt');
            document.getElementById('editKod').value = '';
            document.getElementById('editGtin').value = '';

            // Загружаем наименования по категории
            this.loadUniqueNames(category);

            // Обновляем артикулы по категории (без наименования)
            this.loadUniqueArts(category);

            // Показываем/скрываем чекбокс упаковки
            const isPackaging = category === 'Упаковка';
            if (packCheckboxField) {
                packCheckboxField.style.display = isPackaging ? 'block' : 'none';
            }
            if (modalPackCheckbox) {
                modalPackCheckbox.checked = isPackaging;
            }

            this.checkCategoryForQty(category);
        });
    },

    async loadUniqueNames(category) {
        try {
            const select = document.getElementById('editName');
            this.clearSelect('editName');

            let sql;
            if (category) {
                const escapedCat = category.replace(/'/g, "''");
                sql = `SELECT DISTINCT "name" FROM "guide" WHERE "type"='${escapedCat}' AND "name" != '' ORDER BY "name"`;
            } else {
                sql = `SELECT DISTINCT "name" FROM "guide" WHERE "name" != '' ORDER BY "name"`;
            }

            const result = await this.query(sql);
            const lines = result.trim().split('\n').filter(l => l);

            if (lines.length > 1) {
                const names = lines.slice(1).map(l => l.split('\t')[0]).filter(Boolean);
                names.forEach(name => {
                    const opt = document.createElement('option');
                    opt.value = name;
                    opt.textContent = name;
                    select.appendChild(opt);
                });
            }
        } catch (error) {
            console.error('Ошибка загрузки наименований:', error);
        }
    },

    bindArtSelect() {
        const artSelect = document.getElementById('editArt');
        const nameSelect = document.getElementById('editName');
        const qtyInput = document.getElementById('editQty');
        const catSelect = document.getElementById('editCategory');

        artSelect.addEventListener('change', async () => {
            const art = artSelect.value;

            if (!art) {
                document.getElementById('editKod').value = '';
                document.getElementById('editGtin').value = '';
                qtyInput.type = 'number';
                qtyInput.step = 'any';
                qtyInput.pattern = '';
                this.currentArtKod = null;
                return;
            }

            // Ищем kod по артикулу
            try {
                const sql = `SELECT "kod", "gtin", "name", "type" FROM "guide" WHERE "art"='${art.replace(/'/g, "''")}' LIMIT 1`;
                const result = await this.query(sql);
                const lines = result.trim().split('\n').filter(l => l);

                if (lines.length > 1) {
                    const headerParts = lines[0].split('\t');
                    const kodIndex = headerParts.findIndex(h => h.trim().toLowerCase() === 'kod');
                    const gtinIndex = headerParts.findIndex(h => h.trim().toLowerCase() === 'gtin');
                    const nameIndex = headerParts.findIndex(h => h.trim().toLowerCase() === 'name');
                    const typeIndex = headerParts.findIndex(h => h.trim().toLowerCase() === 'type');
                    const dataParts = lines[1].split('\t');

                    const kod = (kodIndex >= 0 ? dataParts[kodIndex] : '') || '';
                    const gtin = (gtinIndex >= 0 ? dataParts[gtinIndex] : '') || '';
                    const name = (nameIndex >= 0 ? dataParts[nameIndex] : '') || '';
                    const type = (typeIndex >= 0 ? dataParts[typeIndex] : '') || '';

                    document.getElementById('editKod').value = kod;
                    document.getElementById('editGtin').value = gtin;

                    // Заполняем Категорию в select
                    const catSelect = document.getElementById('editCategory');
                    this.clearSelect('editCategory');
                    if (type) {
                        const catOpt = document.createElement('option');
                        catOpt.value = type;
                        catOpt.textContent = type;
                        catOpt.selected = true;
                        catSelect.appendChild(catOpt);
                    }

                    // Загружаем наименования по категории
                    this.loadUniqueNames(type);

                    // Заполняем Наименование в select
                    const nameSelect = document.getElementById('editName');
                    this.clearSelect('editName');
                    if (name) {
                        const nameOpt = document.createElement('option');
                        nameOpt.value = name;
                        nameOpt.textContent = name;
                        nameOpt.selected = true;
                        nameSelect.appendChild(nameOpt);
                    }

                    // Проверяем категорию для количества
                    this.checkCategoryForQty(type);

                    this.currentArtKod = kod;

                    // Загружаем изображение
                    this.loadProductImage(kod);
                } else {
                    document.getElementById('editKod').value = '';
                    document.getElementById('editGtin').value = '';
                    qtyInput.type = 'number';
                    qtyInput.step = 'any';
                    qtyInput.pattern = '';
                    this.currentArtKod = null;
                }
            } catch (error) {
                console.error('Ошибка поиска по артикулу:', error);
            }
        });

        // При изменении категории проверяем для количества
        catSelect.addEventListener('change', () => {
            this.checkCategoryForQty(catSelect.value);
        });
    },

    checkCategoryForQty(category) {
        const qtyInput = document.getElementById('editQty');
        if (category === 'Товар') {
            qtyInput.type = 'number';
            qtyInput.step = '1';
            qtyInput.pattern = '[0-9]*';
        } else {
            qtyInput.type = 'number';
            qtyInput.step = 'any';
            qtyInput.pattern = '';
        }
    },

    bindNameSelect() {
        const nameSelect = document.getElementById('editName');
        const catSelect = document.getElementById('editCategory');
        const qtyInput = document.getElementById('editQty');

        nameSelect.addEventListener('change', async () => {
            const name = nameSelect.value;
            const category = catSelect.value;

            if (!name) {
                this.clearSelect('editArt');
                document.getElementById('editKod').value = '';
                document.getElementById('editGtin').value = '';
                if (qtyInput) {
                    qtyInput.type = 'number';
                    qtyInput.step = 'any';
                    qtyInput.pattern = '';
                }
                this.currentArtKod = null;
                return;
            }

            // Ищем артикулы по наименованию и категории
            await this.loadUniqueArtsByName(name, category);
        });
    },

    async loadUniqueArtsByName(name, category) {
        try {
            const select = document.getElementById('editArt');
            this.clearSelect('editArt');

            let sql;
            if (name && category) {
                const escapedName = name.replace(/'/g, "''");
                const escapedCat = category.replace(/'/g, "''");
                sql = `SELECT DISTINCT "art" FROM "guide" WHERE "name"='${escapedName}' AND "type"='${escapedCat}' AND "art" != '' ORDER BY "art"`;
            } else if (name) {
                const escapedName = name.replace(/'/g, "''");
                sql = `SELECT DISTINCT "art" FROM "guide" WHERE "name"='${escapedName}' AND "art" != '' ORDER BY "art"`;
            } else {
                sql = `SELECT DISTINCT "art" FROM "guide" WHERE "art" != '' ORDER BY "art"`;
            }

            const result = await this.query(sql);
            const lines = result.trim().split('\n').filter(l => l);

            if (lines.length > 1) {
                const arts = lines.slice(1).map(l => l.split('\t')[0]).filter(Boolean);
                arts.forEach(art => {
                    const opt = document.createElement('option');
                    opt.value = art;
                    opt.textContent = art;
                    select.appendChild(opt);
                });
            }
        } catch (error) {
            console.error('Ошибка загрузки артикулов по наименованию:', error);
        }
    },

    bindKodSearch() {
        const kodInput = document.getElementById('editKod');
        const kodResults = document.getElementById('kodResults');

        kodInput.addEventListener('input', () => {
            clearTimeout(this.kodDebounceTimer);
            const query = kodInput.value.trim();

            if (query.length < 1) {
                kodResults.innerHTML = '';
                this.currentKodMatches = [];
                const artSelect = document.getElementById('editArt');
                this.clearSelect('editArt');
                const nameSelect = document.getElementById('editName');
                this.clearSelect('editName');
                const catSelect = document.getElementById('editCategory');
                this.clearSelect('editCategory');
                document.getElementById('editGtin').value = '';
                return;
            }

            this.kodDebounceTimer = setTimeout(async () => {
                try {
                    const escapedQuery = query.replace(/'/g, "''");
                    const sql = `SELECT "kod", "art", "type", "name" FROM "guide" WHERE "kod" LIKE '%${escapedQuery}%' LIMIT 100`;
                    const result = await this.query(sql);
                    const lines = result.trim().split('\n').filter(l => l);

                    if (lines.length <= 1) {
                        kodResults.innerHTML = '<div class="search-no-results">Ничего не найдено</div>';
                        this.currentKodMatches = [];
                        return;
                    }

                    // Парсим заголовки
                    const headerParts = lines[0].split('\t');
                    const kodIndex = headerParts.findIndex(h => h.trim().toLowerCase() === 'kod');
                    const artIndex = headerParts.findIndex(h => h.trim().toLowerCase() === 'art');
                    const typeIndex = headerParts.findIndex(h => h.trim().toLowerCase() === 'type');
                    const nameIndex = headerParts.findIndex(h => h.trim().toLowerCase() === 'name');

                    this.currentKodMatches = [];

                    kodResults.innerHTML = lines.slice(1).map((line) => {
                        const parts = line.split('\t');
                        const kod = (kodIndex >= 0 ? parts[kodIndex] : '') || '';
                        const art = (artIndex >= 0 ? parts[artIndex] : '') || '';
                        const name = (nameIndex >= 0 ? parts[nameIndex] : '') || '';
                        const type = (typeIndex >= 0 ? parts[typeIndex] : '') || '';

                        this.currentKodMatches.push({ kod, art, type, name });

                        return `
                            <div class="search-result-item" data-index="${this.currentKodMatches.length - 1}">
                                <div class="search-result-kod">Код: ${kod}</div>
                                <div class="search-result-art">Артикул: ${art}</div>
                                <div class="search-result-name">Наименование: ${name}</div>
                                <div class="search-result-type">Категория: ${type}</div>
                            </div>
                        `;
                    }).join('');

                    // Привязываем клик по результатам
                    kodResults.querySelectorAll('.search-result-item').forEach(item => {
                        item.addEventListener('click', () => {
                            const idx = parseInt(item.dataset.index);
                            this.selectKodFromResults(idx);
                        });
                    });
                } catch (error) {
                    console.error('Ошибка поиска:', error);
                    kodResults.innerHTML = '<div class="search-no-results">Ошибка поиска</div>';
                }
            }, 300);
        });

        // Клик вне зоны поиска закрывает результаты
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.edit-product-field')) {
                kodResults.innerHTML = '';
            }
        });
    },

    selectKodFromResults(index) {
        const match = this.currentKodMatches[index];
        if (!match) return;

        // Заполняем Код
        document.getElementById('editKod').value = match.kod;

        // Заполняем Категорию в select
        const catSelect = document.getElementById('editCategory');
        this.clearSelect('editCategory');
        if (match.type) {
            const opt = document.createElement('option');
            opt.value = match.type;
            opt.textContent = match.type;
            opt.selected = true;
            catSelect.appendChild(opt);
        }

        // Обновляем Наименования по категории
        this.loadUniqueNames(match.type);

        // Обновляем Артикулы по наименованию и категории
        this.loadUniqueArtsByName(match.name, match.type);

        // Заполняем Артикул в select
        const artSelect = document.getElementById('editArt');
        this.clearSelect('editArt');
        if (match.art) {
            const artOpt = document.createElement('option');
            artOpt.value = match.art;
            artOpt.textContent = match.art;
            artOpt.selected = true;
            artSelect.appendChild(artOpt);
        }

        // Заполняем Наименование в select
        const nameSelect = document.getElementById('editName');
        this.clearSelect('editName');
        if (match.name) {
            const nameOpt = document.createElement('option');
            nameOpt.value = match.name;
            nameOpt.textContent = match.name;
            nameOpt.selected = true;
            nameSelect.appendChild(nameOpt);
        }

        // Показываем/скрываем чекбокс упаковки
        this.updateModalPackCheckbox(match.type);

        // Загружаем изображение по коду
        this.loadProductImage(match.kod);

        // Закрываем список
        document.getElementById('kodResults').innerHTML = '';
    },

    async loadProductImage(kod) {
        try {
            const editImg = document.getElementById('editPreviewImage');
            const editContainer = document.getElementById('editImageContainer');
            if (!kod || !editImg || !editContainer) return;

            const db = await this.getDb();
            const tx = db.transaction('images', 'readonly');
            const request = tx.objectStore('images').get(kod);

            request.onsuccess = () => {
                if (request.result && request.result.data) {
                    editImg.src = request.result.data;
                    editContainer.classList.add('has-image');
                } else {
                    editImg.src = '';
                    editContainer.classList.remove('has-image');
                }
            };

            request.onerror = () => {
                console.error('Ошибка загрузки изображения:', request.error);
                editImg.src = '';
                editContainer.classList.remove('has-image');
            };
        } catch (e) {
            console.error('Ошибка загрузки изображения:', e);
        }
    },

    async saveAddComposition() {
        const kod = document.getElementById('editKod').value.trim();
        const qtyValue = document.getElementById('editQty').value.trim();
        const art = document.getElementById('editArt').value.trim();
        const name = document.getElementById('editName').value.trim();
        const type = document.getElementById('editCategory').value.trim();
        const gtin = document.getElementById('editGtin').value.trim();
        const isPacked = document.getElementById('modalPackCheckbox')?.checked || false;

        // Проверяем, не заполнены ли поля "Не найдено"
        if (kod === 'Не найдено' || type === 'Не найдено' || art === 'Не найдено' || name === 'Не найдено') {
            alert('Данные не найдены в базе. Заполните поля корректно.');
            return;
        }

        if (!kod) {
            alert('Выберите товар из списка поиска');
            return;
        }

        if (!type) {
            alert('Выберите категорию');
            return;
        }

        if (!art) {
            alert('Выберите артикул');
            return;
        }

        if (!name) {
            alert('Выберите наименование');
            return;
        }

        if (!qtyValue) {
            alert('Укажите количество');
            return;
        }

        try {
            const parentKod = document.querySelector('input[name="kod"]')?.value || this.currentKod;
            const koliClean = qtyValue.replace(',', '.');
            const koliVal = parseFloat(koliClean) || 0;

            // Проверяем, есть ли уже такая запись в sostav
            const checkSql = `SELECT * FROM "sostav" WHERE "kod"='${parentKod.replace(/'/g, "''")}' AND "kod2"='${kod.replace(/'/g, "''")}' LIMIT 1`;
            const checkResult = await this.query(checkSql);
            const checkLines = checkResult.trim().split('\n').filter(l => l);
            const exists = checkLines.length > 1;

            if (exists) {
                // Загружаем текущее количество из sostav
                let currentKoli = 0;
                if (checkLines.length > 1) {
                    const headerParts = checkLines[0].split('\t');
                    const dataParts = checkLines[1].split('\t');
                    const koliIndex = headerParts.findIndex(h => h.trim().toLowerCase() === 'koli');
                    if (koliIndex >= 0) {
                        currentKoli = parseFloat(dataParts[koliIndex]) || 0;
                    }
                }

                // Показываем модальное окно дубликата
                this.showDuplicateModal({
                    kod: kod,
                    art: art,
                    name: name,
                    type: type,
                    qtyValue: qtyValue,
                    koliVal: koliVal,
                    isPacked: isPacked,
                    price: null, // загрузим после
                    currentKoli: currentKoli,
                    parentKod: parentKod
                });
                return;
            }

            // Если записи нет — просто добавляем
            this.finalizeAddComposition(kod, qtyValue, art, name, type, isPacked);

        } catch (error) {
            console.error('Ошибка добавления состава:', error);
            alert('Не удалось добавить состав');
        }
    },

    showDuplicateModal(data) {
        const modal = document.getElementById('duplicateModal');
        const nameEl = document.getElementById('dupItemName');
        nameEl.textContent = `Артикул: ${data.art} | ${data.name}`;

        // Сохраняем данные в объект для обработки
        this.duplicateDecisionData = data;

        modal.style.display = 'flex';
    },

    closeDuplicateModal() {
        const modal = document.getElementById('duplicateModal');
        modal.style.display = 'none';
        this.duplicateDecisionData = null;
    },

    clearDuplicateAndComposition() {
        // Очищаем модальное окно состава (без рекурсии!)
        document.getElementById('editGtin').value = '';
        document.getElementById('editGtin').classList.remove('not-found');
        document.getElementById('editKod').value = '';
        document.getElementById('editQty').value = '';
        document.getElementById('gtinResults').innerHTML = '';
        document.getElementById('kodResults').innerHTML = '';

        const selects = ['editCategory', 'editArt', 'editName'];
        selects.forEach(id => {
            const select = document.getElementById(id);
            if (select) select.selectedIndex = 0;
        });

        const editImg = document.getElementById('editPreviewImage');
        const editContainer = document.getElementById('editImageContainer');
        editImg.src = '';
        editContainer.classList.remove('has-image');

        this.clearNotFoundHighlight();

        document.getElementById('editQty').type = 'number';
        document.getElementById('editQty').step = 'any';
        document.getElementById('editQty').pattern = '';

        document.getElementById('addCompositionModal').style.display = 'none';
        document.getElementById('duplicateModal').style.display = 'none';
        this.currentEditRowIndex = null;
        this.currentEditKod = null;
        clearTimeout(this.kodDebounceTimer);
        this.duplicateDecisionData = null;
    },

    async handleDuplicateAddToQty() {
        if (!this.duplicateDecisionData) return;
        const data = this.duplicateDecisionData;

        try {
            const parentKod = data.parentKod;
            const koliNew = (data.currentKoli || 0) + data.koliVal;

            let upak = 'Нет';
            if (data.type === 'Товар') {
                upak = 'Товар';
            } else if (data.type === 'Упаковка') {
                upak = data.isPacked ? 'Да' : 'Нет';
            } else {
                upak = 'Да';
            }

            const updateSql = `UPDATE "sostav" SET "koli"=${koliNew}, "upak"='${upak}' WHERE "kod"='${parentKod.replace(/'/g, "''")}' AND "kod2"='${data.kod.replace(/'/g, "''")}'`;
            await this.query(updateSql);

            // Обновляем строку в таблице (прибавляем qty)
            const tbody = document.getElementById('compositionBody');
            let foundRow = false;
            for (let i = 0; i < tbody.rows.length; i++) {
                const codeInput = tbody.rows[i].querySelector(`input[name="comp_code_${i}"]`);
                const qtyInput = tbody.rows[i].querySelector(`input[name="comp_qty_${i}"]`);
                if (codeInput && codeInput.value === data.kod) {
                    const currentQty = parseFloat(qtyInput.value) || 0;
                    qtyInput.value = (currentQty + data.koliVal);
                    foundRow = true;
                    break;
                }
            }

            // Если строку не нашли — добавляем новую
            if (!foundRow) {
                this.finalizeAddCompositionSync(data.kod, data.qtyValue, data.art, data.name, data.type, data.isPacked);
            }

            this.closeDuplicateModal();
        } catch (error) {
            console.error('Ошибка добавления к количеству:', error);
            alert('Не удалось обновить количество: ' + error.message);
        }
    },

    async handleDuplicateAddNew() {
        if (!this.duplicateDecisionData) return;
        const data = this.duplicateDecisionData;

        try {
            const parentKod = data.parentKod;
            const koliVal = data.koliVal;

            let upak = 'Нет';
            if (data.type === 'Товар') {
                upak = 'Товар';
            } else if (data.type === 'Упаковка') {
                upak = data.isPacked ? 'Да' : 'Нет';
            } else {
                upak = 'Да';
            }

            const insertSql = `INSERT INTO "sostav" ("kod", "kod2", "koli", "upak") VALUES ('${parentKod.replace(/'/g, "''")}', '${data.kod.replace(/'/g, "''")}', ${koliVal}, '${upak}')`;
            await this.query(insertSql);

            this.finalizeAddCompositionSync(data.kod, data.qtyValue, data.art, data.name, data.type, data.isPacked);
            this.closeDuplicateModal();
        } catch (error) {
            console.error('Ошибка добавления новой записи:', error);
            alert('Не удалось добавить запись: ' + error.message);
        }
    },

    finalizeAddCompositionSync(kod, qtyValue, art, name, type, isPacked) {
        // Синхронное добавление строки в таблицу (без SQL-запросов)
        const koliClean = qtyValue.replace(',', '.');
        const koliVal = parseFloat(koliClean) || 0;

        const tbody = document.getElementById('compositionBody');
        const index = tbody.rows.length;
        this.addCompositionRow(tbody, index);

        const codeInput = tbody.rows[index].querySelector(`input[name="comp_code_${index}"]`);
        const nameInput = tbody.rows[index].querySelector(`input[name="comp_name_${index}"]`);
        const categoryInput = tbody.rows[index].querySelector(`input[name="comp_category_${index}"]`);
        const qtyInput = tbody.rows[index].querySelector(`input[name="comp_qty_${index}"]`);
        const unitInput = tbody.rows[index].querySelector(`input[name="comp_unit_${index}"]`);
        const priceInput = tbody.rows[index].querySelector(`input[name="comp_price_${index}"]`);
        const sumInput = tbody.rows[index].querySelector(`input[name="comp_sum_${index}"]`);
        const labelInput = tbody.rows[index].querySelector(`input[name="comp_label_${index}"]`);

        if (codeInput) codeInput.value = kod;
        if (nameInput) nameInput.value = art;
        if (categoryInput) categoryInput.value = type;
        if (qtyInput) qtyInput.value = qtyValue;
        if (labelInput) labelInput.value = name;

        // Устанавливаем чекбокс упаковки и тип строки
        const row = tbody.rows[index];
        row.setAttribute('data-cat', type);
        row.setAttribute('data-kod2', kod); // для удаления из БД
        const upakCb = row.querySelector('.upak-row-cb');
        if (upakCb) {
            upakCb.checked = isPacked;
            upakCb.disabled = (type !== 'Упаковка');
        }

        // Обновляем себестоимость
        this.calculateCost();
    },

    finalizeAddComposition(kod, qtyValue, art, name, type, isPacked, parentKod) {
        // Асинхронное добавление с загрузкой цены, edizm и вставкой в БД
        (async () => {
            let price = 0;
            try {
                const priceSql = `SELECT "price" FROM "guide" WHERE "kod"='${kod.replace(/'/g, "''")}' LIMIT 1`;
                const priceResult = await this.query(priceSql);
                const priceLines = priceResult.trim().split('\n').filter(l => l);
                if (priceLines.length > 1) {
                    const headerParts = priceLines[0].split('\t');
                    const priceIndex = headerParts.findIndex(h => h.trim().toLowerCase() === 'price');
                    const dataParts = priceLines[1].split('\t');
                    price = parseFloat((priceIndex >= 0 ? dataParts[priceIndex] : '0') || '0') || 0;
                }
            } catch (e) {
                console.warn('Не удалось загрузить цену:', e);
            }

            const koliClean = qtyValue.replace(',', '.');
            const koliVal = parseFloat(koliClean) || 0;
            const sum = Math.round(price * koliVal * 100) / 100;

            // ВСТАВКА в БД sostav (для обычного добавления, не для дубликата)
            if (!parentKod) {
                // parentKod не передан — берём из формы
                parentKod = document.querySelector('input[name="kod"]')?.value || this.currentKod;
            }
            let upak = 'Нет';
            if (type === 'Товар') {
                upak = 'Товар';
            } else if (type === 'Упаковка') {
                upak = isPacked ? 'Да' : 'Нет';
            } else {
                upak = 'Да';
            }
            const insertSql = `INSERT INTO "sostav" ("kod", "kod2", "koli", "upak") VALUES ('${parentKod.replace(/'/g, "''")}', '${kod.replace(/'/g, "''")}', ${koliVal}, '${upak}')`;
            try {
                await this.query(insertSql);
            } catch (e) {
                console.error('Ошибка вставки в sostav:', e);
            }

            // Добавляем строку в таблицу (UI)
            const tbody = document.getElementById('compositionBody');
            const index = tbody.rows.length;
            this.addCompositionRow(tbody, index);

            const codeInput = tbody.rows[index].querySelector(`input[name="comp_code_${index}"]`);
            const nameInput = tbody.rows[index].querySelector(`input[name="comp_name_${index}"]`);
            const categoryInput = tbody.rows[index].querySelector(`input[name="comp_category_${index}"]`);
            const qtyInput = tbody.rows[index].querySelector(`input[name="comp_qty_${index}"]`);
            const unitInput = tbody.rows[index].querySelector(`input[name="comp_unit_${index}"]`);
            const priceInput = tbody.rows[index].querySelector(`input[name="comp_price_${index}"]`);
            const sumInput = tbody.rows[index].querySelector(`input[name="comp_sum_${index}"]`);
            const labelInput = tbody.rows[index].querySelector(`input[name="comp_label_${index}"]`);

            if (codeInput) codeInput.value = kod;
            if (nameInput) nameInput.value = art;
            if (categoryInput) categoryInput.value = type;
            if (qtyInput) qtyInput.value = qtyValue;
            if (priceInput) priceInput.value = price;
            if (sumInput) sumInput.value = sum;
            if (labelInput) labelInput.value = name;

            // Устанавливаем чекбокс упаковки и тип строки
            const row = tbody.rows[index];
            row.setAttribute('data-cat', type);
            row.setAttribute('data-kod2', kod); // для удаления из БД
            const upakCb = row.querySelector('.upak-row-cb');
            if (upakCb) {
                upakCb.checked = isPacked;
                upakCb.disabled = (type !== 'Упаковка');
            }

            // Загружаем edizm для unit
            try {
                const unitSql = `SELECT "edizm" FROM "guide" WHERE "kod"='${kod.replace(/'/g, "''")}' LIMIT 1`;
                const unitResult = await this.query(unitSql);
                const unitLines = unitResult.trim().split('\n').filter(l => l);
                if (unitLines.length > 1) {
                    const headerParts = unitLines[0].split('\t');
                    const edizmIndex = headerParts.findIndex(h => h.trim().toLowerCase() === 'edizm');
                    const dataParts = unitLines[1].split('\t');
                    const edizm = (edizmIndex >= 0 ? dataParts[edizmIndex] : '') || '';
                    if (unitInput) unitInput.value = edizm;
                }
            } catch (e) {
                console.warn('Не удалось загрузить ед.изм:', e);
            }

            this.calculateCost();
            this.closeAddCompositionModal();
        })();
    },

    bindEditImageEvents() {
        const container = document.getElementById('editImageContainer');
        const fileInput = document.getElementById('editImageUpload');

        if (!container || !fileInput) return;

        container.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const compressed = await this.compressImage(file);
                const img = document.getElementById('editPreviewImage');
                if (img) {
                    img.src = compressed;
                    container.classList.add('has-image');
                }
            } catch (err) {
                console.error('Ошибка сжатия:', err);
            }
        });
    },

    // ============================================================
    // IMAGE HANDLING - IndexedDB
    // ============================================================
    getDb() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('ImageDB', 3);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('images')) {
                    db.createObjectStore('images', { keyPath: 'kod' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
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

    async saveImageToLocalStorage(kod) {
        const img = document.getElementById('previewImage');
        if (img && img.src && img.src.startsWith('data:image')) {
            try {
                const db = await this.getDb();
                return new Promise((resolve, reject) => {
                    const tx = db.transaction('images', 'readwrite');
                    tx.objectStore('images').put({ kod, data: img.src });
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                });
            } catch (e) {
                // ignore
            }
        }

        const editImg = document.getElementById('editPreviewImage');
        if (editImg && editImg.src && editImg.src.startsWith('data:image') && kod) {
            try {
                const db = await this.getDb();
                return new Promise((resolve, reject) => {
                    const tx = db.transaction('images', 'readwrite');
                    tx.objectStore('images').put({ kod, data: editImg.src });
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                });
            } catch (e) {
                // ignore
            }
        }
    },

    async loadImageFromLocalStorage(kod) {
        try {
            const db = await this.getDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('images', 'readonly');
                const request = tx.objectStore('images').get(kod);
                request.onsuccess = () => {
                    if (request.result && request.result.data) {
                        const img = document.getElementById('previewImage');
                        const container = document.getElementById('imageContainer');
                        if (img) {
                            img.src = request.result.data;
                            if (container) container.classList.add('has-image');
                        }

                        const editImg = document.getElementById('editPreviewImage');
                        const editContainer = document.getElementById('editImageContainer');
                        if (editImg) {
                            editImg.src = request.result.data;
                            if (editContainer) editContainer.classList.add('has-image');
                        }
                    }
                    resolve();
                };
                request.onerror = () => reject(request.error);
            });
        } catch (e) {
            resolve();
        }
    },

    async deleteImageFromStorage(kod) {
        try {
            const db = await this.getDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('images', 'readwrite');
                tx.objectStore('images').delete(kod);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) {
            console.error('Ошибка удаления изображения:', e);
        }
    },

    bindImageEvents() {
        const container = document.getElementById('imageContainer');
        const fileInput = document.getElementById('imageUpload');
        const deleteBtn = document.getElementById('deleteImageBtn');

        if (!container || !fileInput) return;
        if (!deleteBtn) return;

        container.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const compressed = await this.compressImage(file);
                const img = document.getElementById('previewImage');
                if (img) {
                    img.src = compressed;
                    container.classList.add('has-image');
                }
            } catch (err) {
                console.error('Ошибка сжатия:', err);
            }
        });

        deleteBtn.addEventListener('click', () => {
            const img = document.getElementById('previewImage');
            const kodInput = document.querySelector('input[name="kod"]');
            const kod = this.currentKod || (kodInput ? kodInput.value : null);
            if (kod) {
                this.deleteImageFromStorage(kod);
            }
            if (img) {
                img.src = '';
            }
            fileInput.value = '';
            container.classList.remove('has-image');
        });
    },

    calculateCost() {
        let total = 0;
        const sumInputs = document.querySelectorAll('input[name^="comp_sum_"]');
        sumInputs.forEach(input => {
            const val = parseFloat(input.value);
            if (!isNaN(val)) {
                total += val;
            }
        });
        const costPrice = document.getElementById('costPrice');
        if (costPrice) {
            costPrice.value = total > 0 ? total.toFixed(2) : '';
        }
    },

    bindCompositionEvents() {
        const tbody = document.getElementById('compositionBody');
        // Используем делегирование событий, чтобы работать и с новыми строками
        tbody.addEventListener('input', (e) => {
            if (e.target.matches('input[name^="comp_"]')) {
                this.calculateCost();
            }
        });
        this.calculateCost();
    },

    bindEvents() {
        document.getElementById('backBtn').addEventListener('click', () => {
            window.location.href = 'guide.html';
        });

        document.getElementById('addCompositionFromGuide').addEventListener('click', () => {
            this.openAddCompositionModal();
        });

        document.getElementById('cancelForm').addEventListener('click', () => {
            window.location.href = 'guide.html';
        });

        document.getElementById('recordForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveRecord();
        });

        // Модальное окно добавления состава
        document.getElementById('closeAddCompositionModal').addEventListener('click', () => {
            this.closeAddCompositionModal();
        });

        document.getElementById('cancelAddComposition').addEventListener('click', () => {
            if (this.duplicateDecisionData) {
                this.clearDuplicateAndComposition();
            } else {
                this.closeAddCompositionModal();
            }
        });

        document.getElementById('clearModalFields').addEventListener('click', () => {
            this.clearAddCompositionModal();
        });

        document.getElementById('saveAddComposition').addEventListener('click', () => {
            this.saveAddComposition();
        });

        document.getElementById('addCompositionModal').addEventListener('click', (e) => {
            if (e.target.classList.contains('edit-product-modal-overlay')) {
                if (this.duplicateDecisionData) {
                    this.clearDuplicateAndComposition();
                } else {
                    this.closeAddCompositionModal();
                }
            }
        });

        // Модальное окно дубликата
        document.getElementById('dupAddToQty').addEventListener('click', () => {
            this.handleDuplicateAddToQty();
        });

        document.getElementById('dupAddNew').addEventListener('click', () => {
            this.handleDuplicateAddNew();
        });

        document.getElementById('dupCancel').addEventListener('click', () => {
            this.clearDuplicateAndComposition();
        });

        document.querySelector('#duplicateModal .btn-modal-close').addEventListener('click', () => {
            this.clearDuplicateAndComposition();
        });

        document.getElementById('duplicateModal').addEventListener('click', (e) => {
            if (e.target.classList.contains('edit-product-modal-overlay')) {
                this.clearDuplicateAndComposition();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const modal = document.getElementById('addCompositionModal');
                if (modal.style.display === 'flex') {
                    this.closeAddCompositionModal();
                } else {
                    window.location.href = 'guide.html';
                }
            }
        });
    }
};

document.addEventListener('DOMContentLoaded', () => {
    GUIDE_ADD.init();
});
