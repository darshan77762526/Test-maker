const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const firebaseStore = require('../firebase');

// Secure secret from environment, or generate dynamic secret per server process
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

function renderTerminationPage(reason = 'terminated_by_admin') {
  const isMultiple = reason === 'new_login_on_different_device';
  const title = isMultiple ? 'Multiple Device Access Detected' : 'Active Session Revoked';
  const message = isMultiple 
    ? 'Your candidate account was logged in from another device. For examination security, only one device can access the platform at any given time.'
    : 'Your examination session was forcefully terminated by the Administrator. Access to active tests and dashboard operations has been revoked.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Session Terminated — National Testing Platform</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      background: radial-gradient(ellipse at center, #1e293b 0%, #0f172a 100%);
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      max-width: 480px;
      width: 100%;
      background: rgba(30, 41, 59, 0.95);
      border: 1px solid #334155;
      border-radius: 20px;
      padding: 36px 32px;
      text-align: center;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
    }
    .badge {
      display: inline-block;
      padding: 6px 16px;
      background: #ef4444;
      color: #ffffff;
      font-weight: 800;
      font-size: 11px;
      letter-spacing: 0.1em;
      border-radius: 9999px;
      margin-bottom: 20px;
    }
    h1 {
      font-size: 22px;
      font-weight: 800;
      margin-bottom: 12px;
      color: #ffffff;
    }
    p {
      font-size: 14px;
      color: #94a3b8;
      line-height: 1.6;
      margin-bottom: 28px;
    }
    .btn {
      display: inline-block;
      width: 100%;
      padding: 13px 24px;
      background: #0284c7;
      color: #ffffff;
      font-weight: 700;
      font-size: 14px;
      border-radius: 10px;
      text-decoration: none;
      transition: background 0.15s ease;
    }
    .btn:hover { background: #0369a1; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">SESSION TERMINATED</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="/#/login" class="btn" onclick="localStorage.clear();">Return to Sign In</a>
  </div>
</body>
</html>`;
}

function isApiRequest(req) {
  const fullUrl = req.originalUrl || req.url || '';
  return fullUrl.startsWith('/api/') || Boolean(req.xhr) || Boolean(req.headers['accept']?.includes('application/json'));
}

async function authenticate(req, res, next) {
  try {
    let token = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      if (!isApiRequest(req) && req.accepts('html')) {
        return res.status(401).send(renderTerminationPage('no_token'));
      }
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'No authorization token provided' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      if (!isApiRequest(req) && req.accepts('html')) {
        return res.status(401).send(renderTerminationPage('token_expired'));
      }
      return res.status(401).json({ error: 'INVALID_TOKEN', message: 'Session token expired or invalid' });
    }

    // 1. First Check Firebase Realtime Database for real-time termination status
    let fbSession = null;
    if (firebaseStore.isAvailable()) {
      try {
        fbSession = await firebaseStore.getSessionByToken(token);
      } catch (e) {}
    }

    if (fbSession && fbSession.is_active === 0) {
      // Mark terminated in SQLite if present
      query.run('UPDATE sessions SET is_active = 0, terminated_reason = ? WHERE token = ?', [fbSession.terminated_reason || 'terminated_by_admin', token]).catch(() => {});

      if (!isApiRequest(req) && req.accepts('html')) {
        return res.status(401).send(renderTerminationPage(fbSession.terminated_reason || 'terminated_by_admin'));
      }
      return res.status(401).json({
        error: 'SESSION_TERMINATED',
        reason: fbSession.terminated_reason || 'terminated_by_admin',
        message: 'Your session has been terminated by the Administrator.'
      });
    }

    // 2. Verify session in local SQLite database
    let session = await query.get(
      `SELECT s.*, u.name, u.email, u.role 
       FROM sessions s 
       JOIN users u ON u.id = s.user_id 
       WHERE s.token = ?`,
      [token]
    ).catch(() => null);

    // If session is explicitly marked inactive in SQLite, block immediately
    if (session && session.is_active !== 1) {
      if (!isApiRequest(req) && req.accepts('html')) {
        return res.status(401).send(renderTerminationPage(session.terminated_reason || 'terminated_by_admin'));
      }
      return res.status(401).json({
        error: 'SESSION_TERMINATED',
        reason: session.terminated_reason || 'terminated_by_admin',
        message: 'Your session has been terminated by the Administrator.'
      });
    }

    // 3. Serverless Cold-Start Session Recovery (ONLY IF NOT TERMINATED)
    if (!session && decoded && decoded.userId) {
      await query.run(
        `INSERT OR IGNORE INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)`,
        [decoded.userId, decoded.name || 'Candidate', decoded.email, 'SECURE_HASH', decoded.role || 'STUDENT']
      ).catch(() => {});

      const recResult = await query.run(
        `INSERT OR REPLACE INTO sessions 
         (user_id, token, device_os, device_browser, device_type, screen_size, ip_address, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [decoded.userId, token, decoded.deviceOs || 'Client Device', decoded.deviceBrowser || 'Browser', 'desktop', '1920x1080', req.ip || '127.0.0.1']
      ).catch(() => {});

      session = {
        id: (recResult && recResult.lastID) || decoded.sessionId || 1,
        user_id: decoded.userId,
        name: decoded.name || 'Candidate',
        email: decoded.email,
        role: decoded.role || 'STUDENT',
        token,
        is_active: 1,
        device_os: decoded.deviceOs || 'Client Device',
        device_browser: decoded.deviceBrowser || 'Browser',
        ip_address: req.ip || '127.0.0.1',
        login_at: new Date().toISOString()
      };

      // Also ensure Firebase has active session record
      if (firebaseStore.isAvailable() && !fbSession) {
        firebaseStore.saveSession({
          id: session.id,
          user_id: session.user_id,
          user_name: session.name,
          user_email: session.email,
          token,
          device_os: session.device_os,
          device_browser: session.device_browser,
          device_type: 'desktop',
          screen_size: '1920x1080',
          ip_address: session.ip_address,
          is_active: 1,
          login_at: new Date().toISOString(),
          last_ping_at: new Date().toISOString()
        }).catch(() => {});
      }
    }

    if (!session) {
      return res.status(401).json({ error: 'SESSION_NOT_FOUND', message: 'Session does not exist' });
    }

    // Touch last_ping_at
    query.run('UPDATE sessions SET last_ping_at = CURRENT_TIMESTAMP WHERE id = ?', [session.id]).catch(() => {});

    req.user = {
      id: session.user_id,
      name: session.name,
      email: session.email,
      role: session.role
    };

    req.session = {
      id: session.id,
      token: session.token,
      deviceOs: session.device_os,
      deviceBrowser: session.device_browser,
      ipAddress: session.ip_address,
      loginAt: session.login_at
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'AUTH_ERROR', message: 'Server authentication failure' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Administrator privileges required' });
  }
  next();
}

module.exports = {
  authenticate,
  requireAdmin,
  JWT_SECRET,
  renderTerminationPage
};
