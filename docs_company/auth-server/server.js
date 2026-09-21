require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const fetchImpl = typeof fetch === 'function' ? fetch : (...args) => import('node-fetch').then(m=>m.default(...args));

const app = express();
const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8000';
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BOT_API_KEY = process.env.BOT_API_KEY || '';
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

if(!CLIENT_ID || !CLIENT_SECRET) console.warn('Warning: DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET not set in environment');

app.use(cookieParser());
app.use(express.json({ limit: '16kb' }));
// Basic CORS to allow frontend to call /auth/me with credentials
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', FRONTEND_URL);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// The browser receives only an opaque random token. User identity stays on the
// server, so it cannot be changed by editing a cookie.
const sessions = new Map();

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { user, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function getCurrentUser(req) {
  const token = req.cookies[SESSION_COOKIE];
  const session = token && sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session.user;
}

function requireAuth(req, res, next) {
  const user = getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
}

function requireBotApiKey(req, res, next) {
  if (req.get('X-Bot-Api-Key') !== BOT_API_KEY || !BOT_API_KEY) return res.status(401).json({ error: 'Invalid bot API key' });
  next();
}
function readText(value, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function readMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function readImageUrl(value) {
  const imageUrl = readText(value, 2000);
  if (!imageUrl) return '';
  try {
    const url = new URL(imageUrl);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

app.get('/auth/discord', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('oauth_state', state, { httpOnly: true, sameSite: 'lax' });

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'identify',
    state
  });

  res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

app.get('/auth/callback', async (req, res) => {
  const code = req.query.code;
  const state = req.query.state;
  const saved = req.cookies.oauth_state;

  if (!code || !state || !saved || state !== saved) {
    return res.status(400).send('Invalid state or missing code');
  }

  try {
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: REDIRECT_URI,
    });

    const tokenRes = await fetchImpl('https://discord.com/api/oauth2/token', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      console.error('Token response', tokenData);
      return res.status(500).send('Failed to obtain access token');
    }

    const userRes = await fetchImpl('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const userData = await userRes.json();

    // Pick only the fields we need and keep them in the server-side session.
    const userSafe = {
      id: userData.id,
      username: userData.username,
      discriminator: userData.discriminator,
      avatar: userData.avatar || null
    };
    console.log('Authenticated user:', userSafe);
    users[userSafe.id] = userSafe;
    saveData();
    const sessionToken = createSession(userSafe);
    res.cookie(SESSION_COOKIE, sessionToken, SESSION_COOKIE_OPTIONS);

    // clear state cookie
    res.clearCookie('oauth_state');

    // redirect back to frontend (home)
    res.redirect(`${FRONTEND_URL}/?auth=success`);
  } catch (err) {
    console.error('Auth error', err);
    res.status(500).send('Authentication error');
  }
});

app.get('/auth/logout', (req, res) => {
  const token = req.cookies[SESSION_COOKIE];
  if (token) sessions.delete(token);
  res.clearCookie(SESSION_COOKIE, { path: '/', sameSite: 'lax', secure: IS_PRODUCTION });
  res.redirect(FRONTEND_URL);
});

// Persistent local store. This keeps site data across server restarts without
// requiring an external database. Keep this directory backed up in production.
const DATA_DIRECTORY = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIRECTORY, 'docs-company.json');
const proposals = [];
const companies = [];
const userCompany = {}; // map userId -> companyId
const users = {}; // map userId -> most recent Discord profile
const contracts = [];
const deletedStaticContractIds = [];
const companyComments = [];
const companyMembers = [];
const companyLinkRequests = [];
const serviceImages = {};
const serviceTexts = {};
let supabaseReady = false;
let supabaseSaveChain = Promise.resolve();

function generateBiddingNumber() {
  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const number = crypto.randomInt(10000, 100000);
    const bidNumber = `${number}/${year}`;
    if (!contracts.some(contract => contract.bidNumber === bidNumber)) return bidNumber;
  }
  throw new Error('Could not generate a unique bidding number');
}

function loadData() {
  fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const stored = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(stored.companies)) companies.push(...stored.companies);
    if (Array.isArray(stored.contracts)) contracts.push(...stored.contracts);
    if (Array.isArray(stored.proposals)) proposals.push(...stored.proposals);
    if (stored.userCompany && typeof stored.userCompany === 'object') Object.assign(userCompany, stored.userCompany);
    if (stored.users && typeof stored.users === 'object') Object.assign(users, stored.users);
    if (Array.isArray(stored.deletedStaticContractIds)) deletedStaticContractIds.push(...stored.deletedStaticContractIds);
    if (Array.isArray(stored.companyComments)) companyComments.push(...stored.companyComments);
    if (Array.isArray(stored.companyMembers)) companyMembers.push(...stored.companyMembers);
    if (Array.isArray(stored.companyLinkRequests)) companyLinkRequests.push(...stored.companyLinkRequests);
    if (stored.serviceImages && typeof stored.serviceImages === 'object') Object.assign(serviceImages, stored.serviceImages);
    if (stored.serviceTexts && typeof stored.serviceTexts === 'object') Object.assign(serviceTexts, stored.serviceTexts);
    let migrated = false;
    contracts.forEach(contract => {
      if (contract.status === 'EM ANÁLISE') {
        contract.status = 'ABERTA';
        migrated = true;
      }
      if (!contract.bidNumber) {
        contract.bidNumber = generateBiddingNumber();
        migrated = true;
      }
    });
    if (migrated) saveData();
    console.log(`Loaded ${companies.length} companies, ${contracts.length} contracts and ${proposals.length} proposals.`);
  } catch (error) {
    console.error('Could not load persistent data. Starting with empty data.', error);
  }
}

function getDataSnapshot() {
  return { companies, userCompany, users, contracts, proposals, deletedStaticContractIds, companyComments, companyMembers, companyLinkRequests, serviceImages, serviceTexts };
}

function saveData() {
  fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
  const data = JSON.stringify(getDataSnapshot(), null, 2);
  const temporaryFile = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, data, 'utf8');
  fs.renameSync(temporaryFile, DATA_FILE);
  if (USE_SUPABASE && supabaseReady) persistSupabaseState();
}

