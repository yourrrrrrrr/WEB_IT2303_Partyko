import random
from datetime import datetime, timedelta
from pprint import pprint

from faker import Faker
from pymongo import MongoClient, ASCENDING, DESCENDING, TEXT
from pymongo.errors import BulkWriteError

# ============================================================
# 1. ПОДКЛЮЧЕНИЕ К MONGODB ATLAS
# ============================================================
# Замените <username>, <password> и <cluster> на свои данные из Atlas
CONNECTION_STRING = "mongodb+srv://admin:qwerty99999@testlabs.o1iwavu.mongodb.net/?appName=testLabs"
client = MongoClient(CONNECTION_STRING,
    tlsAllowInvalidCertificates=True  # разрешить самоподписанные или недоверенные сертификаты
)
db = client["agro_marketplace"]  # база данных создаётся автоматически при первой записи

# ============================================================
# 2. ОПРЕДЕЛЕНИЕ КОЛЛЕКЦИЙ И СХЕМЫ ДОКУМЕНТОВ
# ============================================================
# Коллекции (будут созданы при вставке данных)
sellers_col = db["sellers"]
products_col = db["products"]
orders_col = db["orders"]
price_history_col = db["price_history"]

# Примеры документов для понимания структуры:
#
# sellers:
# {
#   "_id": ObjectId,
#   "name": "ООО 'Зелёный Луг'",
#   "contact": "+7-999-123-45-67",
#   "location": "Краснодарский край",
#   "rating": 4.8
# }
#
# products:
# {
#   "_id": ObjectId,
#   "seller_id": ObjectId,
#   "name": "Пшеница озимая",
#   "category": "Зерновые",
#   "description": "Высококачественная пшеница, урожай 2025",
#   "price": 15000.0,          # текущая цена за тонну
#   "unit": "тонна",
#   "specs": {                  # вариативные атрибуты
#       "moisture": 14.2,       # влажность, %
#       "protein": 12.5,        # белок, %
#       "gluten": 23.0          # клейковина, %
#   },
#   "created_at": ISODate
# }
#
# orders:
# {
#   "_id": ObjectId,
#   "order_id": "ORD-2025-001",
#   "seller_id": ObjectId,
#   "product_id": ObjectId,
#   "quantity": 10.5,
#   "price_per_unit": 14800.0,   # цена на момент сделки
#   "total_amount": 155400.0,
#   "status": "completed",
#   "order_date": ISODate
# }
#
# price_history:
# {
#   "_id": ObjectId,
#   "product_id": ObjectId,
#   "price": 15000.0,
#   "changed_at": ISODate
# }

# ============================================================
# 3. ГЕНЕРАЦИЯ ТЕСТОВЫХ ДАННЫХ (1000+ документов)
# ============================================================
fake = Faker('ru_RU')

def generate_sellers(n=20):
    sellers = []
    for _ in range(n):
        seller = {
            "name": fake.company(),
            "contact": fake.phone_number(),
            "location": fake.city(),
            "rating": round(random.uniform(3.5, 5.0), 1)
        }
        sellers.append(seller)
    return sellers

