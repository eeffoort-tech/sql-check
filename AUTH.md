# Система доступа к модулям

## Описание

Разрешение на доступ к страницам определяется полем `dostup` в таблице `sotrud`.
Доступ задаётся **русскими названиями кнопок** через запятую.

## Таблица кнопок

| Название кнопки | Страница |
|---|---|
| Админ | `admin.html` |
| База данных | `sql-editor.html` |
| Клиенты | `employees.html` |
| Товары | `column-config.html` |
| Склад | `warehouse.html` |
| Приёмка | `priyomka.html` |
| Стикеры | `column-config.html` |
| Сотрудники | `employees.html` |
| Моя зарплата | `my-salary.html` |
| Справочник | `guide-add.html` |
| Отгрузка | `shipment.html` |
| Отчёты | `sdelano.html` |

## Примеры SQL

### Полный доступ (админ)

```sql
UPDATE "sotrud" SET "status" = 'Админ' WHERE "ID" = '1';
-- Поле dostup не важно — status = 'Админ' даёт доступ ко всему
```

### Старшая смена

```sql
UPDATE "sotrud" SET "dostup" = 'Склад,Приёмка,Отгрузка,Моя зарплата' WHERE "ID" = '2';
```

### Бухгалтер

```sql
UPDATE "sotrud" SET "dostup" = 'Сотрудники,Моя зарплата' WHERE "ID" = '3';
```

### Ограниченный доступ (только зарплата)

```sql
UPDATE "sotrud" SET "dostup" = 'Моя зарплата' WHERE "ID" = '4';
```

### Нет доступа

```sql
-- Пустое поле dostup = вход запрещён
UPDATE "sotrud" SET "dostup" = '' WHERE "ID" = '5';
```

## Как это работает

### 1. Авторизация (`login.js`)

```javascript
// Парсинг статуса и доступа из SQL
const statusValue = columns[statusIndex]; // 'Админ', 'Бухгалтер' и т.д.
const dostupRaw = columns[dostupIndex];   // 'Склад,Приёмка,Отгрузка'

// Если status = 'Админ' → полный доступ ['*']
const доступ = (statusValue.toLowerCase() === 'админ')
    ? ['*']
    : dostupRaw.split(',').map(s => s.trim()).filter(s => s);

// Сохранение в localStorage
localStorage.setItem('userAccess', JSON.stringify(доступ));
```

### 2. Перенаправление после входа

```javascript
// Первая доступная страница
function getRedirectPage(доступ) {
    const map = [
        { key: 'Админ', page: 'admin.html' },
        { key: 'Отчёты', page: 'sdelano.html' },
        { key: 'Склад', page: 'warehouse.html' },
        // ...
    ];

    if (доступ.includes('*')) return 'admin.html';
    for (const entry of map) {
        if (доступ.includes(entry.key)) return entry.page;
    }
    return 'login.html';
}
```

### 3. Фильтрация кнопок на панели админа (`admin.js`)

```javascript
function filterButtons() {
    const userAccess = JSON.parse(localStorage.getItem('userAccess') || '[]');
    const buttons = document.querySelectorAll('.admin-btn');

    buttons.forEach(btn => {
        const key = btn.querySelector('.admin-btn-title').textContent.trim();
        const allowed = userAccess.includes('*') || userAccess.includes(key);
        btn.style.display = allowed ? '' : 'none';
    });
}
```

### 4. Проверка на других страницах

```javascript
// employees.js
function checkAuth() {
    const userAccess = JSON.parse(localStorage.getItem('userAccess') || '[]');

    if (userAccess.length === 0) {
        window.location.href = 'login.html';
        return;
    }

    if (!userAccess.includes('*') && !userAccess.includes('Сотрудники')) {
        window.location.href = 'login.html';
        return;
    }
}
```

## Добавление нового модуля

1. Добавить кнопку с классом `.admin-btn` и текстом в `.admin-btn-title`
2. Добавить в `ADMIN.buttonMap` в `admin.js`:
   ```javascript
   'Новая кнопка': 'new-page.html',
   ```
3. Добавить в `getRedirectPage()` в `login.js`:
   ```javascript
   { key: 'Новая кнопка', page: 'new-page.html' },
   ```
4. На новой странице добавить `checkAuth()`:
   ```javascript
   function checkAuth() {
       const userAccess = getUserAccess();
       if (!userAccess.includes('*') && !userAccess.includes('Новая кнопка')) {
           window.location.href = 'login.html';
       }
   }
   ```

## Готовые роли

| Роль | dostup |
|---|---|
| Администратор | `status = 'Админ'` (автоматически *) |
| Старшая смена | `'Склад,Приёмка,Отгрузка,Моя зарплата'` |
| Бухгалтер | `'Сотрудники,Моя зарплата'` |
| Склад | `'Склад,Приёмка,Отгрузка'` |
| Сотрудник | `'Моя зарплата'` |
