require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const fetchImpl = typeof fetch === 'function'
  ? fetch
  : (...args) => import('node-fetch').then((module) => module.default(...args));

const app = express();
const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8000';
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SESSION_COOKIE = 'docs_session';
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: IS_PRODUCTION,
  maxAge: SESSION_TTL_MS,
  path: '/',
};
const OAUTH_STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: IS_PRODUCTION,
  maxAge: 10 * 60 * 1000,
  path: '/',
};

if (!CLIENT_ID || !CLIENT_SECRET) console.warn('DISCORD_CLIENT_ID ou DISCORD_CLIENT_SECRET não configurado.');

const sessions = new Map();
const LEGACY_STATE_KEYS = [
  'companies', 'userCompany', 'users', 'contracts', 'proposals', 'deletedStaticContractIds',
  'companyComments', 'companyMembers', 'companyLinkRequests', 'serviceImages', 'serviceTexts',
];
const DATA_DIRECTORY = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIRECTORY, 'docs-company.json');
let archivedLegacyState = null;
let legacyStateNeedsMigration = false;
let supabaseReady = false;
let supabaseSaveChain = Promise.resolve();

app.disable('x-powered-by');
app.use(cookieParser());
app.use(express.json({ limit: '16kb' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', FRONTEND_URL);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  return next();
});

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function extractLegacyState(stored) {
  const archive = {};
  LEGACY_STATE_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(stored, key)) archive[key] = stored[key];
  });
  return Object.keys(archive).length ? archive : null;
}

function restoreSessions(savedSessions) {
  sessions.clear();
  if (!savedSessions || typeof savedSessions !== 'object') return;
  Object.entries(savedSessions).forEach(([tokenHash, session]) => {
    if (session && session.expiresAt > Date.now() && session.user) sessions.set(tokenHash, session);
  });
}

function loadData() {
  fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const stored = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const extractedLegacyState = extractLegacyState(stored);
    archivedLegacyState = {
      ...(stored.legacyArchive || {}),
      ...(extractedLegacyState || {}),
    };
    if (!Object.keys(archivedLegacyState).length) archivedLegacyState = null;
    legacyStateNeedsMigration = Boolean(extractedLegacyState);
    restoreSessions(stored.sessions);
    console.log(`Loaded ${sessions.size} saved sessions.`);
  } catch (error) {
    console.error('Could not load local state:', error.message);
  }
}

function getDataSnapshot() {
  const activeSessions = Object.fromEntries([...sessions].filter(([, session]) => session.expiresAt > Date.now()));
  return {
    sessions: activeSessions,
    ...(archivedLegacyState ? { legacyArchive: archivedLegacyState } : {}),
  };
}

function persistSupabaseState() {
  const snapshot = getDataSnapshot();
  supabaseSaveChain = supabaseSaveChain.catch(() => undefined).then(async () => {
    const response = await fetchImpl(`${SUPABASE_URL}/rest/v1/docs_company_state`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ id: 'main', data: snapshot, updated_at: new Date().toISOString() }),
    });
    if (!response.ok) throw new Error(`Supabase save failed (${response.status})`);
  }).catch((error) => console.error('Could not persist state to Supabase:', error.message));
}

function saveData() {
  fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
  const temporaryFile = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(getDataSnapshot(), null, 2), 'utf8');
  fs.renameSync(temporaryFile, DATA_FILE);
  if (USE_SUPABASE && supabaseReady) persistSupabaseState();
}

async function loadSupabaseState() {
  const response = await fetchImpl(`${SUPABASE_URL}/rest/v1/docs_company_state?id=eq.main&select=data`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!response.ok) throw new Error(`Supabase load failed (${response.status})`);
  const rows = await response.json();
  if (!rows[0] || !rows[0].data) return false;

  const stored = rows[0].data;
  const extractedLegacyState = extractLegacyState(stored);
  archivedLegacyState = {
    ...(archivedLegacyState || {}),
    ...(stored.legacyArchive || {}),
    ...(extractedLegacyState || {}),
  };
  if (!Object.keys(archivedLegacyState).length) archivedLegacyState = null;
  if (extractedLegacyState) legacyStateNeedsMigration = true;
  restoreSessions(stored.sessions);
  return true;
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(hashToken(token), { user, expiresAt: Date.now() + SESSION_TTL_MS });
  saveData();
  return token;
}