def generate_products(seller_ids, n=500):
    categories = {
        "Зерновые": ["moisture", "protein", "gluten"],
        "Молочные": ["fat", "protein", "temperature"],
        "Овощи": ["weight", "size"],
        "Фрукты": ["weight", "sugar"],
        "Мясо": ["fat", "protein", "age"]
    }
    products = []
    for _ in range(n):
        seller_id = random.choice(seller_ids)
        category = random.choice(list(categories.keys()))
        # Генерируем спецификации в зависимости от категории
        specs = {}
        for attr in categories[category]:
            if attr == "moisture":
                specs[attr] = round(random.uniform(10.0, 20.0), 1)
            elif attr == "protein":
                specs[attr] = round(random.uniform(10.0, 25.0), 1)
            elif attr == "gluten":
                specs[attr] = round(random.uniform(18.0, 35.0), 1)
            elif attr == "fat":
                specs[attr] = round(random.uniform(1.5, 30.0), 1)
            elif attr == "temperature":
                specs[attr] = round(random.uniform(2.0, 6.0), 1)
            elif attr == "weight":
                specs[attr] = round(random.uniform(0.1, 5.0), 2)
            elif attr == "size":
                specs[attr] = random.choice(["small", "medium", "large"])
            elif attr == "sugar":
                specs[attr] = round(random.uniform(5.0, 15.0), 1)
            elif attr == "age":
                specs[attr] = random.randint(1, 24)  # months
        price = round(random.uniform(1000, 50000), 2)
        product = {
            "seller_id": seller_id,
            "name": fake.sentence(nb_words=3),
            "category": category,
            "description": fake.text(max_nb_chars=200),
            "price": price,
            "unit": random.choice(["кг", "тонна", "литр", "штука"]),
            "specs": specs,
            "created_at": fake.date_time_between(start_date="-2y", end_date="now")
        }
        products.append(product)

        # Создаём запись в price_history для этого продукта (несколько записей)
        for _ in range(random.randint(1, 5)):
            hist = {
                "product_id": None,  # заполним после вставки, когда будут ObjectId
                "price": price * random.uniform(0.8, 1.2),
                "changed_at": fake.date_time_between(start_date="-1y", end_date="now")
            }
            # Сохраним во временный список, потом добавим после получения _id продукта
        # Но так как мы используем bulk insert, придётся сначала вставить продукты,
        # потом получить их _id и создать историю. Для простоты вставим продукты и историю отдельно.

    return products

def generate_orders(product_ids, seller_ids, n=800):
    orders = []
    statuses = ["pending", "completed", "cancelled"]
    for _ in range(n):
        product_id = random.choice(product_ids)
        seller_id = random.choice(seller_ids)
        quantity = round(random.uniform(0.5, 100), 2)
        price_per_unit = round(random.uniform(1000, 50000), 2)
        total = round(quantity * price_per_unit, 2)
        order = {
            "order_id": fake.unique.bothify(text="ORD-####-???"),
            "seller_id": seller_id,
            "product_id": product_id,
            "quantity": quantity,
            "price_per_unit": price_per_unit,
            "total_amount": total,
            "status": random.choice(statuses),
            "order_date": fake.date_time_between(start_date="-1y", end_date="now")
        }
        orders.append(order)
    return orders

def seed_database():
    """Заполнение базы данных тестовыми данными"""
    # Очистка коллекций (осторожно, удалит все данные!)
    sellers_col.delete_many({})
    products_col.delete_many({})
    orders_col.delete_many({})
    price_history_col.delete_many({})

    # Вставка продавцов
    sellers = generate_sellers(20)
    seller_result = sellers_col.insert_many(sellers)
    seller_ids = seller_result.inserted_ids
    print(f"Добавлено продавцов: {len(seller_ids)}")

    # Вставка продуктов
    products = generate_products(seller_ids, 500)
    product_result = products_col.insert_many(products)
    product_ids = product_result.inserted_ids
    print(f"Добавлено продуктов: {len(product_ids)}")

    # Вставка истории цен (для каждого продукта несколько записей)
    price_history = []
    for pid in product_ids:
        product = products_col.find_one({"_id": pid})
        base_price = product["price"]
        # Создаём от 1 до 5 записей об изменении цены
        for _ in range(random.randint(1, 5)):
            change = {
                "product_id": pid,
                "price": round(base_price * random.uniform(0.7, 1.3), 2),
                "changed_at": fake.date_time_between(start_date="-1y", end_date="now")
            }
            price_history.append(change)
    price_history_col.insert_many(price_history)
    print(f"Добавлено записей истории цен: {len(price_history)}")

    # Вставка заказов
    orders = generate_orders(product_ids, seller_ids, 800)
    orders_col.insert_many(orders)
    print(f"Добавлено заказов: {len(orders)}")

# ============================================================
# 4. ИНДЕКСЫ И EXPLAIN
# ============================================================
def create_indexes():
    """Создание необходимых индексов"""
    # Составной индекс для фильтрации по категории и влажности
    products_col.create_index([("category", ASCENDING), ("specs.moisture", ASCENDING)])
    # Текстовый индекс для поиска по описанию
    products_col.create_index([("description", TEXT)])
    # Дополнительные индексы для ускорения агрегаций
    orders_col.create_index([("order_date", DESCENDING)])
    orders_col.create_index([("seller_id", ASCENDING), ("status", ASCENDING)])
    price_history_col.create_index([("product_id", ASCENDING), ("changed_at", DESCENDING)])

