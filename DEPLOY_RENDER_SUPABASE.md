# Publicar a Docs. Company (Render + Supabase)

## 1. Criar a tabela no Supabase

No projeto Supabase, abra **SQL Editor**, crie uma consulta e execute todo o conteúdo de `docs_company/auth-server/schema.sql`.

Isso cria a tabela privada `minecraft_console_events`, onde os eventos do console
ficam armazenados por até 30 dias. Não é necessário criar outro banco.

## 2. Configurar segredos e acesso no Render

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
| `MINECRAFT_LOG_INGEST_TOKEN` | segredo aleatório com pelo menos 32 caracteres, compartilhado somente entre Render e o mod |
| `MINECRAFT_LOG_VIEWER_IDS` | IDs de usuário Discord autorizados a ver o painel; separe múltiplos IDs por vírgula |

O estado ativo do site mantém as sessões de login. Registros do sistema anterior são movidos para `legacyArchive` privado durante a inicialização e não são expostos pelas APIs. Não execute ferramentas antigas de importação de empresas, contratos ou propostas. Mantenha `SUPABASE_SERVICE_ROLE_KEY` somente no ambiente do servidor.

Gere o segredo localmente, sem enviá-lo por chat ou gravá-lo no Git. No PowerShell:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Copie o valor para `MINECRAFT_LOG_INGEST_TOKEN` no Render e para `bearerToken`
em `config/consolebridge.json` no servidor. Defina `endpoint` como
`https://docs-company.onrender.com/api/minecraft-console/events`. Defina
`MINECRAFT_LOG_VIEWER_IDS` com os IDs Discord das contas autorizadas ao painel
`https://docs-company.onrender.com/minecraft-console`.

Depois de atualizar as variáveis no Render, execute o SQL acima e faça novo
deploy. O endpoint recebe apenas HTTPS, exige o segredo e armazena os eventos
no Supabase. O painel exige login Discord e um ID autorizado. Os eventos são
removidos após 30 dias. Antes de preencher o segredo no mod, confirme que o
aviso aos jogadores está ativo no outro mod.

## 3. Atualizar o Discord

No Discord Developer Portal, em **OAuth2 > Redirects**, adicione exatamente a mesma URL de `REDIRECT_URI`, por exemplo `https://docs-company.onrender.com/auth/callback`.

## 4. Publicar

Envie estes arquivos para um repositório GitHub privado ou público e conecte-o ao Render. Quando o deploy terminar, abra a URL do serviço Render: ela passa a servir o site e a API no mesmo endereço.

> O plano gratuito do Render pode pausar após inatividade; a primeira visita depois disso pode levar alguns segundos.