function replaceDataFromStore(stored) {
  companies.splice(0, companies.length, ...(Array.isArray(stored.companies) ? stored.companies : []));
  contracts.splice(0, contracts.length, ...(Array.isArray(stored.contracts) ? stored.contracts : []));
  proposals.splice(0, proposals.length, ...(Array.isArray(stored.proposals) ? stored.proposals : []));
  deletedStaticContractIds.splice(0, deletedStaticContractIds.length, ...(Array.isArray(stored.deletedStaticContractIds) ? stored.deletedStaticContractIds : []));
  companyComments.splice(0, companyComments.length, ...(Array.isArray(stored.companyComments) ? stored.companyComments : []));
  companyMembers.splice(0, companyMembers.length, ...(Array.isArray(stored.companyMembers) ? stored.companyMembers : []));
  companyLinkRequests.splice(0, companyLinkRequests.length, ...(Array.isArray(stored.companyLinkRequests) ? stored.companyLinkRequests : []));
  Object.keys(userCompany).forEach(key => delete userCompany[key]); Object.assign(userCompany, stored.userCompany || {});
  Object.keys(users).forEach(key => delete users[key]); Object.assign(users, stored.users || {});
  Object.keys(serviceImages).forEach(key => delete serviceImages[key]); Object.assign(serviceImages, stored.serviceImages || {});
  Object.keys(serviceTexts).forEach(key => delete serviceTexts[key]); Object.assign(serviceTexts, stored.serviceTexts || {});
}

async function loadSupabaseState() {
  if (!USE_SUPABASE) return false;
  const response = await fetchImpl(`${SUPABASE_URL}/rest/v1/docs_company_state?id=eq.main&select=data`, { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } });
  if (!response.ok) throw new Error(`Supabase load failed (${response.status})`);
  const rows = await response.json();
  if (rows[0] && rows[0].data) {
    replaceDataFromStore(rows[0].data);
    return true;
  }
  return false;
}

function persistSupabaseState() {
  const snapshot = getDataSnapshot();
  supabaseSaveChain = supabaseSaveChain.catch(() => undefined).then(async () => {
    const response = await fetchImpl(`${SUPABASE_URL}/rest/v1/docs_company_state`, {
      method: 'POST',
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ id: 'main', data: snapshot, updated_at: new Date().toISOString() })
    });
    if (!response.ok) throw new Error(`Supabase save failed (${response.status})`);
  }).catch(error => console.error('Could not persist state to Supabase:', error.message));
}

loadData();

// Helper: admin check (single ADMIN_ID owner)
// Default ADMIN_ID set to the provided owner id; override with ENV if needed
const ADMIN_ID = process.env.ADMIN_ID || '602953921337491487';
function isAdmin(req){
  const user = getCurrentUser(req);
  return Boolean(ADMIN_ID && user && String(user.id) === String(ADMIN_ID));
}

function readPostMedia(value) {
  const url = readImageUrl(value);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    let videoId = '';
    if (['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(parsed.hostname)) {
      videoId = parsed.searchParams.get('v') || parsed.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})/)?.[1] || '';
    } else if (parsed.hostname === 'youtu.be') {
      videoId = parsed.pathname.split('/').filter(Boolean)[0] || '';
    }
    if (/^[\w-]{11}$/.test(videoId)) return { type: 'youtube', url: parsed.toString(), videoId, thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` };
    return { type: 'image', url, videoId: '', thumbnailUrl: url };
  } catch { return null; }
}

function isUserLinkedToCompany(userId, companyId) {
  return userCompany[userId] === companyId || companyMembers.some(member => member.userId === userId && member.companyId === companyId);
}

function isCompanyVerified(companyId) {
  return companyMembers.some(member => member.companyId === companyId && member.userId) || Object.values(userCompany).includes(companyId);
}

function canManageCompany(req, companyId) {
  return isAdmin(req) || Boolean(req.user && isUserLinkedToCompany(req.user.id, companyId));
}

// Create a proposal
app.post('/api/propostas', requireAuth, (req, res) => {
  try {
    const user = req.user;
    const { contractId, acceptValue, acceptDeadline, newValue, newDeadline, message } = req.body;
    const numericContractId = Number(contractId);
    if (!Number.isInteger(numericContractId) || !contracts.some(contract => contract.id === numericContractId)) {
      return res.status(400).json({ error: 'Valid contractId required' });
    }
    const proposalValue = newValue === null || newValue === undefined || newValue === '' ? null : Number(newValue);
    if (proposalValue !== null && (!Number.isFinite(proposalValue) || proposalValue < 0)) {
      return res.status(400).json({ error: 'Invalid newValue' });
    }

    const id = crypto.randomBytes(8).toString('hex');
    const proposal = {
      id,
      contractId: numericContractId,
      user: { id: user.id, username: user.username, avatar: user.avatar || null },
      acceptValue: !!acceptValue,
      acceptDeadline: !!acceptDeadline,
      newValue: proposalValue,
      newDeadline: readText(newDeadline, 10) || null,
      message: readText(message, 2000),
      status: 'PENDENTE',
      createdAt: new Date().toISOString()
    };
    proposals.push(proposal);
    const contract = contracts.find(item => item.id === numericContractId);
    if (contract && contract.status === 'ABERTA') contract.status = 'ANDAMENTO';
    saveData();
    return res.json({ ok: true, proposal });
  } catch (err) {
    console.error('POST /api/propostas error', err);
    return res.status(500).json({ error: 'server error' });
  }
});

// Admin: create company
app.post('/api/empresas', (req, res) => {
  if(!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const name = readText(req.body.name, 120);
  if(!name) return res.status(400).json({ error: 'name required' });
  const id = crypto.randomBytes(6).toString('hex');
  const c = { id, name, entityType: 'EMPRESA', industry: 'Não informado', description: '', logoUrl: '', estimatedNetWorth: 0 };
  companies.push(c);
  saveData();
  return res.json({ ok:true, company: c });
});

function getCompanyReviews(companyId) {
  return companyComments.filter(item => item.companyId === companyId && item.type === 'review' && Number.isInteger(Number(item.rating)) && Number(item.rating) >= 1 && Number(item.rating) <= 5);
}

// Public ranking data: only company names and aggregate contract figures.
app.get('/api/empresas/ranking', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const ranking = companies.map(company => {
    const ratings = getCompanyReviews(company.id);
    return {
      id: company.id,
      name: company.name,
      entityType: ['PREFEITURA', 'GOVERNO', 'BIG_TECH'].includes(company.entityType) ? (company.entityType === 'GOVERNO' ? 'PREFEITURA' : company.entityType) : 'EMPRESA',
      industry: company.industry || 'Não informado',
      description: company.description || '',
      logoUrl: company.logoUrl || '',
      rating: ratings.length ? ratings.reduce((total, rating) => total + Number(rating.rating), 0) / ratings.length : 0,
      ratingCount: ratings.length,
      verified: isCompanyVerified(company.id),
    };
  });
  return res.json({ companies: ranking });
});

// Public profile used by the entity social page. Only institutional fields are
// exposed; account links and internal ownership remain private.
app.get('/api/empresas/:id', (req, res) => {
  const company = companies.find(item => item.id === req.params.id);
  if (!company) return res.status(404).json({ error: 'Company not found' });
  const ratings = getCompanyReviews(company.id);
  const rating = ratings.length ? ratings.reduce((total, item) => total + Number(item.rating), 0) / ratings.length : 0;
  res.set('Cache-Control', 'no-store');
  const savedOfficials = company.officials && typeof company.officials === 'object' ? company.officials : {};
  const savedMayor = savedOfficials.prefeito && typeof savedOfficials.prefeito === 'object' ? savedOfficials.prefeito : {};
  const linkedMayor = savedMayor.userId && isUserLinkedToCompany(savedMayor.userId, company.id) ? users[savedMayor.userId] : null;
  return res.json({ company: {
    id: company.id, name: company.name, entityType: company.entityType === 'GOVERNO' ? 'PREFEITURA' : company.entityType || 'EMPRESA',
    industry: company.industry || 'Não informado', description: company.description || '',
    logoUrl: company.logoUrl || '', bannerUrl: company.bannerUrl || '',
    profileTagline: company.profileTagline || '', mediaUrls: Array.isArray(company.mediaUrls) ? company.mediaUrls : [],
    estimatedNetWorth: Number(company.estimatedNetWorth) || 0,
    officials: {
      presidente: { name: readText(savedOfficials.presidente?.name, 100) || 'Não informado', imageUrl: readImageUrl(savedOfficials.presidente?.imageUrl) || '' },
      prefeito: { name: linkedMayor?.username || readText(savedMayor.name, 100) || 'Não informado', imageUrl: linkedMayor?.avatar ? `https://cdn.discordapp.com/avatars/${linkedMayor.id}/${linkedMayor.avatar}.${linkedMayor.avatar.startsWith('a_') ? 'gif' : 'png'}?size=128` : readImageUrl(savedMayor.imageUrl) || '', linked: Boolean(linkedMayor) }
    },
    rating, ratingCount: ratings.length, verified: isCompanyVerified(company.id)
  }});
});

