# Minecraft Ledger API

Servico isolado para registrar transferencias entre UUIDs do Minecraft. O repositorio atual nao tem economia nem auditoria de transacoes do jogo; esta API e uma nova integracao para um plugin executado no servidor, nao para chamadas diretas do navegador.

## Configuracao

Requisitos: Node.js 20.19+ e PostgreSQL 13+.

Configure estas variaveis no ambiente:

```env
DATABASE_URL=postgresql://usuario:senha@host:5432/docs_company?schema=public
MINECRAFT_API_KEY=uma-chave-aleatoria-longa-para-o-plugin
AUDIT_API_KEY=outra-chave-aleatoria-longa-para-auditoria
PORT=3001
```

Mantenha as duas chaves e `DATABASE_URL` apenas no ambiente do servidor. Nunca as inclua no HTML, no JavaScript do navegador ou no plugin distribuido aos jogadores. O plugin confiavel do servidor deve chamar esta API; as chaves devem ser armazenadas na configuracao privada do host/plugin.

```sh
npm install
npx prisma generate
npx prisma migrate deploy
npm start
```

## Endpoints

- `GET /health`: verificacao simples de disponibilidade.
- `GET /api/players/:playerId`: saldo atual; requer `Authorization: Bearer <MINECRAFT_API_KEY>`.
- `POST /api/transfers`: transfere saldo e cria o evento de auditoria na mesma transacao PostgreSQL; requer a chave do plugin.
- `GET /api/audit?limit=50`: consulta os eventos recentes; requer `Authorization: Bearer <AUDIT_API_KEY>`.

Exemplo de transferencia, enviado pelo plugin do servidor:

```json
{
  "fromPlayerId": "550e8400-e29b-41d4-a716-446655440000",
  "toPlayerId": "550e8400-e29b-41d4-a716-446655440001",
  "amount": "250",
  "reason": "Compra no mercado",
  "actorId": "uuid-do-jogador-ou-sistema",
  "idempotencyKey": "event-id-unico-gerado-pelo-plugin"
}
```

`amount` e uma string inteira em unidades minimas definidas pelo plugin. Use a mesma `idempotencyKey` ao repetir uma requisicao por timeout: ela impede debito/credito duplicado e rejeita a reutilizacao da chave com outro conteudo. Contas sao criadas com saldo zero; este scaffold nao oferece endpoint de deposito, criacao de dinheiro ou edicao manual de saldo.

O nivel `Serializable`, a verificacao de saldo no proprio `UPDATE`, a restricao de saldo nao negativo e os registros de transferencia/auditoria atomicos protegem contra saldo negativo e concorrencia. A tabela de auditoria tambem tem trigger PostgreSQL que rejeita `UPDATE` e `DELETE`. Em producao, mantenha backups, use TLS, restrinja acesso de rede ao banco e use um usuario PostgreSQL com privilegios minimos; o superusuario do banco ainda pode alterar o schema ou remover o trigger.