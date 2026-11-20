const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { authenticate, JWT_SECRET } = require('../middleware/auth');
const { parseDevice } = require('../middleware/device');
const firebaseStore = require('../firebase');

// Email regex validation
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/**
 * POST /api/auth/register
 * Student self-registration with valid Gmail / Email & Password
 */
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    if (!email || !EMAIL_REGEX.test(email.trim().toLowerCase())) {
      return res.status(400).json({ error: 'Please provide a valid, real email address (e.g. yourname@gmail.com)' });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();
    const cleanPassword = typeof password === 'string' ? password.trim() : '';

    if (!cleanPassword || cleanPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    // Check if email already registered (SQLite or Firebase)
    let existing = await query.get('SELECT id FROM users WHERE email = ?', [cleanEmail]).catch(() => null);
    if (!existing && firebaseStore.isAvailable()) {
      existing = await firebaseStore.getUser(cleanEmail);
    }
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
    }

    const passwordHash = await bcrypt.hash(cleanPassword, 10);
    const result = await query.run(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, name = excluded.name, role = excluded.role',
      [cleanName, cleanEmail, passwordHash, 'STUDENT']
    );

    const userId = result.lastID || Math.floor(Date.now() / 1000);

    // Sync to Firebase Cloud with password hash for serverless persistence
    if (firebaseStore.isAvailable()) {
      await firebaseStore.saveUser({
        id: userId,
        name: cleanName,
        email: cleanEmail,
        password_hash: passwordHash,
        role: 'STUDENT',
        createdAt: new Date().toISOString()
      }).catch(err => console.error('[Firebase] saveUser error:', err.message));
    }

    return res.status(201).json({
      message: 'Account created successfully! You can now log in.',
      userId
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Internal server error during registration' });
  }
});

/**
 * POST /api/auth/login
 * Authenticates user, captures device details, terminates existing sessions
 */