app.get('/api/config/solucoes-imagens', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ images: serviceImages });
});

app.patch('/api/config/solucoes-imagens', requireAuth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const requestedImages = req.body.images;
  if (!requestedImages || typeof requestedImages !== 'object' || Array.isArray(requestedImages)) return res.status(400).json({ error: 'images object required' });
  const allowedKeys = ['cidadao', 'governo', 'licencas', 'justica', 'registro'];
  for (const key of allowedKeys) {
    if (!(key in requestedImages)) continue;
    const imageUrl = readImageUrl(requestedImages[key]);
    if (readText(requestedImages[key], 2000) && !imageUrl) return res.status(400).json({ error: `Invalid HTTPS image URL for ${key}` });
    if (imageUrl) serviceImages[key] = imageUrl;
    else delete serviceImages[key];
  }
  saveData();
  return res.json({ ok: true, images: serviceImages });
});

app.get('/api/config/solucoes-textos', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ texts: serviceTexts });
});

app.patch('/api/config/solucoes-textos', requireAuth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const requestedTexts = req.body.texts;
  if (!requestedTexts || typeof requestedTexts !== 'object' || Array.isArray(requestedTexts)) return res.status(400).json({ error: 'texts object required' });
  const allowedKeys = ['page-kicker', 'page-title', 'page-lead', 'cidadao-kicker', 'cidadao-title', 'cidadao-description', 'governo-kicker', 'governo-title', 'governo-description', 'licencas-kicker', 'licencas-title', 'licencas-description', 'justica-kicker', 'justica-title', 'justica-description', 'registro-kicker', 'registro-title', 'registro-description'];
  for (const key of allowedKeys) {
    if (!(key in requestedTexts)) continue;
    const text = readText(requestedTexts[key], 1800);
    if (text) serviceTexts[key] = text;
    else delete serviceTexts[key];
  }
  saveData();
  return res.json({ ok: true, texts: serviceTexts });
});

app.patch('/api/empresas/:id', requireAuth, (req, res) => {
  const company = companies.find(item => item.id === req.params.id);
  if (!company) return res.status(404).json({ error: 'Company not found' });
  if (!canManageCompany(req, company.id)) return res.status(403).json({ error: 'Forbidden' });
  // Linked company users may edit institutional copy, while only the platform
  // administrator can change ownership-sensitive company fields.
  if (!isAdmin(req)) {
    company.description = readText(req.body.description, 3000);
    company.profileTagline = readText(req.body.profileTagline, 180);
    const logoUrl = readImageUrl(req.body.logoUrl);
    const bannerUrl = readImageUrl(req.body.bannerUrl);
    if (readText(req.body.logoUrl, 2000) && !logoUrl) return res.status(400).json({ error: 'Logo URL must use HTTPS' });
    if (readText(req.body.bannerUrl, 2000) && !bannerUrl) return res.status(400).json({ error: 'Banner URL must use HTTPS' });
    company.logoUrl = logoUrl;
    company.bannerUrl = bannerUrl;
    saveData();
    return res.json({ ok: true, company });
  }
  const name = readText(req.body.name, 120);
  if (!name) return res.status(400).json({ error: 'Company name is required' });
  const logoUrl = readImageUrl(req.body.logoUrl);
  if (readText(req.body.logoUrl, 2000) && !logoUrl) return res.status(400).json({ error: 'Logo URL must use HTTPS' });
  company.name = name;
  company.entityType = ['PREFEITURA', 'BIG_TECH'].includes(req.body.entityType) ? req.body.entityType : 'EMPRESA';
  company.industry = readText(req.body.industry, 100) || 'Não informado';
  company.description = readText(req.body.description, 3000);
  company.logoUrl = logoUrl;
  const bannerUrl = readImageUrl(req.body.bannerUrl);
  if (readText(req.body.bannerUrl, 2000) && !bannerUrl) return res.status(400).json({ error: 'Banner URL must use HTTPS' });
  company.bannerUrl = bannerUrl;
  company.profileTagline = readText(req.body.profileTagline, 180);
  if (req.body.mediaUrls !== undefined) {
    if (!Array.isArray(req.body.mediaUrls) || req.body.mediaUrls.length > 8) return res.status(400).json({ error: 'mediaUrls must contain up to 8 URLs' });
    const mediaUrls = [];
    for (const value of req.body.mediaUrls) {
      const mediaUrl = readImageUrl(value);
      if (readText(value, 2000) && !mediaUrl) return res.status(400).json({ error: 'Media URLs must use HTTPS' });
      if (mediaUrl) mediaUrls.push(mediaUrl);
    }
    company.mediaUrls = mediaUrls;
  }
  company.estimatedNetWorth = readMoney(req.body.estimatedNetWorth);
  contracts.filter(contract => contract.companyId === company.id).forEach(contract => { contract.orgao = name; });
  saveData();
  return res.json({ ok: true, company });
});

