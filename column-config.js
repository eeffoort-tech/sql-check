// ============================================================
// COLUMN CONFIG - JavaScript (Профили магазинов)
// ============================================================

const COLUMN_CONFIG = {
    serverIp: '',
    editingId: null,

    // ============================================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================================
    async init() {
        this.serverIp = localStorage.getItem('serverIp') || '';
        if (!this.serverIp) {
            window.location.href = 'login.html';
            return;
        }

        this.bindEvents();
        await this.loadProfiles();
    },

    // ============================================================
    // СОБЫТИЯ
    // ============================================================
    bindEvents() {
        document.getElementById('backBtn').addEventListener('click', () => {
            window.location.href = 'admin.html';
        });

        document.getElementById('addProfileBtn').addEventListener('click', () => {
            this.showNewProfileForm();
        });

        document.getElementById('profileForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveProfile();
        });

        document.getElementById('cancelForm').addEventListener('click', () => {
            this.hideProfileForm();
        });
    },

    // ============================================================
    // ЗАГРУЗКА ПРОФИЛЕЙ
    // ============================================================
    async loadProfiles() {
        const container = document.getElementById('profilesList');
        container.innerHTML = '<div class="loading-state">Загрузка...</div>';

        try {
            const sql = `SELECT "id", "store_name", "kod_col", "name_col", "qty_col", "created_at" FROM "mass_upload" WHERE "type"='config' ORDER BY "created_at" DESC`;
            const result = await this.query(sql);
            const lines = result.trim().split('\n').filter(l => l);

            if (lines.length <= 1) {
                container.innerHTML = '<div class="loading-state">Профили не найдены. Создайте первый профиль.</div>';
                return;
            }

            const profiles = [];
            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split('\t');
                profiles.push({
                    id: cols[0],
                    store_name: cols[1] || 'Без названия',
                    kod_col: cols[2] || '',
                    name_col: cols[3] || '',
                    qty_col: cols[4] || '',
                    created_at: cols[5] || ''
                });
            }

            container.innerHTML = profiles.map(profile => `
                <div class="profile-card">
                    <div class="profile-info">
                        <div class="profile-name">
                            🏪 ${this.escapeHtml(profile.store_name)}
                        </div>
                        <div class="profile-columns">
                            <span class="profile-col">
                                <span class="label">Код:</span> 
                                <span class="value">${profile.kod_col ? this.escapeHtml(profile.kod_col) : '<em>не указано</em>'}</span>
                            </span>
                            ${profile.name_col ? `
                            <span class="profile-col">
                                <span class="label">Название:</span> 
                                <span class="value">${this.escapeHtml(profile.name_col)}</span>
                            </span>` : ''}
                            ${profile.qty_col ? `
                            <span class="profile-col">
                                <span class="label">Кол-во:</span> 
                                <span class="value">${this.escapeHtml(profile.qty_col)}</span>
                            </span>` : ''}
                        </div>
                        <div class="profile-date">${this.escapeHtml(profile.created_at)}</div>
                    </div>
                    <div class="profile-actions">
                        <button onclick="COLUMN_CONFIG.editProfile(${profile.id})" class="btn btn-secondary btn-tiny">✏️ Изменить</button>
                        <button onclick="COLUMN_CONFIG.deleteProfile(${profile.id})" class="btn btn-danger btn-tiny">🗑️ Удалить</button>
                    </div>
                </div>
            `).join('');

        } catch (error) {
            console.error('Ошибка загрузки профилей:', error);
            container.innerHTML = `<div class="loading-state" style="color: #e74c3c;">Ошибка: ${error.message}</div>`;
        }
    },

    // ============================================================
    // НОВЫЙ ПРОФИЛЬ
    // ============================================================
    showNewProfileForm() {
        this.editingId = null;
        document.getElementById('formTitle').textContent = '✏️ Новый профиль';
        document.getElementById('profileId').value = '';
        document.getElementById('storeName').value = '';
        document.getElementById('kodCol').value = '';
        document.getElementById('nameCol').value = '';
        document.getElementById('qtyCol').value = '';

        document.getElementById('profileFormSection').style.display = 'block';
        document.getElementById('storeName').focus();
    },

    // ============================================================
    // РЕДАКТИРОВАНИЕ ПРОФИЛЯ
    // ============================================================
    async editProfile(id) {
        try {
            const sql = `SELECT "store_name", "kod_col", "name_col", "qty_col" FROM "mass_upload" WHERE "id"=${id} AND "type"='config'`;
            const result = await this.query(sql);
            const lines = result.trim().split('\n').filter(l => l);

            if (lines.length >= 2) {
                const cols = lines[1].split('\t');
                this.editingId = id;

                document.getElementById('formTitle').textContent = '✏️ Редактировать профиль';
                document.getElementById('profileId').value = id;
                document.getElementById('storeName').value = cols[0] || '';
                document.getElementById('kodCol').value = cols[1] || '';
                document.getElementById('nameCol').value = cols[2] || '';
                document.getElementById('qtyCol').value = cols[3] || '';

                document.getElementById('profileFormSection').style.display = 'block';
                document.getElementById('storeName').focus();
            }
        } catch (error) {
            alert(`❌ Ошибка загрузки профиля: ${error.message}`);
        }
    },

    // ============================================================
    // СОХРАНЕНИЕ ПРОФИЛЯ
    // ============================================================
    async saveProfile() {
        const storeName = document.getElementById('storeName').value.trim();
        const kodCol = document.getElementById('kodCol').value.trim();
        const nameCol = document.getElementById('nameCol').value.trim();
        const qtyCol = document.getElementById('qtyCol').value.trim();

        if (!storeName) {
            alert('Укажите название магазина!');
            return;
        }

        if (!kodCol) {
            alert('Укажите колонку с кодом товара!');
            return;
        }

        try {
            let sql;
            if (this.editingId) {
                // Обновление
                sql = `UPDATE "mass_upload" SET "store_name"='${storeName.replace(/'/g, "''")}', "kod_col"='${kodCol.replace(/'/g, "''")}', "name_col"='${nameCol.replace(/'/g, "''")}', "qty_col"='${qtyCol.replace(/'/g, "''")}' WHERE "id"=${this.editingId} AND "type"='config'`;
            } else {
                // Создание нового
                sql = `INSERT INTO "mass_upload" ("type", "store_name", "kod_col", "name_col", "qty_col") VALUES ('config', '${storeName.replace(/'/g, "''")}', '${kodCol.replace(/'/g, "''")}', '${nameCol.replace(/'/g, "''")}', '${qtyCol.replace(/'/g, "''")}')`;
            }

            await this.query(sql);
            alert('✅ Профиль сохранён!');
            this.hideProfileForm();
            await this.loadProfiles();
        } catch (error) {
            alert(`❌ Ошибка сохранения: ${error.message}`);
        }
    },

    // ============================================================
    // УДАЛЕНИЕ ПРОФИЛЯ
    // ============================================================
    async deleteProfile(id) {
        if (!confirm('Удалить этот профиль?')) return;

        try {
            await this.query(`DELETE FROM "mass_upload" WHERE "id"=${id} AND "type"='config'`);
            alert('Профиль удалён');
            await this.loadProfiles();
        } catch (error) {
            alert(`❌ Ошибка удаления: ${error.message}`);
        }
    },

    // ============================================================
    // СКРЫТЬ ФОРМУ
    // ============================================================
    hideProfileForm() {
        document.getElementById('profileFormSection').style.display = 'none';
        this.editingId = null;
    },

    // ============================================================
    // API ЗАПРОСЫ
    // ============================================================
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

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

// ============================================================
// ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    COLUMN_CONFIG.init();
});
