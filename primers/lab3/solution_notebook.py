# ============================================================
# ЗАДАНИЕ 1 (РЕШЕНИЕ): Интернет-магазин книг
# Тема: Реляционные БД, SQL, ORM (SQLAlchemy), N+1, индексы
# ============================================================

# %% [markdown]
# ## Условие задачи
# Реализовать backend базы данных для интернет-магазина книг:
# - Авторы, Книги, Клиенты, Заказы, Позиции заказов
# - Написать SQL-запросы: выборки с JOIN, агрегации, транзакции
# - Продемонстрировать проблему N+1 и её решение через eager loading
# - Показать влияние индексов на производительность

# %% [markdown]
# ## Часть 1: Настройка окружения

# %%
# pip install sqlalchemy alembic faker

from sqlalchemy import (
    create_engine, Column, Integer, String, Float, ForeignKey,
    DateTime, Text, Index, func, event, text
)
from sqlalchemy.orm import (
    declarative_base, relationship, Session,
    sessionmaker, joinedload, selectinload
)
from sqlalchemy import Table
from datetime import datetime
from faker import Faker
import time
import random

fake = Faker('ru_RU')
Base = declarative_base()

# SQLite для демонстрации (в проде — PostgreSQL)
engine = create_engine("sqlite:///bookstore.db", echo=False)

# %% [markdown]
# ## Часть 2: Модели (ORM)

# %%
# Many-to-Many: книга ↔ автор
book_author = Table(
    "book_author", Base.metadata,
    Column("book_id",   Integer, ForeignKey("books.id"),   primary_key=True),
    Column("author_id", Integer, ForeignKey("authors.id"), primary_key=True),
)

class Author(Base):
    __tablename__ = "authors"
    id         = Column(Integer, primary_key=True)
    name       = Column(String(200), nullable=False)
    bio        = Column(Text)
    books      = relationship("Book", secondary=book_author, back_populates="authors")

    def __repr__(self):
        return f"<Author {self.name}>"

class Book(Base):
    __tablename__ = "books"
    id         = Column(Integer, primary_key=True)
    title      = Column(String(300), nullable=False)
    price      = Column(Float, nullable=False)
    genre      = Column(String(100))
    stock      = Column(Integer, default=0)
    authors    = relationship("Author", secondary=book_author, back_populates="books")
    order_items= relationship("OrderItem", back_populates="book")

    # Индекс для быстрого поиска по жанру
    __table_args__ = (Index("ix_books_genre", "genre"),)

class Customer(Base):
    __tablename__ = "customers"
    id       = Column(Integer, primary_key=True)
    name     = Column(String(200), nullable=False)
    email    = Column(String(200), unique=True, nullable=False)
    orders   = relationship("Order", back_populates="customer")