app.delete('/api/empresas/:id', requireAuth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const companyIndex = companies.findIndex(item => item.id === req.params.id);
  if (companyIndex === -1) return res.status(404).json({ error: 'Company not found' });
  const [company] = companies.splice(companyIndex, 1);
  const contractIds = new Set(contracts.filter(contract => contract.companyId === company.id).map(contract => contract.id));
  for (let index = contracts.length - 1; index >= 0; index -= 1) if (contractIds.has(contracts[index].id)) contracts.splice(index, 1);
  for (let index = proposals.length - 1; index >= 0; index -= 1) if (contractIds.has(proposals[index].contractId)) proposals.splice(index, 1);
  for (let index = companyComments.length - 1; index >= 0; index -= 1) if (companyComments[index].companyId === company.id) companyComments.splice(index, 1);
  for (let index = companyMembers.length - 1; index >= 0; index -= 1) if (companyMembers[index].companyId === company.id) companyMembers.splice(index, 1);
  for (let index = companyLinkRequests.length - 1; index >= 0; index -= 1) if (companyLinkRequests[index].companyId === company.id) companyLinkRequests.splice(index, 1);
  Object.keys(userCompany).forEach(userId => { if (userCompany[userId] === company.id) delete userCompany[userId]; });
  saveData();
  return res.json({ ok: true, deletedCompany: { id: company.id, name: company.name } });
});

app.get('/api/empresas/:id/comentarios', (req, res) => {
  const comments = companyComments.filter(comment => comment.companyId === req.params.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(comment => ({
    ...comment,
    user: users[comment.user.id] ? { id: users[comment.user.id].id, username: users[comment.user.id].username, avatar: users[comment.user.id].avatar || null } : comment.user
  }));
  return res.json({ comments });
});

app.post('/api/empresas/:id/comentarios', requireAuth, (req, res) => {
  if (!companies.some(company => company.id === req.params.id)) return res.status(404).json({ error: 'Company not found' });
  const body = readText(req.body.body, 1500);
  if (!body) return res.status(400).json({ error: 'Comment is required' });
  const imageUrl = readImageUrl(req.body.imageUrl);
  if (readText(req.body.imageUrl, 2000) && !imageUrl) return res.status(400).json({ error: 'Image URL must use HTTPS' });
  if (imageUrl && !isAdmin(req)) return res.status(403).json({ error: 'Only administrators can attach community images' });
  const comment = { id: crypto.randomBytes(8).toString('hex'), companyId: req.params.id, body, imageUrl, user: { id: req.user.id, username: req.user.username, avatar: req.user.avatar || null }, createdAt: new Date().toISOString() };
  companyComments.push(comment);
  saveData();
  return res.json({ ok: true, comment });
});

app.patch('/api/comentarios/:id', requireAuth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const comment = companyComments.find(item => item.id === req.params.id);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  const body = readText(req.body.body, 1500);
  if (!body) return res.status(400).json({ error: 'Comment is required' });
  comment.body = body; comment.updatedAt = new Date().toISOString();
  saveData();
  return res.json({ ok: true, comment });
});

app.delete('/api/comentarios/:id', requireAuth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const index = companyComments.findIndex(item => item.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Comment not found' });
  const [removed] = companyComments.splice(index, 1);
  // Deleting a post also removes its replies.
  if (removed.type === 'post') {
    for (let childIndex = companyComments.length - 1; childIndex >= 0; childIndex -= 1) {
      if (companyComments[childIndex].parentId === removed.id) companyComments.splice(childIndex, 1);
    }
  }
  saveData();
  return res.json({ ok: true });
});

// Admin: link user to company
app.post('/api/users/:id/link-company', (req, res) => {
  if(!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const userNickname = readText(req.params.id, 80);
  const companyName = readText(req.body.companyName, 120);
  if(!userNickname || !companyName) return res.status(400).json({ error: 'user nickname and company name required' });
  const normalizedNickname = userNickname.toLocaleLowerCase('pt-BR');
  const userMatches = Object.values(users).filter(user => user.username && user.username.toLocaleLowerCase('pt-BR') === normalizedNickname);
  if(!userMatches.length) return res.status(404).json({ error: 'user not found; they must log in with Discord first' });
  if(userMatches.length > 1) return res.status(409).json({ error: 'more than one user has this nickname' });
  const normalizedName = companyName.toLocaleLowerCase('pt-BR');
  const matches = companies.filter(company => company.name.toLocaleLowerCase('pt-BR') === normalizedName);
  if(!matches.length) return res.status(404).json({ error: 'company not found' });
  if(matches.length > 1) return res.status(409).json({ error: 'more than one company has this name' });
  userCompany[userMatches[0].id] = matches[0].id;
  saveData();
  return res.json({ ok:true, company: matches[0], user: userMatches[0] });
});

// Get my company for authenticated user
app.get('/api/my-company', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) return res.json({ company: null, companies: [] });
  const linkedCompanies = companies.filter(company => isUserLinkedToCompany(user.id, company.id));
  return res.json({ company: linkedCompanies[0] || null, companies: linkedCompanies });
});

// A Discord user can request access from each entity profile. Global admins approve it.
app.post('/api/empresas/:id/solicitar-vinculo', requireAuth, (req, res) => {
  if (!companies.some(company => company.id === req.params.id)) return res.status(404).json({ error: 'Company not found' });
  if (isUserLinkedToCompany(req.user.id, req.params.id)) return res.status(409).json({ error: 'You are already linked to this company' });
  if (companyLinkRequests.some(item => item.companyId === req.params.id && item.userId === req.user.id)) return res.status(409).json({ error: 'A link request is already pending' });
  const request = { id: crypto.randomBytes(8).toString('hex'), companyId: req.params.id, userId: req.user.id, createdAt: new Date().toISOString() };
  companyLinkRequests.push(request); saveData();
  return res.status(201).json({ ok: true, request });
});

app.get('/api/empresas/:id/vinculo-status', requireAuth, (req, res) => {
  if (!companies.some(company => company.id === req.params.id)) return res.status(404).json({ error: 'Company not found' });
  return res.json({ linked: isUserLinkedToCompany(req.user.id, req.params.id), pending: companyLinkRequests.some(item => item.companyId === req.params.id && item.userId === req.user.id) });
});