def compare_index_performance():
    """Сравнение выполнения запроса с индексом и без"""
    # Отключим использование индекса для первого замера
    products_col.drop_indexes()  # ОСТОРОЖНО: удалит все индексы! Для демо лучше временно отключать через hint.
    # Но мы просто создадим индексы позже и сравним через explain.

    # Сначала убедимся, что индексов нет (или создадим их после первого explain)
    # Для чистоты эксперимента создадим копию коллекции или будем использовать hint.

    # Простой запрос: найти продукты категории "Зерновые" с влажностью > 14
    query = {"category": "Зерновые", "specs.moisture": {"$gt": 14}}

    # 1. Без индекса (предполагаем, что индекс ещё не создан)
    result_no_index = products_col.find(query).explain()
    print("Execution stats БЕЗ ИНДЕКСА:")
    pprint(result_no_index.get("executionStats", {}))

    # Создаём индекс
    products_col.create_index([("category", ASCENDING), ("specs.moisture", ASCENDING)])

    # 2. С индексом (MongoDB выберет индекс автоматически)
    result_with_index = products_col.find(query).explain()
    print("\nExecution stats С ИНДЕКСОМ:")
    pprint(result_with_index.get("executionStats", {}))

    # Для текстового поиска
    products_col.create_index([("description", TEXT)])
    text_query = {"$text": {"$search": "пшеница"}}
    text_result = products_col.find(text_query).explain()
    print("\nТекстовый поиск (с индексом):")
    pprint(text_result.get("executionStats", {}))

# ============================================================
# 5. AGGREGATION PIPELINE
# ============================================================
def avg_price_by_category_last_30_days():
    """Средняя цена и количество лотов по категориям за последние 30 дней"""
    pipeline = [
        {"$match": {
            "created_at": {"$gte": datetime.now() - timedelta(days=30)}
        }},
        {"$group": {
            "_id": "$category",
            "avg_price": {"$avg": "$price"},
            "count": {"$sum": 1}
        }},
        {"$sort": {"count": -1}}
    ]
    result = list(products_col.aggregate(pipeline))
    print("Средняя цена и количество по категориям за 30 дней:")
    for doc in result:
        print(f"  {doc['_id']}: avg_price={doc['avg_price']:.2f}, count={doc['count']}")

def top_10_sellers_by_revenue():
    """Топ-10 продавцов по объёму продаж (сумма quantity * price_per_unit)"""
    pipeline = [
        {"$match": {"status": "completed"}},
        {"$group": {
            "_id": "$seller_id",
            "total_revenue": {"$sum": "$total_amount"}
        }},
        {"$sort": {"total_revenue": -1}},
        {"$limit": 10},
        {"$lookup": {
            "from": "sellers",
            "localField": "_id",
            "foreignField": "_id",
            "as": "seller_info"
        }},
        {"$unwind": "$seller_info"},
        {"$project": {
            "seller_name": "$seller_info.name",
            "total_revenue": 1
        }}
    ]
    result = list(orders_col.aggregate(pipeline))
    print("\nТоп-10 продавцов по выручке:")
    for doc in result:
        print(f"  {doc['seller_name']}: {doc['total_revenue']:.2f} руб.")

def price_dynamics_wheat_by_week():
    """Динамика цен на пшеницу по неделям (из истории цен)"""
    # Сначала найдём продукты, содержащие в названии "пшеница"
    wheat_products = products_col.find({"name": {"$regex": "пшеница", "$options": "i"}}, {"_id": 1})
    wheat_ids = [p["_id"] for p in wheat_products]

    if not wheat_ids:
        print("Нет продуктов с 'пшеница' в названии")
        return

    pipeline = [
        {"$match": {
            "product_id": {"$in": wheat_ids}
        }},
        {"$addFields": {
            "week": {"$week": "$changed_at"},
            "year": {"$year": "$changed_at"}
        }},
        {"$group": {
            "_id": {"year": "$year", "week": "$week"},
            "avg_price": {"$avg": "$price"},
            "min_price": {"$min": "$price"},
            "max_price": {"$max": "$price"},
            "count": {"$sum": 1}
        }},
        {"$sort": {"_id.year": 1, "_id.week": 1}}
    ]
    result = list(price_history_col.aggregate(pipeline))
    print("\nДинамика цен на пшеницу по неделям:")
    for doc in result:
        print(f"  {doc['_id']['year']}-W{doc['_id']['week']}: avg={doc['avg_price']:.2f}, "
              f"min={doc['min_price']:.2f}, max={doc['max_price']:.2f} (записей: {doc['count']})")