class Order(Base):
    __tablename__ = "orders"
    id          = Column(Integer, primary_key=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    created_at  = Column(DateTime, default=datetime.utcnow)
    status      = Column(String(50), default="pending")
    customer    = relationship("Customer", back_populates="orders")
    items       = relationship("OrderItem", back_populates="order")

    # Индекс для фильтрации по статусу и дате
    __table_args__ = (Index("ix_orders_status_date", "status", "created_at"),)

    @property
    def total(self):
        return sum(i.qty * i.price_at_purchase for i in self.items)

class OrderItem(Base):
    __tablename__ = "order_items"
    id                = Column(Integer, primary_key=True)
    order_id          = Column(Integer, ForeignKey("orders.id"),   nullable=False)
    book_id           = Column(Integer, ForeignKey("books.id"),    nullable=False)
    qty               = Column(Integer, default=1)
    price_at_purchase = Column(Float, nullable=False)
    order = relationship("Order", back_populates="items")
    book  = relationship("Book",  back_populates="order_items")

Base.metadata.create_all(engine)
print("✅ Схема создана")

# %% [markdown]
# ## Часть 3: Генерация тестовых данных

# %%
SessionLocal = sessionmaker(bind=engine)

def seed_data(n_authors=20, n_books=100, n_customers=50, n_orders=200):
    with SessionLocal() as session:
        # Авторы
        authors = [
            Author(name=fake.name(), bio=fake.text(200))
            for _ in range(n_authors)
        ]
        session.add_all(authors)
        session.flush()

        # Книги
        genres = ["Роман", "Фантастика", "История", "Детектив", "Наука", "Поэзия"]
        books = []
        for _ in range(n_books):
            b = Book(
                title=fake.sentence(nb_words=4).rstrip("."),
                price=round(random.uniform(150, 3000), 2),
                genre=random.choice(genres),
                stock=random.randint(0, 50),
            )
            b.authors = random.sample(authors, k=random.randint(1, 3))
            books.append(b)
        session.add_all(books)
        session.flush()

        # Клиенты
        customers = [
            Customer(name=fake.name(), email=fake.unique.email())
            for _ in range(n_customers)
        ]
        session.add_all(customers)
        session.flush()

        # Заказы
        statuses = ["pending", "paid", "shipped", "delivered", "cancelled"]
        for _ in range(n_orders):
            order = Order(
                customer=random.choice(customers),
                status=random.choice(statuses),
                created_at=fake.date_time_between(start_date="-1y"),
            )
            for book in random.sample(books, k=random.randint(1, 5)):
                if book.stock > 0:
                    order.items.append(OrderItem(
                        book=book,
                        qty=random.randint(1, 3),
                        price_at_purchase=book.price,
                    ))
            session.add(order)

        session.commit()
    print(f"✅ Данные сгенерированы: {n_authors} авторов, {n_books} книг, "
          f"{n_customers} клиентов, {n_orders} заказов")

seed_data()

# %% [markdown]
# ## Часть 4: SQL-запросы — базовые операции

# %%
# --- SELECT с JOIN: топ-5 самых дорогих книг по жанру "Наука" ---
with engine.connect() as conn:
    result = conn.execute(text("""
        SELECT b.title, b.price, b.genre,
               GROUP_CONCAT(a.name, ', ') AS authors
        FROM books b
        JOIN book_author ba ON b.id = ba.book_id
        JOIN authors a      ON a.id = ba.author_id
        WHERE b.genre = 'Наука'
        GROUP BY b.id
        ORDER BY b.price DESC
        LIMIT 5
    """))
    print("📚 Топ-5 книг по жанру 'Наука':")
    for row in result:
        print(f"  {row.title[:40]:<40} {row.price:>8.2f} руб.  [{row.authors}]")

# %%
# --- Агрегация: выручка по статусам заказов ---
with engine.connect() as conn:
    result = conn.execute(text("""
        SELECT o.status,
               COUNT(o.id)                              AS cnt,
               ROUND(SUM(oi.qty * oi.price_at_purchase), 2) AS revenue
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        GROUP BY o.status
        ORDER BY revenue DESC
    """))
    print("\n💰 Выручка по статусам заказов:")
    for row in result:
        print(f"  {row.status:<12} {row.cnt:>4} заказов   {row.revenue:>12,.2f} руб.")

# %%
# --- UPDATE + транзакция: обработка заказа (ACID) ---
def process_order(order_id: int):
    """
    Транзакция: paid -> shipped, списание со склада.
    При нехватке товара — откат всего заказа.
    """
    with SessionLocal() as session:
        try:
            order = session.get(Order, order_id)
            if not order or order.status != "paid":
                print(f"  Заказ {order_id}: нельзя обработать (статус={getattr(order,'status','?')})")
                return

            for item in order.items:
                book = session.get(Book, item.book_id)
                if book.stock < item.qty:
                    raise ValueError(
                        f"Недостаточно книг на складе: '{book.title}' "
                        f"(нужно {item.qty}, есть {book.stock})"
                    )
                book.stock -= item.qty

            order.status = "shipped"
            session.commit()
            print(f"  ✅ Заказ {order_id} → shipped, склад обновлён")

        except ValueError as e:
            session.rollback()
            print(f"  ❌ Откат заказа {order_id}: {e}")

# Найдём несколько paid-заказов и обработаем
with SessionLocal() as s:
    paid_ids = [r.id for r in s.query(Order).filter_by(status="paid").limit(3)]

print("\n🚚 Обработка заказов:")
for oid in paid_ids:
    process_order(oid)

# %% [markdown]
# ## Часть 5: Проблема N+1 и её решение

# %%
# --- ПРОБЛЕМА N+1 ---
def fetch_orders_n_plus_1(limit=30):
    """Наивный подход: 1 запрос на заказы + N запросов на items."""
    with SessionLocal() as session:
        orders = session.query(Order).limit(limit).all()
        totals = []
        for o in orders:
            # Здесь для каждого o SQLAlchemy делает ОТДЕЛЬНЫЙ SELECT на o.items!
            totals.append((o.id, o.total))
    return totals

# --- РЕШЕНИЕ: joinedload / selectinload ---
def fetch_orders_eager(limit=30):
    """Eager loading: 2 запроса вместо N+1."""
    with SessionLocal() as session:
        orders = (
            session.query(Order)
            .options(selectinload(Order.items))  # один запрос на все items
            .limit(limit)
            .all()
        )
        totals = [(o.id, o.total) for o in orders]
    return totals

# Замер времени
N = 5  # повторений для стабильности

t0 = time.perf_counter()
for _ in range(N): fetch_orders_n_plus_1(50)
t_bad = (time.perf_counter() - t0) / N

t0 = time.perf_counter()
for _ in range(N): fetch_orders_eager(50)
t_good = (time.perf_counter() - t0) / N

print(f"\n⚡ N+1 problem:")
print(f"  Без eager loading:  {t_bad*1000:.2f} ms")
print(f"  С  eager loading:   {t_good*1000:.2f} ms")
print(f"  Ускорение:          {t_bad/t_good:.1f}×")

# %% [markdown]
# ## Часть 6: Влияние индексов на производительность

# %%
import sqlite3, os

# Сравним скорость запроса по жанру с индексом и без
def time_query(use_index: bool, n=200):
    """Запрос SELECT по genre — с индексом и без."""
    db_path = "bench.db"
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("DROP TABLE IF EXISTS bench_books")
    cur.execute("""
        CREATE TABLE bench_books (
            id INTEGER PRIMARY KEY,
            title TEXT, price REAL, genre TEXT
        )
    """)
    genres = ["Роман","Фантастика","История","Детектив","Наука","Поэзия"]
    cur.executemany(
        "INSERT INTO bench_books VALUES (?,?,?,?)",
        [(i, f"Book {i}", round(random.uniform(100,3000),2), random.choice(genres))
         for i in range(10_000)]
    )
    if use_index:
        cur.execute("CREATE INDEX ix_genre ON bench_books(genre)")
    conn.commit()

    t0 = time.perf_counter()
    for _ in range(n):
        cur.execute("SELECT * FROM bench_books WHERE genre='Наука'").fetchall()
    elapsed = (time.perf_counter() - t0) / n

    conn.close()
    os.remove(db_path)
    return elapsed

t_no_idx = time_query(use_index=False)
t_idx    = time_query(use_index=True)

print(f"\n🔍 Индекс по полю genre (10 000 строк, 200 запросов):")
print(f"  Без индекса: {t_no_idx*1000:.3f} ms  (full table scan)")
print(f"  С индексом:  {t_idx*1000:.3f} ms")
print(f"  Ускорение:   {t_no_idx/t_idx:.1f}×")

# %% [markdown]
# ## Часть 7: Query API vs Raw SQL — сравнение

# %%
# ORM Query API
with SessionLocal() as session:
    top_customers = (
        session.query(
            Customer.name,
            func.count(Order.id).label("orders_count"),
            func.sum(OrderItem.qty * OrderItem.price_at_purchase).label("spent"),
        )
        .join(Order, Order.customer_id == Customer.id)
        .join(OrderItem, OrderItem.order_id == Order.id)
        .filter(Order.status == "delivered")
        .group_by(Customer.id)
        .order_by(func.sum(OrderItem.qty * OrderItem.price_at_purchase).desc())
        .limit(5)
        .all()
    )

print("\n🏆 Топ клиентов (ORM Query API):")
for c in top_customers:
    spent = c.spent or 0
    print(f"  {c.name:<30}  {c.orders_count} заказов  {spent:>10,.2f} руб.")

# Raw SQL (эквивалентно, но быстрее для сложных запросов)
with engine.connect() as conn:
    raw = conn.execute(text("""
        SELECT c.name,
               COUNT(o.id)                              AS orders_count,
               ROUND(SUM(oi.qty * oi.price_at_purchase),2) AS spent
        FROM customers c
        JOIN orders o      ON o.customer_id = c.id
        JOIN order_items oi ON oi.order_id  = o.id
        WHERE o.status = 'delivered'
        GROUP BY c.id
        ORDER BY spent DESC
        LIMIT 5
    """))
    print("\n🏆 Топ клиентов (Raw SQL):")
    for r in raw:
        print(f"  {r.name:<30}  {r.orders_count} заказов  {r.spent or 0:>10,.2f} руб.")

# %% [markdown]
# ## Итог
# | Тема | Продемонстрировано |
# |---|---|
# | Модели и связи | One-to-Many (Order→Items), Many-to-Many (Book↔Author) |
# | SQL | SELECT, JOIN, GROUP BY, агрегации, UPDATE |
# | Транзакции (ACID) | Атомарное списание со склада с откатом при ошибке |
# | N+1 problem | Замер и ускорение через `selectinload` |
# | Индексы | Бенчмарк full scan vs index scan |
# | Query API vs Raw SQL | Сравнение синтаксиса и применимости |