app.get('/api/empresas/:id/solicitacoes-vinculo', requireAuth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const requests = companyLinkRequests.filter(item => item.companyId === req.params.id && users[item.userId]).map(item => ({ ...item, user: { id: users[item.userId].id, username: users[item.userId].username, avatar: users[item.userId].avatar || null } }));
  return res.json({ requests });
});

app.post('/api/empresas/:id/solicitacoes-vinculo/:requestId/aprovar', requireAuth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const index = companyLinkRequests.findIndex(item => item.id === req.params.requestId && item.companyId === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Link request not found' });
  const [request] = companyLinkRequests.splice(index, 1);
  if (!isUserLinkedToCompany(request.userId, request.companyId)) companyMembers.push({ id: crypto.randomBytes(8).toString('hex'), companyId: request.companyId, userId: request.userId, role: 'Colaborador', linkedAt: new Date().toISOString() });
  saveData();
  return res.json({ ok: true });
});

app.delete('/api/empresas/:id/solicitacoes-vinculo/:requestId', requireAuth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const index = companyLinkRequests.findIndex(item => item.id === req.params.requestId && item.companyId === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Link request not found' });
  companyLinkRequests.splice(index, 1); saveData();
  return res.json({ ok: true });
});

// Create a contract (only authenticated users linked to a company)
app.post('/api/contratos', requireAuth, (req, res) => {
  try{
    const user = req.user;
    const cid = userCompany[user.id];
    if(!cid) return res.status(403).json({ error: 'User not linked to a company' });
    const company = companies.find(item => item.id === cid);
    if(!company) return res.status(403).json({ error: 'Company not found' });
    const { value } = req.body;
    const valueToBeAgreed = req.body.valueToBeAgreed === true;
    const title = readText(req.body.title, 160);
    const category = readText(req.body.category, 80);
    const status = ['ABERTA', 'ANDAMENTO', 'ENCERRADA'].includes(req.body.status) ? req.body.status : 'ABERTA';
    const deadline = readText(req.body.deadline, 10) || null;
    const description = readText(req.body.description, 4000);
    const contractTitle = readText(req.body.contractTitle, 160);
    const contractText = readText(req.body.contractText, 4000);
    if(!title) return res.status(400).json({ error: 'title required' });
    const numericValue = Number(value);
    if (!valueToBeAgreed && (!Number.isFinite(numericValue) || numericValue < 0)) return res.status(400).json({ error: 'valid non-negative value required' });
    const id = contracts.length ? Math.max(...contracts.map(c=>c.id))+1 : 1000;
    const contract = {
      id,
      code: `CT-${id}`,
      title,
      orgao: company.name,
      city: '',
      state: '',
      category,
      bidNumber: generateBiddingNumber(),
      status,
      value: valueToBeAgreed ? 0 : numericValue,
      valueToBeAgreed,
      deadline,
      description,
      contractTitle: contractTitle || title,
      contractText: contractText || description,
      companyId: cid,
      createdBy: user.id,
      createdAt: new Date().toISOString()
    };
    contracts.push(contract);
    saveData();
    return res.json({ ok:true, contract });
  }catch(err){ console.error('POST /api/contratos error',err); return res.status(500).json({ error: 'server error' }); }
});

function requireBotAdmin(req, res, next) {
  if (String(req.body.actorId) !== String(ADMIN_ID)) return res.status(403).json({ error: 'Administrator permission required' });
  next();
}
function findBotContract(id) { return contracts.find((contract) => String(contract.id) === String(id) || contract.bidNumber === String(id)); }
function botContractView(contract) {
  const company = companies.find((item) => String(item.id) === String(contract.companyId) || item.name === contract.orgao);
  return { ...contract, companyLogo: company && company.logoUrl ? company.logoUrl : '' };
}
app.get('/api/bot/entidades', requireBotApiKey, (req, res) => {
  const names = new Set();
  companies.forEach((company) => { if (company.name) names.add(company.name); });
  contracts.forEach((contract) => { if (contract.orgao) names.add(contract.orgao); });
  res.json({ entities: [...names].sort((a, b) => a.localeCompare(b, 'pt-BR')) });
});

app.patch('/api/empresas/:id/autoridades', requireAuth, (req, res) => {
  const company = companies.find(item => item.id === req.params.id);
  if (!company) return res.status(404).json({ error: 'Company not found' });
  if (!['PREFEITURA', 'GOVERNO'].includes(company.entityType)) return res.status(400).json({ error: 'Officials are only available for city halls' });
  if (!canManageCompany(req, company.id)) return res.status(403).json({ error: 'Forbidden' });
  const presidenteName = readText(req.body.presidenteName, 100);
  const presidenteImageUrl = readImageUrl(req.body.presidenteImageUrl);
  const prefeitoName = readText(req.body.prefeitoName, 100);
  const prefeitoImageUrl = readImageUrl(req.body.prefeitoImageUrl);
  if (readText(req.body.presidenteImageUrl, 2000) && !presidenteImageUrl) return res.status(400).json({ error: 'President image must use HTTPS' });
  if (readText(req.body.prefeitoImageUrl, 2000) && !prefeitoImageUrl) return res.status(400).json({ error: 'Mayor image must use HTTPS' });
  let userId = '';
  const prefeitoUsername = readText(req.body.prefeitoUsername, 80);
  if (prefeitoUsername) {
    const matches = Object.values(users).filter(user => user.username && user.username.toLocaleLowerCase('pt-BR') === prefeitoUsername.toLocaleLowerCase('pt-BR'));
    if (matches.length !== 1) return res.status(404).json({ error: 'Discord mayor not found or ambiguous; the user must log in first' });
    if (!isUserLinkedToCompany(matches[0].id, company.id)) return res.status(403).json({ error: 'The Discord mayor must be linked to this city hall' });
    userId = matches[0].id;
  }
  company.officials = { presidente: { name: presidenteName, imageUrl: presidenteImageUrl }, prefeito: { name: prefeitoName, imageUrl: prefeitoImageUrl, userId } };
  saveData();
  return res.json({ ok: true });
});

function publicComment(comment) {
  const user = comment.user && users[comment.user.id];
  return { ...comment, user: user ? { id: user.id, username: user.username, avatar: user.avatar || null } : comment.user };
}

