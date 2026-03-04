# ===== УСТАНОВКА И ИМПОРТ БИБЛИОТЕК =====

import requests
import json
from typing import Dict, List, Optional
from datetime import datetime

# ===== КОНСТАНТЫ =====

# Базовый URL API
BASE_URL = "https://jsonplaceholder.typicode.com"

# Endpoints
TODOS_ENDPOINT = f"{BASE_URL}/todos"
USERS_ENDPOINT = f"{BASE_URL}/users"

# ===== КЛАСС ДЛЯ РАБОТЫ С TODO API =====

class TodoAPIClient:
    """
    Клиент для работы с JSONPlaceholder Todos API.
    
    Этот класс демонстрирует:
    - Использование всех основных HTTP методов
    - Обработку ответов и ошибок
    - Работу с JSON данными
    - Правильное использование заголовков
    """
    
    def __init__(self, base_url: str = BASE_URL):
        """
        Инициализация клиента.
        
        Args:
            base_url: Базовый URL API
        """
        self.base_url = base_url
        self.session = requests.Session()
        
        # Устанавливаем заголовки по умолчанию для всех запросов
        self.session.headers.update({
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'TodoClient/1.0 (Educational)'
        })
    
    def _handle_response(self, response: requests.Response) -> Dict:
        """
        Универсальный обработчик HTTP ответов.
        
        Эта функция демонстрирует правильную обработку различных
        кодов статуса HTTP.
        
        Args:
            response: Объект Response от requests
            
        Returns:
            Dict с данными или информацией об ошибке
            
        Raises:
            requests.exceptions.HTTPError: При ошибках HTTP
        """
        
        print(f"\n{'='*60}")
        print(f"📊 ДЕТАЛИ ЗАПРОСА:")
        print(f"{'='*60}")
        print(f"🔗 URL: {response.url}")
        print(f"📤 Метод: {response.request.method}")
        print(f"📈 Статус: {response.status_code} {response.reason}")
        print(f"⏱️  Время ответа: {response.elapsed.total_seconds():.3f}s")
        
        # Выводим заголовки ответа (некоторые важные)
        print(f"\n📋 Важные заголовки ответа:")
        important_headers = ['Content-Type', 'Content-Length', 'Date', 'Server']
        for header in important_headers:
            if header in response.headers:
                print(f"   {header}: {response.headers[header]}")
        
        # Обрабатываем коды статуса
        if response.status_code == 200:
            print("✅ Успех: Ресурс получен")
            return response.json()
            
        elif response.status_code == 201:
            print("✅ Успех: Ресурс создан")
            return response.json()
            
        elif response.status_code == 204:
            print("✅ Успех: Ресурс удален (нет содержимого)")
            return {'message': 'Resource deleted successfully'}
            
        elif response.status_code == 404:
            print("❌ Ошибка: Ресурс не найден")
            raise requests.exceptions.HTTPError(f"Resource not found: {response.url}")
            
        elif response.status_code == 400:
            print("❌ Ошибка: Неверный запрос")
            raise requests.exceptions.HTTPError(f"Bad request: {response.text}")
            
        elif response.status_code >= 500:
            print("❌ Ошибка сервера")
            raise requests.exceptions.HTTPError(f"Server error: {response.status_code}")
            
        else:
            # Для других кодов
            response.raise_for_status()
            return response.json() if response.text else {}
    
    
    # ===== GET - ПОЛУЧЕНИЕ ДАННЫХ =====
    
    def get_all_todos(self, limit: Optional[int] = None) -> List[Dict]:
        """
        GET запрос: Получить все задачи.
        
        Демонстрирует:
        - GET запрос
        - Query параметры для пагинации
        - Обработку списка объектов
        
        Args:
            limit: Максимальное количество задач (опционально)
            
        Returns:
            Список задач
        """
        print(f"\n{'='*60}")
        print("🔍 ОПЕРАЦИЯ: Получение всех задач (GET)")
        print(f"{'='*60}")
        
        url = f"{self.base_url}/todos"
        
        # Query параметры (если нужна пагинация)
        params = {}
        if limit:
            params['_limit'] = limit
        
        try:
            response = self.session.get(url, params=params)
            todos = self._handle_response(response)
            
            print(f"\n📦 Получено задач: {len(todos)}")
            
            # Выводим первые 3 для примера
            if todos:
                print("\n📝 Примеры задач:")
                for todo in todos[:3]:
                    status = "✓" if todo['completed'] else "○"
                    print(f"   {status} [{todo['id']}] {todo['title']}")
            
            return todos
            
        except requests.exceptions.RequestException as e:
            print(f"\n❌ Ошибка при получении задач: {e}")
            return []
    
    
    def get_todo_by_id(self, todo_id: int) -> Optional[Dict]:
        """
        GET запрос: Получить конкретную задачу по ID.
        
        Демонстрирует:
        - GET запрос к конкретному ресурсу
        - Обработку 404 ошибки
        
        Args:
            todo_id: ID задачи
            
        Returns:
            Данные задачи или None
        """
        print(f"\n{'='*60}")
        print(f"🔍 ОПЕРАЦИЯ: Получение задачи #{todo_id} (GET)")
        print(f"{'='*60}")
        
        url = f"{self.base_url}/todos/{todo_id}"
        
        try:
            response = self.session.get(url)
            todo = self._handle_response(response)
            
            # Красиво выводим задачу
            print(f"\n📝 Задача найдена:")
            print(f"   ID: {todo['id']}")
            print(f"   Пользователь: {todo['userId']}")
            print(f"   Заголовок: {todo['title']}")
            print(f"   Статус: {'✅ Выполнена' if todo['completed'] else '⏳ В процессе'}")
            
            return todo
            
        except requests.exceptions.HTTPError as e:
            print(f"\n❌ Задача #{todo_id} не найдена")
            return None
    
    
    def get_user_todos(self, user_id: int) -> List[Dict]:
        """
        GET запрос: Получить задачи конкретного пользователя.
        
        Демонстрирует:
        - GET с query параметрами для фильтрации
        - Фильтрация данных на стороне сервера
        
        Args:
            user_id: ID пользователя
            
        Returns:
            Список задач пользователя
        """
        print(f"\n{'='*60}")
        print(f"🔍 ОПЕРАЦИЯ: Получение задач пользователя #{user_id} (GET)")
        print(f"{'='*60}")
        
        url = f"{self.base_url}/todos"
        
        # Query параметры для фильтрации
        params = {
            'userId': user_id
        }
        
        try:
            response = self.session.get(url, params=params)
            todos = self._handle_response(response)
            
            # Статистика
            completed = sum(1 for t in todos if t['completed'])
            total = len(todos)
            
            print(f"\n📊 Статистика пользователя #{user_id}:")
            print(f"   Всего задач: {total}")
            print(f"   Выполнено: {completed} ({completed/total*100:.1f}%)")
            print(f"   В процессе: {total - completed}")
            
            return todos
            
        except requests.exceptions.RequestException as e:
            print(f"\n❌ Ошибка: {e}")
            return []
    
    
    # ===== POST - СОЗДАНИЕ РЕСУРСА =====
    
    def create_todo(self, user_id: int, title: str, completed: bool = False) -> Optional[Dict]:
        """
        POST запрос: Создать новую задачу.
        
        Демонстрирует:
        - POST запрос с JSON телом
        - Создание нового ресурса
        - Ожидание кода 201 Created
        
        Args:
            user_id: ID пользователя
            title: Название задачи
            completed: Статус выполнения
            
        Returns:
            Созданная задача с ID
        """
        print(f"\n{'='*60}")
        print("➕ ОПЕРАЦИЯ: Создание новой задачи (POST)")
        print(f"{'='*60}")
        
        url = f"{self.base_url}/todos"
        
        # Данные для отправки
        new_todo = {
            'userId': user_id,
            'title': title,
            'completed': completed
        }
        
        print(f"\n📤 Отправляемые данные:")
        print(json.dumps(new_todo, indent=2, ensure_ascii=False))
        
        try:
            # POST запрос с JSON данными
            response = self.session.post(url, json=new_todo)
            created_todo = self._handle_response(response)
            
            print(f"\n✅ Задача создана!")
            print(f"   Присвоен ID: {created_todo['id']}")
            print(f"   Заголовок: {created_todo['title']}")
            
            # ВАЖНО: JSONPlaceholder не сохраняет данные реально,
            # но возвращает ответ как будто создал
            print(f"\n⚠️  ПРИМЕЧАНИЕ: JSONPlaceholder - тестовый API.")
            print(f"   Данные не сохраняются на сервере.")
            
            return created_todo
            
        except requests.exceptions.RequestException as e:
            print(f"\n❌ Ошибка при создании: {e}")
            return None
    
    
    # ===== PUT - ПОЛНАЯ ЗАМЕНА =====
    
    def replace_todo(self, todo_id: int, user_id: int, title: str, completed: bool) -> Optional[Dict]:
        """
        PUT запрос: Полностью заменить задачу.
        
        Демонстрирует:
        - PUT запрос (полная замена всех полей)
        - Разницу между PUT и PATCH
        
        Args:
            todo_id: ID задачи для замены
            user_id: ID пользователя
            title: Новый заголовок
            completed: Новый статус
            
        Returns:
            Обновленная задача
        """
        print(f"\n{'='*60}")
        print(f"🔄 ОПЕРАЦИЯ: Полная замена задачи #{todo_id} (PUT)")
        print(f"{'='*60}")
        
        url = f"{self.base_url}/todos/{todo_id}"
        
        # ВСЕ поля должны быть указаны при PUT
        updated_todo = {
            'userId': user_id,
            'title': title,
            'completed': completed
        }
        
        print(f"\n📤 Новые данные (ВСЕ поля):")
        print(json.dumps(updated_todo, indent=2, ensure_ascii=False))
        
        try:
            response = self.session.put(url, json=updated_todo)
            result = self._handle_response(response)
            
            print(f"\n✅ Задача полностью заменена!")
            print(f"   ID: {result['id']}")
            print(f"   Новый заголовок: {result['title']}")
            
            return result
            
        except requests.exceptions.RequestException as e:
            print(f"\n❌ Ошибка при замене: {e}")
            return None
    
    
    # ===== PATCH - ЧАСТИЧНОЕ ОБНОВЛЕНИЕ =====
    
    def update_todo(self, todo_id: int, **fields) -> Optional[Dict]:
        """
        PATCH запрос: Частично обновить задачу.
        
        Демонстрирует:
        - PATCH запрос (обновление только указанных полей)
        - Гибкое обновление через **kwargs
        
        Args:
            todo_id: ID задачи
            **fields: Поля для обновления (title, completed, userId)
            
        Returns:
            Обновленная задача
        """
        print(f"\n{'='*60}")
        print(f"✏️  ОПЕРАЦИЯ: Частичное обновление задачи #{todo_id} (PATCH)")
        print(f"{'='*60}")
        
        url = f"{self.base_url}/todos/{todo_id}"
        
        # Только указанные поля
        print(f"\n📤 Обновляемые поля:")
        print(json.dumps(fields, indent=2, ensure_ascii=False))
        
        try:
            response = self.session.patch(url, json=fields)
            result = self._handle_response(response)
            
            print(f"\n✅ Задача частично обновлена!")
            for key, value in fields.items():
                print(f"   {key}: {value}")
            
            return result
            
        except requests.exceptions.RequestException as e:
            print(f"\n❌ Ошибка при обновлении: {e}")
            return None
    
    
    # ===== DELETE - УДАЛЕНИЕ =====
    
    def delete_todo(self, todo_id: int) -> bool:
        """
        DELETE запрос: Удалить задачу.
        
        Демонстрирует:
        - DELETE запрос
        - Обработку кода 200 (или 204)
        
        Args:
            todo_id: ID задачи для удаления
            
        Returns:
            True если успешно удалено
        """
        print(f"\n{'='*60}")
        print(f"🗑️  ОПЕРАЦИЯ: Удаление задачи #{todo_id} (DELETE)")
        print(f"{'='*60}")
        
        url = f"{self.base_url}/todos/{todo_id}"
        
        try:
            response = self.session.delete(url)
            self._handle_response(response)
            
            print(f"\n✅ Задача #{todo_id} успешно удалена!")
            
            return True
            
        except requests.exceptions.RequestException as e:
            print(f"\n❌ Ошибка при удалении: {e}")
            return False


