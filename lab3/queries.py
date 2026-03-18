from sqlalchemy.orm import Session, joinedload, selectinload, contains_eager
from sqlalchemy import func, desc, case
from models import Teacher, Course, Lesson, Student, Enrollment, Submission
import time

def get_course_stats(course_id: int, session: Session):
    """Количество студентов, средний прогресс, процент завершивших курс, выручка."""
    course = session.get(Course, course_id)
    if not course:
        return None

    enrollments = course.enrollments
    total_students = len(enrollments)
    if total_students == 0:
        avg_progress = 0
        completion_rate = 0
        revenue = 0
    else:
        avg_progress = sum(e.progress_pct for e in enrollments) / total_students
        completed = sum(1 for e in enrollments if e.progress_pct == 100)
        completion_rate = (completed / total_students) * 100
        revenue = course.price * total_students  # предполагаем, что цена за курс фиксирована

    return {
        'course_title': course.title,
        'total_students': total_students,
        'avg_progress': round(avg_progress, 2),
        'completion_rate': round(completion_rate, 2),
        'revenue': revenue
    }

def top_teachers(n: int, session: Session):
    """Топ N преподавателей по среднему рейтингу курсов (рейтинг = avg score submissions)."""
    # Подзапрос: средний балл submission по каждому курсу
    subq = session.query(
        Submission.lesson_id,
        func.avg(Submission.score).label('avg_score')
    ).group_by(Submission.lesson_id).subquery()

    # Средний балл по курсу (усредняем по урокам)
    course_avg = session.query(
        Lesson.course_id,
        func.avg(subq.c.avg_score).label('course_avg_score')
    ).join(subq, Lesson.id == subq.c.lesson_id
    ).group_by(Lesson.course_id).subquery()

    # Средний рейтинг преподавателя (усредняем по всем его курсам)
    teachers_rating = session.query(
        Teacher.id,
        Teacher.name,
        func.coalesce(func.avg(course_avg.c.course_avg_score), 0).label('avg_rating')
    ).outerjoin(Course, Teacher.id == Course.teacher_id
    ).outerjoin(course_avg, Course.id == course_avg.c.course_id
    ).group_by(Teacher.id
    ).order_by(desc('avg_rating')
    ).limit(n).all()

    return teachers_rating

def lazy_vs_eager_loading(session: Session):
    """Сравнение Lazy и Eager loading, возвращает времена и ускорение"""
    # Lazy loading
    start = time.perf_counter()
    courses = session.query(Course).limit(50).all()
    for course in courses:
        lessons = course.lessons
    lazy_time = time.perf_counter() - start

    # Eager loading
    start = time.perf_counter()
    courses = session.query(Course).options(selectinload(Course.lessons)).limit(50).all()
    for course in courses:
        lessons = course.lessons
    eager_time = time.perf_counter() - start

    speedup = lazy_time / eager_time
    return lazy_time, eager_time, speedup

def nplus1_demo(session: Session):
    """Демонстрация N+1 и исправление, возвращает времена"""
    course = session.query(Course).first()
    if not course:
        return 0, 0, 0

    # Плохой вариант
    start = time.perf_counter()
    enrollments = course.enrollments
    for e in enrollments:
        student = e.student
        submissions = session.query(Submission).filter(
            Submission.student_id == student.id,
            Submission.lesson_id.in_([l.id for l in course.lessons])
        ).all()
    bad_time = time.perf_counter() - start

    # Хороший вариант
    start = time.perf_counter()
    enrollments = session.query(Enrollment).filter(
        Enrollment.course == course
    ).options(
        selectinload(Enrollment.student),
        selectinload(Enrollment.student, Student.submissions)
    ).all()
    for e in enrollments:
        student_subs = [s for s in e.student.submissions if s.lesson_id in [l.id for l in course.lessons]]
    good_time = time.perf_counter() - start

    speedup = bad_time / good_time
    return bad_time, good_time, speedup

def top_students_orm(session: Session, n=5):
    subq = session.query(
        Submission.student_id,
        func.avg(Submission.score).label('avg_score'),
        func.count(Submission.id).label('total_submissions'),
        func.sum(case((Submission.score >= 60, 1), else_=0)).label('passed_lessons')
    ).group_by(Submission.student_id).subquery()

    result = session.query(
        Student.id,
        Student.name,
        Student.email,
        func.coalesce(subq.c.avg_score, 0).label('avg_score'),
        func.coalesce(subq.c.passed_lessons, 0).label('passed_lessons'),
        func.coalesce(subq.c.total_submissions, 0).label('total_submissions')
    ).outerjoin(subq, Student.id == subq.c.student_id
    ).order_by(desc('avg_score')
    ).limit(n).all()
    return result

from sqlalchemy import text

def top_students_raw(session: Session, n=5):
    sql = text("""
        SELECT s.id, s.name, s.email,
               COALESCE(AVG(sub.score), 0) AS avg_score,
               COUNT(sub.id) AS total_submissions,
               SUM(CASE WHEN sub.score >= 60 THEN 1 ELSE 0 END) AS passed_lessons
        FROM students s
        LEFT JOIN submissions sub ON s.id = sub.student_id
        GROUP BY s.id, s.name, s.email
        ORDER BY avg_score DESC
        LIMIT :n
    """)
    result = session.execute(sql, {'n': n}).fetchall()
    return result

def compare_orm_vs_raw(session: Session, n=5):
    """Сравнение ORM и Raw SQL, возвращает результаты и времена"""
    # ORM
    start = time.perf_counter()
    orm_result = top_students_orm(session, n)
    orm_time = time.perf_counter() - start

    # Raw SQL
    start = time.perf_counter()
    raw_result = top_students_raw(session, n)
    raw_time = time.perf_counter() - start

    return orm_result, raw_result, orm_time, raw_time