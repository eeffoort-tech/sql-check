# ЗАПУСК ПРОЕКТА

## 1. Запуск локального HTTP сервера

```bash
cd C:\Users\Villi_Bobs\Desktop\VER1.0\sql-check
python -m http.server 3000
```

## 2. Открытие в браузере

- **Справочник:** http://localhost:3000/guide.html
- **Добавить запись:** http://localhost:3000/guide-add.html

## 3. Подключение к Android серверу

При открытии страницы введите IP Android-устройства (HTTP режим).

## 4. Структура данных

- Данные (SQL) — через HTTP API с Android сервера (порт 8080)
- Таблица guide — основной справочник
- Таблица perevod — переводы названий колонок
- Поле kod — уникальный идентификатор записи
