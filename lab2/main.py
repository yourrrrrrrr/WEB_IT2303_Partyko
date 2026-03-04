from database import SessionLocal
from recommendations import RecommendationService
import json
from sqlalchemy import text
import audit_events
from audit_and_monitoring import (
    monitor_query_performance,
    PerformanceAnalyzer,
    AuditReportService,
    AuditCleanupService,
    DatabaseMonitor
)
from datetime import datetime, timedelta

def print_tracks_report(tracks, id):
    if not tracks:
        print("❌ Нет рекомендованных треков")
        return

    print("\n╔" + "═" * 109 + "╗")
    print("║" + f" РЕКОМЕНДОВАННЫЕ ТРЕКИ ДЛЯ КЛИЕНТА id = {id}".center(109) + "║")
    print("╠" + "═" * 109 + "╣")

    print("║ ID │"
          + "Название".center(32) + "│"
          + "Жанр".center(6) + "│"
          + "Автор".center(40) + "│"
          + "Цена".center(8) + "│"
          + "Длительность".center(14)
          + "║")

    print("╠" + "═" * 4 + "╪"
          + "═" * 32 + "╪"
          + "═" * 6 + "╪"
          + "═" * 40 + "╪"
          + "═" * 8 + "╪"
          + "═" * 14 + "╣")

    for track in tracks:

        name = (track["name"][:27] + "...") if len(track["name"]) > 27 else track["name"].ljust(30)
        autor = (track["composer"][:35] + "...") if len(track["composer"]) > 35 else track["composer"].ljust(38)

        minutes = track["milliseconds"] // 60000
        seconds = (track["milliseconds"] % 60000) // 1000
        duration = f"{minutes}:{str(seconds).zfill(2)}".center(12)

        track_id = str(track["track_id"]).rjust(2)
        genre = str(track["genre_id"]).center(4)
        price = f"${track['unit_price']}".center(6)

        print(f"║ {track_id} │ {name} │ {genre} │ {autor} │ {price} │ {duration} ║")

    print("╚" + "═" * 109 + "╝")

def main():
    """Главная функция для демонстрации всех возможностей"""
    
    # Создать сессию
    session = SessionLocal()
    
    try:
        customer = input('Введите id клиента:\n')
        service = RecommendationService(session)
        recommend_track = service.recommend_tracks_by_purchase_history(customer)
        json1 = json.dumps(
            [t.to_dict() for t in recommend_track],
            indent=4,
            ensure_ascii=False
        )
        # print(json1)
            # t = session.execute(text("SELECT first_name, last_name FROM customer WHERE customer_id = 1"))
            # result = t.fetchone()
            # print(result)
        json_recommend = json.loads(json1)
        print_tracks_report(json_recommend,customer)

        similar_customers = service.find_similar_customers(customer)
        json2 = json.dumps(
            similar_customers,
            indent=4,
            ensure_ascii=False
        )
        json_similar = json.loads(json2)
        print(json2)

        recommend_cust = service.collaborative_filtering_recommendations(customer)
        json3 = json.dumps(
            recommend_cust,
            indent=4,
            ensure_ascii=False
        )
        # json_similar = json.loads(json2)
        print(json3)

        playlist = service.generate_personal_playlist(customer)
        json4 = json.dumps(
            playlist,
            indent=4,
            ensure_ascii=False
        )
        # json_similar = json.loads(json2)
        print(json4)

        dashboard = service.recommendation_dashboard()
        json5 = json.dumps(
            dashboard,
            indent=4,
            ensure_ascii=False
        )
        # json_similar = json.loads(json2)
        print(json5)

        # ==============================
        # МОНИТОРИНГ И АНАЛИТИКА
        # ==============================

        print("\n" + "="*80)
        print("DATABASE MONITORING")
        print("="*80)

        db_monitor = DatabaseMonitor(session)

        print("Active connections:", db_monitor.active_connections())

        print("\nTop tables by size:")
        for table in db_monitor.table_sizes()[:5]:
            print(table)

        print("\nIndex usage:")
        for idx in db_monitor.check_index_health()[:5]:
            print(idx)

        print("\nThreshold check:", db_monitor.check_thresholds())


        # ==============================
        # АНАЛИЗ МЕДЛЕННЫХ ЗАПРОСОВ
        # ==============================

        print("\n" + "="*80)
        print("SLOW QUERY ANALYSIS")
        print("="*80)

        analyzer = PerformanceAnalyzer(session)

        slow = analyzer.analyze_slow_queries()

        for q in slow:
            print("\nQuery:", q["query"])
            print("Max time:", round(q["max_time"], 2), "ms")

        print("\nIndex suggestions:")
        for suggestion in analyzer.suggest_indexes():
            print(suggestion)


        # ==============================
        # AUDIT REPORT
        # ==============================

        print("\n" + "="*80)
        print("AUDIT REPORT")
        print("="*80)

        audit_service = AuditReportService(session)

        report = audit_service.generate_audit_report(
            start_date=datetime.utcnow() - timedelta(days=30),
            end_date=datetime.utcnow()
        )

        print("\nOperations:")
        for op in report["operations"]:
            print(op)

        print("\nTop users:")
        for user in report["top_users"]:
            print(user)

        print("\nTop tables:")
        for table in report["top_tables"]:
            print(table)


        # ==============================
        # CLEANUP OLD AUDIT LOGS
        # ==============================

        print("\n" + "="*80)
        print("AUDIT CLEANUP")
        print("="*80)

        cleanup_service = AuditCleanupService(session)

        deleted = cleanup_service.cleanup_old_audit_logs(days=180)

        print(f"Deleted {deleted} old audit logs")

        
    finally:
        session.close()


if __name__ == "__main__":
    main()
