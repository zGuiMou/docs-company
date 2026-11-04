require('dotenv').config();

const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Prisma, PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const app = express();
const port = Number(process.env.PORT || 3001);
const serviceKey = process.env.MINECRAFT_API_KEY || '';
const auditKey = process.env.AUDIT_API_KEY || '';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxBigInt = 9223372036854775807n;

if (!serviceKey || !auditKey || serviceKey === auditKey) {
  throw new Error('Configure chaves MINECRAFT_API_KEY e AUDIT_API_KEY distintas.');
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '16kb' }));

function requireKey(expectedKey) {
  const expected = Buffer.from(expectedKey);
  return (req, res, next) => {
    const match = /^Bearer (.+)$/.exec(req.get('authorization') || '');
    const supplied = Buffer.from(match ? match[1] : '');
    const valid = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
    if (!valid) return res.status(401).json({ error: 'Unauthorized' });
    next();
  };
}

const requireServiceKey = requireKey(serviceKey);
const requireAuditKey = requireKey(auditKey);

function readUuid(value) {
  return typeof value === 'string' && uuidPattern.test(value) ? value.toLowerCase() : null;
}

function readTransfer(body) {
  const fromPlayerId = readUuid(body.fromPlayerId);
  const toPlayerId = readUuid(body.toPlayerId);
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  const actorId = typeof body.actorId === 'string' ? body.actorId.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  let amount;

  try {
    if (typeof body.amount !== 'string' || !/^\d+$/.test(body.amount)) throw new Error();
    amount = BigInt(body.amount);
  } catch {
    throw new HttpError(400, 'amount must be a positive integer string');
  }

  if (!fromPlayerId || !toPlayerId) throw new HttpError(400, 'Valid fromPlayerId and toPlayerId UUIDs are required');
  if (fromPlayerId === toPlayerId) throw new HttpError(400, 'Players must be different');
  if (amount <= 0n || amount > maxBigInt) throw new HttpError(400, 'amount is outside the supported range');
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) throw new HttpError(400, 'idempotencyKey must contain 8 to 128 characters');
  if (!actorId || actorId.length > 100) throw new HttpError(400, 'actorId is required and must be at most 100 characters');
  if (!reason || reason.length > 500) throw new HttpError(400, 'reason is required and must be at most 500 characters');

  return { fromPlayerId, toPlayerId, amount, idempotencyKey, actorId, reason };
}

function sameRequest(transfer, input) {
  return transfer.fromPlayerId === input.fromPlayerId
    && transfer.toPlayerId === input.toPlayerId
    && transfer.amount === input.amount
    && transfer.reason === input.reason
    && transfer.auditEvent?.actorId === input.actorId;
}

function transferView(transfer) {
  return {
    id: transfer.id,
    fromPlayerId: transfer.fromPlayerId,
    toPlayerId: transfer.toPlayerId,
    amount: transfer.amount.toString(),
    reason: transfer.reason,
    actorId: transfer.auditEvent?.actorId,
    createdAt: transfer.createdAt,
  };
}

async function applyTransfer(input) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.transfer.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          include: { auditEvent: true },
        });
        if (existing) {
          if (!sameRequest(existing, input)) throw new HttpError(409, 'idempotencyKey was already used for a different request');
          return { transfer: existing, replayed: true };
        }

        await tx.playerAccount.upsert({
          where: { playerId: input.fromPlayerId },
          create: { playerId: input.fromPlayerId },
          update: {},
        });
        await tx.playerAccount.upsert({
          where: { playerId: input.toPlayerId },
          create: { playerId: input.toPlayerId },
          update: {},
        });

        const debit = await tx.playerAccount.updateMany({
          where: { playerId: input.fromPlayerId, balance: { gte: input.amount } },
          data: { balance: { decrement: input.amount } },
        });
        if (debit.count !== 1) throw new HttpError(409, 'Insufficient balance');

        await tx.playerAccount.update({
          where: { playerId: input.toPlayerId },
          data: { balance: { increment: input.amount } },
        });

        const transfer = await tx.transfer.create({
          data: {
            idempotencyKey: input.idempotencyKey,
            fromPlayerId: input.fromPlayerId,
            toPlayerId: input.toPlayerId,
            amount: input.amount,
            reason: input.reason,
            source: 'minecraft-server',
          },
        });
        const auditEvent = await tx.auditEvent.create({
          data: {
            transferId: transfer.id,
            action: 'PLAYER_TRANSFER',
            actorId: input.actorId,
            metadata: { reason: input.reason, source: 'minecraft-server' },
          },
        });

        return { transfer: { ...transfer, auditEvent }, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error.code === 'P2034' && attempt < 2) continue;
      if (error.code === 'P2002') {
        const existing = await prisma.transfer.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          include: { auditEvent: true },
        });
        if (existing) {
          if (!sameRequest(existing, input)) throw new HttpError(409, 'idempotencyKey was already used for a different request');
          return { transfer: existing, replayed: true };
        }
      }
      throw error;
    }
  }

  throw new HttpError(503, 'Could not serialize transfer; retry with the same idempotencyKey');
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/api/players/:playerId', requireServiceKey, async (req, res, next) => {
  try {
    const playerId = readUuid(req.params.playerId);
    if (!playerId) throw new HttpError(400, 'Invalid player UUID');
    const account = await prisma.playerAccount.findUnique({ where: { playerId } });
    res.json({ playerId, balance: (account?.balance ?? 0n).toString() });
  } catch (error) {
    next(error);
  }
});

app.post('/api/transfers', requireServiceKey, async (req, res, next) => {
  try {
    const input = readTransfer(req.body || {});
    const result = await applyTransfer(input);
    res.status(result.replayed ? 200 : 201).json({
      replayed: result.replayed,
      transfer: transferView(result.transfer),
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/audit', requireAuditKey, async (req, res, next) => {
  try {
    const requestedLimit = Number(req.query.limit || 50);
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
    const events = await prisma.auditEvent.findMany({
      take: limit,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { transfer: true },
    });
    res.json({ events: events.map((event) => ({
      id: event.id,
      action: event.action,
      actorId: event.actorId,
      metadata: event.metadata,
      createdAt: event.createdAt,
      transfer: transferView({ ...event.transfer, auditEvent: event }),
    })) });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  console.error('Minecraft ledger request failed:', error);
  return res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(port, () => console.log(`Minecraft ledger listening on ${port}`));

async function shutdown() {
  server.close(async () => {
    await prisma.$disconnect();
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);