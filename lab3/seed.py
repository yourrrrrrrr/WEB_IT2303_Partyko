from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import Base, Teacher, Course, Lesson, Student, Enrollment, Submission
from faker import Faker
import random
from datetime import datetime, timedelta

engine = create_engine('postgresql://postgres:qwerty@localhost:5432/online_course',
                       client_encoding='utf8', echo=False, future=True)
Session = sessionmaker(bind=engine)
session = Session()
fake = Faker('ru_RU')

def seed_data():
    # Очистка (аккуратно, только для демо)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)

    teachers = []
    for _ in range(10):
        t = Teacher(
            name=fake.name(),
            email=fake.unique.email(),
            bio=fake.text(200)
        )
        teachers.append(t)
    session.add_all(teachers)
    session.commit()

    courses = []
    for teacher in teachers:
        for _ in range(random.randint(1, 3)):
            c = Course(
                title=fake.sentence(nb_words=4),
                description=fake.text(300),
                price=round(random.uniform(1000, 15000), 2),
                teacher=teacher
            )
            courses.append(c)
    session.add_all(courses)
    session.commit()

    lessons = []
    for course in courses:
        num_lessons = random.randint(5, 15)
        for i in range(1, num_lessons+1):
            l = Lesson(
                title=f"sentence(nb_words=3)",
                content=fake.text(500),
                order_num=i,
                course=course
            )
            lessons.append(l)
    session.add_all(lessons)
    session.commit()

    students = []
    for _ in range(50):
        s = Student(
            name=fake.name(),
            email=fake.unique.email()
        )
        students.append(s)
    session.add_all(students)
    session.commit()

    enrollments = []
    submissions = []
    for student in students:
        # Каждый студент записывается на 2-5 курсов
        for course in random.sample(courses, k=random.randint(2, 5)):
            enrolled_at = fake.date_time_between(start_date='-1y', end_date='now')
            # Прогресс (0-100) случайно
            progress = random.randint(0, 100)
            enrollment = Enrollment(
                student=student,
                course=course,
                enrolled_at=enrolled_at,
                progress_pct=progress
            )
            enrollments.append(enrollment)
            session.add(enrollment)
            session.flush()  # чтобы получить id не нужен, но для связи ok

            # Для каждого урока курса генерируем submission с вероятностью, зависящей от прогресса
            course_lessons = course.lessons
            total_lessons = len(course_lessons)
            passed_lessons = int(total_lessons * progress / 100) if progress > 0 else 0
            for i, lesson in enumerate(course_lessons):
                if i < passed_lessons:
                    # студент сдал этот урок
                    score = random.randint(60, 100)
                    submitted_at = enrolled_at + timedelta(days=random.randint(1, 30))
                else:
                    # не сдал или не приступал (score может быть меньше 60 или None)
                    # но мы хотим, чтобы submission были только если пытался
                    # для простоты: с вероятностью 30% есть submission с низким баллом
                    if random.random() < 0.3:
                        score = random.randint(20, 59)
                        submitted_at = enrolled_at + timedelta(days=random.randint(1, 30))
                    else:
                        continue
                sub = Submission(
                    student=student,
                    lesson=lesson,
                    score=score,
                    submitted_at=submitted_at
                )
                submissions.append(sub)
    session.add_all(submissions)
    session.commit()
    print("Данные успешно сгенерированы.")

if __name__ == '__main__':
    seed_data()