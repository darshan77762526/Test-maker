const jwt = require('jsonwebtoken');
const { query } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'cbt_portal_super_secret_jwt_key_2026_x99a!';

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
    const session = await query.get(
      `SELECT s.*, u.name, u.email, u.role 
       FROM sessions s 
       JOIN users u ON u.id = s.user_id 
       WHERE s.token = ?`,
      [token]
    );

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