app.get('/api/empresas/:id/opinioes', (req, res) => {
  if (!companies.some(company => company.id === req.params.id)) return res.status(404).json({ error: 'Company not found' });
  const reviews = getCompanyReviews(req.params.id);
  const comments = reviews.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)).map(publicComment);
  const average = reviews.length ? reviews.reduce((total, review) => total + Number(review.rating), 0) / reviews.length : 0;
  const currentUser = getCurrentUser(req);
  const myReview = currentUser ? comments.find(comment => comment.user?.id === currentUser.id) || null : null;
  res.set('Cache-Control', 'no-store');
  return res.json({ comments, average, count: reviews.length, myReview });
});

app.post('/api/empresas/:id/opinioes', requireAuth, (req, res) => {
  if (!companies.some(company => company.id === req.params.id)) return res.status(404).json({ error: 'Company not found' });
  const body = readText(req.body.body, 1500);
  const rating = Number(req.body.rating);
  if (!body || !Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Uma opinião requer comentário e avaliação de 1 a 5 estrelas.' });
  const existing = getCompanyReviews(req.params.id).find(review => review.user?.id === req.user.id);
  if (existing) {
    existing.body = body; existing.rating = rating; existing.user = { id: req.user.id, username: req.user.username, avatar: req.user.avatar || null }; existing.updatedAt = new Date().toISOString(); saveData();
    return res.json({ ok: true, updated: true, comment: publicComment(existing) });
  }
  const comment = { id: crypto.randomBytes(8).toString('hex'), type: 'review', companyId: req.params.id, body, rating, user: { id: req.user.id, username: req.user.username, avatar: req.user.avatar || null }, createdAt: new Date().toISOString() };
  companyComments.push(comment); saveData();
  return res.status(201).json({ ok: true, comment: publicComment(comment) });
});

app.delete('/api/opinioes/:id', requireAuth, (req, res) => {
  const index = companyComments.findIndex(item => item.id === req.params.id && item.type === 'review');
  if (index === -1) return res.status(404).json({ error: 'Opinion not found' });
  if (!isAdmin(req)) return res.status(403).json({ error: 'Only moderators can remove opinions' });
  companyComments.splice(index, 1); saveData();
  return res.json({ ok: true });
});

app.get('/api/empresas/:id/posts', (req, res) => {
  if (!companies.some(company => company.id === req.params.id)) return res.status(404).json({ error: 'Company not found' });
  const posts = companyComments.filter(item => item.companyId === req.params.id && item.type === 'post')
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || new Date(b.createdAt) - new Date(a.createdAt))
    .map(post => ({ ...publicComment(post), comments: companyComments.filter(item => item.parentId === post.id && item.type === 'post-comment').sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).map(publicComment) }));
  res.set('Cache-Control', 'no-store');
  return res.json({ posts });
});

app.post('/api/empresas/:id/posts', requireAuth, (req, res) => {
  if (!companies.some(company => company.id === req.params.id)) return res.status(404).json({ error: 'Company not found' });
  if (!canManageCompany(req, req.params.id)) return res.status(403).json({ error: 'Only linked company users can publish posts' });
  const body = readText(req.body.body, 1500);
  const media = readPostMedia(req.body.imageUrl);
  if (!body || !media) return res.status(400).json({ error: 'A post requires a message and one HTTPS image or YouTube URL' });
  const post = { id: crypto.randomBytes(8).toString('hex'), type: 'post', companyId: req.params.id, body, imageUrl: media.thumbnailUrl, mediaUrl: media.url, mediaType: media.type, youtubeId: media.videoId, user: { id: req.user.id, username: req.user.username, avatar: req.user.avatar || null }, createdAt: new Date().toISOString() };
  companyComments.push(post); saveData();
  return res.status(201).json({ ok: true, post: publicComment(post) });
});

app.patch('/api/posts/:id', requireAuth, (req, res) => {
  const post = companyComments.find(item => item.id === req.params.id && item.type === 'post');
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (!canManageCompany(req, post.companyId)) return res.status(403).json({ error: 'Only linked company users can edit posts' });
  const body = readText(req.body.body, 1500);
  const media = readPostMedia(req.body.imageUrl);
  if (!body || !media) return res.status(400).json({ error: 'A post requires a message and one HTTPS image or YouTube URL' });
  post.body = body; post.imageUrl = media.thumbnailUrl; post.mediaUrl = media.url; post.mediaType = media.type; post.youtubeId = media.videoId; post.updatedAt = new Date().toISOString();
  saveData();
  return res.json({ ok: true, post: publicComment(post) });
});

app.patch('/api/posts/:id/fixar', requireAuth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Only administrators can pin posts' });
  const post = companyComments.find(item => item.id === req.params.id && item.type === 'post');
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (req.body.pinned === true) companyComments.forEach(item => { if (item.type === 'post' && item.companyId === post.companyId) item.pinned = false; });
  post.pinned = req.body.pinned === true;
  saveData();
  return res.json({ ok: true, post: publicComment(post) });
});

app.post('/api/posts/:id/comentarios', requireAuth, (req, res) => {
  const post = companyComments.find(item => item.id === req.params.id && item.type === 'post');
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const body = readText(req.body.body, 1500);
  if (!body) return res.status(400).json({ error: 'Comment is required' });
  const comment = { id: crypto.randomBytes(8).toString('hex'), type: 'post-comment', parentId: post.id, companyId: post.companyId, body, user: { id: req.user.id, username: req.user.username, avatar: req.user.avatar || null }, createdAt: new Date().toISOString() };
  companyComments.push(comment); saveData();
  return res.status(201).json({ ok: true, comment: publicComment(comment) });
});

app.get('/api/empresas/:id/colaboradores', (req, res) => {
  if (!companies.some(company => company.id === req.params.id)) return res.status(404).json({ error: 'Company not found' });
  // A visible member must be an account actually linked to this company.
  const members = companyMembers
    .filter(member => member.companyId === req.params.id && member.userId && isUserLinkedToCompany(member.userId, req.params.id) && users[member.userId])
    .map(member => ({ id: member.id, role: member.role, user: { id: users[member.userId].id, username: users[member.userId].username, avatar: users[member.userId].avatar || null } }))
    .sort((a, b) => a.user.username.localeCompare(b.user.username, 'pt-BR'));
  res.set('Cache-Control', 'no-store');
  return res.json({ members });
});

