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

    print("╔" + "═" * 109 + "╗")
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

def print_similar_customers(similar, id):
    if not similar:
        print("❌ Клиентов с похожими музыкальными предпочтениями нет!")
        return

    print("╔" + "═" * 67 + "╗")
    print("║" + f" КЛИЕНТЫ С ПОХОЖИМИ ПРЕДПОЧТЕНИЯМИ КАК У КЛИЕНТА id = {id}".center(67) + "║")
    print("╠" + "═" * 67 + "╣")

    print("║ ID │"
          + "Имя".center(15) + "│"
          + "Фамилия".center(20) + "│"
          + "Коэффициент схожести".center(25)
          + "║")

    print("╠" + "═" * 4 + "╪"
          + "═" * 15 + "╪"
          + "═" * 20 + "╪"
          + "═" * 25 + "╣")

    for track in similar:
        fname = (track["fname"][:11] + "...") if len(track["fname"]) > 11 else track["fname"].center(13)
        lname = (track["lname"][:16] + "...") if len(track["lname"]) > 16 else track["lname"].center(18)

        id = str(track["id"]).rjust(2)
        similarity = f"{track['similarity']}".center(23)

        print(f"║ {id} │ {fname} │ {lname} │ {similarity} ║")

    print("╚" + "═" * 67 + "╝")

def print_collab_recommendation(tracks, id):
    if not tracks:
        print("❌ Нет рекомендаций на основе похожих клиентов!")
        return

    print("╔" + "═" * 54 + "╗")
    print("║" + f" РЕКОМЕНДОВАННЫЕ ТРЕКИ НА ОСНОВЕ ПОХОЖИХ КЛИЕНТОВ".center(54) + "║")
    print("╠" + "═" * 54 + "╣")

    print("║"
          + "ID".center(6) + "│"
          + "Название трека".center(32) + "│"
          + "Популярность".center(14)
          + "║")

    print("╠" + "═" * 6 + "╪"
          + "═" * 32 + "╪"
          + "═" * 14 + "╣")

    for track in tracks:
        name = (track["name"][:28] + "...") if len(track["name"]) > 28 else track["name"].ljust(30)

        id = str(track["track_id"]).center(4)
        popularity = f"{track['popularity']}".center(12)

        print(f"║ {id} │ {name} │ {popularity} ║")

    print("╚" + "═" * 54 + "╝")

def print_collab_recommendation(tracks, id):
    if not tracks:
        print("❌ Нет рекомендаций на основе похожих клиентов!")
        return

    print("╔" + "═" * 54 + "╗")
    print("║" + f" РЕКОМЕНДОВАННЫЕ ТРЕКИ НА ОСНОВЕ ПОХОЖИХ КЛИЕНТОВ".center(54) + "║")
    print("╠" + "═" * 54 + "╣")

    print("║"
          + "ID".center(6) + "│"
          + "Название трека".center(32) + "│"
          + "Популярность".center(14)
          + "║")

    print("╠" + "═" * 6 + "╪"
          + "═" * 32 + "╪"
          + "═" * 14 + "╣")

    for track in tracks:
        name = (track["name"][:28] + "...") if len(track["name"]) > 28 else track["name"].ljust(30)

        id = str(track["track_id"]).center(4)
        popularity = f"{track['popularity']}".center(12)

        print(f"║ {id} │ {name} │ {popularity} ║")

    print("╚" + "═" * 54 + "╝")

def print_playlist(tracks, id):
    if not tracks:
        print("❌ Невозможно создать плейлист!")
        return

    print("╔" + "═" * 90 + "╗")
    print("║" + f"Персональный плейлист для клиента id = {id}".center(90) + "║")
    print("╠" + "═" * 90 + "╣")

    print("║"
          + "ID".center(6) + "│"
          + "Название трека".center(42) + "│"
          + "Обоснование рекомендации".center(40)
          + "║")

    print("╠" + "═" * 6 + "╪"
          + "═" * 42 + "╪"
          + "═" * 40 + "╣")

    for track in tracks:
        name = (track["name"][:37] + "...") if len(track["name"]) > 37 else track["name"].ljust(40)

        id = str(track["track_id"]).ljust(4)
        reason = f"{track['reason']}".ljust(38)

        print(f"║ {id} │ {name} │ {reason} ║")

    print("╚" + "═" * 90 + "╝")

