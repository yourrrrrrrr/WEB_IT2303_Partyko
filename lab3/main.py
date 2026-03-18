from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import Base
from seed import seed_data
from queries import (
    get_course_stats, top_teachers, lazy_vs_eager_loading,
    nplus1_demo, compare_orm_vs_raw
)
from models import Base, Course, Teacher, Student, Enrollment, Submission, Lesson

engine = create_engine('postgresql://postgres:qwerty@localhost:5432/online_course',
client_encoding='utf8', echo=False, future=True)
Session = sessionmaker(bind=engine)
session = Session()

# ==============================
# Функции для красивого вывода
# ==============================

def print_course_stats(stats):
    """Вывод статистики по курсу в виде таблицы"""
    if not stats:
        print("❌ Статистика недоступна")
        return

    print("╔" + "═" * 70 + "╗")
    print("║" + f" СТАТИСТИКА КУРСА: {stats['course_title']}".center(70) + "║")
    print("╠" + "═" * 70 + "╣")

    metrics = [
        ("Количество студентов", f"{stats['total_students']} чел."),
        ("Средний прогресс", f"{stats['avg_progress']}%"),
        ("Процент завершивших", f"{stats['completion_rate']}%"),
        ("Выручка", f"{stats['revenue']:,.2f} руб.")
    ]

    for label, value in metrics:
        print(f"║ {label.ljust(30)} {value.rjust(37)} ║")

    print("╚" + "═" * 70 + "╝")


def print_top_teachers(teachers):
    """Вывод топа преподавателей"""
    if not teachers:
        print("❌ Нет данных о преподавателях")
        return

    print("╔" + "═" * 58 + "╗")
    print("║" + " ТОП ПРЕПОДАВАТЕЛЕЙ ПО РЕЙТИНГУ".center(58) + "║")
    print("╠" + "═" * 58 + "╣")
    print("║" + "№".center(3) + "│ Имя преподавателя".ljust(45) + "│ Рейтинг ║")
    print("╠" + "═" * 3 + "╪" + "═" * 44 + "╪" + "═" * 9 + "╣")

    for idx, (name, rating) in enumerate(teachers, 1):
        # Обрезаем имя, если слишком длинное
        short_name = (name[:41] + '...') if len(name) > 41 else name.ljust(43)
        rating_str = f"{rating:.2f}".rjust(7)
        print(f"║{str(idx).center(3)}│ {short_name.ljust(43)}│ {rating_str} ║")

    print("╚" + "═" * 58 + "╝")


def print_lazy_vs_eager(lazy_time, eager_time, speedup):
    """Сравнение Lazy и Eager loading"""
    print("╔" + "═" * 58 + "╗")
    print("║" + " СРАВНЕНИЕ LAZY vs EAGER LOADING".center(58) + "║")
    print("╠" + "═" * 58 + "╣")
    print(f"║ {'Lazy loading время:':<20}" + f"{lazy_time * 1000:>10.2f} ms ║".rjust(38))
    print(f"║ {'Eager loading время:':<20}" + f"{eager_time * 1000:>10.2f} ms ║".rjust(38))
    print(f"║ {'Ускорение:':<20}" + f"{speedup:>10.1f}× ║".rjust(38))
    print("╚" + "═" * 58 + "╝")


def print_nplus1(bad_time, good_time, speedup):
    """Демонстрация проблемы N+1 и её решения"""
    print("╔" + "═" * 58 + "╗")
    print("║" + " ПРОБЛЕМА N+1 и EAGER LOADING".center(58) + "║")
    print("╠" + "═" * 58 + "╣")
    print(f"║ {'N+1 подход (без оптимизации):':<35}" + f"{bad_time * 1000:>10.2f} ms ║".rjust(23))
    print(f"║ {'Eager loading (с оптимизацией):':<35}" + f"{good_time * 1000:>10.2f} ms ║".rjust(23))
    print(f"║ {'Ускорение:':<35}" + f"{speedup:>10.1f}× ║".rjust(23))
    print("╚" + "═" * 58 + "╝")