app.post('/api/empresas/:id/colaboradores', requireAuth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (!companies.some(company => company.id === req.params.id)) return res.status(404).json({ error: 'Company not found' });
  const role = readText(req.body.role, 100);
  const username = readText(req.body.username, 80);
  if (!username || !role) return res.status(400).json({ error: 'Discord username and role are required' });
  const matches = Object.values(users).filter(user => user.username && user.username.toLocaleLowerCase('pt-BR') === username.toLocaleLowerCase('pt-BR'));
  if (matches.length !== 1) return res.status(404).json({ error: 'Discord user not found or ambiguous; the user must log in first' });
  const user = matches[0];
  if (!isUserLinkedToCompany(user.id, req.params.id)) return res.status(403).json({ error: 'This Discord user is not linked to this company' });
  if (companyMembers.some(member => member.companyId === req.params.id && member.userId === user.id)) return res.status(409).json({ error: 'This user is already in the company board' });
  const member = { id: crypto.randomBytes(8).toString('hex'), companyId: req.params.id, userId: user.id, role };
  companyMembers.push(member);
  saveData();
  return res.status(201).json({ ok: true, member });
});

app.delete('/api/empresas/:companyId/colaboradores/:memberId', requireAuth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const index = companyMembers.findIndex(member => member.companyId === req.params.companyId && member.id === req.params.memberId);
  if (index === -1) return res.status(404).json({ error: 'Member not found' });
  companyMembers.splice(index, 1);
  saveData();
  return res.json({ ok: true });
});
app.get('/api/bot/contratos', requireBotApiKey, (req, res) => res.json({ contracts: [...contracts].sort((a, b) => b.id - a.id).map(botContractView) }));
app.get('/api/bot/contratos/:id', requireBotApiKey, (req, res) => {
  const contract = findBotContract(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  res.json({ contract: botContractView(contract) });
});
app.post('/api/bot/contratos', requireBotApiKey, requireBotAdmin, (req, res) => {
  const title = readText(req.body.title, 160), description = readText(req.body.description, 4000), value = Number(req.body.value);
  if (!title || !Number.isFinite(value) || value < 0) return res.status(400).json({ error: 'title and valid value required' });
  const id = contracts.length ? Math.max(...contracts.map((contract) => contract.id)) + 1 : 1000;
  const contract = { id, code: 'CT-' + id, title, orgao: process.env.BOT_COMPANY_NAME || 'Docs Company', city: '', state: '', category: '', bidNumber: generateBiddingNumber(), status: ['ABERTA','ANDAMENTO','ENCERRADA'].includes(req.body.status) ? req.body.status : 'ABERTA', value, valueToBeAgreed: false, deadline: readText(req.body.deadline, 10) || null, description, contractTitle: title, contractText: description, companyId: null, createdBy: String(req.body.actorId), createdAt: new Date().toISOString(), source: 'discord-bot' };
  contracts.push(contract); saveData(); res.status(201).json({ ok: true, contract });
});
app.patch('/api/bot/contratos/:id', requireBotApiKey, requireBotAdmin, (req, res) => {
  const contract = findBotContract(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (readText(req.body.title, 160)) { contract.title = readText(req.body.title,160); contract.contractTitle = contract.title; }
  if (readText(req.body.description,4000)) { contract.description = readText(req.body.description,4000); contract.contractText = contract.description; }
  if (req.body.value !== undefined && Number.isFinite(Number(req.body.value))) contract.value = Number(req.body.value);
  if (typeof req.body.deadline === 'string') contract.deadline = readText(req.body.deadline,10) || null;
  if (['ABERTA','ANDAMENTO','ENCERRADA'].includes(req.body.status)) contract.status = req.body.status;
  contract.updatedAt = new Date().toISOString(); saveData(); res.json({ ok:true, contract });
});
app.patch('/api/bot/contratos/:id/encerrar', requireBotApiKey, requireBotAdmin, (req, res) => {
  const contract = findBotContract(req.params.id), reason = readText(req.body.reason, 2000);
  if (!contract) return res.status(404).json({ error:'Contract not found' });
  if (!reason) return res.status(400).json({ error:'A closing reason is required' });
  contract.status='ENCERRADA'; contract.closeReason=reason; contract.closedAt=new Date().toISOString(); contract.closedBy=String(req.body.actorId); saveData(); res.json({ok:true,contract});
});
app.delete('/api/bot/contratos/:id', requireBotApiKey, requireBotAdmin, (req, res) => {
  const index=contracts.findIndex((contract)=>contract.id===Number(req.params.id));
  if(index<0) return res.status(404).json({error:'Contract not found'});
  const deletedContract=contracts.splice(index,1)[0]; saveData(); res.json({ok:true,deletedContract});
});
app.post('/api/bot/contratos/:id/propostas', requireBotApiKey, (req, res) => {
  const contract = findBotContract(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (contract.status === 'ENCERRADA') return res.status(409).json({ error: 'Closed contracts cannot receive proposals' });
  const value = req.body.newValue === undefined || req.body.newValue === null ? null : Number(req.body.newValue);
  if (value !== null && (!Number.isFinite(value) || value < 0)) return res.status(400).json({ error: 'Invalid proposed value' });
  const acceptValue = !!req.body.acceptValue;
  const acceptDeadline = !!req.body.acceptDeadline;
  const deadline = readText(req.body.newDeadline, 10) || null;
  if (!acceptValue && value === null) return res.status(400).json({ error: 'A new value is required when the contract value is not accepted' });
  if (!acceptDeadline && !deadline) return res.status(400).json({ error: 'A new deadline is required when the contract deadline is not accepted' });
  const proposal = { id: crypto.randomBytes(8).toString('hex'), contractId: contract.id, user: { id: String(req.body.userId), username: readText(req.body.username, 100), avatar: readText(req.body.avatar, 2000) || null }, acceptValue, acceptDeadline, newValue: value, newDeadline: deadline, message: readText(req.body.message, 2000), status: 'PENDENTE', createdAt: new Date().toISOString() };
  proposals.push(proposal);
  if (contract.status === 'ABERTA') contract.status = 'ANDAMENTO';
  saveData(); res.status(201).json({ ok:true, proposal });
});
app.get('/api/bot/contratos/:id/propostas', requireBotApiKey, (req, res) => {
  const contract = findBotContract(req.params.id);
  if (!contract) return res.status(404).json({ error:'Contract not found' });
  res.json({ proposals: proposals.filter((item) => item.contractId === contract.id).sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt)) });
});
// List contracts (for admin/any) - optional
app.get('/api/contratos', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.json({ contracts, deletedStaticContractIds });
});

