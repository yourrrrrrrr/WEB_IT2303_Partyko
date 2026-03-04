from sqlalchemy import event
from sqlalchemy.orm import Session
from datetime import datetime
import json
from models import AuditLog
from datetime import datetime, date
from decimal import Decimal

def serialize_model(obj):
    data = {}

    for column in obj.__table__.columns:
        value = getattr(obj, column.name)

        if isinstance(value, (datetime, date)):
            value = value.isoformat()

        elif isinstance(value, Decimal):
            value = float(value)

        data[column.name] = value

    return data

@event.listens_for(Session, "after_flush")
def log_changes(session, flush_context):

    for instance in session.new:

        # 🚫 НЕ логируем audit_log
        if instance.__tablename__ == "audit_log":
            continue

        log = AuditLog(
            operation_type="INSERT",
            table_name=instance.__tablename__,
            record_id=getattr(instance, "id", None),
            timestamp=datetime.utcnow(),
            new_values=json.dumps(serialize_model(instance))
        )

        session.add(log)

    # UPDATE
    for instance in session.dirty:
        log = AuditLog(
            operation_type="UPDATE",
            table_name=instance.__tablename__,
            record_id=getattr(instance, "id", None),
            timestamp=datetime.utcnow(),
            new_values=json.dumps(instance.__dict__, default=str)
        )
        session.add(log)

    # DELETE
    for instance in session.deleted:
        log = AuditLog(
            operation_type="DELETE",
            table_name=instance.__tablename__,
            record_id=getattr(instance, "id", None),
            timestamp=datetime.utcnow(),
            old_values=json.dumps(instance.__dict__, default=str)
        )
        session.add(log)