def print_orm_vs_raw(orm_result, raw_result, orm_time, raw_time):
    """Сравнение ORM Query API и Raw SQL"""
    print("╔" + "═" * 78 + "╗")
    print("║" + " СРАВНЕНИЕ ORM QUERY API vs RAW SQL".center(78) + "║")
    print("╠" + "═" * 78 + "╣")

    # Вывод результатов ORM
    print("║" + " ORM Query API (топ-5 студентов)".center(78) + "║")
    print("╠" + "═" * 4 + "╦" + "═" * 43 + "╦" + "═" * 14 + "╦" + "═" * 14 + "╣")
    print("║" + "ID".center(4) + "║ "+ "Имя студента".ljust(41) + " ║ Средний балл ║ Сдано уроков ║")
    print("╠" + "═" * 4 + "╬" + "═" * 43 + "╬" + "═" * 14 + "╬" + "═" * 14 + "╣")

    for row in orm_result:
        student_id = str(row[0]).center(4)
        name = (row[1][:39] + '...') if len(row[1]) > 39 else row[1].ljust(41)
        avg = f"{float(row[3]):.2f}".rjust(12)   # row[3] — средний балл
        passed = str(row[4]).rjust(12)           # row[4] — количество сданных уроков
        print(f"║{student_id}║ {name} ║ {avg} ║ {passed} ║")

    print("╠" + "═" * 78 + "╣")

    # Вывод результатов Raw SQL
    print("║" + " Raw SQL (топ-5 студентов)".center(78) + "║")
    print("╠" + "═" * 4 + "╦" + "═" * 43 + "╦" + "═" * 14 + "╦" + "═" * 14 + "╣")
    print("║" + "ID".center(4) + "║ "+ "Имя студента".ljust(41) + " ║ Средний балл ║ Сдано уроков ║")
    print("╠" + "═" * 4 + "╬" + "═" * 43 + "╬" + "═" * 14 + "╬" + "═" * 14 + "╣")

    for row in raw_result:
        student_id = str(row[0]).center(4)
        name = (row[1][:39] + '...') if len(row[1]) > 39 else row[1].ljust(41)
        avg = f"{float(row[3]):.2f}".rjust(12)   # row[3] — средний балл
        passed = str(row[5]).rjust(12)           # row[5] — количество сданных уроков
        print(f"║{student_id}║ {name} ║ {avg} ║ {passed} ║")

    print("╠" + "═" * 78 + "╣")
    print(f"║ {'Время выполнения ORM:':<38}" + f"{orm_time * 1000:>10.2f} ms ║".rjust(40))
    print(f"║ {'Время выполнения Raw SQL:':<38}" + f"{raw_time * 1000:>10.2f} ms ║".rjust(40))
    print(f"║ {'Raw SQL быстрее в':<38}" + f"{raw_time/orm_time if orm_time>0 else 0:>10.1f}× ║".rjust(40))
    print("╚" + "═" * 78 + "╝")

if __name__ == '__main__':
    # Раскомментируйте для заполнения БД
    # seed_data()

    # 1. Статистика курса
    course = session.query(Course).first()
    if course:
        stats = get_course_stats(course.id, session)
        print_course_stats(stats)

    # 2. Топ преподавателей
    teachers = top_teachers(3, session)
    # Преобразуем в список кортежей (имя, рейтинг) для удобства вывода
    teacher_list = [(t.name, t.avg_rating) for t in teachers]
    print_top_teachers(teacher_list)

    # 3. Lazy vs Eager
    lazy_time, eager_time, speedup = lazy_vs_eager_loading(session)
    print_lazy_vs_eager(lazy_time, eager_time, speedup)

    # 4. N+1 demo
    bad_time, good_time, speedup_n1 = nplus1_demo(session)
    print_nplus1(bad_time, good_time, speedup_n1)

    # 5. ORM vs Raw SQL
    orm_result, raw_result, orm_time, raw_time = compare_orm_vs_raw(session)
    print_orm_vs_raw(orm_result, raw_result, orm_time, raw_time)

    session.close()