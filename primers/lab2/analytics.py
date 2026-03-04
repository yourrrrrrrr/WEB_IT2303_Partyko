from sqlalchemy import func, desc, extract
from sqlalchemy.orm import Session
from models import Track, Artist, Album, Invoice, InvoiceItem, Customer, Genre
from database import SessionLocal
import pandas as pd
from datetime import datetime, timedelta

class MusicStoreAnalytics:
    """Класс для аналитики музыкального магазина"""
    
    def __init__(self, session: Session):
        self.session = session
    
    def top_selling_tracks(self, limit=10):
        """
        1. Топ-10 самых продаваемых треков
        Возвращает: название трека, исполнитель, альбом, количество продаж
        """
        query = (
            self.session.query(
                Track.Name.label('track_name'),
                Artist.Name.label('artist_name'),
                Album.Title.label('album_title'),
                func.sum(InvoiceItem.Quantity).label('total_sold'),
                func.sum(InvoiceItem.Quantity * InvoiceItem.UnitPrice).label('revenue')
            )
            .join(InvoiceItem, Track.TrackId == InvoiceItem.TrackId)
            .join(Album, Track.AlbumId == Album.AlbumId)
            .join(Artist, Album.ArtistId == Artist.ArtistId)
            .group_by(Track.TrackId, Track.Name, Artist.Name, Album.Title)
            .order_by(desc('total_sold'))
            .limit(limit)
        )
        
        results = query.all()
        
        # Преобразовать в pandas DataFrame для удобства
        df = pd.DataFrame(results, columns=[
            'Track', 'Artist', 'Album', 'Total Sold', 'Revenue'
        ])
        
        print("\n" + "="*80)
        print("TOP 10 BEST SELLING TRACKS")
        print("="*80)
        print(df.to_string(index=False))
        
        return df
    
    def revenue_by_country(self):
        """
        2. Выручка по странам
        Возвращает: страна, общая выручка, количество счетов
        """
        query = (
            self.session.query(
                Customer.Country.label('country'),
                func.sum(Invoice.Total).label('total_revenue'),
                func.count(Invoice.InvoiceId).label('invoice_count'),
                func.count(func.distinct(Customer.CustomerId)).label('customer_count')
            )
            .join(Invoice, Customer.CustomerId == Invoice.CustomerId)
            .group_by(Customer.Country)
            .order_by(desc('total_revenue'))
        )
        
        results = query.all()
        
        df = pd.DataFrame(results, columns=[
            'Country', 'Total Revenue', 'Invoices', 'Customers'
        ])
        
        print("\n" + "="*80)
        print("REVENUE BY COUNTRY")
        print("="*80)
        print(df.to_string(index=False))
        
        return df
    
    def average_order_value_by_country(self):
        """
        3. Средний чек по странам
        Возвращает: страна, средний чек
        """
        query = (
            self.session.query(
                Customer.Country.label('country'),
                func.avg(Invoice.Total).label('avg_order_value'),
                func.min(Invoice.Total).label('min_order'),
                func.max(Invoice.Total).label('max_order')
            )
            .join(Invoice, Customer.CustomerId == Invoice.CustomerId)
            .group_by(Customer.Country)
            .order_by(desc('avg_order_value'))
        )
        
        results = query.all()
        
        df = pd.DataFrame(results, columns=[
            'Country', 'Avg Order Value', 'Min Order', 'Max Order'
        ])
        
        print("\n" + "="*80)
        print("AVERAGE ORDER VALUE BY COUNTRY")
        print("="*80)
        print(df.to_string(index=False))
        
        return df
    
    def popular_genres_by_country(self, top_n=5):
        """
        4. Самые популярные жанры по странам
        Возвращает: страна, жанр, количество проданных треков
        """
        # Подзапрос для ранжирования жанров в каждой стране
        from sqlalchemy import over
        
        subquery = (
            self.session.query(
                Customer.Country.label('country'),
                Genre.Name.label('genre'),
                func.sum(InvoiceItem.Quantity).label('tracks_sold'),
                func.row_number().over(
                    partition_by=Customer.Country,
                    order_by=desc(func.sum(InvoiceItem.Quantity))
                ).label('rank')
            )
            .join(Invoice, Customer.CustomerId == Invoice.CustomerId)
            .join(InvoiceItem, Invoice.InvoiceId == InvoiceItem.InvoiceId)
            .join(Track, InvoiceItem.TrackId == Track.TrackId)
            .join(Genre, Track.GenreId == Genre.GenreId)
            .group_by(Customer.Country, Genre.Name)
        ).subquery()
        
        query = (
            self.session.query(subquery)
            .filter(subquery.c.rank <= top_n)
            .order_by(subquery.c.country, subquery.c.rank)
        )
        
        results = query.all()
        
        df = pd.DataFrame(results, columns=[
            'Country', 'Genre', 'Tracks Sold', 'Rank'
        ])
        
        print("\n" + "="*80)
        print(f"TOP {top_n} GENRES BY COUNTRY")
        print("="*80)
        print(df.to_string(index=False))
        
        return df
    
    def sales_trend_by_month(self, months=12):
        """
        5. Динамика продаж по месяцам
        Возвращает: месяц, количество счетов, общая выручка
        """
        # Дата год назад
        start_date = datetime.now() - timedelta(days=365)
        
        query = (
            self.session.query(
                func.to_char(Invoice.InvoiceDate, 'YYYY-MM').label('month'),
                func.count(Invoice.InvoiceId).label('invoice_count'),
                func.sum(Invoice.Total).label('revenue'),
                func.avg(Invoice.Total).label('avg_invoice')
            )
            .filter(Invoice.InvoiceDate >= start_date)
            .group_by('month')
            .order_by('month')
        )
        
        results = query.all()
        
        df = pd.DataFrame(results, columns=[
            'Month', 'Invoices', 'Revenue', 'Avg Invoice'
        ])
        
        print("\n" + "="*80)
        print("SALES TREND BY MONTH (LAST 12 MONTHS)")
        print("="*80)
        print(df.to_string(index=False))
        
        return df
