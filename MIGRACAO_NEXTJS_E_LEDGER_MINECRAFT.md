# Estado atual e caminho para Next.js

## O que existe hoje

- O frontend e HTML estatico em `docs_company/`, com uma pagina por arquivo; nao ha projeto Next.js ou componentes React.
- `docs_company/style.css` concentra estilos globais e de varias paginas. Scripts inline fazem renderizacao e interacoes; `runtime-api.js` redireciona chamadas legadas de `localhost:3000` para a API no Render.
- `docs_company/index.html` apresenta o Expresso Continental e incorpora `trilho-original.html` em um `iframe`. O arquivo do trilho e uma experiencia visual Minecraft, nao uma integracao de economia.
- `docs_company/auth-server/server.js` e um Express com OAuth do Discord, sessoes em memoria, rotas de empresas/contratos/propostas e acesso a um backup JSON local e a uma linha JSONB no Supabase (`docs_company_state`).
- Propostas de licitacao e contratos possuem valores, mas nao representam saldo nem transferencias do Minecraft. O bot Discord usa a API do auth-server para consultar e administrar licitacoes.
- Nao foram encontrados endpoints nem tabelas atuais para saldo, transferencia ou auditoria de transacoes Minecraft.

## Decomposicao para Next App Router

| Arquivo atual | Destino sugerido | Componentes/modulos |
| --- | --- | --- |
| `index.html` | `app/page.tsx` | `HomeHero`, `MinecraftShowcase`, `RailShowcase` |
| `servicos.html` | `app/servicos/page.tsx` | `ServicesPage`, `ServiceGrid`; textos editaveis em um modulo de dados |
| `licitacoes.html` | `app/licitacoes/page.tsx` | `ContractList`, `ContractFilters`, `ProposalForm`; buscar a API no servidor ou em componentes client apenas onde houver interacao |
| `entidades.html` | `app/entidades/page.tsx` | `EntityList`, `EntityFilters` |
| `empresa.html` | `app/entidades/[id]/page.tsx` | `EntityProfile`, `CompanyPosts`, `CompanyComments` |
| `trilho-original.html` | `app/minecraft/trilho/page.tsx` ou rota estatica isolada | `RailScene`; manter client-side apenas se depender de canvas/WebGL ou APIs do navegador |
| cabecalho repetido | `components/site-header.tsx` | `SiteHeader`, `MainNav`, `DiscordAuthControl` |
| rodape repetido | `components/site-footer.tsx` | `SiteFooter`, `FooterPopups` |
| `style.css` | `app/globals.css` + CSS Modules por componente | Tokens e reset globais em `globals.css`; regras especificas junto a cada componente |
| `runtime-api.js` | `lib/api.ts` e configuracao de ambiente | Cliente HTTP tipado; remover a reescrita global de `fetch` e usar URL/config explicita |
| scripts inline de OAuth | `app/api/auth/...` ou rotas do backend existentes | Preservar OAuth no servidor, cookie `HttpOnly` e validacao de sessao; nunca enviar segredo ao client |

Estrutura inicial recomendada:

```text
app/
  layout.tsx
  page.tsx
  servicos/page.tsx
  licitacoes/page.tsx
  entidades/page.tsx
  entidades/[id]/page.tsx
  minecraft/trilho/page.tsx
components/
  site-header.tsx
  site-footer.tsx
  home/minecraft-showcase.tsx
  contracts/contract-list.tsx
lib/
  api.ts
  auth.ts
```

Comece extraindo o cabecalho/rodape compartilhados e migre uma pagina por vez. Preserve os endpoints atuais enquanto o frontend Next consome o auth-server; migrar o armazenamento JSONB para tabelas relacionais e Prisma e um trabalho separado, com migracao/validacao dos dados antes de trocar a persistencia.

## Ledger Minecraft novo

O scaffold independente esta em `docs_company/minecraft-api/`. Ele usa Node/Express e Prisma/PostgreSQL para transferencias atomicas com saldo, chave de idempotencia e trilha de auditoria append-only. A integracao requer um plugin confiavel do servidor Minecraft para identificar eventos e chamar a API. Ainda nao ha plugin do jogo neste repositorio, entao o ledger nao esta conectado nem deve ser publicado como funcionalidade ativa ate essa integracao e a definicao da unidade monetaria.