function getCurrentUser(req) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = hashToken(token);
  const session = sessions.get(tokenHash);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(tokenHash);
    saveData();
    return null;
  }
  return session.user;
}

app.get('/auth/discord', (req, res) => {
  if (!CLIENT_ID || !CLIENT_SECRET) return res.status(503).send('Login do Discord não configurado.');
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('oauth_state', state, OAUTH_STATE_COOKIE_OPTIONS);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'identify',
    state,
  });
  return res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  const savedState = req.cookies.oauth_state;
  if (typeof code !== 'string' || typeof state !== 'string' || !savedState || state !== savedState) {
    return res.status(400).send('Estado OAuth inválido ou código ausente.');
  }

  try {
    const tokenResponse = await fetchImpl('https://discord.com/api/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!tokenResponse.ok) throw new Error(`Discord token request failed (${tokenResponse.status})`);
    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) throw new Error('Discord did not return an access token');

    const userResponse = await fetchImpl('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userResponse.ok) throw new Error(`Discord user request failed (${userResponse.status})`);
    const userData = await userResponse.json();
    if (!userData.id) throw new Error('Discord did not return a user id');

    const user = {
      id: userData.id,
      username: userData.username,
      discriminator: userData.discriminator,
      avatar: userData.avatar || null,
    };
    const sessionToken = createSession(user);
    res.cookie(SESSION_COOKIE, sessionToken, SESSION_COOKIE_OPTIONS);
    res.clearCookie('oauth_state', OAUTH_STATE_COOKIE_OPTIONS);
    return res.redirect(`${FRONTEND_URL}/?auth=success`);
  } catch (error) {
    console.error('Discord authentication failed:', error.message);
    return res.status(500).send('Não foi possível concluir o login.');
  }
});

app.get('/auth/logout', (req, res) => {
  const token = req.cookies[SESSION_COOKIE];
  if (token && sessions.delete(hashToken(token))) saveData();
  res.clearCookie(SESSION_COOKIE, { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
  return res.redirect(FRONTEND_URL);
});

app.get('/auth/me', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.json({ user: getCurrentUser(req) });
});

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/auth-server', (req, res) => res.sendStatus(404));
app.use('/api', (req, res) => res.status(410).json({ error: 'Esta API foi desativada.' }));

const PUBLIC_DIRECTORY = path.join(__dirname, '..');
const pageRoutes = {
  '/': 'index.html',
  '/transacoes': 'transacoes.html',
  '/transparencia': 'transparencia.html',
};
const legacyPageRoutes = {
  '/index.html': '/',
  '/servicos.html': '/',
  '/licitacoes.html': '/transacoes',
  '/entidades.html': '/transacoes',
  '/empresa.html': '/transacoes',
  '/trilho-original.html': '/',
  '/parceiros.html': '/transparencia',
};
const legacyCleanRoutes = {
  '/servicos': '/',
  '/licitacoes': '/transacoes',
  '/entidades': '/transacoes',
  '/empresa': '/transacoes',
  '/trilho-original': '/',
};

Object.entries(pageRoutes).forEach(([route, filename]) => {
  app.get(route, (req, res) => res.sendFile(path.join(PUBLIC_DIRECTORY, filename)));
});
app.get('/:page.html', (req, res, next) => {
  const target = legacyPageRoutes[req.path];
  if (!target) return next();
  return res.redirect(301, target);
});
app.get(Object.keys(legacyCleanRoutes), (req, res) => res.redirect(301, legacyCleanRoutes[req.path]));
app.use(express.static(PUBLIC_DIRECTORY, { dotfiles: 'deny' }));

loadData();
if (legacyStateNeedsMigration) saveData();

async function startServer() {
  if (USE_SUPABASE) {
    try {
      const remoteStateFound = await loadSupabaseState();
      supabaseReady = true;
      if (!remoteStateFound) console.log('No Supabase state found; initializing session storage.');
      else console.log('Loaded persistent session state from Supabase.');
      if (!remoteStateFound || legacyStateNeedsMigration) {
        legacyStateNeedsMigration = false;
        persistSupabaseState();
        if (remoteStateFound) console.log('Moved retired records to the private legacy archive.');
      }
    } catch (error) {
      console.error('Could not load Supabase state; using local state:', error.message);
    }
  }

  app.listen(PORT, () => console.log(`Docs. Company server listening on port ${PORT}`));
}

startServer();