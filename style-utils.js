// ============================================================
// GENERATE RANDOM DATA FOR STYLE PAGES
// ============================================================
const RandomData = {
    firstNames: ['Алексей','Мария','Дмитрий','Анна','Сергей','Елена','Андрей','Ольга','Николай','Екатерина','Павел','Наталья','Иван','Татьяна','Михаил','Юлия','Артём','Вера','Борис','Людмила'],
    lastNames: ['Иванов','Петров','Сидоров','Козлов','Новиков','Морозов','Волков','Соколов','Лебедев','Кузнецов','Попов','Семёнов','Голубев','Виноградов','Богданов','Воробьёв','Фёдоров','Михайлов','Белов','Захарцев'],
    cities: ['Москва','Санкт-Петербург','Новосибирск','Екатеринбург','Казань','Нижний Новгород','Челябинск','Самара','Омск','Ростов-на-Дону','Уфа','Красноярск','Воронеж','Пермь','Владивосток'],
    products: ['Ноутбук','Монитор','Клавиатура','Мышь','Наушники','Веб-камера','Флешка','Жёсткий диск','SSD 240GB','SSD 500GB','SSD 1TB','RAM 8GB','RAM 16GB','Видеокарта','Процессор','Материнская плата','Блок питания','Корпус','Вентилятор','Кабель HDMI'],
    categories: ['Электроника','Аксессуары','Комплектующие','Периферия','Сетевое оборудование','Хранение данных','Видео','Аудио','Кабели','Охлаждение'],
    statuses: ['Новый','В работе','На проверке','Отправлен','Доставлен','Оплачен','Отменён','Возврат'],
    names: ['ИП Петров','ООО Ромашка','ИП Сидоров','ООО Вектор','ИП Козлов','ООО Горизонт','ИП Новиков','ООО Прогресс','ИП Морозов','ООО Альфа','ИП Волков','ООО Солар','ИП Соколов','ООО Меркурий','ИП Лебедев'],

    rand(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    },

    randArr(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    },

    randFloat(min, max, decimals = 2) {
        return (Math.random() * (max - min) + min).toFixed(decimals);
    },

    /**
     * Generate random table data
     * @param {string} type - 'employees' | 'products' | 'orders' | 'clients' | 'statistics'
     * @param {number} rowCount - number of rows (default 15)
     * @returns {{headers: string[], rows: string[][]}}
     */
    generate(type, rowCount = 15) {
        const count = this.rand(rowCount - 5, rowCount + 5);
        switch(type) {
            case 'employees': return this.generateEmployees(count);
            case 'products': return this.generateProducts(count);
            case 'orders': return this.generateOrders(count);
            case 'clients': return this.generateClients(count);
            case 'statistics': return this.generateStatistics(count);
            default: return this.generateEmployees(count);
        }
    },

    generateEmployees(count) {
        const headers = ['№', 'ID', 'ФИО', 'Отдел', 'Должность', 'Город', 'Зарплата', 'Дата приёма'];
        const departments = ['IT','Продажи','Маркетинг','HR','Финансы','Логистика','Поддержка','Безопасность'];
        const positions = ['Сотрудник','Менеджер','Старший менеджер','Руководитель','Директор','Аналитик','Специалист'];
        const dates = [];
        for (let i = 0; i < count; i++) {
            const year = this.rand(2018, 2024);
            const month = this.rand(1, 12);
            const day = this.rand(1, 28);
            dates.push(`${day.toString().padStart(2,'0')}.${month.toString().padStart(2,'0')}.${year}`);
        }
        const rows = [];
        for (let i = 0; i < count; i++) {
            const firstName = this.randArr(this.firstNames);
            const lastName = this.randArr(this.lastNames);
            const midName = this.randArr(['Александрович','Дмитриевна','Сергеевич','Андреевна','Иванович','Николаевна','Павлович','Михайловна']);
            rows.push([
                (i+1).toString(),
                this.rand(1000, 9999).toString(),
                `${lastName} ${firstName} ${midName}`,
                this.randArr(departments),
                this.randArr(positions),
                this.randArr(this.cities),
                `₽${this.rand(40000, 250000)}`,
                dates[i]
            ]);
        }
        return { headers, rows };
    },

    generateProducts(count) {
        const headers = ['№', 'Артикул', 'Название', 'Категория', 'Цена', 'Остаток', 'Склад'];
        const rows = [];
        for (let i = 0; i < count; i++) {
            rows.push([
                (i+1).toString(),
                `ART-${this.rand(10000, 99999)}`,
                this.randArr(this.products),
                this.randArr(this.categories),
                `₽${this.rand(500, 150000)}`,
                this.rand(0, 500).toString(),
                `Склад ${this.rand(1, 5)}`
            ]);
        }
        return { headers, rows };
    },

    generateOrders(count) {
        const headers = ['№', '№ заказа', 'Клиент', 'Товар', 'Сумма', 'Статус', 'Дата'];
        const dates = [];
        for (let i = 0; i < count; i++) {
            const year = 2024;
            const month = this.rand(1, 12);
            const day = this.rand(1, 28);
            dates.push(`${day.toString().padStart(2,'0')}.${month.toString().padStart(2,'0')}.${year}`);
        }
        const rows = [];
        for (let i = 0; i < count; i++) {
            rows.push([
                (i+1).toString(),
                `ORD-${this.rand(100000, 999999)}`,
                this.randArr(this.names),
                this.randArr(this.products),
                `₽${this.rand(1000, 500000)}`,
                this.randArr(this.statuses),
                dates[i]
            ]);
        }
        return { headers, rows };
    },

    generateClients(count) {
        const headers = ['№', 'ID', 'Компания', 'Контакт', 'Телефон', 'Email', 'Город', 'Баланс'];
        const rows = [];
        for (let i = 0; i < count; i++) {
            rows.push([
                (i+1).toString(),
                `CL-${this.rand(100, 999)}`,
                this.randArr(this.names),
                this.randArr(this.firstNames),
                `+7(${this.rand(100,999)})${this.rand(100,999)}-${this.rand(10,99)}-${this.rand(10,99)}`,
                `${this.randArr(this.lastNames).toLowerCase()}@mail.ru`,
                this.randArr(this.cities),
                `₽${this.rand(0, 1000000)}`
            ]);
        }
        return { headers, rows };
    },

    generateStatistics(count) {
        const headers = ['№', 'Метрика', 'Значение', 'Изменение', 'Период', 'Цель', 'Прогресс'];
        const metrics = ['Продажи','Посещаемость','Конверсия','Выручка','Прибыль','Расходы','Клиенты','Отзывы','Рейтинг','NPS'];
        const rows = [];
        for (let i = 0; i < count; i++) {
            const val = this.rand(10, 10000);
            const change = (Math.random() * 40 - 15).toFixed(1);
            const progress = this.rand(20, 100);
            rows.push([
                (i+1).toString(),
                metrics[i % metrics.length],
                val.toString(),
                `${change > 0 ? '+' : ''}${change}%`,
                `${this.rand(1,30)}.${this.rand(1,12)}.2024`,
                '10000',
                `${progress}%`
            ]);
        }
        return { headers, rows };
    },

    /**
     * Generate multiple datasets for multiple tables
     */
    generateMultiple(tableTypes, rowsPerTable = 15) {
        const datasets = {};
        tableTypes.forEach(type => {
            datasets[type] = this.generate(type, rowsPerTable);
        });
        return datasets;
    }
};
