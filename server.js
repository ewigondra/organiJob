const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const initial = { users: [], sessions: [], contacts: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf8');
  }
}

function readDb() {
  ensureDb();
  const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  return {
    users: Array.isArray(raw.users) ? raw.users : [],
    sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
    contacts: Array.isArray(raw.contacts) ? raw.contacts : [],
  };
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  });
  res.end(body);
}

function sendFile(res, filepath) {
  const ext = path.extname(filepath).toLowerCase();
  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  };

  fs.readFile(filepath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizePassword(password) {
  return String(password || '');
}

function isValidEmail(email) {
  return Boolean(email && email.includes('@') && email.includes('.'));
}

function isValidPassword(password) {
  return password.length >= 8;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

function getUserFromAuth(req, db) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;

  const session = db.sessions.find((s) => s.token === token);
  if (!session) return null;

  const user = db.users.find((u) => u.id === session.userId);
  if (!user) return null;

  return { user, token };
}

function createToken() {
  return crypto.randomBytes(24).toString('hex');
}

function issueSession(db, userId) {
  const token = createToken();
  db.sessions = db.sessions.filter((s) => s.userId !== userId);
  db.sessions.push({ token, userId, createdAt: new Date().toISOString() });
  return token;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    });
    res.end();
    return;
  }

  if (req.url === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.url === '/api/auth/register' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const email = normalizeEmail(body.email);
      const password = normalizePassword(body.password);

      if (!isValidEmail(email)) {
        sendJson(res, 400, { error: 'Adresse email invalide.' });
        return;
      }

      if (!isValidPassword(password)) {
        sendJson(res, 400, { error: 'Mot de passe trop court (8 caractères minimum).' });
        return;
      }

      const db = readDb();
      const existing = db.users.find((u) => u.email === email);
      if (existing && existing.passwordHash && existing.passwordSalt) {
        sendJson(res, 409, { error: 'Ce compte existe déjà. Connecte-toi.' });
        return;
      }

      const { hash, salt } = hashPassword(password);
      let user = existing;

      if (!user) {
        user = {
          id: crypto.randomUUID(),
          email,
          passwordHash: hash,
          passwordSalt: salt,
          createdAt: new Date().toISOString(),
        };
        db.users.push(user);
      } else {
        user.passwordHash = hash;
        user.passwordSalt = salt;
        user.updatedAt = new Date().toISOString();
      }

      const token = issueSession(db, user.id);
      writeDb(db);
      sendJson(res, 201, { token, user: { id: user.id, email: user.email } });
    } catch {
      sendJson(res, 400, { error: 'Requête invalide.' });
    }
    return;
  }

  if (req.url === '/api/auth/login' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const email = normalizeEmail(body.email);
      const password = normalizePassword(body.password);

      if (!isValidEmail(email)) {
        sendJson(res, 400, { error: 'Adresse email invalide.' });
        return;
      }

      const db = readDb();
      const user = db.users.find((u) => u.email === email);
      if (!user || !user.passwordHash || !user.passwordSalt) {
        sendJson(res, 404, { error: 'Compte introuvable. Crée un compte.' });
        return;
      }

      const ok = verifyPassword(password, user.passwordSalt, user.passwordHash);
      if (!ok) {
        sendJson(res, 401, { error: 'Email ou mot de passe incorrect.' });
        return;
      }

      const token = issueSession(db, user.id);
      writeDb(db);
      sendJson(res, 200, { token, user: { id: user.id, email: user.email } });
    } catch {
      sendJson(res, 400, { error: 'Requête invalide.' });
    }
    return;
  }

  if (req.url === '/api/auth/logout' && req.method === 'POST') {
    const db = readDb();
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    db.sessions = db.sessions.filter((s) => s.token !== token);
    writeDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.url === '/api/sync' && req.method === 'GET') {
    const db = readDb();
    const authData = getUserFromAuth(req, db);
    if (!authData) {
      sendJson(res, 401, { error: 'Non autorisé.' });
      return;
    }

    const userContacts = db.contacts
      .filter((c) => c.userId === authData.user.id)
      .sort((a, b) => new Date(b.dateAppel) - new Date(a.dateAppel));

    sendJson(res, 200, {
      user: { id: authData.user.id, email: authData.user.email },
      contacts: userContacts,
      syncedAt: new Date().toISOString(),
    });
    return;
  }

  if (req.url === '/api/sync' && req.method === 'PUT') {
    try {
      const db = readDb();
      const authData = getUserFromAuth(req, db);
      if (!authData) {
        sendJson(res, 401, { error: 'Non autorisé.' });
        return;
      }

      const body = await parseBody(req);
      const incomingContacts = Array.isArray(body.contacts) ? body.contacts : null;
      if (!incomingContacts) {
        sendJson(res, 400, { error: 'Format invalide: contacts attendus.' });
        return;
      }

      const userId = authData.user.id;
      const sanitizedContacts = incomingContacts
        .map((c) => ({
          id: c.id || crypto.randomUUID(),
          userId,
          nom: String(c.nom || '').trim(),
          organisation: String(c.organisation || '').trim(),
          dateAppel: String(c.dateAppel || '').trim(),
          expertise: String(c.expertise || '').trim(),
          inclusivite: String(c.inclusivite || '').trim(),
          notes: String(c.notes || '').trim(),
          updatedAt: new Date().toISOString(),
        }))
        .filter((c) => c.nom && c.organisation && c.dateAppel);

      db.contacts = db.contacts.filter((c) => c.userId !== userId).concat(sanitizedContacts);
      writeDb(db);

      sendJson(res, 200, {
        ok: true,
        count: sanitizedContacts.length,
        syncedAt: new Date().toISOString(),
      });
    } catch {
      sendJson(res, 400, { error: 'Requête invalide.' });
    }
    return;
  }

  const safePath = req.url === '/' ? '/index.html' : req.url;
  const cleaned = safePath.split('?')[0];
  const filepath = path.join(PUBLIC_DIR, cleaned);

  if (!filepath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  sendFile(res, filepath);
});

server.listen(PORT, () => {
  ensureDb();
  console.log(`OrganiJob server running on http://localhost:${PORT}`);
});
