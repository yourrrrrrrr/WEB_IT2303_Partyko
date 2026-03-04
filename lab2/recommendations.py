from sqlalchemy.orm import Session
from sqlalchemy import func, desc, extract
from models import Customer, Invoice, InvoiceItem, Track, Album, RecommendedPlaylist
from collections import defaultdict
from audit_and_monitoring import (
    monitor_query_performance,
    PerformanceAnalyzer,
    AuditReportService,
    AuditCleanupService,
    DatabaseMonitor
)

class RecommendationService:
    def __init__(self, session: Session):
        self.session = session

    @monitor_query_performance
    def recommend_tracks_by_purchase_history(self, customer_id, limit=10):

        # Купленные треки
        buy_track = (
            self.session.query(InvoiceItem.TrackId)
            .join(Invoice)
            .filter(Invoice.CustomerId == customer_id)
            .subquery()
        )

        # Любимые жанры
        favorite_genres = (
            self.session.query(Track.GenreId)
            .join(InvoiceItem)
            .join(Invoice)
            .filter(Invoice.CustomerId == customer_id)
            .group_by(Track.GenreId)
            .all()
        )

        genre_ids = [g[0] for g in favorite_genres]

        # Рекомендации
        recommendations = (
            self.session.query(Track)
            .filter(
                Track.GenreId.in_(genre_ids),
                ~Track.TrackId.in_(buy_track)
            )
            .limit(limit)
            .all()
        )
        return recommendations
    
    @monitor_query_performance
    def find_similar_customers(self, customer_id, limit=5):

        # Жанры и артисты текущего клиента
        user_data = (
            self.session.query(
                Track.GenreId,
                Album.ArtistId
            )
            .join(InvoiceItem, InvoiceItem.TrackId == Track.TrackId)
            .join(Invoice, Invoice.InvoiceId == InvoiceItem.InvoiceId)
            .join(Album, Album.AlbumId == Track.AlbumId)
            .filter(Invoice.CustomerId == customer_id)
            .distinct()
            .all()
        )

        if not user_data:
            return []

        user_genres = {g for g, _ in user_data}
        user_artists = {a for _, a in user_data}

        # Данные остальных клиентов
        all_data = (
            self.session.query(
                Invoice.CustomerId,
                Track.GenreId,
                Album.ArtistId
            )
            .join(InvoiceItem, InvoiceItem.InvoiceId == Invoice.InvoiceId)
            .join(Track, Track.TrackId == InvoiceItem.TrackId)
            .join(Album, Album.AlbumId == Track.AlbumId)
            .filter(Invoice.CustomerId != customer_id)
            .distinct()
            .all()
        )

        customer_genres = defaultdict(set)
        customer_artists = defaultdict(set)

        for cust_id, genre_id, artist_id in all_data:
            customer_genres[cust_id].add(genre_id)
            customer_artists[cust_id].add(artist_id)

        similarities = []

        for other_id in customer_genres:
            common_genres = len(user_genres & customer_genres[other_id])
            common_artists = len(user_artists & customer_artists[other_id])
            similarity = (common_genres * 0.5) + (common_artists * 0.5)

            if similarity > 0:
                similarities.append((other_id, similarity))

        similarities.sort(key=lambda x: x[1], reverse=True)
        similar = []
        for cust_id, _ in similarities[:limit]:
            customer = (
                self.session.query(Customer).filter(Customer.CustomerId == cust_id).first()
            )
            similar.append({'id':customer.CustomerId, 'fname':customer.FirstName, 'lname':customer.LastName})
        return similar
        # return [cust_id for cust_id, _ in similarities[:limit]]
    
    @monitor_query_performance
    def collaborative_filtering_recommendations(self, customer_id, limit=10):

        # Получаем похожих клиентов
        similar_customers = self.find_similar_customers(customer_id)

        if not similar_customers:
            return []
        similar_ids = [c['id'] for c in similar_customers]

        # треки, которые уже купил текущий клиент
        user_tracks = (
            self.session.query(InvoiceItem.TrackId)
            .join(Invoice, Invoice.InvoiceId == InvoiceItem.InvoiceId)
            .filter(Invoice.CustomerId == customer_id)
            .subquery()
        )

        # популярные треки похожих клиентов
        track_counts = (
            self.session.query(
                Track.TrackId,
                Track.Name,
                func.count(InvoiceItem.TrackId).label("popularity")
            )
            .join(InvoiceItem, InvoiceItem.TrackId == Track.TrackId)
            .join(Invoice, Invoice.InvoiceId == InvoiceItem.InvoiceId)
            .filter(
                Invoice.CustomerId.in_(similar_ids),
                ~Track.TrackId.in_(user_tracks)  # исключаем уже купленные
            )
            .group_by(Track.TrackId, Track.Name)
            .order_by(desc("popularity"))
            .limit(limit)
            .all()
        )

        recommendations = [
            {
                "track_id": t.TrackId,
                "name": t.Name,
                "popularity": t.popularity
            }
            for t in track_counts
        ]   

        return recommendations
    
    @monitor_query_performance
    def generate_personal_playlist(self, customer_id, limit=20):
        try:
            customer = self.session.query(Customer).filter(
                Customer.CustomerId == customer_id
            ).first()

            if not customer:
                raise ValueError("Клиент не найден")

            purchase_based = self.recommend_tracks_by_purchase_history(customer_id)
            collaborative = self.collaborative_filtering_recommendations(customer_id)

            if not purchase_based and not collaborative:
                raise ValueError("Нет истории покупок для генерации плейлиста")

            playlist = {}

            for track in purchase_based:
                playlist[track.TrackId] = {
                    "name": track.Name,
                    "reason": "Основан на ваших любимых жанрах"
                }

            for track in collaborative:
                if track["track_id"] not in playlist:
                    playlist[track["track_id"]] = {
                        "name": track["name"],
                        "reason": "Популярен среди подобных пользователей"
                    }

            self.session.query(RecommendedPlaylist).filter(
                RecommendedPlaylist.customer_id == customer_id
            ).delete()

            for track_id, data in playlist.items():
                rec = RecommendedPlaylist(
                    customer_id=customer_id,
                    track_id=track_id,
                    reason=data["reason"]
                )
                self.session.add(rec)

            self.session.commit()

            return [
                {
                    "track_id": tid,
                    "name": data["name"],
                    "reason": data["reason"]
                }
                for tid, data in playlist.items()
            ]

        except Exception as e:
            self.session.rollback()
            raise e
    
    @monitor_query_performance
    def recommendation_dashboard(self):
        try:
            total_playlists = self.session.query(
                func.count(func.distinct(RecommendedPlaylist.customer_id))
            ).scalar()

            top_tracks = (
                self.session.query(
                    Track.Name,
                    func.count(RecommendedPlaylist.track_id).label("times_recommended")
                )
                .join(RecommendedPlaylist, Track.TrackId == RecommendedPlaylist.track_id)
                .group_by(Track.Name)
                .order_by(desc("times_recommended"))
                .limit(10)
                .all()
            )

            # Распределение по жанрам
            genre_distribution = (
                self.session.query(
                    Track.GenreId,
                    func.count().label("count")
                )
                .join(RecommendedPlaylist, Track.TrackId == RecommendedPlaylist.track_id)
                .group_by(Track.GenreId)
                .all()
            )

            subq = (
                self.session.query(
                RecommendedPlaylist.customer_id,
                func.count().label("track_count")
                )
                .group_by(RecommendedPlaylist.customer_id)
                .subquery()
            )
            # Средняя длина плейлиста
            avg_playlist_length = (
                self.session.query(
                    func.avg(subq.c.track_count)
                )
                .select_from(
                    self.session.query(
                        RecommendedPlaylist.customer_id,
                        func.count().label("track_count")
                    )
                    .group_by(RecommendedPlaylist.customer_id)
                    .subquery()
                )
                .scalar()
            )

            return {
                "total_playlists": total_playlists,
                "top_tracks": [
                    {"name": t.Name, "times_recommended": t.times_recommended}
                    for t in top_tracks
                ],
                "genre_distribution": [
                    {"genre_id": g.GenreId, "count": g.count}
                    for g in genre_distribution
                ],
                "average_playlist_length": float(avg_playlist_length or 0)
            }

        except Exception as e:
            self.session.rollback()
            raise e

