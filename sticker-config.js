// ============================================================
// STICKER CONFIGURATOR — шаблоны + формы, без drag & drop
// ============================================================
(function() {
    // === СОСТОЯНИЕ ===
    const state = {
        serverIp: localStorage.getItem('serverIp') || '',
        profiles: [],
        currentProfileId: null,
        selectedTemplate: null,
        previewData: { kodpod: '123456', art: 'ABC-DEF-12345' }
    };

    // === ПРЕДУСТАНОВЛЕННЫЕ ШАБЛОНЫ ===
    const TEMPLATES = {
        'default_58x40': {
            name: 'Стикер 58×40 — стандарт',
            widthMM: 58, heightMM: 40,
            showQR: true, qrSizeMM: 24, qrMarginMM: 2,
            showText: true, textValue: '3D IDEA', textFontSize: 18,
            textPos: 'left-center', leftMM: 10, topMM: null,
            showArt: true, artFontSize: 20, artMaxWidthMM: 54, artBottomMM: 12,
            showKodpod: true, kodpodLeftMM: 10, kodpodTopMM: 30,
            artMultiLine: true, artLineGap: 0.7
        },
        'wide_62x30': {
            name: 'Стикер 62×30 — узкий',
            widthMM: 62, heightMM: 30,
            showQR: true, qrSizeMM: 18, qrMarginMM: 2,
            showText: true, textValue: '3D IDEA', textFontSize: 14,
            textPos: 'left-center', leftMM: 8, topMM: null,
            showArt: true, artFontSize: 16, artMaxWidthMM: 48, artBottomMM: 6,
            showKodpod: false, kodpodLeftMM: 10, kodpodTopMM: 22,
            artMultiLine: true, artLineGap: 0.6
        },
        'tall_40x55': {
            name: 'Стикер 40×55 — высокий',
            widthMM: 40, heightMM: 55,
            showQR: true, qrSizeMM: 20, qrMarginMM: 2,
            showText: true, textValue: '3D IDEA', textFontSize: 12,
            textPos: 'left-center', leftMM: 3, topMM: null,
            showArt: true, artFontSize: 14, artMaxWidthMM: 32, artBottomMM: 8,
            showKodpod: true, kodpodLeftMM: 10, kodpodTopMM: 45,
            artMultiLine: true, artLineGap: 0.6
        },
        'minimal_58x25': {
            name: 'Стикер 58×25 — минимальный',
            widthMM: 58, heightMM: 25,
            showQR: true, qrSizeMM: 16, qrMarginMM: 1,
            showText: false, textValue: '3D IDEA', textFontSize: 10,
            textPos: 'left-center', leftMM: 5, topMM: null,
            showArt: true, artFontSize: 12, artMaxWidthMM: 38, artBottomMM: 4,
            showKodpod: false, kodpodLeftMM: 10, kodpodTopMM: 20,
            artMultiLine: false, artLineGap: 0.5
        }
    };

    // === API ===
    async function query(sql) {
        const url = `http://${state.serverIp}:8080/query?sql=${encodeURIComponent(sql.trim())}`;
        const r = await fetch(url, { method: 'GET', mode: 'cors' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.text();
    }

    // === PROFILES ===
    async function loadProfiles() {
        try {
            const result = await query('SELECT "id","name","width_mm","height_mm","elements","is_default" FROM "sticker_profiles" ORDER BY "id"');
            const lines = result.trim().split('\n').filter(function(l) { return l; });
            state.profiles = [];
            if (lines.length >= 2) {
                const h = lines[0].split('\t');
                var idI = h.indexOf('id'), nameI = h.indexOf('name'), wmI = h.indexOf('width_mm'), hmI = h.indexOf('height_mm'), elI = h.indexOf('elements'), defI = h.indexOf('is_default');
                for (var i = 1; i < lines.length; i++) {
                    const p = lines[i].split('\t');
                    state.profiles.push({
                        id: parseInt(p[idI]),
                        name: p[nameI],
                        widthMM: parseInt(p[wmI]) || 58,
                        heightMM: parseInt(p[hmI]) || 40,
                        elements: JSON.parse(p[elI] || '{"elements":[]}'),
                        isDefault: p[defI] == '1'
                    });
                }
            }
            const sel = document.getElementById('profileSelect');
            sel.innerHTML = '<option value="">— Выберите профиль —</option>';
            state.profiles.forEach(function(pr) {
                const o = document.createElement('option');
                o.value = pr.id;
                o.textContent = pr.name + (pr.isDefault ? ' ★' : '');
                sel.appendChild(o);
            });
            if (state.profiles.length > 0) {
                sel.value = state.profiles[0].id;
                state.currentProfileId = state.profiles[0].id;
                document.getElementById('loadProfileBtn').disabled = false;
                document.getElementById('deleteProfileBtn').disabled = false;
                loadProfile();
            }
        } catch (e) { console.error('[sticker-config]', e); }
    }

    async function loadProfile() {
        if (!state.currentProfileId) return;
        const pr = state.profiles.find(function(p) { return p.id === state.currentProfileId; });
        if (pr) {
            // elements из БД — это объект { elements: [...] } или массив
            let elementsArray = null;
            if (pr.elements) {
                if (Array.isArray(pr.elements)) {
                    elementsArray = pr.elements;
                } else if (pr.elements.elements && Array.isArray(pr.elements.elements)) {
                    elementsArray = pr.elements.elements;
                }
            }
            applyTemplateToForm(elementsArray, pr.widthMM, pr.heightMM);
        }
    }

    async function saveProfile() {
        const name = document.getElementById('profileName').value.trim();
        if (!name) { alert('Введите название'); return; }
        const widthMM = parseInt(document.getElementById('widthMM').value) || 58;
        const heightMM = parseInt(document.getElementById('heightMM').value) || 40;
        const isDefault = document.getElementById('profileDefault').checked ? 1 : 0;

        // Собираем элементы из формы
        const elements = buildElementsFromForm();
        const userId = localStorage.getItem('userId') || 'unknown';
        const dateNow = new Date().toISOString().split('T')[0];

        try {
            let sql;
            const n = name.replace(/'/g, "''");
            const cb = userId.replace(/'/g, "''");
            const pData = JSON.stringify({ elements: elements });
            const escData = pData.replace(/'/g, "''");
            if (state.currentProfileId) {
                sql = 'UPDATE "sticker_profiles" SET "name"=\''+n+'\', "width_mm"='+widthMM+', "height_mm"='+heightMM+', "elements"=\''+escData+'\', "is_default"='+isDefault+' WHERE "id"='+state.currentProfileId;
            } else {
                sql = 'INSERT INTO "sticker_profiles" ("name","width_mm","height_mm","elements","created_by","created_date","is_default") VALUES (\''+n+'\', '+widthMM+', '+heightMM+', \''+escData+'\', \''+cb+'\', \''+dateNow+'\', '+isDefault+')';
            }
            await query(sql);
            alert('✅ Профиль сохранён');
            await loadProfiles();
        } catch (e) { alert('❌ Ошибка: ' + e.message); }
    }

    async function deleteProfile() {
        if (!state.currentProfileId || !confirm('Удалить профиль?')) return;
        try {
            await query('DELETE FROM "sticker_profiles" WHERE "id"='+state.currentProfileId);
            alert('✅ Удалён');
            state.currentProfileId = null;
            document.getElementById('profileSelect').value = '';
            document.getElementById('loadProfileBtn').disabled = true;
            document.getElementById('deleteProfileBtn').disabled = true;
            await loadProfiles();
        } catch (e) { alert('❌ ' + e.message); }
    }

    function exportProfile() {
        const widthMM = parseInt(document.getElementById('widthMM').value) || 58;
        const heightMM = parseInt(document.getElementById('heightMM').value) || 40;
        const elements = buildElementsFromForm();
        const blob = new Blob([JSON.stringify({ widthMM: widthMM, heightMM: heightMM, elements: elements }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'sticker.json';
        a.click();
    }

    // === СТРОИМ ЭЛЕМЕНТЫ ИЗ ФОРМЫ ===
    function buildElementsFromForm() {
        console.log('[sticker-config] buildElementsFromForm start');
        const elements = [];
        var cbQR = document.getElementById('cbShowQR');
        var cbText = document.getElementById('cbShowText');
        var cbArt = document.getElementById('cbShowArt');
        var cbKodpod = document.getElementById('cbShowKodpod');
        console.log('[sticker-config] cbShowQR.checked =', cbQR ? cbQR.checked : 'NOT FOUND');
        console.log('[sticker-config] cbShowText.checked =', cbText ? cbText.checked : 'NOT FOUND');
        console.log('[sticker-config] cbShowArt.checked =', cbArt ? cbArt.checked : 'NOT FOUND');
        console.log('[sticker-config] cbShowKodpod.checked =', cbKodpod ? cbKodpod.checked : 'NOT FOUND');

        if (cbQR && cbQR.checked) {
            elements.push({
                type: 'qr',
                dataField: document.getElementById('selQrField').value,
                sizeMM: parseInt(document.getElementById('numQrSize').value) || 24,
                marginMM: parseInt(document.getElementById('numQrMargin').value) || 2
            });
            console.log('[sticker-config] added QR');
        }
        if (cbText && cbText.checked) {
            elements.push({
                type: 'text',
                value: document.getElementById('txtTextValue').value || '3D IDEA',
                fontSize: parseInt(document.getElementById('numTextSize').value) || 18,
                leftMM: parseInt(document.getElementById('numTextLeft').value) || 10,
                topMM: parseInt(document.getElementById('numTextTop').value) || 20
            });
            console.log('[sticker-config] added text');
        }
        if (cbArt && cbArt.checked) {
            elements.push({
                type: 'art',
                dataField: 'art',
                fontSize: parseInt(document.getElementById('numArtSize').value) || 20,
                maxWidthMM: parseInt(document.getElementById('numArtWidth').value) || 54,
                bottomMM: parseInt(document.getElementById('numArtBottom').value) || 12,
                multiLine: document.getElementById('cbArtMulti').checked,
                lineGap: parseFloat(document.getElementById('numArtGap').value) || 0.7
            });
            console.log('[sticker-config] added art');
        }
        if (cbKodpod && cbKodpod.checked) {
            elements.push({
                type: 'kodpod',
                dataField: document.getElementById('selKodpodField').value,
                fontSize: parseInt(document.getElementById('numKodpodSize').value) || 11,
                leftMM: parseInt(document.getElementById('numKodpodLeft').value) || 10,
                topMM: parseInt(document.getElementById('numKodpodTop').value) || 30
            });
            console.log('[sticker-config] added kodpod');
        }
        console.log('[sticker-config] buildElementsFromForm result:', elements.length, 'elements');
        return elements;
    }

    // === ПОЛУЧИТЬ ТЕКУЩИЙ ШАБЛОН ===
    function getCurrentTemplate() {
        return TEMPLATES[state.selectedTemplate || 'default_58x40'];
    }

    // === ПРИМЕНИТЬ ШАБЛОН К ФОРМЕ ===
    function applyTemplateToForm(elements, widthMM, heightMM) {
        console.log('[sticker-config] applyTemplateToForm called, widthMM:', widthMM, 'heightMM:', heightMM, 'elements:', elements);
        if (!widthMM || !heightMM) {
            const tmpl = getCurrentTemplate();
            widthMM = tmpl.widthMM;
            heightMM = tmpl.heightMM;
        }

        document.getElementById('widthMM').value = widthMM;
        document.getElementById('heightMM').value = heightMM;

        // Если это массив элементов (из профиля) — извлекаем настройки
        if (Array.isArray(elements) && elements.length > 0) {
            console.log('[sticker-config] applying from array of', elements.length, 'elements');
            elements.forEach(function(el) {
                console.log('[sticker-config]   el:', el);
                switch (el.type) {
                    case 'qr':
                        document.getElementById('cbShowQR').checked = true;
                        document.getElementById('selQrField').value = el.dataField || 'kodpod';
                        document.getElementById('numQrSize').value = el.sizeMM || 24;
                        document.getElementById('numQrMargin').value = el.marginMM || 2;
                        break;
                    case 'text':
                        document.getElementById('cbShowText').checked = true;
                        document.getElementById('txtTextValue').value = el.value || '3D IDEA';
                        document.getElementById('numTextSize').value = el.fontSize || 18;
                        document.getElementById('numTextLeft').value = el.leftMM || 10;
                        document.getElementById('numTextTop').value = el.topMM || 20;
                        break;
                    case 'art':
                        document.getElementById('cbShowArt').checked = true;
                        document.getElementById('numArtSize').value = el.fontSize || 20;
                        document.getElementById('numArtWidth').value = el.maxWidthMM || 54;
                        document.getElementById('numArtBottom').value = el.bottomMM || 12;
                        document.getElementById('cbArtMulti').checked = el.multiLine !== false;
                        document.getElementById('numArtGap').value = el.lineGap || 0.7;
                        break;
                    case 'kodpod':
                        document.getElementById('cbShowKodpod').checked = true;
                        document.getElementById('selKodpodField').value = el.dataField || 'kodpod';
                        document.getElementById('numKodpodSize').value = el.fontSize || 11;
                        document.getElementById('numKodpodLeft').value = el.leftMM || 10;
                        document.getElementById('numKodpodTop').value = el.topMM || 30;
                        break;
                }
            });
        } else if (elements && typeof elements === 'object') {
            // Это объект шаблона (showQR, textValue, ...)
            console.log('[sticker-config] applying from object template');
            if (elements.showQR !== undefined) {
                document.getElementById('cbShowQR').checked = elements.showQR || false;
                document.getElementById('selQrField').value = elements.qrField || 'kodpod';
                document.getElementById('numQrSize').value = elements.qrSizeMM || 24;
                document.getElementById('numQrMargin').value = elements.qrMarginMM || 2;
            }
            if (elements.showText !== undefined) {
                document.getElementById('cbShowText').checked = elements.showText || false;
                document.getElementById('txtTextValue').value = elements.textValue || '3D IDEA';
                document.getElementById('numTextSize').value = elements.textFontSize || 18;
                document.getElementById('numTextLeft').value = elements.leftMM || 10;
                document.getElementById('numTextTop').value = elements.topMM || 20;
            }
            if (elements.showArt !== undefined) {
                document.getElementById('cbShowArt').checked = elements.showArt || false;
                document.getElementById('numArtSize').value = elements.artFontSize || 20;
                document.getElementById('numArtWidth').value = elements.artMaxWidthMM || 54;
                document.getElementById('numArtBottom').value = elements.artBottomMM || 12;
                document.getElementById('cbArtMulti').checked = elements.artMultiLine !== false;
                document.getElementById('numArtGap').value = elements.artLineGap || 0.7;
            }
            if (elements.showKodpod !== undefined) {
                document.getElementById('cbShowKodpod').checked = elements.showKodpod || false;
                document.getElementById('numKodpodSize').value = elements.kodpodFontSize || 11;
                document.getElementById('numKodpodLeft').value = elements.kodpodLeftMM || 10;
                document.getElementById('numKodpodTop').value = elements.kodpodTopMM || 30;
            }
        } else {
            console.log('[sticker-config] no elements, using default');
            const tmpl = getCurrentTemplate();
            applyTemplateToForm(tmpl, tmpl.widthMM, tmpl.heightMM);
            return;
        }
        toggleVisibility();
        resizeCanvas();
        drawPreviewFromForm();
    }

    // === ПЕРЕКЛЮЧЕНИЕ ВИДИМОСТИ СЕКЦИЙ ===
    function toggleVisibility() {
        document.getElementById('secQr').style.display = document.getElementById('cbShowQR').checked ? '' : 'none';
        document.getElementById('secText').style.display = document.getElementById('cbShowText').checked ? '' : 'none';
        document.getElementById('secArt').style.display = document.getElementById('cbShowArt').checked ? '' : 'none';
        document.getElementById('secKodpod').style.display = document.getElementById('cbShowKodpod').checked ? '' : 'none';
    }

    // === РЕНДЕР ПРОФИЛЯ НА CANVAS ===
    function drawPreviewFromForm() {
        console.log('[sticker-config] drawPreviewFromForm called');
        const elements = buildElementsFromForm();
        const widthMM = parseInt(document.getElementById('widthMM').value) || 58;
        const heightMM = parseInt(document.getElementById('heightMM').value) || 40;
        console.log('[sticker-config] size:', widthMM, 'x', heightMM);
        drawPreviewFromProfile(elements, widthMM, heightMM);
    }

    function drawPreviewFromProfile(elements, widthMM, heightMM) {
        console.log('[sticker-config] drawPreviewFromProfile, elements count:', elements.length);
        const canvas = document.getElementById('stickerPreview');
        console.log('[sticker-config] canvas.width:', canvas.width, 'canvas.height:', canvas.height, 'canvas._ppx:', canvas._ppx);
        const ctx = canvas.getContext('2d');
        const p = canvas._ppx || 10;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        for (const el of elements) {
            console.log('[sticker-config] drawing element:', el.type);
            drawOneElement(ctx, el, widthMM, heightMM, p);
        }

        // Рамка
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, canvas.width, canvas.height);
    }

    function drawOneElement(ctx, el, wMM, hMM, p) {
        const data = state.previewData;
        switch (el.type) {
            case 'qr': {
                const sz = el.sizeMM * p;
                const mg = el.marginMM * p;
                const x = wMM * p - sz - mg;
                const y = mg;
                ctx.fillStyle = '#fff';
                ctx.fillRect(x, y, sz, sz);
                ctx.fillStyle = '#000';
                const cs = sz / 21;
                const val = data[el.dataField] || data.kodpod || '';
                // Генерируем битовую матрицу из строки
                const bits = [];
                for (var rr = 0; rr < 21; rr++) {
                    for (var cc = 0; cc < 21; cc++) {
                        // Комбинируем несколько хешей для отсутствия диагоналей
                        var h1 = ((rr * 21 + cc) * 2654435761) >>> 0;
                        var h2 = ((val.charCodeAt((rr + cc) % val.length) * 39359 + h1) * 2654435761) >>> 0;
                        var h3 = ((h1 * 0x5bd1e995) >>> 0);
                        var h = ((h2 + h3) >>> 0);
                        bits.push((h & 1) === 1);
                    }
                }
                for (var rr = 0; rr < 21; rr++) {
                    for (var cc = 0; cc < 21; cc++) {
                        var f = isFinder(rr, cc, 21);
                        var d = f ? true : bits[rr * 21 + cc];
                        if (d) ctx.fillRect(Math.round(x + cc * cs), Math.round(y + rr * cs), Math.ceil(cs), Math.ceil(cs));
                    }
                }
                break;
            }
            case 'text': {
                const fs = Math.round(el.fontSize * p / 3.78);
                ctx.font = 'bold '+fs+'px Arial, sans-serif';
                ctx.fillStyle = '#000';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';
                ctx.fillText(el.value, el.leftMM*p, (el.topMM+el.fontSize/3.78*0.9)*p);
                break;
            }
            case 'art': {
                const val = data.art || '';
                const fs = Math.round(el.fontSize * p / 3.78);
                ctx.font = 'bold '+fs+'px Arial, sans-serif';
                ctx.fillStyle = '#000';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'alphabetic';
                const mw = el.maxWidthMM * p;
                const ax = wMM * p / 2;
                const ay = (hMM - el.bottomMM)*p + fs*0.8;
                drawArtText(ctx, val, ax, ay, fs, mw, el.lineGap||0.7);
                break;
            }
            case 'kodpod': {
                const val = data[el.dataField] || data.kodpod || '';
                const fs = Math.round(el.fontSize * p / 3.78);
                ctx.font = 'bold '+fs+'px Arial, sans-serif';
                ctx.fillStyle = '#000';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';
                const x = (el.leftMM != null ? el.leftMM : 10) * p;
                const y = (el.topMM != null ? el.topMM : 30) * p;
                ctx.fillText(val, x, y);
                break;
            }
        }
    }

    function drawArtText(ctx, art, x, y, fontSize, maxWidth, lineGap) {
        var words = (art||'').split(/\s+/).filter(function(w){return w;});
        if(ctx.measureText(art).width<=maxWidth){ctx.fillText(art,x,y);return;}
        var l1=words[0], l2='';
        for(var i=1;i<words.length;i++){
            var t=l1+' '+words[i];
            if(ctx.measureText(t).width<=maxWidth) l1=t;
            else{l2=words.slice(i).join(' ');break;}
        }
        var gap=fontSize*(lineGap||0.5);
        ctx.fillText(l1,x,y-gap);
        if(l2) ctx.fillText(l2,x,y+gap);
    }

    function isFinder(r,c,s){
        if((r<7&&c<7)||(r<7&&c>=s-7)||(r>=s-7&&c<7)){
            var fx=(r<7&&c<7)?c:(r<7&&c>=s-7)?c-(s-7):c;
            var fy=(r<7&&c<7)?r:(r<7&&c>=s-7)?r:r-(s-7);
            return fx===0||fx===6||fy===0||fy===6||(fy>=2&&fy<=4&&fx>=2&&fx<=4);
        }
        return false;
    }

    // === CANVAS SIZE ===
    function resizeCanvas() {
        const canvas = document.getElementById('stickerPreview');
        const w = parseInt(document.getElementById('widthMM').value) || 58;
        const h = parseInt(document.getElementById('heightMM').value) || 40;
        const ppx = 10;
        canvas.width = w * ppx;
        canvas.height = h * ppx;
        const maxW = Math.min(500, window.innerWidth - 600);
        const maxH = Math.min(400, window.innerHeight - 400);
        const scale = Math.min(maxW / (w * ppx), maxH / (h * ppx), 1);
        canvas.style.width = (w * ppx * scale) + 'px';
        canvas.style.height = (h * ppx * scale) + 'px';
        canvas._ppx = ppx;
    }

    // === INIT ===
    function init() {
        if (!state.serverIp) { window.location.href = 'login.html'; return; }

        // Back
        document.getElementById('backBtn').addEventListener('click', function(){ window.history.back(); });

        // Выбор профиля
        document.getElementById('profileSelect').addEventListener('change', function(e) {
            state.currentProfileId = e.target.value ? parseInt(e.target.value) : null;
            document.getElementById('loadProfileBtn').disabled = !state.currentProfileId;
            document.getElementById('deleteProfileBtn').disabled = !state.currentProfileId;
            if (state.currentProfileId) loadProfile();
        });

        // Кнопки
        document.getElementById('loadProfileBtn').addEventListener('click', loadProfile);
        document.getElementById('saveProfileBtn').addEventListener('click', function(){
            if (!state.currentProfileId) {
                document.getElementById('profileName').value = 'Стикер ' + new Date().toLocaleDateString();
            }
            document.getElementById('saveModal').style.display = 'flex';
        });
        document.getElementById('deleteProfileBtn').addEventListener('click', deleteProfile);
        document.getElementById('exportProfileBtn').addEventListener('click', exportProfile);
        document.getElementById('closeSaveModal').addEventListener('click', function(){ document.getElementById('saveModal').style.display = 'none'; });
        document.getElementById('cancelSaveProfileBtn').addEventListener('click', function(){ document.getElementById('saveModal').style.display = 'none'; });
        document.getElementById('confirmSaveProfileBtn').addEventListener('click', function(){ saveProfile(); document.getElementById('saveModal').style.display = 'none'; });

        // Шаблон
        document.getElementById('templateSelect').addEventListener('change', function() {
            state.selectedTemplate = this.value;
            const tmpl = TEMPLATES[this.value];
            document.getElementById('widthMM').value = tmpl.widthMM;
            document.getElementById('heightMM').value = tmpl.heightMM;
            applyTemplateToForm(tmpl, tmpl.widthMM, tmpl.heightMM);
        });

        // Переключатели видимости
        ['cbShowQR','cbShowText','cbShowArt','cbShowKodpod'].forEach(function(id){
            document.getElementById(id).addEventListener('change', function(){
                toggleVisibility();
                drawPreviewFromForm();
            });
        });

        // Все поля форм — мгновенная перерисовка
        document.querySelectorAll('#secQr input, #secQr select, #secText input, #secText select, #secArt input, #secArt select, #secKodpod input, #secKodpod select, #widthMM, #heightMM').forEach(function(inp){
            inp.addEventListener('input', drawPreviewFromForm);
            inp.addEventListener('change', drawPreviewFromForm);
        });

        // Превью данные
        var pk = document.getElementById('previewKodpod');
        var pa = document.getElementById('previewArt');
        if (pk) pk.addEventListener('input', function(e){ state.previewData.kodpod = e.target.value; drawPreviewFromForm(); });
        if (pa) pa.addEventListener('input', function(e){ state.previewData.art = e.target.value; drawPreviewFromForm(); });

        // Размеры
        document.getElementById('widthMM').addEventListener('input', function(){ resizeCanvas(); drawPreviewFromForm(); });
        document.getElementById('heightMM').addEventListener('input', function(){ resizeCanvas(); drawPreviewFromForm(); });

        // Модал
        document.getElementById('saveModal').addEventListener('click', function(e){ if(e.target.id==='saveModal') e.target.style.display='none'; });

        // Размер и превью
        resizeCanvas();
        drawPreviewFromForm();

        // Загружаем профили
        loadProfiles();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
