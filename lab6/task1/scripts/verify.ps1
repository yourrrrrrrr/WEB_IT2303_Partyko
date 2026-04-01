$ErrorActionPreference = "Stop"

$base = "http://localhost:3006"
$cookieFile = Join-Path $PSScriptRoot "cookies.txt"

Write-Host "== 0) Получаем CSRF cookie через GET /api/products =="
Invoke-WebRequest "$base/api/products" -WebSession (New-Object Microsoft.PowerShell.Commands.WebRequestSession) | Out-Null

# PowerShell WebSession хранит cookie только в объекте, поэтому проще идти через curl с cookie-jar.
Write-Host "== 0b) Получаем csrf-token cookie (curl) =="
curl.exe -sS -c $cookieFile "$base/api/products" | Out-Null

Write-Host "== 1) Сидим пользователей (dev endpoint) =="
curl.exe -sS -b $cookieFile -c $cookieFile -X POST "$base/__dev/seed-users" | Out-Host

Write-Host "== 2) Логин как alice (user) =="
curl.exe -sS -b $cookieFile -c $cookieFile -X POST "$base/api/login" `
  -H "Content-Type: application/json" `
  -d '{\"username\":\"alice\",\"password\":\"user123\"}' | Out-Host

$csrf = (Get-Content $cookieFile | Select-String -Pattern "csrf-token" | Select-Object -Last 1).ToString().Split("`t")[-1]
if (-not $csrf) { throw "csrf-token не найден в cookie jar" }
Write-Host "CSRF = $csrf"

Write-Host "== 3) Проверка SQLi productId = '1 OR 1=1' => 400 =="
curl.exe -sS -i "$base/api/products/1%20OR%201%3D1/reviews" | Out-Host

Write-Host "== 4) POST review без CSRF => 403 =="
curl.exe -sS -i -b $cookieFile -c $cookieFile -X POST "$base/api/products/1/reviews" `
  -H "Content-Type: application/json" `
  -d '{\"body\":\"<b>ok</b>\"}' | Out-Host

Write-Host "== 5) POST review c XSS payload => <script> должен быть удалён =="
curl.exe -sS -b $cookieFile -c $cookieFile -X POST "$base/api/products/1/reviews" `
  -H "Content-Type: application/json" `
  -H "X-CSRF-Token: $csrf" `
  -d '{\"body\":\"Hello <script>alert(1)</script> <b>bold</b> <a href=\\\"javascript:alert(1)\\\">x</a>\"}' | Out-Host

Write-Host "== 6) GET reviews => script отсутствует, href javascript заменён =="
curl.exe -sS "$base/api/products/1/reviews" | Out-Host

Write-Host "== 7) Rate limit: 4-й отзыв за минуту => 429 =="
1..3 | ForEach-Object {
  curl.exe -sS -b $cookieFile -c $cookieFile -X POST "$base/api/products/1/reviews" `
    -H "Content-Type: application/json" `
    -H "X-CSRF-Token: $csrf" `
    -d '{\"body\":\"<i>spam</i>\"}' | Out-Null
}
curl.exe -sS -i -b $cookieFile -c $cookieFile -X POST "$base/api/products/1/reviews" `
  -H "Content-Type: application/json" `
  -H "X-CSRF-Token: $csrf" `
  -d '{\"body\":\"<i>spam4</i>\"}' | Out-Host

Write-Host "== 8) DELETE review обычным пользователем => 403 =="
curl.exe -sS -i -b $cookieFile -c $cookieFile -X DELETE "$base/api/reviews/1" -H "X-CSRF-Token: $csrf" | Out-Host

Write-Host "Готово."

