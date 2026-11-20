const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { parseCbtHtml } = require('../utils/htmlParser');
const firebaseStore = require('../firebase');

// Apply admin guard across all admin endpoints
router.use(authenticate, requireAdmin);

// Multer storage configuration
const uploadDir = process.env.UPLOAD_DIR || (process.env.VERCEL ? '/tmp/uploads' : path.join(__dirname, '..', 'uploads'));
if (!fs.existsSync(uploadDir)) {
  try { fs.mkdirSync(uploadDir, { recursive: true }); } catch (e) {}
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, `${uniqueSuffix}_${cleanName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max file size
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.html') || file.mimetype === 'text/html') {
      cb(null, true);
    } else {
      cb(new Error('Only .html CBT exam files are allowed!'), false);
    }
  }
});

/**
 * GET /api/admin/stats
 * Dashboard KPI numbers synced with Firebase Cloud
 */
router.get('/stats', async (req, res) => {
  try {
    let totalStudents = 0;
    let totalTests = 0;
    let totalSubmissions = 0;
    let liveActiveSessions = 0;

    // Check SQLite
    try {
      const studentsCount = await query.get("SELECT COUNT(*) AS count FROM users WHERE role = 'STUDENT'");
      const testsCount = await query.get('SELECT COUNT(*) AS count FROM tests WHERE is_active = 1');
      const submissionsCount = await query.get('SELECT COUNT(*) AS count FROM submissions');
      const activeSessionsCount = await query.get(
        `SELECT COUNT(*) AS count FROM sessions 
         WHERE is_active = 1 
           AND (strftime('%s', 'now') - strftime('%s', last_ping_at)) < 120`
      );

      totalStudents = studentsCount?.count || 0;
      totalTests = testsCount?.count || 0;
      totalSubmissions = submissionsCount?.count || 0;
      liveActiveSessions = activeSessionsCount?.count || 0;
    } catch (e) {}

    // Fallback/enrich from Firebase RTDB if SQLite had cold start
    if (firebaseStore.isAvailable()) {
      try {
        if (totalTests === 0) {
          const fbTests = await firebaseStore.getTests();
          if (fbTests) totalTests = fbTests.filter(t => t.is_active !== 0).length;
        }
        if (totalSubmissions === 0) {
          const fbSubs = await firebaseStore.getSubmissions();
          if (fbSubs) totalSubmissions = fbSubs.length;
        }
        if (totalStudents === 0) {
          const fbUsersCount = await firebaseStore.getUsersCount();
          if (fbUsersCount > 0) totalStudents = fbUsersCount;
        }
        const fbSessions = await firebaseStore.getSessions();
        if (fbSessions && fbSessions.length > 0) {
          const now = Date.now();
          liveActiveSessions = fbSessions.filter(s => {
            if (s.is_active !== 1) return false;
            const lastPing = new Date(s.last_ping_at || s.login_at || 0).getTime();
            return (now - lastPing) < 180000;
          }).length;
        }
      } catch (fbErr) {
        console.error('Firebase stats sync error:', fbErr.message);
      }
    }

    return res.json({
      totalStudents,
      totalTests,
      totalSubmissions,
      liveActiveSessions
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    return res.status(500).json({ error: 'Failed to fetch dashboard metrics' });
  }
});

/**
 * GET /api/admin/sessions
 * Real-time active devices & candidate session monitor
 */
router.get('/sessions', async (req, res) => {
  try {
    if (firebaseStore.isAvailable()) {
      const fbSessions = await firebaseStore.getSessions();
      if (fbSessions && fbSessions.length > 0) {
        return res.json({
          sessions: fbSessions.map(s => ({
            id: s.id,
            userId: s.user_id,
            studentName: s.user_name || 'Candidate',
            studentEmail: s.user_email || 'candidate@gmail.com',
            deviceOs: s.device_os || 'Unknown',
            deviceBrowser: s.device_browser || 'Unknown',
            deviceType: s.device_type || 'desktop',
            screenSize: s.screen_size || '1920x1080',
            ipAddress: s.ip_address || '127.0.0.1',
            loginAt: s.login_at,
            lastPingAt: s.last_ping_at,
            isActive: s.is_active === 1,
            terminatedReason: s.terminated_reason,
            liveStatus: s.is_active === 1 ? 'Active' : 'Terminated',
            secSincePing: Math.round((Date.now() - new Date(s.last_ping_at || s.login_at || 0).getTime()) / 1000)
          }))
        });
      }
    }

    const sessions = await query.all(
      `SELECT s.id, s.user_id, s.device_os, s.device_browser, s.device_type, 
              s.screen_size, s.ip_address, s.user_agent, s.login_at, s.last_ping_at, 
              s.is_active, s.terminated_reason,
              u.name AS student_name, u.email AS student_email,
              (strftime('%s', 'now') - strftime('%s', s.last_ping_at)) AS sec_since_ping
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       ORDER BY s.is_active DESC, s.last_ping_at DESC
       LIMIT 100`
    );

    const formatted = sessions.map(s => {
      let liveStatus = 'Offline';
      if (s.is_active === 1) {
        if (s.sec_since_ping < 45) {
          liveStatus = 'Active';
        } else if (s.sec_since_ping < 180) {
          liveStatus = 'Idle';
        } else {
          liveStatus = 'Unresponsive';
        }
      } else {
        liveStatus = 'Terminated';
      }

      return {
        id: s.id,
        userId: s.user_id,
        studentName: s.student_name,
        studentEmail: s.student_email,
        deviceOs: s.device_os,
        deviceBrowser: s.device_browser,
        deviceType: s.device_type,
        screenSize: s.screen_size,
        ipAddress: s.ip_address,
        loginAt: s.login_at,
        lastPingAt: s.last_ping_at,
        isActive: s.is_active === 1,
        terminatedReason: s.terminated_reason,
        liveStatus,
        secSincePing: s.sec_since_ping
      };
    });

    return res.json({ sessions: formatted });
  } catch (error) {
    console.error('Fetch sessions error:', error);
    return res.status(500).json({ error: 'Failed to retrieve active sessions' });
  }
});

/**
 * POST /api/admin/sessions/:id/terminate
 * Forcefully kick a device session
 */
router.post('/sessions/:id/terminate', async (req, res) => {
  try {
    const sessionId = req.params.id;
    const session = await query.get('SELECT token FROM sessions WHERE id = ?', [sessionId]).catch(() => null);

    await query.run(
      `UPDATE sessions 
       SET is_active = 0, terminated_reason = 'terminated_by_admin' 
       WHERE id = ?`,
      [sessionId]
    );

    if (firebaseStore.isAvailable()) {
      await firebaseStore.terminateSession(sessionId, session ? session.token : null);
    }

    return res.json({ message: 'Session forcefully terminated' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to terminate session' });
  }
});

/**
 * POST /api/admin/upload
 * Admin uploads CBT HTML files with optional Window Scheduling (Feature 3)
 */
router.post('/upload', upload.single('testFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please choose an HTML test file to upload.' });
    }

    const filePath = req.file.path;
    const fileContent = fs.readFileSync(filePath, 'utf8');

    // Parse the CBT HTML
    const parsed = parseCbtHtml(fileContent, req.file.originalname);

    const title = req.body.title?.trim() || parsed.title;
    const durationMinutes = parseInt(req.body.durationMinutes, 10) || parsed.durationMinutes;
    const hideResults = req.body.hideResultsStudent === '1' || req.body.hideResultsStudent === true ? 1 : 0;

    function normalizeWindowDate(val) {
      if (!val) return null;
      val = String(val).trim();
      if (!val) return null;
      if (val.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(val)) return val;
      const istDate = new Date(val.replace(' ', 'T') + '+05:30');
      if (!isNaN(istDate.getTime())) return istDate.toISOString();
      const d = new Date(val);
      return !isNaN(d.getTime()) ? d.toISOString() : val;
    }

    const windowStart = normalizeWindowDate(req.body.windowStart);
    const windowEnd = normalizeWindowDate(req.body.windowEnd);

    // Generate unique test code
    let testCode = req.body.testCode?.trim();
    if (!testCode) {
      testCode = 'CBT_' + Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    const result = await query.run(
      `INSERT INTO tests 
       (test_code, title, description, file_name, duration_minutes, total_questions, subjects, hide_results_student, window_start, window_end)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        testCode,
        title,
        req.body.description?.trim() || 'Uploaded CBT Paper',
        req.file.filename,
        durationMinutes,
        parsed.totalQuestions,
        JSON.stringify(parsed.subjects),
        hideResults,
        windowStart,
        windowEnd
      ]
    );

    const testId = result.lastID;

    // Persist test metadata AND full HTML content to Firebase Realtime Database
    if (firebaseStore.isAvailable()) {
      try {
        await firebaseStore.saveTest({
          id: testId,
          test_code: testCode,
          title,
          description: req.body.description?.trim() || 'Uploaded CBT Paper',
          file_name: req.file.filename,
          duration_minutes: durationMinutes,
          total_questions: parsed.totalQuestions,
          subjects: parsed.subjects,
          hide_results_student: hideResults,
          window_start: windowStart,
          window_end: windowEnd,
          is_active: 1,
          created_at: new Date().toISOString(),
          html_content: fileContent
        });
        console.log(`[Firebase] Successfully backed up test ${testCode} with Window Schedule to Cloud RTDB`);
      } catch (fbErr) {
        console.error('[Firebase] Failed to backup test to cloud:', fbErr.message);
      }
    }

    return res.status(201).json({
      message: 'Test uploaded and published successfully!',
      test: {
        id: testId,
        testCode,
        title,
        durationMinutes,
        totalQuestions: parsed.totalQuestions,
        subjects: parsed.subjects,
        hideResultsStudent: hideResults === 1,
        windowStart,
        windowEnd
      }
    });
  } catch (error) {
    console.error('Upload test error:', error);
    return res.status(500).json({ error: 'Failed to upload and parse test file' });
  }
});

