// ============================================================
// INIT MASS UPLOAD TABLE
// Единая таблица для профилей магазинов и журнала загрузок
// ============================================================

async function initMassUploadTable() {
    const serverIp = localStorage.getItem('serverIp');
    if (!serverIp) {
        alert('Сначала выполните вход в систему!');
        return;
    }

    const queries = [
        // Единая таблица для профилей магазинов и журнала
        `CREATE TABLE IF NOT EXISTS "mass_upload" (
            "id" INTEGER PRIMARY KEY AUTOINCREMENT,
            "type" TEXT NOT NULL CHECK(type IN ('config','upload')),
            "store_name" TEXT DEFAULT '',
            "kod_col" TEXT DEFAULT '',
            "name_col" TEXT DEFAULT '',
            "qty_col" TEXT DEFAULT '',
            "filename" TEXT,
            "upload_date" TEXT,
            "file_hash" TEXT,
            "record_count" INTEGER DEFAULT 0,
            "user_id" TEXT,
            "created_at" TEXT DEFAULT (datetime('now'))
        )`,

        // Индексы
        `CREATE INDEX IF NOT EXISTS "idx_mass_upload_filename_date" ON "mass_upload" ("filename", "upload_date")`,
        `CREATE INDEX IF NOT EXISTS "idx_mass_upload_type" ON "mass_upload" ("type")`
    ];

    let success = 0;
    for (const sql of queries) {
        try {
            const encodedSql = encodeURIComponent(sql.trim());
            const url = `http://${serverIp}:8080/query?sql=${encodedSql}`;
            const response = await fetch(url, { method: 'GET', mode: 'cors' });
            if (response.ok) success++;
        } catch (error) {
            console.error('Ошибка:', sql.substring(0, 50), error);
        }
    }

    if (success === queries.length) {
        alert(`✅ Таблица mass_upload создана успешно! (${success}/${queries.length})`);
    } else {
        alert(`⚠️ Создано ${success} из ${queries.length}. Проверьте консоль.`);
    }
}

// Запуск:
// initMassUploadTable();
