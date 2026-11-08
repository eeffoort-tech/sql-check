-- Таблица профилей стикеров
CREATE TABLE IF NOT EXISTS "sticker_profiles" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "width_mm" INTEGER NOT NULL DEFAULT 58,
    "height_mm" INTEGER NOT NULL DEFAULT 40,
    "elements" TEXT NOT NULL, -- JSON массив элементов
    "created_by" TEXT,
    "created_date" TEXT,
    "is_default" INTEGER DEFAULT 0
);

-- Профиль по умолчанию (текущий)
INSERT INTO "sticker_profiles" ("name", "width_mm", "height_mm", "elements", "created_by", "created_date", "is_default")
VALUES ('58x40 по умолчанию', 58, 40,
'{"elements":[{"type":"qr","dataField":"kodpod","anchorX":"right","anchorY":"top","sizeMM":24,"marginMM":2},{"type":"text","value":"3D IDEA","anchorX":"left","anchorY":"center","leftMM":10,"fontSize":18},{"type":"art","dataField":"art","anchorX":"center","anchorY":"bottom","maxWidthMM":54,"fontSize":20,"lineGap":0.7,"multiLine":true},{"type":"text","dataField":"kodpod","anchorX":"center","anchorY":"bottom","bottomMM":12,"fontSize":11,"textBelowQR":true}]}'
,'system', datetime('now'), 1);
