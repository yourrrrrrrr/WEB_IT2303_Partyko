import time
import json
import hashlib
import statistics
from datetime import datetime, timedelta
from functools import wraps
from sqlalchemy import func, text, event
from sqlalchemy.orm import Session
from models import (
    AuditLog,
    InvoiceHistory,
    CustomerActivity,
    QueryPerformance,
    RecommendedPlaylist
)

def monitor_query_performance(func_to_monitor):
    @wraps(func_to_monitor)
    def wrapper(self, *args, **kwargs):
        start_time = time.time()

        result = func_to_monitor(self, *args, **kwargs)

        execution_time = (time.time() - start_time) * 1000  # ms

        if execution_time > 100:
            sql_hash = hashlib.md5(
                func_to_monitor.__name__.encode()
            ).hexdigest()

            record = self.session.query(QueryPerformance).filter(
                QueryPerformance.query_hash == sql_hash
            ).first()

            if record:
                record.execution_count += 1
                record.total_time += execution_time
                record.max_time = max(record.max_time, execution_time)
                record.min_time = min(record.min_time, execution_time)
                record.last_executed = datetime.utcnow()
            else:
                record = QueryPerformance(
                    query_hash=sql_hash,
                    query_text=func_to_monitor.__name__,
                    execution_count=1,
                    total_time=execution_time,
                    max_time=execution_time,
                    min_time=execution_time,
                    last_executed=datetime.utcnow()
                )
                self.session.add(record)

            self.session.flush()

        return result
    return wrapper

class PerformanceAnalyzer:

    def __init__(self, session: Session):
        self.session = session

    def analyze_slow_queries(self):
        slow_queries = (
            self.session.query(QueryPerformance)
            .order_by(QueryPerformance.max_time.desc())
            .limit(10)
            .all()
        )

        analysis = []

        for q in slow_queries:
            analysis.append({
                "query": q.query_text,
                "max_time": q.max_time
            })

        return analysis
    
    def suggest_indexes(self):
        slow_queries = (
            self.session.query(QueryPerformance)
            .filter(QueryPerformance.max_time > 100)
            .all()
        )

        suggestions = []

        for q in slow_queries:
            if "WHERE" in q.query_text.upper():
                suggestions.append(
                    f"-- Рассмотреть индекс для запроса: {q.query_text}"
                )

        return suggestions
    
class AuditReportService:

    def __init__(self, session: Session):
        self.session = session

    def generate_audit_report(self, start_date, end_date):
        operations = (
            self.session.query(
                AuditLog.operation_type,
                func.count().label("count")
            )
            .filter(AuditLog.timestamp.between(start_date, end_date))
            .group_by(AuditLog.operation_type)
            .all()
        )

        top_users = (
            self.session.query(
                AuditLog.user_id,
                func.count().label("activity")
            )
            .group_by(AuditLog.user_id)
            .order_by(func.count().desc())
            .limit(10)
            .all()
        )

        top_tables = (
            self.session.query(
                AuditLog.table_name,
                func.count().label("changes")
            )
            .group_by(AuditLog.table_name)
            .order_by(func.count().desc())
            .limit(10)
            .all()
        )

        return {
            "operations": operations,
            "top_users": top_users,
            "top_tables": top_tables
        }
    
class AuditCleanupService:

    def __init__(self, session: Session):
        self.session = session

    def cleanup_old_audit_logs(self, days=90):
        try:
            threshold = datetime.utcnow() - timedelta(days=days)

            old_logs = (
                self.session.query(AuditLog)
                .filter(AuditLog.timestamp < threshold)
                .all()
            )

            # Архивирование можно реализовать bulk insert
            archive_data = [
                {
                    "operation_type": log.operation_type,
                    "table_name": log.table_name
                }
                for log in old_logs
            ]

            self.session.query(AuditLog).filter(
                AuditLog.timestamp < threshold
            ).delete(synchronize_session=False)

            self.session.commit()

            return len(old_logs)

        except Exception as e:
            self.session.rollback()
            raise e
        
class DatabaseMonitor:

    def __init__(self, session: Session):
        self.session = session

    def active_connections(self):
        result = self.session.execute(
            text("SELECT count(*) FROM pg_stat_activity")
        ).scalar()
        return result

    def table_sizes(self):
        result = self.session.execute(
            text("""
                SELECT relname,
                pg_size_pretty(pg_total_relation_size(relid))
                FROM pg_catalog.pg_statio_user_tables
                ORDER BY pg_total_relation_size(relid) DESC
            """)
        ).fetchall()

        return result

    def check_index_health(self):
        result = self.session.execute(
            text("""
                SELECT relname, idx_scan
                FROM pg_stat_user_indexes
            """)
        ).fetchall()

        return result

    def check_thresholds(self):
        connections = self.active_connections()
        if connections > 1000:
            return "ALERT: Too many connections!"
        return "OK"