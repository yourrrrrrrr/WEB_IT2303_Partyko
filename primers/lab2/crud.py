from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from models import Artist, Album, Track

class MusicStoreCRUD:
    """Операции CRUD для музыкального магазина"""
    
    def __init__(self, session: Session):
        self.session = session
    
    def create_album(self, artist_name: str, album_title: str, tracks_data: list = None):
        """
        Создать новый альбом с проверкой на дубликаты
        
        Args:
            artist_name: Имя исполнителя
            album_title: Название альбома
            tracks_data: Список треков (опционально)
                [{'name': 'Track 1', 'duration': 180000, 'price': 0.99}, ...]
        
        Returns:
            Album object или None при ошибке
        """
        try:
            # Шаг 1: Найти или создать исполнителя
            artist = self.session.query(Artist).filter(
                Artist.Name == artist_name
            ).first()
            
            if not artist:
                print(f"Creating new artist: {artist_name}")
                artist = Artist(Name=artist_name)
                self.session.add(artist)
                self.session.flush()  # Получить ID без commit
            else:
                print(f"Found existing artist: {artist_name} (ID: {artist.ArtistId})")
            
            # Шаг 2: Проверить дубликат альбома
            existing_album = self.session.query(Album).filter(
                Album.Title == album_title,
                Album.ArtistId == artist.ArtistId
            ).first()
            
            if existing_album:
                print(f"❌ Album '{album_title}' by '{artist_name}' already exists!")
                return None
            
            # Шаг 3: Создать альбом
            album = Album(
                Title=album_title,
                ArtistId=artist.ArtistId
            )
            self.session.add(album)
            self.session.flush()
            
            print(f"✅ Created album: {album_title} (ID: {album.AlbumId})")
            
            # Шаг 4: Добавить треки (если есть)
            if tracks_data:
                for track_data in tracks_data:
                    track = Track(
                        Name=track_data['name'],
                        AlbumId=album.AlbumId,
                        MediaTypeId=1,  # MPEG audio file по умолчанию
                        GenreId=track_data.get('genre_id', 1),
                        Milliseconds=track_data['duration'],
                        UnitPrice=track_data['price']
                    )
                    self.session.add(track)
                
                print(f"✅ Added {len(tracks_data)} tracks")
            
            # Коммит всех изменений
            self.session.commit()
            
            print(f"\n✅ SUCCESS: Album '{album_title}' created successfully!")
            return album
            
        except IntegrityError as e:
            self.session.rollback()
            print(f"❌ Database error: {e}")
            return None
        except Exception as e:
            self.session.rollback()
            print(f"❌ Error: {e}")
            return None
