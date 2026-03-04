from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Numeric
from sqlalchemy.orm import relationship
from database import Base

class Artist(Base):
    __tablename__ = 'artist'
    
    ArtistId = Column('artist_id', primary_key=True)
    Name = Column('name')
    
    # Relationships
    albums = relationship('Album', back_populates='artist')
    
    def __repr__(self):
        return f"<Artist(id={self.ArtistId}, name='{self.Name}')>"


class Album(Base):
    __tablename__ = 'album'
    
    AlbumId = Column('album_id', primary_key=True)
    Title = Column('title', nullable=False)
    ArtistId = Column('artist_id', ForeignKey('artist.artist_id'), nullable=False)
    
    # Relationships
    artist = relationship('Artist', back_populates='albums')
    tracks = relationship('Track', back_populates='album')
    
    def __repr__(self):
        return f"<Album(id={self.AlbumId}, title='{self.Title}')>"


class Genre(Base):
    __tablename__ = 'genre'
    
    GenreId = Column('genre_id', primary_key=True)
    Name = Column('name')
    
    # Relationships
    tracks = relationship('Track', back_populates='genre')


class MediaType(Base):
    __tablename__ = 'media_type'
    
    MediaTypeId = Column('media_type_id', primary_key=True)
    Name = Column('name')
    
    # Relationships
    tracks = relationship('Track', back_populates='media_type')


class Track(Base):
    __tablename__ = 'track'
    
    TrackId = Column('track_id', primary_key=True)
    Name = Column('name', nullable=False)
    AlbumId = Column('album_id', ForeignKey('album.album_id'))
    MediaTypeId = Column('media_type_id', ForeignKey('media_type.media_type_id'), nullable=False)
    GenreId = Column('genre_id', ForeignKey('genre.genre_id'))
    Composer = Column('composer')
    Milliseconds = Column('milliseconds', nullable=False)
    Bytes = Column('bytes')
    UnitPrice = Column('unit_price', nullable=False)
    
    # Relationships
    album = relationship('Album', back_populates='tracks')
    genre = relationship('Genre', back_populates='tracks')
    media_type = relationship('MediaType', back_populates='tracks')
    invoice_items = relationship('InvoiceItem', back_populates='track')
    
    @property
    def duration_minutes(self):
        """Длительность трека в минутах"""
        return round(self.Milliseconds / 60000, 2)


class Customer(Base):
    __tablename__ = 'customer'
    
    CustomerId = Column('customer_id', primary_key=True)
    FirstName = Column('first_name', nullable=False)
    LastName = Column('last_name', nullable=False)
    Company = Column('company')
    Address = Column('address')
    City = Column('city')
    State = Column('state')
    Country = Column('country')
    PostalCode = Column('postal_code')
    Phone = Column('phone')
    Fax = Column('fax')
    Email = Column('email', nullable=False)
    SupportRepId = Column('support_rep_id', ForeignKey('employee.employee_id'))
    
    # Relationships
    invoices = relationship('Invoice', back_populates='customer')
    support_rep = relationship('Employee', back_populates='customers')
    
    @property
    def full_name(self):
        return f"{self.FirstName} {self.LastName}"


class Employee(Base):
    __tablename__ = 'employee'
    
    EmployeeId = Column('employee_id', primary_key=True)
    LastName = Column('last_name', nullable=False)
    FirstName = Column('first_name', nullable=False)
    Title = Column('title')
    ReportsTo = Column('reports_to', ForeignKey('employee.employee_id'))
    BirthDate = Column('birth_date')
    HireDate = Column('hire_date')
    Address = Column('address')
    City = Column('city')
    State = Column('state')
    Country = Column('country')
    PostalCode = Column('postal_code')
    Phone = Column('phone')
    Fax = Column('fax')
    Email = Column('email')
    
    # Relationships
    customers = relationship('Customer', back_populates='support_rep')
    manager = relationship('Employee', remote_side=[EmployeeId], backref='subordinates')


class Invoice(Base):
    __tablename__ = 'invoice'
    
    InvoiceId = Column('invoice_id', primary_key=True)
    CustomerId = Column('customer_id', ForeignKey('customer.customer_id'), nullable=False)
    InvoiceDate = Column('invoice_date', nullable=False)
    BillingAddress = Column('billing_address')
    BillingCity = Column('billing_city')
    BillingState = Column('billing_state')
    BillingCountry = Column('billing_country')
    BillingPostalCode = Column('billing_postal_code')
    Total = Column('total', nullable=False)
    
    # Relationships
    customer = relationship('Customer', back_populates='invoices')
    items = relationship('InvoiceItem', back_populates='invoice')


class InvoiceItem(Base):
    __tablename__ = 'invoice_line'
    
    InvoiceLineId = Column('invoice_line_id', primary_key=True)
    InvoiceId = Column('invoice_id', ForeignKey('invoice.invoice_id'), nullable=False)
    TrackId = Column('track_id', ForeignKey('track.track_id'), nullable=False)
    UnitPrice = Column('unit_price', nullable=False)
    Quantity = Column('quantity', nullable=False)
    
    # Relationships
    invoice = relationship('Invoice', back_populates='items')
    track = relationship('Track', back_populates='invoice_items')
    
    @property
    def total(self):
        return float(self.UnitPrice) * self.Quantity
