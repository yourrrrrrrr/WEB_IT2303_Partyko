from sqlalchemy import create_engine, Column, Integer, String, Float, ForeignKey, DateTime, Boolean, Text, Index, func
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship, sessionmaker, backref
from datetime import datetime

Base = declarative_base()

class Teacher(Base):
    __tablename__ = 'teachers'
    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    email = Column(String(100), unique=True, nullable=False)
    bio = Column(Text)
    courses = relationship('Course', back_populates='teacher')

class Course(Base):
    __tablename__ = 'courses'
    id = Column(Integer, primary_key=True)
    title = Column(String(200), nullable=False)
    description = Column(Text)
    price = Column(Float, default=0.0)
    teacher_id = Column(Integer, ForeignKey('teachers.id'), nullable=False)
    teacher = relationship('Teacher', back_populates='courses')
    lessons = relationship('Lesson', back_populates='course', order_by='Lesson.order_num')
    enrollments = relationship('Enrollment', back_populates='course', cascade='all, delete-orphan')

    # Для доступа к студентам через enrollment
    students = relationship('Student', secondary='enrollments', viewonly=True)

class Lesson(Base):
    __tablename__ = 'lessons'
    id = Column(Integer, primary_key=True)
    title = Column(String(200), nullable=False)
    content = Column(Text)
    order_num = Column(Integer, nullable=False)  # порядковый номер урока в курсе
    course_id = Column(Integer, ForeignKey('courses.id'), nullable=False)
    course = relationship('Course', back_populates='lessons')
    submissions = relationship('Submission', back_populates='lesson', cascade='all, delete-orphan')

class Student(Base):
    __tablename__ = 'students'
    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    email = Column(String(100), unique=True, nullable=False)
    enrolled_courses = relationship('Enrollment', back_populates='student')
    submissions = relationship('Submission', back_populates='student')

class Enrollment(Base):
    __tablename__ = 'enrollments'
    student_id = Column(Integer, ForeignKey('students.id'), primary_key=True)
    course_id = Column(Integer, ForeignKey('courses.id'), primary_key=True)
    enrolled_at = Column(DateTime, default=datetime.utcnow)
    progress_pct = Column(Float, default=0.0)  # процент выполнения курса
    certificate_url = Column(String(200), nullable=True)  # будет добавлено миграцией

    student = relationship('Student', back_populates='enrolled_courses')
    course = relationship('Course', back_populates='enrollments')

class Submission(Base):
    __tablename__ = 'submissions'
    id = Column(Integer, primary_key=True)
    student_id = Column(Integer, ForeignKey('students.id'), nullable=False)
    lesson_id = Column(Integer, ForeignKey('lessons.id'), nullable=False)
    score = Column(Float, nullable=False)  # балл за задание (0-100)
    submitted_at = Column(DateTime, default=datetime.utcnow)

    student = relationship('Student', back_populates='submissions')
    lesson = relationship('Lesson', back_populates='submissions')

    @property
    def is_passed(self):
        """Вычисляемое поле: сдано, если score >= 60"""
        return self.score >= 60