def orders_with_seller_info():
    """Пример $lookup: заказы с данными продавца (аналог JOIN)"""
    pipeline = [
        {"$limit": 5},  # для демонстрации только 5 заказов
        {"$lookup": {
            "from": "sellers",
            "localField": "seller_id",
            "foreignField": "_id",
            "as": "seller"
        }},
        {"$unwind": "$seller"},
        {"$project": {
            "order_id": 1,
            "total_amount": 1,
            "seller.name": 1,
            "seller.rating": 1
        }}
    ]
    result = list(orders_col.aggregate(pipeline))
    print("\nПример заказов с информацией о продавце:")
    for doc in result:
        print(f"  Заказ {doc['order_id']}: сумма {doc['total_amount']}, продавец {doc['seller']['name']} (рейтинг {doc['seller']['rating']})")

# ============================================================
# 6. CHANGE STREAMS (ОПЦИОНАЛЬНО, БОНУС)
# ============================================================
def watch_price_changes(threshold=10):
    """
    Подписка на изменения в коллекции price_history.
    Логирует изменения цены более чем на threshold процентов.
    """
    try:
        with price_history_col.watch() as stream:
            print(f"Ожидание изменений цены (порог {threshold}%)...")
            for change in stream:
                if change["operationType"] == "insert":
                    # Получаем вставленный документ
                    full_doc = change["fullDocument"]
                    product_id = full_doc["product_id"]
                    new_price = full_doc["price"]

                    # Найдём предыдущую цену для этого продукта (последнюю до этого изменения)
                    previous = price_history_col.find_one(
                        {"product_id": product_id, "_id": {"$lt": full_doc["_id"]}},
                        sort=[("changed_at", DESCENDING)]
                    )
                    if previous:
                        old_price = previous["price"]
                        change_pct = abs((new_price - old_price) / old_price * 100)
                        if change_pct > threshold:
                            print(f"⚠️ Значительное изменение цены для продукта {product_id}: "
                                  f"{old_price} -> {new_price} ({change_pct:.1f}%)")
    except KeyboardInterrupt:
        print("Остановка прослушивания change stream.")

# ============================================================
# 7. СРАВНЕНИЕ С SQL (ОТВЕТЫ В ФАЙЛЕ README.md)
# ============================================================
# Ответы на вопросы задания будут помещены в отдельный файл README.md
# (см. ниже текст)