# ===== ДЕМОНСТРАЦИЯ РАБОТЫ С API =====

def demonstrate_api():
    """
    Полная демонстрация работы с API.
    
    Показывает все операции CRUD:
    - Create (POST)
    - Read (GET)
    - Update (PUT, PATCH)
    - Delete (DELETE)
    """
    
    print("="*60)
    print("🚀 ДЕМОНСТРАЦИЯ РАБОТЫ С JSONPlaceholder API")
    print("="*60)
    
    # Создаем клиент
    client = TodoAPIClient()
    
    # ===== 1. GET - Получение данных =====
    
    print("\n" + "="*60)
    print("1️⃣  ЧТЕНИЕ ДАННЫХ (GET)")
    print("="*60)
    
    # Получаем все задачи (с ограничением)
    all_todos = client.get_all_todos(limit=5)
    
    # Получаем конкретную задачу
    todo_1 = client.get_todo_by_id(1)
    
    # Получаем задачи пользователя
    user_1_todos = client.get_user_todos(user_id=1)
    
    
    # ===== 2. POST - Создание ресурса =====
    
    print("\n" + "="*60)
    print("2️⃣  СОЗДАНИЕ РЕСУРСА (POST)")
    print("="*60)
    
    new_todo = client.create_todo(
        user_id=1,
        title="Изучить HTTP протокол",
        completed=False
    )
    
    
    # ===== 3. PUT - Полная замена =====
    
    print("\n" + "="*60)
    print("3️⃣  ПОЛНАЯ ЗАМЕНА (PUT)")
    print("="*60)
    
    replaced_todo = client.replace_todo(
        todo_id=1,
        user_id=1,
        title="Изучить REST API (обновлено)",
        completed=True
    )
    
    
    # ===== 4. PATCH - Частичное обновление =====
    
    print("\n" + "="*60)
    print("4️⃣  ЧАСТИЧНОЕ ОБНОВЛЕНИЕ (PATCH)")
    print("="*60)
    
    # Обновляем только статус
    updated_todo = client.update_todo(
        todo_id=1,
        completed=True
    )
    
    # Обновляем только заголовок
    updated_todo_2 = client.update_todo(
        todo_id=2,
        title="Новый заголовок задачи"
    )
    
    
    # ===== 5. DELETE - Удаление =====
    
    print("\n" + "="*60)
    print("5️⃣  УДАЛЕНИЕ РЕСУРСА (DELETE)")
    print("="*60)
    
    deleted = client.delete_todo(todo_id=1)
    
    
    # ===== 6. Обработка ошибок =====
    
    print("\n" + "="*60)
    print("6️⃣  ОБРАБОТКА ОШИБОК")
    print("="*60)
    
    # Попытка получить несуществующую задачу
    print("\n🔍 Попытка получить задачу с несуществующим ID:")
    non_existent = client.get_todo_by_id(99999)
    
    
    # ===== ИТОГИ =====
    
    print("\n" + "="*60)
    print("✅ ДЕМОНСТРАЦИЯ ЗАВЕРШЕНА")
    print("="*60)
    print("\n📚 Вы изучили:")
    print("   ✓ GET - получение данных")
    print("   ✓ POST - создание ресурса")
    print("   ✓ PUT - полная замена")
    print("   ✓ PATCH - частичное обновление")
    print("   ✓ DELETE - удаление")
    print("   ✓ Обработка ошибок и кодов статуса")
    print("   ✓ Работа с JSON данными")
    print("   ✓ HTTP заголовки")


# ===== ЗАПУСК ДЕМОНСТРАЦИИ =====

if __name__ == "__main__":
    demonstrate_api()