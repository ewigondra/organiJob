const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;
const DATABASE_URL = process.env.DATABASE_URL;
const PGSSLMODE = process.env.PGSSLMODE;

if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL. Set it in your environment.');
  process.exit(1);
}

const shouldUseSSL = PGSSLMODE === 'require' || DATABASE_URL.includes('render.com');
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: shouldUseSSL ? { rejectUnauthorized: false } : undefined,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nom TEXT NOT NULL,
      organisation TEXT NOT NULL,
      date_appel TIMESTAMPTZ NOT NULL,
      expertise TEXT,
      inclusivite TEXT,
      notes TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id);');
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

function normalizeDate(dateAppel) {
  const raw = String(dateAppel || '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
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

function createToken() {
  return crypto.randomBytes(24).toString('hex');
}

async function getUserFromAuth(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;

  const result = await pool.query(
    `
      SELECT u.id, u.email
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = $1
      LIMIT 1
    `,
    [token]
  );

  if (!result.rows[0]) return null;
  return { token, user: result.rows[0] };
}

async function issueSession(userId) {
  const token = createToken();
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  await pool.query('INSERT INTO sessions(token, user_id) VALUES($1, $2)', [token, userId]);
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
        sendJson(res, 400, { error: 'Mot de passe trop court (8 caracteres minimum).' });
        return;
      }

      const existing = await pool.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
      if (existing.rows[0]) {
        sendJson(res, 409, { error: 'Ce compte existe deja. Connecte-toi.' });
        return;
      }

      const userId = crypto.randomUUID();
      const { hash, salt } = hashPassword(password);

      await pool.query(
        `
          INSERT INTO users(id, email, password_hash, password_salt)
          VALUES($1, $2, $3, $4)
        `,
        [userId, email, hash, salt]
      );

      const token = await issueSession(userId);
      sendJson(res, 201, { token, user: { id: userId, email } });
    } catch {
      sendJson(res, 400, { error: 'Requete invalide.' });
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

      const result = await pool.query(
        `
          SELECT id, email, password_hash, password_salt
          FROM users
          WHERE email = $1
          LIMIT 1
        `,
        [email]
      );

      const user = result.rows[0];
      if (!user) {
        sendJson(res, 404, { error: 'Compte introuvable. Cree un compte.' });
        return;
      }

      const ok = verifyPassword(password, user.password_salt, user.password_hash);
      if (!ok) {
        sendJson(res, 401, { error: 'Email ou mot de passe incorrect.' });
        return;
      }

      const token = await issueSession(user.id);
      sendJson(res, 200, { token, user: { id: user.id, email: user.email } });
    } catch {
      sendJson(res, 400, { error: 'Requete invalide.' });
    }
    return;
  }

  if (req.url === '/api/auth/logout' && req.method === 'POST') {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token) {
      await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.url === '/api/sync' && req.method === 'GET') {
    try {
      const authData = await getUserFromAuth(req);
      if (!authData) {
        sendJson(res, 401, { error: 'Non autorise.' });
        return;
      }

      const contactsResult = await pool.query(
        `
          SELECT id, user_id AS "userId", nom, organisation,
                 date_appel AS "dateAppel", expertise, inclusivite, notes,
                 updated_at AS "updatedAt"
          FROM contacts
          WHERE user_id = $1
          ORDER BY date_appel DESC
        `,
        [authData.user.id]
      );

      sendJson(res, 200, {
        user: { id: authData.user.id, email: authData.user.email },
        contacts: contactsResult.rows,
        syncedAt: new Date().toISOString(),
      });
    } catch {
      sendJson(res, 500, { error: 'Erreur serveur.' });
    }
    return;
  }

  if (req.url === '/api/sync' && req.method === 'PUT') {
    const client = await pool.connect();
    try {
      const authData = await getUserFromAuth(req);
      if (!authData) {
        sendJson(res, 401, { error: 'Non autorise.' });
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
          dateAppel: normalizeDate(c.dateAppel),
          expertise: String(c.expertise || '').trim(),
          inclusivite: String(c.inclusivite || '').trim(),
          notes: String(c.notes || '').trim(),
        }))
        .filter((c) => c.nom && c.organisation && c.dateAppel);

      await client.query('BEGIN');
      await client.query('DELETE FROM contacts WHERE user_id = $1', [userId]);

      for (const c of sanitizedContacts) {
        await client.query(
          `
            INSERT INTO contacts(id, user_id, nom, organisation, date_appel, expertise, inclusivite, notes, updated_at)
            VALUES($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          `,
          [c.id, c.userId, c.nom, c.organisation, c.dateAppel, c.expertise, c.inclusivite, c.notes]
        );
      }

      await client.query('COMMIT');
      sendJson(res, 200, {
        ok: true,
        count: sanitizedContacts.length,
        syncedAt: new Date().toISOString(),
      });
    } catch {
      await client.query('ROLLBACK');
      sendJson(res, 400, { error: 'Requete invalide.' });
    } finally {
      client.release();
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

initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`OrganiJob server running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Database init failed:', error.message);
    process.exit(1);
  });
