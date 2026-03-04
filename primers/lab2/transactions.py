from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
from models import Customer, Invoice, InvoiceItem, Track
from datetime import datetime
from decimal import Decimal

class InvoiceTransaction:
    """Транзакции для работы со счетами"""
    
    def __init__(self, session: Session):
        self.session = session
    
    def create_invoice_with_items(self, customer_id: int, track_purchases: list):
        """
        Создать счет с несколькими позициями (атомарная транзакция)
        
        Args:
            customer_id: ID клиента
            track_purchases: Список покупок
                [{'track_id': 1, 'quantity': 2}, ...]
        
        Returns:
            Invoice object или None при ошибке
        """
        try:
            # Начинаем транзакцию
            # SQLAlchemy сессия автоматически создает транзакцию
            
            # Шаг 1: Проверить существование клиента
            customer = self.session.query(Customer).filter(
                Customer.CustomerId == customer_id
            ).first()
            
            if not customer:
                raise ValueError(f"Customer {customer_id} not found")
            
            print(f"Customer: {customer.full_name} ({customer.Email})")
            
            # Шаг 2: Проверить все треки и рассчитать total
            total = Decimal('0.00')
            validated_items = []
            
            for purchase in track_purchases:
                track = self.session.query(Track).filter(
                    Track.TrackId == purchase['track_id']
                ).first()
                
                if not track:
                    raise ValueError(f"Track {purchase['track_id']} not found")
                
                quantity = purchase['quantity']
                item_total = track.UnitPrice * quantity
                total += item_total
                
                validated_items.append({
                    'track': track,
                    'quantity': quantity,
                    'unit_price': track.UnitPrice,
                    'total': item_total
                })
                
                print(f"  - {track.Name}: {quantity} x ${track.UnitPrice} = ${item_total}")
            
            print(f"Total: ${total}")
            
            # Шаг 3: Создать Invoice
            invoice = Invoice(
                CustomerId=customer_id,
                InvoiceDate=datetime.now(),
                BillingAddress=customer.Address,
                BillingCity=customer.City,
                BillingState=customer.State,
                BillingCountry=customer.Country,
                BillingPostalCode=customer.PostalCode,
                Total=total
            )
            
            self.session.add(invoice)
            self.session.flush()  # Получить InvoiceId
            
            # Шаг 4: Создать InvoiceItems
            for item_data in validated_items:
                invoice_item = InvoiceItem(
                    InvoiceId=invoice.InvoiceId,
                    TrackId=item_data['track'].TrackId,
                    UnitPrice=item_data['unit_price'],
                    Quantity=item_data['quantity']
                )
                self.session.add(invoice_item)
            
            # Шаг 5: Commit транзакции
            self.session.commit()
            
            print(f"\n✅ SUCCESS: Invoice #{invoice.InvoiceId} created!")
            print(f"Total: ${total}")
            print(f"Items: {len(validated_items)}")
            
            return invoice
            
        except ValueError as e:
            # Откатить транзакцию
            self.session.rollback()
            print(f"❌ Validation error: {e}")
            return None
            
        except SQLAlchemyError as e:
            # Откатить транзакцию
            self.session.rollback()
            print(f"❌ Database error: {e}")
            return None
            
        except Exception as e:
            # Откатить транзакцию
            self.session.rollback()
            print(f"❌ Unexpected error: {e}")
            return None
