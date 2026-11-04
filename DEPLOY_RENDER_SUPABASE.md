# Publicar a Docs. Company (Render + Supabase)

## 1. Criar a tabela no Supabase

No projeto Supabase, abra **SQL Editor**, crie uma consulta e execute todo o conteúdo de `docs_company/auth-server/schema.sql`.

## 2. Guardar as chaves no Render

No Supabase, em **Project Settings > API**, copie o **Project URL** e a chave `service_role` (nunca a coloque no HTML ou no GitHub).

Crie um **Web Service** no Render a partir deste repositório. O arquivo `render.yaml` preenche os comandos automaticamente. Em **Environment**, informe:

| Variável | Valor |
| --- | --- |
| `NODE_ENV` | `production` |
| `SUPABASE_URL` | Project URL do Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | chave `service_role` do Supabase |
| `DISCORD_CLIENT_ID` | ID da aplicação Discord atual |
| `DISCORD_CLIENT_SECRET` | segredo da aplicação Discord atual |
| `FRONTEND_URL` | URL pública criada pelo Render, sem `/` no final |
| `REDIRECT_URI` | URL pública do Render + `/auth/callback` |

O estado ativo do site mantém as sessões de login. Registros do sistema anterior são movidos para `legacyArchive` privado durante a inicialização e não são expostos pelas APIs. Não execute ferramentas antigas de importação de empresas, contratos ou propostas. Mantenha `SUPABASE_SERVICE_ROLE_KEY` somente no ambiente do servidor.

## 3. Atualizar o Discord

No Discord Developer Portal, em **OAuth2 > Redirects**, adicione exatamente a mesma URL de `REDIRECT_URI`, por exemplo `https://docs-company.onrender.com/auth/callback`.

## 4. Publicar

Envie estes arquivos para um repositório GitHub privado ou público e conecte-o ao Render. Quando o deploy terminar, abra a URL do serviço Render: ela passa a servir o site e a API no mesmo endereço.

> O plano gratuito do Render pode pausar após inatividade; a primeira visita depois disso pode levar alguns segundos.
