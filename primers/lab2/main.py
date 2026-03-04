from database import SessionLocal
from analytics import MusicStoreAnalytics
from crud import MusicStoreCRUD
from transactions import InvoiceTransaction

def main():
    """Главная функция для демонстрации всех возможностей"""
    
    # Создать сессию
    session = SessionLocal()
    
    try:
        print("\n" + "="*80)
        print("MUSIC STORE ANALYTICS SYSTEM")
        print("="*80)
        
        # ===== АНАЛИТИКА =====
        
        analytics = MusicStoreAnalytics(session)
        
        # 1. Топ-10 треков
        top_tracks = analytics.top_selling_tracks(10)
        
        # 2. Выручка по странам
        revenue_by_country = analytics.revenue_by_country()
        
        # 3. Средний чек
        avg_order = analytics.average_order_value_by_country()
        
        # 4. Популярные жанры
        popular_genres = analytics.popular_genres_by_country(3)
        
        # 5. Динамика продаж
        sales_trend = analytics.sales_trend_by_month(12)
        
        # ===== CRUD ОПЕРАЦИИ =====
        
        print("\n" + "="*80)
        print("CREATING NEW ALBUM")
        print("="*80)
        
        crud = MusicStoreCRUD(session)
        
        # Создать новый альбом
        new_album = crud.create_album(
            artist_name="Elena Researcher",
            album_title="Data Science Beats",
            tracks_data=[
                {
                    'name': 'The SQL Query',
                    'duration': 240000,  # 4 минуты
                    'price': 0.99,
                    'genre_id': 1
                },
                {
                    'name': 'Python Dreams',
                    'duration': 300000,  # 5 минут
                    'price': 0.99,
                    'genre_id': 1
                },
                {
                    'name': 'Machine Learning Symphony',
                    'duration': 360000,  # 6 минут
                    'price': 1.29,
                    'genre_id': 1
                }
            ]
        )
        
        # Попытка создать дубликат (должна провалиться)
        print("\n--- Attempting to create duplicate ---")
        duplicate = crud.create_album(
            artist_name="Elena Researcher",
            album_title="Data Science Beats"
        )
        
        # ===== ТРАНЗАКЦИЯ =====
        
        print("\n" + "="*80)
        print("CREATING INVOICE (TRANSACTION)")
        print("="*80)
        
        invoice_tx = InvoiceTransaction(session)
        
        # Создать счет для клиента 1
        new_invoice = invoice_tx.create_invoice_with_items(
            customer_id=1,
            track_purchases=[
                {'track_id': 1, 'quantity': 2},
                {'track_id': 5, 'quantity': 1},
                {'track_id': 10, 'quantity': 3}
            ]
        )
        
        # Попытка с несуществующим треком (должна откатиться)
        print("\n--- Attempting invalid invoice (will rollback) ---")
        invalid_invoice = invoice_tx.create_invoice_with_items(
            customer_id=1,
            track_purchases=[
                {'track_id': 1, 'quantity': 1},
                {'track_id': 99999, 'quantity': 1}  # Несуществующий трек
            ]
        )
        
        print("\n" + "="*80)
        print("DEMO COMPLETED")
        print("="*80)
        
    finally:
        session.close()


if __name__ == "__main__":
    main()
