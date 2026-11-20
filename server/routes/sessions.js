const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');
const firebaseStore = require('../firebase');

/**
 * POST /api/sessions/ping
 * Heartbeat check for active session status, device synchronization & live admin broadcast delivery
 */
router.post('/ping', authenticate, async (req, res) => {
  try {
    const screenSize = req.headers['x-screen-size'] || req.body?.screenSize;

    if (screenSize && screenSize !== 'Unknown') {
      await query.run(
        `UPDATE sessions 
         SET last_ping_at = CURRENT_TIMESTAMP, screen_size = ? 
         WHERE id = ?`,
        [screenSize, req.session.id]
      ).catch(() => {});
    } else {
      await query.run(
        `UPDATE sessions 
         SET last_ping_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [req.session.id]
      ).catch(() => {});
    }

    // Retrieve active emergency broadcast if present (Feature 5)
    let activeBroadcast = null;
    if (firebaseStore.isAvailable()) {
      try {
        activeBroadcast = await firebaseStore.getBroadcast();
      } catch (e) {}
    }

    return res.json({
      ok: true,
      status: 'active',
      sessionId: req.session.id,
      activeBroadcast
    });
  } catch (error) {
    return res.status(500).json({ error: 'Ping update error' });
  }
});

module.exports = router;