def print_dashboard(dashboard):
    if not dashboard:
        print("❌ Невозможно создать дашборд!")
        return

    print("╔" + "═" * 76 + "╗")
    print("║" + f"ДАШБОРД".center(76) + "║")
    print("╠" + "═" * 76 + "╣")

    print("║ "+ f"Количество сгенерированных плейлистов : {dashboard.get('total_playlists')}".ljust(74)+" ║")
    print("╠" + "═" * 76 + "╣")
    print("║" + " " * 76 + "║")
    print("║ "+ "Топ-10 рекомендуемых треков".center(74)+" ║")
    print("╟" + "─" * 76 + "╢")   
    print("║"
          + "ID".center(6) + "│"
          + "Название трека".center(42) + "│"
          + "Сколько раз рекомендован".center(26)
          + "║")

    print("╟" + "─" * 6 + "┼"
          + "─" * 42 + "┼"
          + "─" * 26 + "╢")
    tracks = dashboard.get('top_tracks')
    for track in tracks:
        name = (track["name"][:37] + "...") if len(track["name"]) > 37 else track["name"].ljust(40)

        id = str(track["id"]).ljust(4)
        times_recommended = f"{track['times_recommended']}".ljust(24)

        print(f"║ {id} │ {name} │ {times_recommended} ║")
    print("╠" + "═" * 76 + "╣")
    print("║" + " " * 76 + "║")
    print("║ "+ "Распределение рекомендаций по жанрам".center(74)+" ║")
    print("╟" + "─" * 76 + "╢")
    print("║"
          + "ID".center(6) + "│"
          + "Название жанра".center(42) + "│"
          + "Сколько раз рекомендован".center(26)
          + "║")

    print("╟" + "─" * 6 + "┼"
          + "─" * 42 + "┼"
          + "─" * 26 + "╢")
    genres = dashboard.get('genre_distribution')
    for genre in genres:
        name = (genre["name"][:37] + "...") if len(genre["name"]) > 37 else genre["name"].ljust(40)

        id = str(genre["genre_id"]).ljust(4)
        count = f"{genre['count']}".ljust(24)

        print(f"║ {id} │ {name} │ {count} ║")
    print("╠" + "═" * 76 + "╣")

    print("║ "+ f"Средняя длина плейлиста : {dashboard.get('average_playlist_length')}".ljust(74)+" ║")
    print("╚" + "═" * 76 + "╝")

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
        print_similar_customers(json_similar,customer)

        recommend_cust = service.collaborative_filtering_recommendations(customer)
        json3 = json.dumps(
            recommend_cust,
            indent=4,
            ensure_ascii=False
        )
        json_rec_similar = json.loads(json3)
        print_collab_recommendation(json_rec_similar,customer)

        playlist = service.generate_personal_playlist(customer)
        json4 = json.dumps(
            playlist,
            indent=4,
            ensure_ascii=False
        )
        json_playlist = json.loads(json4)
        print_playlist(json_playlist,customer)

        dashboard = service.recommendation_dashboard()
        json5 = json.dumps(
            dashboard,
            indent=4,
            ensure_ascii=False
        )
        json_dashboard = json.loads(json5)
        print_dashboard(json_dashboard)


        # ==============================
        # МОНИТОРИНГ И АНАЛИТИКА
        # ==============================

        print("╔" + "═" * 70 + "╗")
        print("║" + f"МОНИТОРИНГ БАЗЫ ДАННЫХ".center(70) + "║")
        print("╠" + "═" * 70 + "╣")

        db_monitor = DatabaseMonitor(session)
        print("║ "+ f"Активные соединения : {db_monitor.active_connections()}".ljust(68)+" ║")

        print("╠" + "═" * 70 + "╣")
        print("║" + " " * 70 + "║")
        print("║ "+ "Топ-5 таблиц по размеру".center(68)+" ║")
        print("╟" + "─" * 70 + "╢")
        print("║"
          + "Название таблицы".center(49) + "│"
          + "Размер".center(20)
          + "║")
        print("╟"
          + "─" * 49 + "┼"
          + "─" * 20 + "╢")

        for table in db_monitor.table_sizes()[:5]:
            print(f"║ {table[0].ljust(47)} │ {str(table[1]).center(18)} ║")

        print("╠" + "═" * 70 + "╣")
        print("║" + " " * 70 + "║")
        print("║ "+ "Использование индексов".center(68)+" ║")
        print("╟" + "─" * 70 + "╢")
        print("║"
          + "Таблица".center(23) + "│"
          + "Индекс".center(35) + "│"
          + "Количество".center(10)
          + "║")
        print("╟"
          + "─" * 23 + "┼"
          + "─" * 35 + "┼"
          + "─" * 10 + "╢")
        for idx in db_monitor.check_index_health():
            print(f"║ {idx[0].ljust(21)} │ {idx[1].ljust(33)} │ {str(idx[2]).center(9)}║")
        print("╚" + "═" * 70 + "╝")

        # ==============================
        # АНАЛИЗ МЕДЛЕННЫХ ЗАПРОСОВ
        # ==============================

        print("\n╔" + "═" * 70 + "╗")
        print("║" + f"АНАЛИЗ МЕДЛЕННЫХ ЗАПРОСОВ".center(70) + "║")
        print("╠" + "═" * 70 + "╣")

        analyzer = PerformanceAnalyzer(session)
        slow = analyzer.analyze_slow_queries()

        print("║"
          + "Запрос".center(49) + "│"
          + "Максимальное время".center(20)
          + "║")
        print("╟"
          + "─" * 49 + "┼"
          + "─" * 20 + "╢")
        for q in slow:
            print(f"║ {q["query"].ljust(47)} │ " + f"{round(q["max_time"], 2)} ms".center(18) + " ║")
        print("╚" + "═" * 70 + "╝")


        # ==============================
        # Отчёт по аудиту
        # ==============================

        print("\n╔" + "═" * 51 + "╗")
        print("║" + f"ОТЧЁТ ПО АУДИТУ".center(51) + "║")
        print("╠" + "═" * 51 + "╣")

        audit_service = AuditReportService(session)

        report = audit_service.generate_audit_report(
            start_date=datetime.now().astimezone() - timedelta(days=30),
            end_date=datetime.now().astimezone()
        )
        print("║" + " " * 51 + "║")
        print("║ "+ "Операции".center(49)+" ║")
        print("╟" + "─" * 51 + "╢")
        print("║"
          + "Тип операции".center(30) + "│"
          + "Количество операций".center(20)
          + "║")
        print("╟"
          + "─" * 30 + "┼"
          + "─" * 20 + "╢")
        
        for op in report["operations"]:
            print(f"║ {op[0].center(28)} │ {str(op[1]).center(18)} ║")

        print("╠" + "═" * 51 + "╣")
        print("║" + " " * 51 + "║")
        print("║ "+ "Топ-10 самых активных пользователей".center(49)+" ║")
        print("╟" + "─" * 51 + "╢")
        print("║"
          + "Пользователь".center(30) + "│"
          + "Активность".center(20)
          + "║")
        print("╟"
          + "─" * 30 + "┼"
          + "─" * 20 + "╢")
        for user in report["top_users"]:
            print(f"║ {(user[0].center(28)) if user[0] else 'none'.center(28)} │ {str(user[1]).center(18)} ║")

        print("╠" + "═" * 51 + "╣")
        print("║" + " " * 51 + "║")
        print("║ "+ "Топ-10 самых изменяемых таблиц".center(49)+" ║")
        print("╟" + "─" * 51 + "╢")
        print("║"
          + "Название таблицы".center(30) + "│"
          + "Количество изменений".center(20)
          + "║")
        print("╟"
          + "─" * 30 + "┼"
          + "─" * 20 + "╢")
        for table in report["top_tables"]:
            print(f"║ {table[0].ljust(28)} │ {str(table[1]).center(18)} ║")

        print("╚" + "═" * 51 + "╝")

        # ==============================
        # CLEANUP OLD AUDIT LOGS
        # ==============================

        print("\n╔" + "═" * 51 + "╗")
        print("║" + f"Автоматическая очистка старых логов".center(51) + "║")
        print("╠" + "═" * 51 + "╣")
        cleanup_service = AuditCleanupService(session)
        deleted = cleanup_service.cleanup_old_audit_logs()

        print("║ "+ f"Удалено {deleted} старых логов".ljust(49)+" ║")
        print("╚" + "═" * 51 + "╝")

        
    finally:
        session.close()


if __name__ == "__main__":
    main()
