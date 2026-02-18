import requests
from typing import List, Dict
import statistics

class UserActivityAnalyzer:
    """
    Анализатор активности пользователей.
    """
    
    def __init__(self):
        self.base_url = "https://jsonplaceholder.typicode.com"
        self.users = []
        self.user_stats = []
        self.session = requests.Session()
        # Устанавливаем заголовки по умолчанию для всех запросов
        self.session.headers.update({
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'TodoClient/1.0 (Educational)'
        })
    
    def fetch_all_users(self) -> List[Dict]:
        url = f"{self.base_url}/users"
        try:
            response = self.session.get(url)
            todos = response.json()
            
            print(f"\n📦 Получено пользователей: {len(todos)}")
    
            # if todos:
            #     print("\n📝 Примеры пользователей:")
            #     for todo in todos[:3]:
            #         print(f"   [{todo['id']}] {todo['name']}")
            
            return todos
            
        except requests.exceptions.RequestException as e:
            print(f"\n❌ Ошибка при получении пользователей: {e}")
            return []
        
    
    def fetch_user_todos(self, user_id: int) -> List[Dict]:
        url = f"{self.base_url}/todos"
        params = {
            'userId': user_id
        }
        try:
            response = self.session.get(url, params=params)
            todos = response.json()
            # Статистика
            completed = sum(1 for t in todos if t['completed'])
            total = len(todos)
            
            # print(f"\n📊 Статистика пользователя #{user_id}:")
            # print(f"   Всего задач: {total}")
            # print(f"   Выполнено: {completed} ({completed/total*100:.1f}%)")
            # print(f"   В процессе: {total - completed}")
            
            return todos
            
        except requests.exceptions.RequestException as e:
            print(f"\n❌ Ошибка: {e}")
            return []
        
    
    def calculate_user_stats(self, user_id: int) -> Dict:
        """
        Returns:
            Словарь со статистикой:
            {
                'user_id': int,
                'name': str,
                'total_tasks': int,
                'completed_tasks': int,
                'completion_rate': float,
                'productivity_stars': int  # от 1 до 5
            }
        """
        url1 = f"{self.base_url}/todos"
        params1 = {
            'userId': user_id
        }
        url2 = f"{self.base_url}/users/{user_id}"
        response1 = self.session.get(url1, params=params1)
        todos = response1.json()
        completed = sum(1 for t in todos if t['completed'])
        total = len(todos)
        rate = completed/total*100
        stars = 0
        if rate <= 20:
            stars = 1
        elif rate <= 40:
            stars = 2
        elif rate <= 60:
            stars = 3
        elif rate <= 80:
            stars = 4
        else:
            stars = 5
        response2 = self.session.get(url2)
        user = response2.json()
        
        stat = {
            'user_id': user['id'],
            'name':  user['name'],
            'total_tasks': total,
            'completed_tasks': completed,
            'completion_rate': f'{rate:.1f}%',
            'productivity_stars': stars
        }
        return stat
    
    def analyze_all_users(self):
        self.users = self.fetch_all_users()
        for u in self.users:
            stat = self.calculate_user_stats(u['id'])
            self.user_stats.append(stat) 
      
    
    def print_report(self):
        if not self.user_stats:
            print("❌ Нет данных для отчета")
            return
    
        print("\n╔" + "═" * 70 + "╗")
        print("║" + " ОТЧЕТ ПО АКТИВНОСТИ ПОЛЬЗОВАТЕЛЕЙ".center(69) + " ║")
        print("╠" + "═" * 70 + "╣")
        print("║ ID │" + "Имя".center(20) + "│ Всего" + " │ Выполнено │" + "%".center(7) + " │ Продуктивность" + "║")
        print("╠" + "═" * 4 + "╪" + "═" * 20 + "╪" + "═" * 7 + "╪" + "═" * 11 + "╪" + "═" * 8 + "╪" + "═" * 15 + "╣")
    
        for stat in self.user_stats:
        # Звездочки продуктивности
            stars = "★" * stat['productivity_stars'] + "☆" * (5 - stat['productivity_stars'])
        
        # Форматирование строк
            user_id = str(stat['user_id']).rjust(2)
            name = (stat['name'][:15] + "...") if len(stat['name']) > 15 else stat['name'].ljust(18)
            total = str(stat['total_tasks']).center(5)
            completed = str(stat['completed_tasks']).rjust(9)
            rate = stat['completion_rate'].center(6)
            productivity = stars.rjust(13)
        
            print(f"║ {user_id} │ {name} │ {total} │ {completed} │ {rate} │ {productivity} ║")
    
        print("╚" + "═" * 4 + "═" + "═" * 20 + "═" + "═" * 7 + "═" + "═" * 11 + "═" + "═" * 8 + "═" + "═" * 15 + "╝")
    
    def find_most_productive(self) -> Dict:
        if not self.user_stats:
            print("❌ Нет данных для анализа")
            return {}
    
        def get_rate(stat):
            rate_str = stat['completion_rate'].replace('%', '')
            return float(rate_str)
    
        most_productive = max(self.user_stats, key=get_rate)
        return most_productive
    
    def find_least_productive(self) -> Dict:
        if not self.user_stats:
            print("❌ Нет данных для анализа")
            return {}
    
        # Находим пользователя с минимальным completion_rate
        def get_rate(stat):
            rate_str = stat['completion_rate'].replace('%', '')
            return float(rate_str)
    
        least_productive = min(self.user_stats, key=get_rate)
        return least_productive
    
    def create_motivation_task(self, user_id: int) -> Dict:
        url = f"{self.base_url}/todos"
        
        # Данные для отправки
        new_todo = {
            'userId': user_id,
            'title': 'Улучшить продуктивность!',
            'completed': False
        }
        
        try:
            # POST запрос с JSON данными
            response = self.session.post(url, json=new_todo)
    
            created_todo = response.json()
            print(f"\n✅ Задача создана!")
            print(f"   Присвоен ID: {created_todo['id']}")
            print(f"   Заголовок: {created_todo['title']}\n")
            return created_todo
            
            
        except requests.exceptions.RequestException as e:
            print(f"\n❌ Ошибка при создании: {e}")
            return None


# ===== ОСНОВНОЙ КОД =====

def main():
    """Основная функция"""
    
    print("="*70)
    print("АНАЛИЗАТОР АКТИВНОСТИ ПОЛЬЗОВАТЕЛЕЙ".center(70))
    print("="*70)
    
    analyzer = UserActivityAnalyzer()
    
    # 1. Проанализировать всех пользователей
    analyzer.analyze_all_users()
    
    # 2. Вывести отчет
    analyzer.print_report()
    
    # 3. Найти самого продуктивного
    most_productive = analyzer.find_most_productive()
    print(f"\n🏆 Самый продуктивный: {most_productive['name']} {most_productive['completion_rate']} ({most_productive['productivity_stars']}★)")
    
    # 4. Найти наименее продуктивного
    least_productive = analyzer.find_least_productive()
    print(f"\n📉 Наименее продуктивный: {least_productive['name']} {least_productive['completion_rate']} ({least_productive['productivity_stars']}★)")
    
    # 5. Создать мотивационную задачу
    analyzer.create_motivation_task(least_productive['user_id'])
    


if __name__ == "__main__":
    main()
