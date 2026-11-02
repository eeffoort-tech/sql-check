-- ============================================================
-- Инициализация таблицы для массовой загрузки товаров
-- Профили магазинов + журнал загрузок
-- ============================================================

CREATE TABLE IF NOT EXISTS "mass_upload" (
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
);

-- Индекс для защиты от повторов
CREATE INDEX IF NOT EXISTS "idx_mass_upload_filename_date" ON "mass_upload" ("filename", "upload_date");
CREATE INDEX IF NOT EXISTS "idx_mass_upload_type" ON "mass_upload" ("type");