// Proposals received by contracts belonging to the authenticated user's company.
app.get('/api/propostas/recebidas', requireAuth, (req, res) => {
  const companyId = userCompany[req.user.id];
  if (!companyId) return res.status(403).json({ error: 'User not linked to a company' });
  const companyContracts = new Map(contracts.filter(contract => contract.companyId === companyId).map(contract => [contract.id, contract]));
  const received = proposals
    .filter(proposal => companyContracts.has(proposal.contractId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(proposal => {
      const contract = companyContracts.get(proposal.contractId);
      return { ...proposal, contract: { id: contract.id, code: contract.code, title: contract.title } };
    });
  return res.json({ proposals: received });
});

// The company receiving a proposal can make the final decision.
app.patch('/api/propostas/:id/status', requireAuth, (req, res) => {
  const companyId = userCompany[req.user.id];
  if (!companyId) return res.status(403).json({ error: 'User not linked to a company' });
  const status = readText(req.body.status, 16).toUpperCase();
  if (!['ACEITA', 'RECUSADA'].includes(status)) return res.status(400).json({ error: 'Status must be ACEITA or RECUSADA' });
  const proposal = proposals.find(item => item.id === req.params.id);
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  const contract = contracts.find(item => item.id === proposal.contractId);
  if (!contract || contract.companyId !== companyId) return res.status(403).json({ error: 'Forbidden' });
  if (contract.status === 'ENCERRADA') return res.status(409).json({ error: 'Closed contracts cannot receive decisions' });
  if (proposal.status !== 'PENDENTE') return res.status(409).json({ error: 'Proposal has already been decided' });
  proposal.status = status;
  proposal.decidedAt = new Date().toISOString();
  proposal.decidedBy = req.user.id;
  if (status === 'ACEITA') contract.status = 'ANDAMENTO';
  saveData();
  return res.json({ ok: true, proposal });
});

// Only administrators can remove a proposal comment and its complete record.
app.delete('/api/propostas/:id/comentario', requireAuth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const proposalIndex = proposals.findIndex(item => item.id === req.params.id);
  if (proposalIndex === -1) return res.status(404).json({ error: 'Proposal not found' });
  const [deletedProposal] = proposals.splice(proposalIndex, 1);
  saveData();
  return res.json({ ok: true, deletedProposal: { id: deletedProposal.id } });
});

// The company that owns a contract can close it, with a recorded reason.
app.patch('/api/contratos/:id', requireAuth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const contractId = Number(req.params.id);
  const contract = contracts.find(item => item.id === contractId);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  const title = readText(req.body.title, 160);
  const description = readText(req.body.description, 4000);
  const deadline = readText(req.body.deadline, 10) || null;
  const valueToBeAgreed = req.body.valueToBeAgreed === true;
  const value = Number(req.body.value);
  if (!title) return res.status(400).json({ error: 'title required' });
  if (!valueToBeAgreed && (!Number.isFinite(value) || value < 0)) return res.status(400).json({ error: 'valid non-negative value required' });
  contract.title = title;
  contract.contractTitle = title;
  contract.description = description;
  contract.contractText = description;
  contract.deadline = deadline;
  contract.value = valueToBeAgreed ? 0 : value;
  contract.valueToBeAgreed = valueToBeAgreed;
  contract.updatedAt = new Date().toISOString();
  saveData();
  return res.json({ ok: true, contract });
});

app.patch('/api/contratos/:id/encerrar', requireAuth, (req, res) => {
  const companyId = userCompany[req.user.id];
  if (!companyId) return res.status(403).json({ error: 'User not linked to a company' });
  const contractId = Number(req.params.id);
  const contract = contracts.find(item => item.id === contractId);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (contract.companyId !== companyId) return res.status(403).json({ error: 'Forbidden' });
  if (contract.status === 'ENCERRADA') return res.status(409).json({ error: 'Contract is already closed' });
  const closeReason = readText(req.body.reason, 2000);
  if (!closeReason) return res.status(400).json({ error: 'A closing reason is required' });
  contract.status = 'ENCERRADA';
  contract.closeReason = closeReason;
  contract.closedAt = new Date().toISOString();
  contract.closedBy = req.user.id;
  saveData();
  return res.json({ ok: true, contract });
});

// Administrator-only deletion, including proposals belonging to the contract.
app.delete('/api/contratos/:id', requireAuth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const contractId = Number(req.params.id);
  const contractIndex = contracts.findIndex(item => item.id === contractId);
  if (contractIndex === -1) {
    if (!Number.isInteger(contractId)) return res.status(400).json({ error: 'Valid contract id required' });
    if (!deletedStaticContractIds.includes(contractId)) deletedStaticContractIds.push(contractId);
    saveData();
    return res.json({ ok: true, deletedContract: { id: contractId, title: 'Licitação demonstrativa' } });
  }
  const [contract] = contracts.splice(contractIndex, 1);
  for (let index = proposals.length - 1; index >= 0; index -= 1) {
    if (proposals[index].contractId === contractId) proposals.splice(index, 1);
  }
  saveData();
  return res.json({ ok: true, deletedContract: { id: contract.id, title: contract.title } });
});

// Proposal comments are public in the Discord channel, so the licitation page
// also exposes this read-only history without requiring a website session.
app.get('/api/contratos/:id/propostas', (req, res) => {
  try {
    const id = Number(req.params.id);
    const list = proposals.filter(p => p.contractId === id).sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt));
    return res.json({ proposals: list });
  } catch (err) {
    console.error('GET /api/contratos/:id/propostas error', err);
    return res.status(500).json({ error: 'server error' });
  }
});

// Endpoint for frontend to fetch current user session (returns null if not authenticated)
app.get('/auth/me', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) return res.json({ user: null });
  const isAdmin = ADMIN_ID && String(user.id) === String(ADMIN_ID);
  return res.json({ user, isAdmin });
});

// In production the same Express service delivers the public site and its API.
// Keeping auth-server private avoids publishing .env and the local backup JSON.
app.use('/auth-server', (req, res) => res.sendStatus(404));
app.get('/parceiros.html', (req, res) => res.redirect(301, '/entidades.html'));
app.use(express.static(path.join(__dirname, '..'), { dotfiles: 'deny' }));

async function startServer() {
  if (USE_SUPABASE) {
    try {
      const remoteStateFound = await loadSupabaseState();
      supabaseReady = true;
      if (!remoteStateFound) {
        // First deployment: seed the database with the existing local backup.
        persistSupabaseState();
        console.log('No Supabase state found; queued migration of the local backup.');
      } else {
        console.log('Loaded persistent state from Supabase.');
      }
    } catch (error) {
      // The local JSON remains a safe fallback, including during a temporary outage.
      console.error('Could not load Supabase state; using local backup:', error.message);
    }
  }
  app.listen(PORT, () => console.log(`Docs. Company server listening on port ${PORT}`));
}

startServer();