readme_text = """
## Сравнение MongoDB с PostgreSQL для агро-маркетплейса

### 1. В каком сценарии MongoDB выигрывает у PostgreSQL для данного домена?

MongoDB особенно эффективна в следующих аспектах:

- **Гибкая схема для вариативных атрибутов**: продукты в агро-маркетплейсе имеют разный набор характеристик (зерно – влажность, молоко – жирность, фрукты – сахар и т.д.). В MongoDB эти разнородные данные удобно хранить как вложенный объект `specs`. В PostgreSQL потребовалась бы либо таблица с множеством разреженных колонок (EAV-модель), либо отдельные таблицы для каждого типа продуктов, что усложняет запросы.
- **Скорость разработки**: добавление нового атрибута не требует миграции схемы – просто вставляем поле в документ.
- **Вложенные структуры**: заказы могут содержать позиции как массив, избегая отдельных таблиц и JOIN'ов.
- **Агрегации через конвейер**: мощный агрегационный фреймворк позволяет выполнять сложные аналитические запросы (группировки, вычисления) прямо в базе, часто быстрее, чем эквивалентные SQL-запросы с множественными JOIN'ами.
- **Горизонтальное масштабирование**: при росте данных MongoDB легче шардируется, чем PostgreSQL.

### 2. Почему Redis не подходит в качестве основного хранилища здесь?

Redis – это in-memory key-value store, предназначенный для кэширования и быстрых операций с малым объёмом данных. Он не подходит как основное хранилище для агро-маркетплейса по причинам:

- **Ограниченный объём памяти**: все данные должны помещаться в RAM, что невозможно для исторических данных (тысячи заказов, история цен).
- **Отсутствие сложных запросов**: Redis не поддерживает агрегации, фильтрацию по нескольким полям, текстовый поиск, связи между объектами (JOIN).
- **Нет durable-хранения "из коробки"**: хотя есть persistence, он не гарантирует надёжность как полноценная дисковый БД.
- **Нет поддержки индексов для произвольных полей**: поиск по цене или категории потребовал бы сканирования всех ключей.
Redis можно использовать как кэш перед MongoDB, но не как primary storage.

### 3. Как бы выглядела нормализованная SQL-схема и какие JOIN'ы потребовались бы?

В PostgreSQL потребовались бы таблицы:

- `sellers` (id, name, contact, location, rating)
- `products` (id, seller_id, name, category, description, price, unit, created_at)
- `product_attributes` (product_id, attribute_name, value) – для хранения спецификаций (EAV-модель)
- `orders` (id, order_id, seller_id, product_id, quantity, price_per_unit, total_amount, status, order_date)
- `price_history` (id, product_id, price, changed_at)

Типичные запросы потребовали бы множественных JOIN'ов:

- Выборка продуктов с атрибутами: `products JOIN product_attributes` (или множество LEFT JOIN для каждого атрибута).
- Получение заказов с данными продавца: `orders JOIN sellers`.
- Аналитические запросы (средняя цена по категориям): `products GROUP BY category` (без проблем), но с условиями на атрибутах пришлось бы использовать подзапросы или сложные JOIN'ы с фильтрацией в `product_attributes`.
- Топ продавцов по выручке: `orders JOIN sellers GROUP BY seller_id` (вполне нормально).
- Динамика цен с недельной группировкой: `price_history` с функциями извлечения недели.

Основная сложность – атрибуты. В EAV-модели запросы с фильтрацией по нескольким атрибутам (например, "зерно с влажностью > 14 и белком > 12") превращаются в самосоединения таблицы атрибутов, что громоздко и медленно. Альтернатива – использовать JSONB в PostgreSQL (начиная с 9.4), что приближает его к документной модели. Однако MongoDB изначально заточена под такие сценарии и предоставляет более удобные операторы для работы с вложенными полями.
"""

def write_readme():
    with open("README.md", "w", encoding="utf-8") as f:
        f.write(readme_text)
    print("README.md с ответами создан.")

# ============================================================
# 8. ГЛАВНАЯ ФУНКЦИЯ ДЛЯ ДЕМОНСТРАЦИИ
# ============================================================
def main():
    print("=" * 60)
    print("ЗАДАНИЕ 3: MONGODB ДЛЯ АГРО-МАРКЕТПЛЕЙСА")
    print("=" * 60)

    # ЗАПОЛНЕНИЕ БАЗЫ (раскомментируйте, если нужно пересоздать данные)
    # seed_database()

    # ИНДЕКСЫ
    print("\n--- СОЗДАНИЕ ИНДЕКСОВ ---")
    create_indexes()
    print("Индексы созданы.")

    # СРАВНЕНИЕ ПРОИЗВОДИТЕЛЬНОСТИ (осторожно: удалит индексы!)
    # print("\n--- СРАВНЕНИЕ ПРОИЗВОДИТЕЛЬНОСТИ ---")
    # compare_index_performance()

    # АГРЕГАЦИИ
    print("\n--- АГРЕГАЦИОННЫЕ ЗАПРОСЫ ---")
    avg_price_by_category_last_30_days()
    top_10_sellers_by_revenue()
    price_dynamics_wheat_by_week()
    orders_with_seller_info()

    # CHANGE STREAMS (запускается в отдельном потоке или интерактивно)
    # watch_price_changes()

    # ЗАПИСЬ README
    write_readme()

    client.close()
    print("\nРабота завершена.")

if __name__ == "__main__":
    main()