@echo off
rem --- Ajuste estes caminhos se necessário ---
set "WORKDIR=C:\Users\Guilherme\Downloads\DOCS_Company_site_mapa_visualizar_direto\docs_company"
set "AUTHDIR=%WORKDIR%\auth-server"

rem --- Opcional: seu Discord user id (usado temporariamente só nesta janela do servidor) ---
set "ADMIN_ID=602953921337491487"

rem --- Inicia auth-server em uma nova janela (ADMIN_ID exportado apenas para essa sessão) ---
start "Auth Server" cmd /k "cd /d "%AUTHDIR%" && set "ADMIN_ID=%ADMIN_ID%" && echo Starting auth-server with ADMIN_ID=%ADMIN_ID% && node server.js"

rem --- Inicia frontend (python simple HTTP) em outra janela ---
start "Frontend" cmd /k "cd /d "%WORKDIR%" && echo Starting frontend on :8000 && python -m http.server 8000 --directory ."

rem --- Abre o navegador nas páginas úteis ---
start "" "http://localhost:8000/licitacoes.html"
start "" "http://localhost:3000/auth/me"

exit /b 0
