// ============================================================
// MASS UPLOAD - JavaScript
// ============================================================

const MASS_UPLOAD = {
    serverIp: '',
    userId: '',
    selectedStoreId: null,
    selectedStoreName: '',
    selectedStoreSettings: null,
    currentFile: null,
    currentFileHash: '',
    csvHeaders: [],
    csvRows: [],
    analyzedData: [], // [{kod, name, qty, status, rowIdx, originalWkodMap}]
    assignRowIndex: null, // Индекс строки для присвоения
    conflicts: [], // Конфликты: [{ourKod, csvKods: []}]
    deletedConflictCodes: [], // Удалённые коды
    isBlocked: false,
    blockReason: '',

    // ============================================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================================
    init() {
        this.serverIp = localStorage.getItem('serverIp') || '';
        this.userId = localStorage.getItem('userId') || '';
        if (!this.serverIp) {
            window.location.href = 'login.html';
            return;
        }
        this.bindEvents();
    },

    // ============================================================
    // СОБЫТИЯ
    // ============================================================
    bindEvents() {
        document.getElementById('backBtn').addEventListener('click', () => {
            window.history.back();
        });

        // Разрешить конфликт
        const resolveConflictBtn = document.getElementById('resolveConflictBtn');
        if (resolveConflictBtn) {
            resolveConflictBtn.addEventListener('click', () => {
                this.openConflictModal();
            });
        }

        // Управление профилями
        const manageProfilesBtn = document.getElementById('manageProfilesBtn');
        if (manageProfilesBtn) {
            manageProfilesBtn.addEventListener('click', () => {
                window.location.href = 'column-config.html';
            });
        }

        // Просмотр файла (основная кнопка)
        const viewFileBtn = document.getElementById('viewFileBtn');
        if (viewFileBtn) {
            viewFileBtn.addEventListener('click', () => {
                this.openViewFileModal();
            });
        }

        // Просмотр файла (кнопка в модалке конфликтов)
        const viewFileBtnConflict = document.getElementById('viewFileBtnConflict');
        if (viewFileBtnConflict) {
            viewFileBtnConflict.addEventListener('click', () => {
                this.openViewFileModal();
            });
        }

        // Закрытие модалки просмотра файла
        const closeViewFileBtn = document.getElementById('closeViewFileBtn');
        if (closeViewFileBtn) {
            closeViewFileBtn.addEventListener('click', () => {
                this.closeViewFileModal();
            });
        }

        const viewFileModalClose = document.getElementById('closeViewFileModalX');
        if (viewFileModalClose) {
            viewFileModalClose.addEventListener('click', () => {
                this.closeViewFileModal();
            });
        }

        const viewFileModal = document.getElementById('viewFileModal');
        if (viewFileModal) {
            viewFileModal.addEventListener('click', (e) => {
                if (e.target.classList.contains('mass-upload-modal-overlay')) {
                    this.closeViewFileModal();
                }
            });
        }

        // Изменение выбора колонок
        ['viewCol1', 'viewCol2', 'viewCol3'].forEach(id => {
            const select = document.getElementById(id);
            if (select) {
                select.addEventListener('change', () => {
                    this.renderViewFileTable();
                });
            }
        });

        // Поиск по файлу
        const viewFileSearchInput = document.getElementById('viewFileSearch');
        const viewFileSearchClear = document.getElementById('viewFileSearchClear');
        if (viewFileSearchInput) {
            viewFileSearchInput.addEventListener('input', () => {
                this.filterViewFile();
            });
        }
        if (viewFileSearchClear) {
            viewFileSearchClear.addEventListener('click', () => {
                viewFileSearchInput.value = '';
                this.filterViewFile();
            });
        }

        // Загружаем и сохраняем настройки чекбоксов
        this.loadDuplicateSettings();

        // Присвоение (делегирование событий для кнопок в динамической таблице)
        document.getElementById('previewBody').addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-assign')) {
                const rowIndex = parseInt(e.target.dataset.row);
                this.openAssignModal(rowIndex);
            }
        });

        // Закрытие модалки присвоения
        const assignCancelBtn = document.getElementById('assignCancelBtn');
        if (assignCancelBtn) {
            assignCancelBtn.addEventListener('click', () => {
                this.closeAssignModal();
            });
        }

        const assignModal = document.getElementById('assignModal');
        if (assignModal) {
            assignModal.addEventListener('click', (e) => {
                if (e.target.classList.contains('mass-upload-modal-overlay')) {
                    this.closeAssignModal();
                }
            });
        }

        const assignModalClose = assignModal?.querySelector('.btn-modal-close');
        if (assignModalClose) {
            assignModalClose.addEventListener('click', () => {
                this.closeAssignModal();
            });
        }

        // Сохранение присвоения
        const assignSaveBtn = document.getElementById('assignSaveBtn');
        if (assignSaveBtn) {
            assignSaveBtn.addEventListener('click', () => {
                this.saveAssign();
            });
        }

        // Выбор артикула в модалке (кастомный select)
        const assignArtSelectWrap = document.getElementById('assignArtSelectWrap');
        if (assignArtSelectWrap) {
            const trigger = assignArtSelectWrap.querySelector('.custom-select-trigger');
            if (trigger) {
                trigger.addEventListener('click', (e) => {
                    e.stopPropagation();
                    assignArtSelectWrap.classList.toggle('open');
                });
            }
        }

        // Закрытие кастомного select при клике вне
        document.addEventListener('click', () => {
            document.querySelectorAll('.custom-select.open').forEach(sel => {
                sel.classList.remove('open');
            });
        });

        // Предотвращаем закрытие при клике внутри custom-select
        const optionsContainer = document.querySelector('.custom-select-options');
        if (optionsContainer) {
            optionsContainer.addEventListener('click', (e) => e.stopPropagation());
        }

        // Сохранение разрешения конфликта
        const saveConflictBtn = document.getElementById('saveConflictBtn');
        if (saveConflictBtn) {
            saveConflictBtn.addEventListener('click', () => {
                this.saveConflictResolution();
            });
        }

        const closeConflictBtn = document.getElementById('closeConflictBtn');
        if (closeConflictBtn) {
            closeConflictBtn.addEventListener('click', () => {
                this.closeConflictModal();
            });
        }

        const conflictModal = document.getElementById('conflictModal');
        if (conflictModal) {
            conflictModal.addEventListener('click', (e) => {
                if (e.target.classList.contains('mass-upload-modal-overlay')) {
                    this.closeConflictModal();
                }
            });
        }

        const conflictModalClose = conflictModal?.querySelector('.btn-modal-close');
        if (conflictModalClose) {
            conflictModalClose.addEventListener('click', () => {
                this.closeConflictModal();
            });
        }

        // Drag & Drop
        const dropZone = document.getElementById('dropZone');
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) this.handleFile(files[0]);
        });
        dropZone.addEventListener('click', (e) => {
            if (e.target.tagName !== 'BUTTON') {
                document.getElementById('fileInput').click();
            }
        });

        // File input
        document.getElementById('fileInput').addEventListener('change', (e) => {
            if (e.target.files.length > 0) this.handleFile(e.target.files[0]);
        });

        // Remove file
        document.getElementById('removeFile').addEventListener('click', () => {
            this.removeFile();
        });

        // Column selectors
        document.getElementById('analyzeBtn').addEventListener('click', () => {
            this.analyzeFile();
        });
        document.getElementById('cancelStep2').addEventListener('click', () => {
            this.resetAll();
        });

        // Confirm / Cancel
        document.getElementById('confirmUpload').addEventListener('click', () => {
            this.confirmUpload();
        });
        document.getElementById('cancelUpload').addEventListener('click', () => {
            this.cancelAll();
        });

        // Finish / New
        document.getElementById('finishBtn').addEventListener('click', () => {
            window.location.href = 'warehouse.html';
        });
        document.getElementById('newUploadBtn').addEventListener('click', () => {
            this.resetAll();
        });
    },

    // ============================================================
    // НАСТРОЙКИ ПРОВЕРКИ ДУБЛИКАТОВ (localStorage)
    // ============================================================
    loadDuplicateSettings() {
        // Восстанавливаем состояние чекбоксов из localStorage
        const chkByName = document.getElementById('chkCheckByName');
        const chkByContent = document.getElementById('chkCheckByContent');

        if (chkByName) {
            const savedByName = localStorage.getItem('mass_upload_checkByName');
            chkByName.checked = savedByName === null ? true : (savedByName === 'true');
            console.log('📥 Загружена настройка checkByName:', chkByName.checked);
        }

        if (chkByContent) {
            const savedByContent = localStorage.getItem('mass_upload_checkByContent');
            chkByContent.checked = savedByContent === null ? true : (savedByContent === 'true');
            console.log('📥 Загружена настройка checkByContent:', chkByContent.checked);
        }

        // Вешаем обработчики на изменение
        if (chkByName) {
            chkByName.addEventListener('change', () => {
                this.saveDuplicateSettings();
                console.log('✅ Сохранена настройка checkByName:', chkByName.checked);
            });
        }

        if (chkByContent) {
            chkByContent.addEventListener('change', () => {
                this.saveDuplicateSettings();
                console.log('✅ Сохранена настройка checkByContent:', chkByContent.checked);
            });
        }
    },

    saveDuplicateSettings() {
        const chkByName = document.getElementById('chkCheckByName');
        const chkByContent = document.getElementById('chkCheckByContent');

        if (chkByName) {
            localStorage.setItem('mass_upload_checkByName', chkByName.checked.toString());
        }
        if (chkByContent) {
            localStorage.setItem('mass_upload_checkByContent', chkByContent.checked.toString());
        }
    },

    // ============================================================
    // ОБРАБОТКА ФАЙЛА
    // ============================================================
    handleFile(file) {
        this.currentFile = file;
        this.isBlocked = false;
        this.blockReason = '';

        // Определяем расширение
        const ext = '.' + file.name.split('.').pop().toLowerCase();

        // Показываем имя файла
        document.getElementById('fileName').style.display = 'flex';
        document.querySelector('.file-name-text').textContent = file.name;
        document.getElementById('removeFile').style.display = 'inline-flex';

        // Читаем файл
        if (ext === '.xlsx' || ext === '.xls') {
            // Excel файл
            const reader = new FileReader();
            reader.onload = (e) => {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                this.parseExcel(workbook).catch(err => console.error('parseExcel error:', err));
            };
            reader.readAsArrayBuffer(file);
        } else {
            // CSV файл
            const reader = new FileReader();
            reader.onload = (e) => {
                const text = e.target.result;
                this.currentFileHash = this.simpleHash(text);
                this.parseCSV(text);
            };
            reader.readAsText(file, 'UTF-8');
        }
    },

    removeFile() {
        this.currentFile = null;
        this.currentFileHash = '';
        document.getElementById('fileName').style.display = 'none';
        document.getElementById('fileInput').value = '';
        this.hideAllSteps();
    },

    // ============================================================
    // ПАРСИНГ CSV (разделитель ;)
    // ============================================================
    parseCSV(text) {
        const lines = text.split(/\r?\n/).filter(line => line.trim());
        if (lines.length < 2) {
            alert('Файл пуст или содержит менее 2 строк.');
            return;
        }

        // Парсим заголовки (первая строка)
        this.csvHeaders = this.parseCSVLine(lines[0]);

        // Парсим данные — НЕ фильтруем, сохраняем индексы
        this.csvRows = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = this.parseCSVLine(lines[i]);
            if (cols.length >= 1) {
                this.csvRows.push(cols);
            }
        }

        if (this.csvRows.length === 0) {
            alert('Файл не содержит данных.');
            return;
        }

        // Показываем шаг 2
        this.hideAllSteps();
        document.getElementById('step2').style.display = 'block';

        // Заполняем селекторы заголовками
        this.populateColumnSelectors();

        // Автоматически определяем магазин по совпадению колонок
        this.autoMatchStore().catch(err => console.error('autoMatchStore error:', err));
    },

    parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i++; // Пропускаем вторую кавычку
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
    // ПАРСИНГ EXCEL
    // ============================================================
    async parseExcel(workbook) {
        // Берём первый лист
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
            alert('Файл не содержит листов!');
            return;
        }

        const worksheet = workbook.Sheets[firstSheetName];

        // Конвертируем в JSON (массив массивов)
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

        if (jsonData.length < 2) {
            alert('Файл пуст или содержит менее 2 строк.');
            return;
        }

        // Заголовки (первая строка) — убираем пустые
        this.csvHeaders = jsonData[0]
            .map(h => String(h !== undefined && h !== null ? h : '').trim())
            .filter(h => h);

        if (this.csvHeaders.length === 0) {
            alert('Не удалось найти заголовки колонок!');
            return;
        }

        // Данные — НЕ фильтруем пустые, чтобы сохранить индексы колонок!
        this.csvRows = [];
        for (let i = 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            if (row && row.length > 0) {
                // Конвертируем всё в строки, но сохраняем пустые ячейки
                const rowStrings = row.map(cell => {
                    if (cell === undefined || cell === null) return '';
                    if (cell instanceof Date) return cell.toLocaleDateString('ru-RU');
                    return String(cell).trim();
                });
                this.csvRows.push(rowStrings);
            }
        }

        if (this.csvRows.length === 0) {
            alert('Файл не содержит данных!');
            return;
        }

        // Хэш файла
        this.currentFileHash = this.simpleHash(this.currentFile.name + JSON.stringify(this.csvRows[0]));

        // Показываем шаг 2
        this.hideAllSteps();
        document.getElementById('step2').style.display = 'block';

        // Заполняем селекторы заголовками
        this.populateColumnSelectors();

        // Автоматически определяем магазин по совпадению колонок
        await this.autoMatchStore();
    },

    // ============================================================
    // АВТООПРЕДЕЛЕНИЕ МАГАЗИНА ПО СОВОПАДЕНИЮ КОЛОНОК
    // ============================================================
    async autoMatchStore() {
        try {
            const sql = `SELECT "id", "store_name", "kod_col", "name_col", "qty_col" FROM "mass_upload" WHERE "type"='config' ORDER BY "store_name"`;
            const result = await this.query(sql);
            const lines = result.trim().split('\n').filter(l => l);

            if (lines.length <= 1) {
                const suggest = document.getElementById('autoSuggest');
                if (suggest) suggest.textContent = 'Профили магазинов не найдены. Выберите колонки вручную.';
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

                // Считаем сколько колонок совпадает
                let score = 0;
                if (store.kod_col) score += this.matchColumn(store.kod_col);
                if (store.name_col) score += this.matchColumn(store.name_col);
                if (store.qty_col) score += this.matchColumn(store.qty_col);

                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = store;
                }
            }

            if (bestMatch && bestScore > 0) {
                // Нашли совпадение!
                this.selectedStoreId = bestMatch.id;
                this.selectedStoreName = bestMatch.name;
                this.selectedStoreSettings = {
                    kod_col: bestMatch.kod_col,
                    name_col: bestMatch.name_col,
                    qty_col: bestMatch.qty_col
                };

                // Показываем бейдж магазина
                this.showSelectedStore();

                // Автовыбираем колонки
                this.autoSelectColumn('kodColumnSelect', bestMatch.kod_col);
                if (bestMatch.qty_col) {
                    this.autoSelectColumn('qtyColumnSelect', bestMatch.qty_col);
                }

                // Подсвечиваем что нашли
                const suggest = document.getElementById('autoSuggest');
                if (suggest) {
                    suggest.innerHTML =
                        `✅ Магазин <strong>${this.escapeHtml(bestMatch.name)}</strong> найден! ` +
                        (bestScore >= 2 ? '(совпало несколько колонок)' : '(совпала 1 колонка)');
                }
            } else {
                const suggest = document.getElementById('autoSuggest');
                if (suggest) suggest.textContent = 'Магазин не определён. Выберите колонки вручную.';
            }
        } catch (error) {
            console.error('Ошибка автоопределения магазина:', error);
            const suggest = document.getElementById('autoSuggest');
            if (suggest) suggest.textContent = 'Ошибка определения магазина. Выберите колонки вручную.';
        }
    },

    // Проверяет, есть ли имя колонки в заголовках файла
    matchColumn(columnName) {
        if (!columnName) return 0;
        const normalized = columnName.toLowerCase().trim();

        for (const header of this.csvHeaders) {
            const h = header.toLowerCase().trim();
            if (h === normalized || h.includes(normalized) || normalized.includes(h)) {
                return 1;
            }
        }
        return 0;
    },

    // ============================================================
    // ПОКАЗАТЬ ВЫБРАННЫЙ МАГАЗИН
    // ============================================================
    showSelectedStore() {
        if (!this.selectedStoreId) return;

        const info = document.getElementById('selectedStoreInfo');
        if (!info) return;

        const nameEl = info.querySelector('.store-name');
        if (!nameEl) return;

        nameEl.textContent = this.selectedStoreName;
        info.style.display = 'block';
    },

    // ============================================================
    // ЗАГРУЗКА ИЗОБРАЖЕНИЙ ИЗ INDEXEDDB
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

    async loadImageFromStorage(kod) {
        try {
            const db = await this.getDb();
            return new Promise((resolve) => {
                const tx = db.transaction('images', 'readonly');
                const request = tx.objectStore('images').get(kod);
                request.onsuccess = () => {
                    if (request.result && request.result.data) {
                        resolve(request.result.data);
                    } else {
                        resolve(null);
                    }
                };
                request.onerror = () => resolve(null);
            });
        } catch (e) {
            console.error('Ошибка загрузки изображения:', e);
            return null;
        }
    },

    // ============================================================
    // ПРИСВОЕНИЕ ТОВАРА (МОДАЛКА)
    // ============================================================
    async openAssignModal(rowIndex) {
        this.assignRowIndex = rowIndex;
        const item = this.analyzedData[rowIndex];

        if (!item || item.status !== 'not-found') return;

        // Заполняем информацию
        document.getElementById('assignForeignKod').textContent = item.csvKod;

        // Загружаем товары из guide
        await this.loadGuideProducts();

        // Открываем модалку
        document.getElementById('assignModal').style.display = 'flex';
    },

    closeAssignModal() {
        document.getElementById('assignModal').style.display = 'none';
        this.assignRowIndex = null;
    },

    async loadGuideProducts() {
        const wrap = document.getElementById('assignArtSelectWrap');
        const optionsContainer = wrap.querySelector('.custom-select-options');
        optionsContainer.innerHTML = '<div class="custom-select-option" data-value="" data-label="— Выберите артикул —" data-kod="" data-art="" data-name="">— Выберите артикул —</div>';

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
                option.className = 'custom-select-option';
                option.setAttribute('data-value', kod);
                option.setAttribute('data-kod', kod);
                option.setAttribute('data-art', art);
                option.setAttribute('data-name', name);
                option.textContent = `${art} — ${name}`;

                option.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.selectCustomOption(wrap, option);
                });

                optionsContainer.appendChild(option);
            }
        } catch (error) {
            console.error('Ошибка загрузки товаров:', error);
        }
    },

    selectCustomOption(wrap, option) {
        // Снимаем выделение со всех
        wrap.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('selected'));
        // Выделяем текущий
        option.classList.add('selected');
        // Сохраняем значение
        const value = option.getAttribute('data-value') || '';
        const kod = option.getAttribute('data-kod') || '';
        const art = option.getAttribute('data-art') || '';
        const name = option.getAttribute('data-name') || '';

        document.getElementById('assignArtSelect').value = value;
        wrap.querySelector('.custom-select-value').textContent = option.textContent;

        // Добавляем класс для показа выбранного значения
        if (value) {
            wrap.classList.add('has-value');
        }

        // Закрываем dropdown
        wrap.classList.remove('open');

        // Вызываем обработку выбора
        this.onAssignArtSelectChange();
    },

    async onAssignArtSelectChange() {
        const hiddenInput = document.getElementById('assignArtSelect');
        const value = hiddenInput.value;
        const wrap = document.getElementById('assignArtSelectWrap');

        if (!value) {
            // Сброс полей
            document.getElementById('assignKodInput').value = '';
            document.getElementById('assignNameInput').value = '';
            document.getElementById('assignImagePlaceholder').style.display = 'flex';
            document.getElementById('assignImage').style.display = 'none';
            document.getElementById('assignImageContainer').classList.remove('has-image');
            return;
        }

        const selectedOption = wrap.querySelector('.custom-select-option.selected');
        const kod = selectedOption ? selectedOption.getAttribute('data-kod') || '' : '';
        const art = selectedOption ? selectedOption.getAttribute('data-art') || '' : '';
        const name = selectedOption ? selectedOption.getAttribute('data-name') || '' : '';

        document.getElementById('assignKodInput').value = kod;
        document.getElementById('assignNameInput').value = name;

        // Показываем placeholder по умолчанию
        document.getElementById('assignImagePlaceholder').style.display = 'flex';
        document.getElementById('assignImage').style.display = 'none';
        document.getElementById('assignImageContainer').classList.remove('has-image');

        // Загружаем изображение из IndexedDB
        if (kod) {
            const imageData = await this.loadImageFromStorage(kod);
            if (imageData) {
                document.getElementById('assignImage').src = imageData;
                document.getElementById('assignImage').style.display = 'block';
                document.getElementById('assignImagePlaceholder').style.display = 'none';
                document.getElementById('assignImageContainer').classList.add('has-image');
            }
        }
    },

    async saveAssign() {
        const rowIndex = this.assignRowIndex;
        const item = this.analyzedData[rowIndex];

        if (!item) return;

        const kod = document.getElementById('assignKodInput').value.trim();
        const art = document.getElementById('assignArtSelect').value.trim();

        // Валидация
        if (!kod || !art) {
            alert('Заполните обязательные поля: Артикул и Код!');
            return;
        }

        try {
            // Проверяем, существует ли уже запись в wnes kod
            const checkSql = `SELECT "id" FROM "wneshkod" WHERE "wkod"='${item.csvKod.replace(/'/g, "''")}'`;
            const checkResult = await this.query(checkSql);
            const checkLines = checkResult.trim().split('\n').filter(l => l);

            let sql;
            if (checkLines.length > 1) {
                // Обновляем существующую запись
                const id = checkLines[1].split('\t')[0];
                sql = `UPDATE "wneshkod" SET "kod"=${kod} WHERE "id"=${id}`;
            } else {
                // Создаём новую запись
                sql = `INSERT INTO "wneshkod" ("kod", "wkod") VALUES (${kod}, '${item.csvKod.replace(/'/g, "''")}')`;
            }

            await this.query(sql);

            // Обновляем локальные данные
            item.status = 'found';
            item.ourKod = kod;

            // Показываем уведомление и закрываем модалку
            this.showToast('✅ Присвоено');
            this.closeAssignModal();

            // Автоматически перезапускаем анализ
            await this.analyzeFile();
            return;

        } catch (error) {
            console.error('Ошибка присвоения:', error);
        }
    },

    // ============================================================
    // КОНФЛИКТЫ ЗАГРУЖЕННЫХ ТОВАРОВ (ПЕРЕПИСАНО С НУЛЯ)
    // ============================================================

    showConflictWarning() {
        const warning = document.getElementById('conflictWarning');
        if (!warning) return;
        warning.style.display = 'flex';
        // updateConfirmButtonState() вызовется после анализа и сама установит disabled
    },

    openConflictModal() {
        const modal = document.getElementById('conflictModal');
        if (!modal) return;

        const conflictsList = document.getElementById('conflictsList');
        conflictsList.innerHTML = '<div class="loading-state">Загрузка данных...</div>';
        modal.style.display = 'flex';
        this.deletedConflictCodes = []; // Очищаем список удалённых

        this.loadConflictData();
    },

    async loadConflictData() {
        const conflictsList = document.getElementById('conflictsList');

        try {
            const conflictsData = await this.getConflictData();

            if (conflictsData.length === 0) {
                conflictsList.innerHTML = '<div class="loading-state">Конфликтов не найдено</div>';
                return;
            }

            // Формируем HTML для каждого конфликта
            let html = '';
            for (let c = 0; c < conflictsData.length; c++) {
                const conflict = conflictsData[c];
                html += `<div class="conflict-item" data-conflict-id="${c}">`;
                html += `<div class="conflict-our-product">`;
                html += `<div class="label">Наш товар:</div>`;
                html += `<div class="value">`;
                html += `Код: ${this.escapeHtml(conflict.ourKod)} | `;
                html += `Артикул: ${this.escapeHtml(conflict.art)} | `;
                if (conflict.name) {
                    html += `Название: ${this.escapeHtml(conflict.name)}`;
                }
                html += `</div></div>`;

                html += `<div class="conflict-foreign-codes">`;
                html += `<div class="label">Вражеские коды (нажмите "×" чтобы удалить):</div>`;

                for (let k = 0; k < conflict.csvKods.length; k++) {
                    const csvKod = conflict.csvKods[k];
                    html += `<div class="conflict-code-row">`;
                    html += `<span class="code">${this.escapeHtml(csvKod)}</span>`;
                    // Важно: используем data-атрибуты для идентификации
                    html += `<button type="button" class="btn-delete" `;
                    html += `data-conflict-id="${c}" data-kod-index="${k}" data-code="${this.escapeHtml(csvKod)}">`;
                    html += `× Удалить</button>`;
                    html += `</div>`;
                }

                html += `</div></div>`;
            }

            conflictsList.innerHTML = html;

            // Теперь вешаем обработчики на кнопки
            this.bindConflictButtons();

        } catch (error) {
            console.error('Ошибка загрузки конфликтов:', error);
            conflictsList.innerHTML = `<div class="loading-state" style="color: #e74c3c;">Ошибка: ${error.message}</div>`;
        }
    },

    bindConflictButtons() {
        const deleteButtons = document.querySelectorAll('.btn-delete');
        console.log('Найдено кнопок удаления:', deleteButtons.length);

        deleteButtons.forEach(btn => {
            // Удаляем старые обработчики (если есть)
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);

            newBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const conflictId = parseInt(newBtn.dataset.conflictId);
                const kodIndex = parseInt(newBtn.dataset.kodIndex);
                const code = newBtn.dataset.code;

                console.log('Клик по кнопке! conflictId:', conflictId, 'kodIndex:', kodIndex, 'code:', code);

                if (!newBtn.disabled) {
                    this.deleteConflictCode(conflictId, kodIndex, code);
                }
            });
        });

        // Обработчик на кнопку "Закрыть" (×)
        const closeBtn = document.getElementById('closeConflictModalX');
        if (closeBtn) {
            const newCloseBtn = closeBtn.cloneNode(true);
            closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
            newCloseBtn.addEventListener('click', () => {
                this.closeConflictModal();
            });
        }

        // Обработчик на кнопку "Закрыть" (внизу)
        const closeBottomBtn = document.getElementById('closeConflictBtn');
        if (closeBottomBtn) {
            const newCloseBottomBtn = closeBottomBtn.cloneNode(true);
            closeBottomBtn.parentNode.replaceChild(newCloseBottomBtn, closeBottomBtn);
            newCloseBottomBtn.addEventListener('click', () => {
                this.closeConflictModal();
            });
        }

        // Обработчик на кнопку "Сохранить"
        const saveBtn = document.getElementById('saveConflictBtn');
        if (saveBtn) {
            const newSaveBtn = saveBtn.cloneNode(true);
            saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
            newSaveBtn.addEventListener('click', () => {
                this.saveConflictResolution();
            });
        }
    },

    // ============================================================
    // ОБНОВЛЕНИЕ СОСТОЯНИЯ КНОПКИ "ПОДТВЕРДИТЬ ЗАГРУЗКУ"
    // ============================================================
    updateConfirmButtonState() {
        const btn = document.getElementById('confirmUpload');
        if (!btn) return;

        // Проверяем, есть ли найденные коды
        const foundCount = this.analyzedData.filter(d => d.status === 'found').length;

        // Проверяем, есть ли ненайденные коды
        const notFoundCount = this.analyzedData.filter(d => d.status === 'not-found').length;

        // Проверяем, есть ли конфликты (любые, даже частично разрешённые)
        const hasConflicts = this.conflicts && this.conflicts.length > 0;

        // Кнопка активна ТОЛЬКО если:
        // - есть хотя бы один найденный товар
        // - нет ненайденных кодов (все найдены или присвоены)
        // - нет конфликтов
        // - нет блокировки (дубликат разрешён или не обнаружен)
        const isReady = foundCount > 0 && notFoundCount === 0 && !hasConflicts && !this.isBlocked;

        btn.disabled = !isReady;

        console.log('🔍 Состояние кнопки:', { 
            foundCount, 
            notFoundCount, 
            hasConflicts, 
            isBlocked: this.isBlocked, 
            isReady 
        });
    },

    closeConflictModal() {
        const modal = document.getElementById('conflictModal');
        if (modal) {
            modal.style.display = 'none';
        }
    },

    deleteConflictCode(conflictId, kodIndex, code) {
        console.log('Удаляем код:', code);

        // Помечаем кнопку как удалённую
        const buttons = document.querySelectorAll('.btn-delete');
        buttons.forEach(btn => {
            if (btn.dataset.conflictId == conflictId && btn.dataset.kodIndex == kodIndex) {
                btn.disabled = true;
                btn.classList.add('deleted');
                btn.innerHTML = '✓ Удалён';
            }
        });

        // Запоминаем, что этот код нужно удалить из БД
        this.deletedConflictCodes.push({
            conflictId: conflictId,
            kodIndex: kodIndex,
            code: code
        });

        console.log('Удалённые коды:', this.deletedConflictCodes);
    },

    async saveConflictResolution() {
        if (this.deletedConflictCodes.length === 0) {
            return;
        }

        try {
            let deletedCount = 0;

            for (const item of this.deletedConflictCodes) {
                // Удаляем из БД
                const sql = `DELETE FROM "wneshkod" WHERE "wkod"='${item.code.replace(/'/g, "''")}'`;
                await this.query(sql);
                deletedCount++;

                // Помечаем как not-found в текущем анализе
                const index = this.analyzedData.findIndex(d => d.csvKod === item.code);
                if (index !== -1) {
                    this.analyzedData[index].ourKod = null;
                    this.analyzedData[index].art = null;
                    this.analyzedData[index].status = 'not-found';
                }
            }

            this.showToast('✅ Сохранено');
            this.closeConflictModal();
            document.getElementById('conflictWarning').style.display = 'none';

            // Очищаем конфликты после разрешения
            this.conflicts = [];

            // Автоматически перезапускаем анализ
            await this.analyzeFile();

        } catch (error) {
            console.error('Ошибка сохранения:', error);
        }
    },

    async getConflictData() {
        const data = [];

        for (const conflict of this.conflicts) {
            const { ourKod, csvKods } = conflict;

            const sql = `SELECT "kod", "art", "NAME" FROM "guide" WHERE "kod"=${ourKod} AND "type"='Товар'`;
            const result = await this.query(sql);
            const lines = result.trim().split('\n').filter(l => l);

            let art = '';
            let name = '';
            if (lines.length >= 2) {
                const cols = lines[1].split('\t');
                art = cols[1] || '';
                name = cols[2] || '';
            }

            data.push({
                ourKod,
                art,
                name,
                csvKods: [...csvKods]
            });
        }

        return data;
    },

    // ============================================================
    // СЕЛЕКТОРЫ КОЛОНОК
    // ============================================================
    populateColumnSelectors() {
        const kodSelect = document.getElementById('kodColumnSelect');
        const qtySelect = document.getElementById('qtyColumnSelect');

        kodSelect.innerHTML = '<option value="">— Выберите —</option>';
        qtySelect.innerHTML = '<option value="">Нет (по умолчанию = 1)</option>';

        this.csvHeaders.forEach((header, index) => {
            if (!header) return;
            const option1 = document.createElement('option');
            option1.value = index;
            option1.textContent = header;
            kodSelect.appendChild(option1);

            const option2 = document.createElement('option');
            option2.value = index;
            option2.textContent = header;
            qtySelect.appendChild(option2);
        });
    },

    async autoSuggestColumns() {
        let kodCol = '';
        let nameCol = '';
        let qtyCol = '';

        // Если выбран магазин — используем его настройки
        if (this.selectedStoreId && this.selectedStoreSettings) {
            kodCol = this.selectedStoreSettings.kod_col || '';
            nameCol = this.selectedStoreSettings.name_col || '';
            qtyCol = this.selectedStoreSettings.qty_col || '';
        } else {
            // Иначе загружаем из БД (для обратной совместимости)
            try {
                const settings = await this.getColumnSettings();
                kodCol = settings.kod_col || '';
                nameCol = settings.name_col || '';
                qtyCol = settings.qty_col || '';
            } catch (error) {
                console.error('Ошибка загрузки настроек:', error);
            }
        }

        let suggestText = '';
        if (kodCol) suggestText += `Код: "${this.escapeHtml(kodCol)}" `;
        if (nameCol) suggestText += `Название: "${this.escapeHtml(nameCol)}" `;
        if (qtyCol) suggestText += `Кол-во: "${this.escapeHtml(qtyCol)}"`;

        document.getElementById('autoSuggest').textContent = suggestText || 'Настройки не указаны. Выберите колонки вручную.';

        // Автовыбор колонок по совпадению с заголовками файла
        if (kodCol) this.autoSelectColumn('kodColumnSelect', kodCol);
        if (qtyCol) this.autoSelectColumn('qtyColumnSelect', qtyCol);
    },

    autoSelectColumn(selectId, headerName) {
        if (!headerName) return;

        const select = document.getElementById(selectId);
        const normalizedInput = headerName.toLowerCase().trim();

        for (let i = 0; i < select.options.length; i++) {
            if (select.options[i].value === '') continue;
            const optionText = select.options[i].textContent.toLowerCase();

            // Точное совпадение
            if (optionText === normalizedInput) {
                select.selectedIndex = i;
                return;
            }
        }

        // Частичное совпадение
        for (let i = 0; i < select.options.length; i++) {
            if (select.options[i].value === '') continue;
            const optionText = select.options[i].textContent.toLowerCase();

            if (optionText.includes(normalizedInput) || normalizedInput.includes(optionText)) {
                select.selectedIndex = i;
                return;
            }
        }

        // По ключевым словам
        const keywords = {
            'kodColumnSelect': ['код', 'kod', 'code', 'артикул', 'art', 'sku', 'номер', 'num'],
            'qtyColumnSelect': ['кол', 'qty', 'quantity', 'количество', 'колич', 'count', 'шт', 'pcs']
        };

        const relevantKeywords = keywords[selectId] || [];
        for (let i = 0; i < select.options.length; i++) {
            if (select.options[i].value === '') continue;
            const optionText = select.options[i].textContent.toLowerCase();

            for (const kw of relevantKeywords) {
                if (optionText.includes(kw)) {
                    select.selectedIndex = i;
                    return;
                }
            }
        }
    },

    async getColumnSettings() {
        const result = await this.query('SELECT "kod_col", "name_col", "qty_col" FROM "mass_upload" WHERE "type"=\'config\' LIMIT 1');
        const lines = result.trim().split('\n').filter(l => l);

        if (lines.length >= 2) {
            const cols = lines[1].split('\t');
            return {
                kod_col: cols[0] || '',
                name_col: cols[1] || '',
                qty_col: cols[2] || ''
            };
        }

        return { kod_col: '', name_col: '', qty_col: '' };
    },

    // ============================================================
    // АНАЛИЗ ФАЙЛА
    // ============================================================
    async analyzeFile() {
        const kodColIndex = parseInt(document.getElementById('kodColumnSelect').value) || 0;
        const qtyColIndex = document.getElementById('qtyColumnSelect').value !== '' ? parseInt(document.getElementById('qtyColumnSelect').value) : -1;

        if (document.getElementById('kodColumnSelect').value === '') {
            alert('Укажите колонку с кодом товара!');
            return;
        }

        console.log('🔍 Индексы:', { kodColIndex, qtyColIndex, kodColName: this.csvHeaders[kodColIndex] });
        console.log('🔍 Пример строки:', this.csvRows[0]);

        // Скрываем предудущие результаты
        document.getElementById('step3').style.display = 'block';
        document.getElementById('blockWarning').style.display = 'none';
        document.getElementById('conflictWarning').style.display = 'none';
        document.getElementById('previewBody').innerHTML = '<tr><td colspan="6" class="loading-state">Анализ...</td></tr>';

        try {
            // Загружаем настройки колонок из БД
            const settings = await this.getColumnSettings();

            // Получаем все связи wnes kod → guide для быстрого поиска
            const wneskodMap = await this.getAllWnesKod();

            this.analyzedData = [];
            let foundCount = 0;
            let notFoundCount = 0;
            const kodMap = {}; // Для проверки конфликтов: kod → [csvKod1, csvKod2, ...]

            const kodColName = this.csvHeaders[kodColIndex];
            const qtyColName = qtyColIndex >= 0 ? this.csvHeaders[qtyColIndex] : '';

            for (let i = 0; i < this.csvRows.length; i++) {
                const row = this.csvRows[i];
                const csvKod = row[kodColIndex] || '';

                if (!csvKod) continue;

                // Ищем csvKod в wnes kod.wkod
                const wneskodRecord = wneskodMap[csvKod] || null;

                // Определяем количество
                let qty = 1;
                if (qtyColIndex >= 0 && row[qtyColIndex]) {
                    const parsed = parseInt(row[qtyColIndex].replace(',', '.'));
                    if (!isNaN(parsed) && parsed > 0) qty = parsed;
                }

                if (wneskodRecord) {
                    // Нашли в wnes kod → берём наш kod и артикул
                    this.analyzedData.push({
                        csvKod: csvKod,
                        ourKod: wneskodRecord.ourKod,
                        art: wneskodRecord.art,
                        qty: qty,
                        status: 'found',
                        rowIdx: i
                    });
                    foundCount++;
                } else {
                    // Не нашли в wnes kod
                    this.analyzedData.push({
                        csvKod: csvKod,
                        ourKod: null,
                        art: null,
                        qty: qty,
                        status: 'not-found',
                        rowIdx: i
                    });
                    notFoundCount++;
                }
            }

            // Проверяем конфликты: если в загруженном файле один наш kod ссылается на несколько разных csvKod
            // Это нужно делать по ВСЕМ found записям
            const csvKodMap = {}; // csvKod → нашKod
            const ourKodToCsvKods = {}; // ourKod → [csvKod1, csvKod2, ...]

            for (const item of this.analyzedData) {
                if (item.ourKod) {
                    // Запоминаем связь csvKod → ourKod
                    csvKodMap[item.csvKod] = item.ourKod;

                    // Группируем ourKod → все csvKod которые на него ссылаются
                    if (!ourKodToCsvKods[item.ourKod]) {
                        ourKodToCsvKods[item.ourKod] = [];
                    }
                    // Не добавляем дубликаты csvKod
                    if (!ourKodToCsvKods[item.ourKod].includes(item.csvKod)) {
                        ourKodToCsvKods[item.ourKod].push(item.csvKod);
                    }
                }
            }

            // Конфликт = один ourKod ссылается на несколько разных csvKod
            const conflicts = [];
            for (const [ourKod, csvKods] of Object.entries(ourKodToCsvKods)) {
                if (csvKods.length > 1) {
                    conflicts.push({
                        ourKod,
                        csvKods
                    });
                }
            }

            this.conflicts = conflicts; // Сохраняем для использования позже

            // Обновляем статистику
            document.getElementById('totalRows').textContent = this.csvRows.length;
            document.getElementById('foundRows').textContent = foundCount;
            document.getElementById('notFoundRows').textContent = notFoundCount;

            // Показываем конфликты, если есть
            if (this.conflicts && this.conflicts.length > 0) {
                this.showConflictWarning();
            }

            // Проверяем защиту от повторной загрузки
            const blockInfo = await this.checkUploadProtection();
            if (blockInfo.blocked) {
                this.isBlocked = true;
                this.blockReason = blockInfo.reason;
                this.showBlockWarning(blockInfo.reason);
            } else {
                this.isBlocked = false;
            }

            // Отрисовываем таблицу
            this.renderPreviewTable();

            // Обновляем состояние кнопки (единый вызов — учитывает все условия)
            this.updateConfirmButtonState();

        } catch (error) {
            console.error('Ошибка анализа:', error);
            alert('Ошибка анализа файла: ' + error.message);
        }
    },

    async getAllWnesKod() {
        // Загружаем wnes kod с артикулами из guide
        const result = await this.query(`
            SELECT w.kod, w.wkod, g.art 
            FROM "wneshkod" w 
            LEFT JOIN "guide" g ON w.kod = g.kod
        `);
        const lines = result.trim().split('\n').filter(l => l);
        const map = {};

        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split('\t');
            if (cols.length >= 3) {
                const ourKod = cols[0];  // kod из wnes kod
                const wkod = cols[1];    // wkod из wnes kod (это код из CSV)
                const art = cols[2];     // art из guide
                map[wkod] = { ourKod, art };
            }
        }
        return map;
    },

    // ============================================================
    // ЗАЩИТА ОТ ПОВТОРНОЙ ЗАГРУЗКИ
    // ============================================================
    async checkUploadProtection() {
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        // Получаем настройки из localStorage
        const checkByName = localStorage.getItem('mass_upload_checkByName') !== 'false'; // true по умолчанию
        const checkByContent = localStorage.getItem('mass_upload_checkByContent') !== 'false'; // true по умолчанию

        // Если обе проверки отключены — пропускаем
        if (!checkByName && !checkByContent) {
            console.log('🔓 Обе проверки отключены — пропускаем');
            return { blocked: false };
        }

        try {
            // 1. Проверяем по имени файла (если включено)
            if (checkByName) {
                const todayCheck = await this.query(
                    `SELECT "file_hash" FROM "mass_upload" WHERE "filename"='${this.currentFile.name}' AND "upload_date"='${todayStr}' AND "type"='upload'`
                );
                const todayLines = todayCheck.trim().split('\n').filter(l => l);
                if (todayLines.length > 1) {
                    return { blocked: true, reason: `Файл "${this.currentFile.name}" уже загружался сегодня.` };
                }
            }

            // 2. Проверяем дату создания файла (если включено)
            if (checkByContent) {
                const fileDate = new Date(this.currentFile.lastModified);
                const fileDateStr = fileDate.toISOString().split('T')[0]; // YYYY-MM-DD
                if (fileDateStr !== todayStr) {
                    return { blocked: true, reason: `Файл "${this.currentFile.name}" создан не сегодня (дата создания: ${fileDate.toLocaleDateString('ru-RU')}). Загрузка заблокирована.` };
                }
            }

            return { blocked: false };
        } catch (error) {
            // Если таблица не существует — не блокируем
            console.warn('Ошибка проверки защиты:', error);
            return { blocked: false };
        }
    },

    showBlockWarning(reason) {
        const warning = document.getElementById('blockWarning');
        warning.style.display = 'flex';
        warning.querySelector('.warning-title').textContent = 'Загрузка заблокирована';
        warning.querySelector('.warning-text').textContent = reason;

        // Показываем кнопку разрешения
        const forceBtn = document.getElementById('forceContinueBtn');
        if (forceBtn) {
            forceBtn.style.display = 'inline-flex';
            forceBtn.disabled = false;
            forceBtn.textContent = '✅ Да, я знаю, продолжить';

            forceBtn.onclick = () => {
                this.isBlocked = false;
                forceBtn.disabled = true;
                forceBtn.textContent = '✅ Разрешено';
                // Обновляем состояние кнопки (теперь isBlocked=false)
                this.updateConfirmButtonState();
            };
        }
    },

    // ============================================================
    // ПРЕДПРОСМОТР
    // ============================================================
    renderPreviewTable() {
        const tbody = document.getElementById('previewBody');
        const maxRows = 200; // Ограничиваем для производительности
        const displayData = this.analyzedData.slice(0, maxRows);

        tbody.innerHTML = displayData.map((item, index) => `
            <tr class="${item.status}">
                <td>${index + 1}</td>
                <td>${this.escapeHtml(item.csvKod)}</td>
                <td>${item.ourKod ? this.escapeHtml(item.ourKod) : '—'}</td>
                <td>${item.art ? this.escapeHtml(item.art) : '—'}</td>
                <td>${item.qty}</td>
                <td>
                    ${item.status === 'found'
                        ? `<span class="status-badge found">Найдено</span>`
                        : `<span class="status-badge not-found">Не найдено</span>
                           <button class="btn-assign" data-row="${index}" style="margin-top: 4px;">🔗 Присвоить</button>`
                    }
                </td>
            </tr>
        `).join('');

        if (this.analyzedData.length > maxRows) {
            tbody.innerHTML += `
                <tr>
                    <td colspan="6" class="loading-state">
                        ... и ещё ${this.analyzedData.length - maxRows} записей (показано ${maxRows})
                    </td>
                </tr>
            `;
        }
    },

    // ============================================================
    // ПОДТВЕРЖДЕНИЕ ЗАГРУЗКИ
    // ============================================================
    async confirmUpload() {
        if (this.isBlocked) {
            alert('Разрешите загрузку через предупреждение.');
            return;
        }

        const foundItems = this.analyzedData.filter(d => d.status === 'found');
        if (foundItems.length === 0) {
            alert('Нет найденных товаров для загрузки.');
            return;
        }

        if (!confirm(`Загрузить ${foundItems.length} товаров?\n\nПосле подтверждения данные будут сохранены в базу.`)) {
            return;
        }

        try {
            const today = new Date().toISOString().split('T')[0];
            const now = new Date().toLocaleTimeString('ru-RU');

            // Удаляем старые записи для этого файла за этот день
            await this.query(`DELETE FROM "mass_upload" WHERE "filename"='${this.currentFile.name}' AND "upload_date"='${today}' AND "type"='upload'`);

            // Записываем каждый найденный код в wnes hkod
            for (const item of foundItems) {
                const insertSql = `INSERT INTO "wneshkod" ("kod", "wkod") VALUES (${item.ourKod}, '${item.csvKod.replace(/'/g, "''")}')`;
                await this.query(insertSql);
            }

            // Записываем в журнал mass_upload
            const journalSql = `INSERT INTO "mass_upload" ("filename", "upload_date", "file_hash", "record_count", "user_id", "type") VALUES ('${this.currentFile.name.replace(/'/g, "''")}', '${today}', '${this.currentFileHash}', ${foundItems.length}, '${this.userId}', 'upload')`;
            await this.query(journalSql);

            // Показываем результат
            this.hideAllSteps();
            document.getElementById('step4').style.display = 'block';
            document.getElementById('resultDetails').innerHTML = `
                <p>✅ Файл: <strong>${this.escapeHtml(this.currentFile.name)}</strong></p>
                <p>📊 Всего строк: <strong>${this.csvRows.length}</strong></p>
                <p>✅ Загружено товаров: <strong>${foundItems.length}</strong></p>
                <p>⏰ Время: <strong>${now}</strong></p>
            `;

        } catch (error) {
            console.error('Ошибка загрузки:', error);
            alert('❌ Ошибка сохранения: ' + error.message);
        }
    },

    // ============================================================
    // ОТМЕНА / СБРОС
    // ============================================================
    cancelAll() {
        if (confirm('Отменить загрузку? Все данные будут удалены.')) {
            this.resetAll();
        }
    },

    resetAll() {
        this.selectedStoreId = null;
        this.selectedStoreName = '';
        this.selectedStoreSettings = null;
        this.assignRowIndex = null;
        this.conflicts = [];
        this.deletedConflictCodes = [];
        this.currentFile = null;
        this.currentFileHash = '';
        this.csvHeaders = [];
        this.csvRows = [];
        this.analyzedData = [];
        this.isBlocked = false;
        this.blockReason = '';

        // Сбрасываем форму
        const storeSelect = document.getElementById('storeSelect');
        if (storeSelect) storeSelect.selectedIndex = 0;
        document.getElementById('fileInput').value = '';
        document.getElementById('selectedStoreInfo').style.display = 'none';
        document.getElementById('fileName').style.display = 'none';
        const kodSelect = document.getElementById('kodColumnSelect');
        if (kodSelect) kodSelect.selectedIndex = 0;
        const qtySelect = document.getElementById('qtyColumnSelect');
        if (qtySelect) qtySelect.selectedIndex = 0;
        document.getElementById('confirmUpload').disabled = true;
        const autoSuggest = document.getElementById('autoSuggest');
        if (autoSuggest) autoSuggest.textContent = 'Загрузите файл для автоматического определения магазина.';

        this.hideAllSteps();
        document.getElementById('step1').style.display = 'block';
    },

    hideAllSteps() {
        document.getElementById('step1').style.display = 'none';
        document.getElementById('step2').style.display = 'none';
        document.getElementById('step3').style.display = 'none';
        document.getElementById('step4').style.display = 'none';
    },

    // ============================================================
    // УТИЛИТЫ
    // ============================================================
    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(16);
    },

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    escapeAttr(text) {
        if (!text) return '';
        return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

    // ============================================================
    // TOAST УВЕДОМЛЕНИЯ
    // ============================================================
    showToast(text) {
        const toast = document.getElementById('toast');
        if (!toast) return;

        const toastText = toast.querySelector('.toast-text');
        if (!toastText) return;

        toastText.textContent = text;
        toast.classList.add('show');

        setTimeout(() => {
            toast.classList.remove('show');
        }, 2000);
    },

    // ============================================================
    // ПРОСМОТР ФАЙЛА
    // ============================================================
    openViewFileModal() {
        if (this.csvHeaders.length === 0) {
            alert('Файл не загружен.');
            return;
        }

        // Сброс поиска
        const searchInput = document.getElementById('viewFileSearch');
        const searchClear = document.getElementById('viewFileSearchClear');
        if (searchInput) searchInput.value = '';
        if (searchClear) searchClear.style.display = 'none';
        this.filteredRows = [...this.csvRows];

        this.populateViewFileSelectors();
        this.renderViewFileTable();

        document.getElementById('viewFileModal').style.display = 'flex';
    },

    closeViewFileModal() {
        document.getElementById('viewFileModal').style.display = 'none';
    },

    filterViewFile() {
        const query = document.getElementById('viewFileSearch').value.trim().toLowerCase();
        const searchClear = document.getElementById('viewFileSearchClear');
        if (searchClear) {
            searchClear.style.display = query ? 'inline-flex' : 'none';
        }

        if (!query) {
            this.filteredRows = [...this.csvRows];
        } else {
            this.filteredRows = this.csvRows.filter(row => {
                return row.some(cell => (cell || '').toLowerCase().includes(query));
            });
        }

        this.renderViewFileTable();
    },

    populateViewFileSelectors() {
        const selects = ['viewCol1', 'viewCol2', 'viewCol3'];

        selects.forEach(id => {
            const select = document.getElementById(id);
            if (!select) return;

            select.innerHTML = '<option value="">— Выберите колонку —</option>';

            this.csvHeaders.forEach((header, index) => {
                if (!header) return;
                const option = document.createElement('option');
                option.value = index;
                option.textContent = header;
                select.appendChild(option);
            });
        });
    },

    renderViewFileTable() {
        const col1Idx = document.getElementById('viewCol1').value;
        const col2Idx = document.getElementById('viewCol2').value;
        const col3Idx = document.getElementById('viewCol3').value;

        const col1Selected = col1Idx !== '';
        const col2Selected = col2Idx !== '';
        const col3Selected = col3Idx !== '';

        // Обновляем заголовки
        document.getElementById('viewCol1Header').textContent = col1Selected ? this.csvHeaders[parseInt(col1Idx)] : 'Колонка 1';
        document.getElementById('viewCol2Header').textContent = col2Selected ? this.csvHeaders[parseInt(col2Idx)] : 'Колонка 2';
        document.getElementById('viewCol3Header').textContent = col3Selected ? this.csvHeaders[parseInt(col3Idx)] : 'Колонка 3';

        // Скрываем пустые колонки
        document.getElementById('viewCol1Header').style.display = col1Selected ? '' : 'none';
        document.getElementById('viewCol2Header').style.display = col2Selected ? '' : 'none';
        document.getElementById('viewCol3Header').style.display = col3Selected ? '' : 'none';

        const tbody = document.getElementById('viewFileBody');
        if (!col1Selected && !col2Selected && !col3Selected) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: #a0a0c0;">Выберите колонки для отображения</td></tr>';
            return;
        }

        // Показываем количество найденных строк
        if (this.filteredRows.length < this.csvRows.length) {
            const colspan = [col1Selected, col2Selected, col3Selected].filter(Boolean).length || 3;
            tbody.innerHTML = `<tr><td colspan="${colspan}" style="text-align: center; color: #a0a0c0; padding: 8px 12px;">Найдено ${this.filteredRows.length} из ${this.csvRows.length} строк</td></tr>`;
        }

        if (this.filteredRows.length === 0) {
            const colspan = [col1Selected, col2Selected, col3Selected].filter(Boolean).length || 3;
            tbody.innerHTML += `<tr><td colspan="${colspan}" style="text-align: center; color: #e74c3c;">Ничего не найдено</td></tr>`;
            return;
        }

        const maxRows = 100;
        const displayRows = this.filteredRows.slice(0, maxRows);

        tbody.innerHTML = displayRows.map(row => {
            const val1 = col1Selected ? this.escapeHtml(row[parseInt(col1Idx)] || '') : '';
            const val2 = col2Selected ? this.escapeHtml(row[parseInt(col2Idx)] || '') : '';
            const val3 = col3Selected ? this.escapeHtml(row[parseInt(col3Idx)] || '') : '';

            return `<tr>
                ${col1Selected ? `<td class="view-col" data-tooltip="${this.escapeAttr(val1)}">${val1}</td>` : ''}
                ${col2Selected ? `<td class="view-col" data-tooltip="${this.escapeAttr(val2)}">${val2}</td>` : ''}
                ${col3Selected ? `<td class="view-col" data-tooltip="${this.escapeAttr(val3)}">${val3}</td>` : ''}
            </tr>`;
        }).join('');

        if (this.filteredRows.length > maxRows) {
            const colspan = [col1Selected, col2Selected, col3Selected].filter(Boolean).length || 1;
            tbody.innerHTML += `<tr><td colspan="${colspan}" class="loading-state">... и ещё ${this.filteredRows.length - maxRows} записей (показано ${maxRows})</td></tr>`;
        }
    },
};

// ============================================================
// ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    MASS_UPLOAD.init();
});