router.post('/login', parseDevice, async (req, res) => {
  try {
    const { email, password, screenSize } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = typeof password === 'string' ? password.trim() : '';

    let user = await query.get('SELECT * FROM users WHERE email = ?', [cleanEmail]).catch(() => null);

    // Retrieve cloud profile from Firebase
    let fbUser = null;
    if (firebaseStore.isAvailable()) {
      try {
        fbUser = await firebaseStore.getUser(cleanEmail);
      } catch (e) {}
    }

    // Auto-heal / restore user from Firebase if not in local SQLite container
    if (!user && fbUser) {
      user = {
        id: fbUser.id || Math.floor(Date.now() / 1000),
        name: fbUser.name,
        email: fbUser.email,
        password_hash: fbUser.password_hash || '',
        role: fbUser.role || 'STUDENT'
      };
      await query.run(
        'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, name = excluded.name, role = excluded.role',
        [user.name, user.email, user.password_hash, user.role]
      ).catch(() => {});
    }

    // If SQLite user exists but Firebase has updated hash, synchronize
    if (user && fbUser && fbUser.password_hash && fbUser.password_hash !== user.password_hash) {
      user.password_hash = fbUser.password_hash;
      await query.run('UPDATE users SET password_hash = ? WHERE email = ?', [fbUser.password_hash, cleanEmail]).catch(() => {});
    }

    // Auto-heal legacy accounts that were saved without password_hash in earlier revisions
    if (user && (!user.password_hash || user.password_hash === '')) {
      if (cleanPassword.length >= 6) {
        const newHash = await bcrypt.hash(cleanPassword, 10);
        user.password_hash = newHash;
        await query.run('UPDATE users SET password_hash = ? WHERE email = ?', [newHash, cleanEmail]).catch(() => {});
        if (firebaseStore.isAvailable()) {
          await firebaseStore.saveUser({ ...user, password_hash: newHash }).catch(() => {});
        }
      }
    }

    // Password verification with whitespace tolerance
    let passwordMatch = false;
    if (user && user.password_hash) {
      passwordMatch = await bcrypt.compare(cleanPassword, user.password_hash);
      if (!passwordMatch && cleanPassword !== password) {
        passwordMatch = await bcrypt.compare(password, user.password_hash);
      }
      if (!passwordMatch && fbUser && fbUser.password_hash && fbUser.password_hash !== user.password_hash) {
        passwordMatch = await bcrypt.compare(cleanPassword, fbUser.password_hash);
        if (passwordMatch) {
          user.password_hash = fbUser.password_hash;
          await query.run('UPDATE users SET password_hash = ? WHERE email = ?', [fbUser.password_hash, cleanEmail]).catch(() => {});
        }
      }
    }

    // Fallback: Check Administrator credentials configured in environment
    const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const adminPass = process.env.ADMIN_PASSWORD;
    if (!passwordMatch && adminEmail && cleanEmail === adminEmail && adminPass && (cleanPassword === adminPass || password === adminPass)) {
      passwordMatch = true;
      const adminHash = await bcrypt.hash(adminPass, 10);
      user = {
        id: 1,
        name: process.env.ADMIN_NAME || 'Exam Administrator',
        email: adminEmail,
        password_hash: adminHash,
        role: 'ADMIN'
      };
      await query.run(
        'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, role = excluded.role',
        [user.name, user.email, adminHash, 'ADMIN']
      ).catch(() => {});
    }

    if (!user || !passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // SINGLE ACTIVE SESSION ENFORCEMENT:
    // Invalidate all prior active sessions for this user
    await query.run(
      `UPDATE sessions 
       SET is_active = 0, terminated_reason = 'new_login_on_different_device' 
       WHERE user_id = ? AND is_active = 1`,
      [user.id]
    );

    // Device telemetry
    const device = req.clientDevice;
    const finalScreenSize = screenSize || device.screenSize || 'Unknown';

    // Generate token with unique nonce and complete identity payload
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        deviceOs: device.os,
        deviceBrowser: device.browser,
        nonce: crypto.randomBytes(16).toString('hex'),
        loginAt: Date.now()
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Save active session
    const sessionResult = await query.run(
      `INSERT OR REPLACE INTO sessions 
       (user_id, token, device_os, device_browser, device_type, screen_size, ip_address, user_agent, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        user.id,
        token,
        device.os,
        device.browser,
        device.deviceType,
        finalScreenSize,
        device.ip,
        device.userAgent
      ]
    );

    // Sync session to Firebase if configured
    firebaseStore.terminateOldSessions(user.id, token).catch(() => {});
    firebaseStore.saveSession({
      id: sessionResult.lastID,
      user_id: user.id,
      user_email: user.email,
      user_name: user.name,
      token,
      device_os: device.os,
      device_browser: device.browser,
      device_type: device.deviceType,
      screen_size: finalScreenSize,
      ip_address: device.ip,
      login_at: new Date().toISOString(),
      last_ping_at: new Date().toISOString(),
      is_active: 1
    }).catch(() => {});

    return res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      },
      session: {
        id: sessionResult.lastID,
        os: device.os,
        browser: device.browser,
        ip: device.ip,
        screenSize: finalScreenSize
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Server error during login' });
  }
});

/**
 * POST /api/auth/logout
 * Marks current session as terminated
 */
router.post('/logout', authenticate, async (req, res) => {
  try {
    await query.run(
      `UPDATE sessions SET is_active = 0, terminated_reason = 'user_logged_out' WHERE id = ?`,
      [req.session.id]
    );
    return res.json({ message: 'Successfully logged out' });
  } catch (error) {
    return res.status(500).json({ error: 'Error logging out' });
  }
});

/**
 * GET /api/auth/me
 * Returns current authenticated profile
 */
router.get('/me', authenticate, async (req, res) => {
  return res.json({
    user: req.user,
    session: req.session
  });
});

module.exports = router;
