const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { query } = require('../db');

// Secure secret from environment, or generate dynamic secret per server process
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

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
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'No authorization token provided' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'INVALID_TOKEN', message: 'Session token expired or invalid' });
    }

    // Verify session in database and ensure SINGLE ACTIVE SESSION
    let session = await query.get(
      `SELECT s.*, u.name, u.email, u.role 
       FROM sessions s 
       JOIN users u ON u.id = s.user_id 
       WHERE s.token = ?`,
      [token]
    );

    // Serverless Cold-Start Session Recovery for Vercel:
    if (!session && decoded && decoded.userId) {
      await query.run(
        `INSERT OR IGNORE INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)`,
        [decoded.userId, decoded.name || 'Candidate', decoded.email, 'SECURE_HASH', decoded.role || 'STUDENT']
      ).catch(() => {});

      await query.run(
        `INSERT OR REPLACE INTO sessions 
         (user_id, token, device_os, device_browser, device_type, screen_size, ip_address, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [decoded.userId, token, decoded.deviceOs || 'Client Device', decoded.deviceBrowser || 'Browser', 'desktop', '1920x1080', req.ip || '127.0.0.1']
      ).catch(() => {});

      session = {
        id: decoded.sessionId || 1,
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
    }

    if (!session) {
      return res.status(401).json({ error: 'SESSION_NOT_FOUND', message: 'Session does not exist' });
    }

    if (session.is_active !== 1) {
      return res.status(401).json({
        error: 'SESSION_TERMINATED',
        reason: session.terminated_reason || 'Logged in from another device',
        message: 'This session has been terminated because your account was accessed from another device.'
      });
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
  JWT_SECRET
};