/**
 * GET /api/admin/tests
 * List all uploaded tests with attempt statistics, merged across SQLite & Firebase
 */
router.get('/tests', async (req, res) => {
  try {
    let localTests = [];
    try {
      localTests = await query.all(
        `SELECT t.*, COUNT(s.id) AS total_attempts, AVG(s.total_score) AS avg_score
         FROM tests t
         LEFT JOIN submissions s ON s.test_id = t.id
         GROUP BY t.id
         ORDER BY t.id DESC`
      );
    } catch (e) {}

    // Synchronize tests from Firebase if SQLite was fresh/cold
    if (firebaseStore.isAvailable()) {
      try {
        const fbTests = await firebaseStore.getTests();
        if (fbTests && fbTests.length > 0) {
          for (const fbt of fbTests) {
            const exists = localTests.find(lt => String(lt.id) === String(fbt.id) || lt.test_code === fbt.test_code);
            if (!exists && fbt.is_active !== 0) {
              const fName = fbt.file_name || `test_${fbt.id}.html`;
              const fPath = path.join(uploadDir, fName);
              if (!fs.existsSync(fPath) && fbt.html_content) {
                try { fs.writeFileSync(fPath, fbt.html_content, 'utf8'); } catch (e) {}
              }

              await query.run(
                `INSERT OR REPLACE INTO tests 
                 (id, test_code, title, description, file_name, duration_minutes, total_questions, subjects, hide_results_student, window_start, window_end, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                [
                  fbt.id,
                  fbt.test_code,
                  fbt.title,
                  fbt.description || '',
                  fName,
                  fbt.duration_minutes || 180,
                  fbt.total_questions || 75,
                  typeof fbt.subjects === 'string' ? fbt.subjects : JSON.stringify(fbt.subjects || []),
                  fbt.hide_results_student ? 1 : 0,
                  fbt.window_start || null,
                  fbt.window_end || null
                ]
              ).catch(() => {});

              localTests.push({
                id: fbt.id,
                test_code: fbt.test_code,
                title: fbt.title,
                description: fbt.description,
                duration_minutes: fbt.duration_minutes || 180,
                total_questions: fbt.total_questions || 75,
                subjects: fbt.subjects,
                hide_results_student: fbt.hide_results_student ? 1 : 0,
                window_start: fbt.window_start || null,
                window_end: fbt.window_end || null,
                is_active: 1,
                total_attempts: 0,
                avg_score: 0,
                created_at: fbt.created_at || new Date().toISOString()
              });
            }
          }
        }
      } catch (fbErr) {
        console.error('Error synchronizing tests from Firebase:', fbErr.message);
      }
    }

    const formatted = localTests.map(t => {
      let subjects = [];
      try {
        subjects = typeof t.subjects === 'string' ? JSON.parse(t.subjects) : t.subjects;
      } catch (e) {
        subjects = [t.subjects];
      }

      return {
        id: t.id,
        testCode: t.test_code,
        title: t.title,
        description: t.description,
        durationMinutes: t.duration_minutes,
        totalQuestions: t.total_questions,
        subjects,
        hideResultsStudent: t.hide_results_student === 1,
        windowStart: t.window_start || null,
        windowEnd: t.window_end || null,
        isActive: t.is_active === 1,
        totalAttempts: t.total_attempts || 0,
        avgScore: t.avg_score ? parseFloat(t.avg_score).toFixed(1) : 0,
        createdAt: t.created_at
      };
    });

    return res.json({ tests: formatted });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch test catalog' });
  }
});

/**
 * PATCH /api/admin/tests/:id
 * Toggle test settings (window scheduling, active state, title, duration)
 */
router.patch('/tests/:id', async (req, res) => {
  try {
    const testId = req.params.id;
    const { hideResultsStudent, isActive, title, durationMinutes, windowStart, windowEnd } = req.body;

    const updates = [];
    const params = [];

    if (hideResultsStudent !== undefined) {
      updates.push('hide_results_student = ?');
      params.push(hideResultsStudent ? 1 : 0);
    }
    if (isActive !== undefined) {
      updates.push('is_active = ?');
      params.push(isActive ? 1 : 0);
    }
    if (title) {
      updates.push('title = ?');
      params.push(title.trim());
    }
    if (durationMinutes) {
      updates.push('duration_minutes = ?');
      params.push(parseInt(durationMinutes, 10));
    }
    function normalizeWindowDate(val) {
      if (!val) return null;
      val = String(val).trim();
      if (!val) return null;
      if (val.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(val)) return val;
      const istDate = new Date(val.replace(' ', 'T') + '+05:30');
      if (!isNaN(istDate.getTime())) return istDate.toISOString();
      const d = new Date(val);
      return !isNaN(d.getTime()) ? d.toISOString() : val;
    }

    if (windowStart !== undefined) {
      const normStart = normalizeWindowDate(windowStart);
      updates.push('window_start = ?');
      params.push(normStart);
    }
    if (windowEnd !== undefined) {
      const normEnd = normalizeWindowDate(windowEnd);
      updates.push('window_end = ?');
      params.push(normEnd);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(testId);
    await query.run(`UPDATE tests SET ${updates.join(', ')} WHERE id = ?`, params);

    if (firebaseStore.isAvailable()) {
      try {
        const rtdb = firebaseStore.getDb();
        if (rtdb) {
          const fbUpdate = {};
          if (hideResultsStudent !== undefined) fbUpdate['hide_results_student'] = hideResultsStudent ? 1 : 0;
          if (isActive !== undefined) fbUpdate['is_active'] = isActive ? 1 : 0;
          if (title) fbUpdate['title'] = title.trim();
          if (durationMinutes) fbUpdate['duration_minutes'] = parseInt(durationMinutes, 10);
          if (windowStart !== undefined) fbUpdate['window_start'] = normalizeWindowDate(windowStart);
          if (windowEnd !== undefined) fbUpdate['window_end'] = normalizeWindowDate(windowEnd);
          await rtdb.ref(`cbt/tests/${testId}`).update(fbUpdate);
        }
      } catch (e) {}
    }

    return res.json({ message: 'Test updated successfully' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update test' });
  }
});

/**
 * DELETE /api/admin/tests/:id
 * Delete test and remove file
 */
router.delete('/tests/:id', async (req, res) => {
  try {
    const testId = req.params.id;
    const test = await query.get('SELECT * FROM tests WHERE id = ?', [testId]);

    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }

    try {
      const filePath = path.join(uploadDir, test.file_name);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (e) {}

    await query.run('DELETE FROM submissions WHERE test_id = ?', [testId]);
    await query.run('DELETE FROM tests WHERE id = ?', [testId]);

    if (test.test_code) {
      await query.run('INSERT OR IGNORE INTO deleted_tests (test_code) VALUES (?)', [test.test_code]).catch(() => {});
      firebaseStore.deleteTest(testId, test.test_code).catch(() => {});
    }

    return res.json({ message: 'Test and associated submissions deleted successfully' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete test' });
  }
});

/**
 * GET /api/admin/results
 * View all candidate exam results and submissions with device info
 * Serves as the master Admin Leaderboard
 */
router.get('/results', async (req, res) => {
  try {
    if (firebaseStore.isAvailable()) {
      const fbSubs = await firebaseStore.getSubmissions();
      if (fbSubs && fbSubs.length > 0) {
        return res.json({
          results: fbSubs.map(s => {
            let device = {};
            try { device = JSON.parse(s.device_info || '{}'); } catch(e) {}
            return {
              id: s.id,
              studentName: s.user_name || 'Candidate',
              studentEmail: s.user_email || 'candidate@gmail.com',
              testTitle: s.test_title || 'CBT Paper',
              testCode: s.test_code || 'CBT',
              totalScore: s.total_score,
              maxMarks: s.max_marks || 300,
              correct: s.correct_count || 0,
              incorrect: s.incorrect_count || 0,
              unattempted: s.unattempted_count || 0,
              accuracy: s.accuracy_percent || 0,
              timeTakenSec: s.time_taken_sec || 0,
              submittedAt: s.submitted_at,
              deviceOs: device.os || 'Unknown',
              deviceBrowser: device.browser || 'Unknown',
              deviceIp: device.ip || 'Unknown'
            };
          })
        });
      }
    }

    const testFilter = req.query.testId ? 'WHERE s.test_id = ' + parseInt(req.query.testId, 10) : '';

    const results = await query.all(
      `SELECT s.id, s.total_score, s.max_marks, s.correct_count, s.incorrect_count,
              s.unattempted_count, s.accuracy_percent, s.time_taken_sec, s.device_info,
              s.submitted_at,
              u.name AS student_name, u.email AS student_email,
              t.title AS test_title, t.test_code
       FROM submissions s
       JOIN users u ON u.id = s.user_id
       JOIN tests t ON t.id = s.test_id
       ${testFilter}
       ORDER BY s.submitted_at DESC`
    );

    const formatted = results.map(r => {
      let device = {};
      try {
        device = JSON.parse(r.device_info || '{}');
      } catch (e) {}

      return {
        id: r.id,
        studentName: r.student_name,
        studentEmail: r.student_email,
        testTitle: r.test_title,
        testCode: r.test_code,
        totalScore: r.total_score,
        maxMarks: r.max_marks,
        correct: r.correct_count,
        incorrect: r.incorrect_count,
        unattempted: r.unattempted_count,
        accuracy: r.accuracy_percent,
        timeTakenSec: r.time_taken_sec,
        submittedAt: r.submitted_at,
        deviceOs: device.os || 'Unknown',
        deviceBrowser: device.browser || 'Unknown',
        deviceIp: device.ip || 'Unknown'
      };
    });

    return res.json({ results: formatted });
  } catch (error) {
    console.error('Fetch results error:', error);
    return res.status(500).json({ error: 'Failed to retrieve test submissions' });
  }
});

/**
 * GET /api/admin/results/:submissionId
 * View single submission breakdown with responses AND Proctoring Photos (Feature 2)
 */
router.get('/results/:submissionId', async (req, res) => {
  try {
    const subId = req.params.submissionId;
    let sub = null;
    
    try {
      sub = await query.get(
        `SELECT s.*, u.name AS student_name, u.email AS student_email,
                t.title AS test_title, t.test_code, t.subjects
         FROM submissions s
         JOIN users u ON u.id = s.user_id
         JOIN tests t ON t.id = s.test_id
         WHERE s.id = ?`,
        [subId]
      );
    } catch (e) {}

    // Fallback to Firebase Realtime Database
    if (!sub && firebaseStore.isAvailable()) {
      const fbSub = await firebaseStore.getSubmission(subId);
      if (fbSub) {
        let answers = {};
        let device = {};
        let proctoringPhotos = [];
        try {
          answers = typeof fbSub.answers_json === 'string' ? JSON.parse(fbSub.answers_json) : (fbSub.answers_json || {});
          device = typeof fbSub.device_info === 'string' ? JSON.parse(fbSub.device_info) : (fbSub.device_info || {});
          proctoringPhotos = typeof fbSub.proctoring_photos === 'string' ? JSON.parse(fbSub.proctoring_photos) : (fbSub.proctoring_photos || []);
        } catch (e) {}

        return res.json({
          submission: {
            id: fbSub.id,
            studentName: fbSub.user_name || 'Candidate',
            studentEmail: fbSub.user_email || 'candidate@gmail.com',
            testTitle: fbSub.test_title || 'CBT Paper',
            testCode: fbSub.test_code || 'CBT',
            totalScore: fbSub.total_score,
            maxMarks: fbSub.max_marks || 300,
            correct: fbSub.correct_count || 0,
            incorrect: fbSub.incorrect_count || 0,
            unattempted: fbSub.unattempted_count || 0,
            accuracy: fbSub.accuracy_percent || 0,
            timeTakenSec: fbSub.time_taken_sec || 0,
            submittedAt: fbSub.submitted_at,
            device,
            answers,
            proctoringPhotos
          }
        });
      }
    }

    if (!sub) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    let answers = {};
    let device = {};
    let proctoringPhotos = [];
    try {
      answers = JSON.parse(sub.answers_json || '{}');
      device = JSON.parse(sub.device_info || '{}');
      proctoringPhotos = sub.proctoring_photos ? (typeof sub.proctoring_photos === 'string' ? JSON.parse(sub.proctoring_photos) : sub.proctoring_photos) : [];
    } catch (e) {}

    return res.json({
      submission: {
        id: sub.id,
        studentName: sub.student_name,
        studentEmail: sub.student_email,
        testTitle: sub.test_title,
        testCode: sub.test_code,
        totalScore: sub.total_score,
        maxMarks: sub.max_marks,
        correct: sub.correct_count,
        incorrect: sub.incorrect_count,
        unattempted: sub.unattempted_count,
        accuracy: sub.accuracy_percent,
        timeTakenSec: sub.time_taken_sec,
        submittedAt: sub.submitted_at,
        device,
        answers,
        proctoringPhotos
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to retrieve submission details' });
  }
});

/**
 * Emergency Broadcast APIs (Feature 5)
 */
router.post('/broadcast', async (req, res) => {
  try {
    const { message, level = 'urgent' } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Broadcast message cannot be empty' });
    }
    if (firebaseStore.isAvailable()) {
      await firebaseStore.setBroadcast({ message: message.trim(), level });
    }
    return res.json({ message: 'Live announcement dispatched to all candidate exam screens' });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to dispatch broadcast' });
  }
});

router.delete('/broadcast', async (req, res) => {
  try {
    if (firebaseStore.isAvailable()) {
      await firebaseStore.clearBroadcast();
    }
    return res.json({ message: 'Active broadcast cleared' });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to clear broadcast' });
  }
});

router.get('/broadcast', async (req, res) => {
  try {
    let broadcast = null;
    if (firebaseStore.isAvailable()) {
      broadcast = await firebaseStore.getBroadcast();
    }
    return res.json({ broadcast });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to retrieve broadcast' });
  }
});

/**
 * GET /api/admin/export/csv
 * Export results to CSV
 */
router.get('/export/csv', async (req, res) => {
  try {
    let results = [];
    if (firebaseStore.isAvailable()) {
      const fbSubs = await firebaseStore.getSubmissions();
      if (fbSubs && fbSubs.length > 0) {
        results = fbSubs.map(s => {
          let dev = {};
          try { dev = JSON.parse(s.device_info || '{}'); } catch(e) {}
          return {
            id: s.id,
            student_name: s.user_name || 'Candidate',
            student_email: s.user_email || 'candidate@gmail.com',
            test_title: s.test_title || 'CBT Paper',
            total_score: s.total_score,
            max_marks: s.max_marks || 300,
            correct_count: s.correct_count,
            incorrect_count: s.incorrect_count,
            unattempted_count: s.unattempted_count,
            accuracy_percent: s.accuracy_percent,
            time_taken_sec: s.time_taken_sec,
            device_info: s.device_info,
            submitted_at: s.submitted_at
          };
        });
      }
    }

    if (results.length === 0) {
      results = await query.all(
        `SELECT s.id, u.name AS student_name, u.email AS student_email,
                t.title AS test_title, s.total_score, s.max_marks,
                s.correct_count, s.incorrect_count, s.unattempted_count,
                s.accuracy_percent, s.time_taken_sec, s.device_info, s.submitted_at
         FROM submissions s
         JOIN users u ON u.id = s.user_id
         JOIN tests t ON t.id = s.test_id
         ORDER BY s.submitted_at DESC`
      );
    }

    let csv = 'ID,Student Name,Email,Test,Score,Max Marks,Correct,Incorrect,Unattempted,Accuracy %,Time (sec),Device OS,Browser,IP,Submitted At\n';

    results.forEach(r => {
      let dev = {};
      try { dev = JSON.parse(r.device_info || '{}'); } catch (e) {}
      const escape = (str) => `"${String(str || '').replace(/"/g, '""')}"`;

      csv += [
        r.id,
        escape(r.student_name),
        escape(r.student_email),
        escape(r.test_title),
        r.total_score,
        r.max_marks,
        r.correct_count,
        r.incorrect_count,
        r.unattempted_count,
        r.accuracy_percent,
        r.time_taken_sec,
        escape(dev.os || 'Unknown'),
        escape(dev.browser || 'Unknown'),
        escape(dev.ip || 'Unknown'),
        escape(r.submitted_at)
      ].join(',') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="CBT_Exam_Results.csv"');
    return res.send(csv);
  } catch (error) {
    return res.status(500).send('Error generating CSV export');
  }
});

module.exports = router;
