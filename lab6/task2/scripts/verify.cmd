@echo off
REM Simple curl-based checks for lab6/task2
REM Требование: сервер уже запущен: npm run dev (порт 3010)

set BASE=http://localhost:3010

echo ==== [10] /debug/config -> 404 ====
curl -sS -i "%BASE%/debug/config"
echo.

echo ==== [2] SQLi login: username=admin'-- -> 4xx (не 200) ====
curl -sS -i -X POST "%BASE%/login" ^
  -H "Content-Type: application/json" ^
  --data "{\"username\":\"admin'--\",\"password\":\"anything\"}"
echo.

echo ==== Login as alice (user) ====
curl -sS -i -c cookies.txt -b cookies.txt -X POST "%BASE%/login" ^
  -H "Content-Type: application/json" ^
  --data "{\"username\":\"alice\",\"password\":\"alice123\"}"
echo.

echo ==== [6] Upload shell.php -> 4xx ====
echo ^<?php echo 'pwn'; ?^> > shell.php
curl -sS -i -c cookies.txt -b cookies.txt -X POST "%BASE%/upload" ^
  -F "file=@shell.php;type=application/x-php"
del shell.php
echo.

echo ==== [9] SSRF: http://127.0.0.1 -> 400 ====
curl -sS -i "%BASE%/preview?url=http://127.0.0.1:3000/debug/config"
echo.

echo ==== [8] publish as alice -> 403/401 ====
curl -sS -i -c cookies.txt -b cookies.txt -X POST "%BASE%/articles/1/publish"
echo.

echo ==== [5] Stored XSS: post <script> + проверить HTML ====
curl -sS -i -c cookies.txt -b cookies.txt -X POST "%BASE%/articles/1/comments" ^
  -H "Content-Type: application/json" ^
  --data "{\"body\":\"<script>alert(1)</script>hello\"}"
echo.
echo ---- HTML /articles/1/comments (проверь, что <script> НЕТ) ----
curl -sS "%BASE%/articles/1/comments"
echo.

echo ==== Rate limit /login: сделать 6 неверных логинов (последний должен быть 429 или 4xx) ====
for /L %%i in (1,1,6) do (
  echo ---- attempt %%i ----
  curl -sS -i -c cookies.txt -b cookies.txt -X POST "%BASE%/login" ^
    -H "Content-Type: application/json" ^
    --data "{\"username\":\"admin\",\"password\":\"wrong\"}"
  echo.
)

echo ==== DONE ====

