const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { parseCbtHtml } = require('../utils/htmlParser');

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
 * Dashboard KPI numbers
 */
router.get('/stats', async (req, res) => {
  try {
    const studentsCount = await query.get("SELECT COUNT(*) AS count FROM users WHERE role = 'STUDENT'");
    const testsCount = await query.get('SELECT COUNT(*) AS count FROM tests');
    const submissionsCount = await query.get('SELECT COUNT(*) AS count FROM submissions');
    const activeSessionsCount = await query.get(
      `SELECT COUNT(*) AS count FROM sessions 
       WHERE is_active = 1 
         AND (strftime('%s', 'now') - strftime('%s', last_ping_at)) < 120`
    );

    return res.json({
      totalStudents: studentsCount?.count || 0,
      totalTests: testsCount?.count || 0,
      totalSubmissions: submissionsCount?.count || 0,
      liveActiveSessions: activeSessionsCount?.count || 0
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
    await query.run(
      `UPDATE sessions 
       SET is_active = 0, terminated_reason = 'terminated_by_admin' 
       WHERE id = ?`,
      [sessionId]
    );
    return res.json({ message: 'Session forcefully terminated' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to terminate session' });
  }
});

/**
 * POST /api/admin/upload
 * Admin uploads CBT HTML files (Gemini-generated, minor, major, or mock papers)
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
    const hideResults = req.body.hideResultsStudent === '0' || req.body.hideResultsStudent === false ? 0 : 1;

    // Generate unique test code
    let testCode = req.body.testCode?.trim();
    if (!testCode) {
      testCode = 'CBT_' + Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    const result = await query.run(
      `INSERT INTO tests 
       (test_code, title, description, file_name, duration_minutes, total_questions, subjects, hide_results_student)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        testCode,
        title,
        req.body.description?.trim() || 'Uploaded CBT Paper',
        req.file.filename,
        durationMinutes,
        parsed.totalQuestions,
        JSON.stringify(parsed.subjects),
        hideResults
      ]
    );

    return res.status(201).json({
      message: 'Test uploaded and published successfully!',
      test: {
        id: result.lastID,
        testCode,
        title,
        durationMinutes,
        totalQuestions: parsed.totalQuestions,
        subjects: parsed.subjects,
        hideResultsStudent: hideResults === 1
      }
    });
  } catch (error) {
    console.error('Upload test error:', error);
    return res.status(500).json({ error: 'Failed to upload and parse test file' });
  }
});

/**
 * GET /api/admin/tests
 * List all uploaded tests with attempt statistics
 */
router.get('/tests', async (req, res) => {
  try {
    const tests = await query.all(
      `SELECT t.*, COUNT(s.id) AS total_attempts, AVG(s.total_score) AS avg_score
       FROM tests t
       LEFT JOIN submissions s ON s.test_id = t.id
       GROUP BY t.id
       ORDER BY t.id DESC`
    );

    const formatted = tests.map(t => {
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
 * Toggle test settings (e.g. results visibility or active state)
 */
router.patch('/tests/:id', async (req, res) => {
  try {
    const testId = req.params.id;
    const { hideResultsStudent, isActive, title, durationMinutes } = req.body;

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

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(testId);
    await query.run(`UPDATE tests SET ${updates.join(', ')} WHERE id = ?`, params);

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

    // Try deleting file if exists
    try {
      const filePath = path.join(uploadDir, test.file_name);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (e) {}

    await query.run('DELETE FROM submissions WHERE test_id = ?', [testId]);
    await query.run('DELETE FROM tests WHERE id = ?', [testId]);

    return res.json({ message: 'Test and associated submissions deleted successfully' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete test' });
  }
});

/**
 * GET /api/admin/results
 * View all candidate exam results and submissions with device info
 */
router.get('/results', async (req, res) => {
  try {
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
 * View single submission breakdown with responses
 */
router.get('/results/:submissionId', async (req, res) => {
  try {
    const subId = req.params.submissionId;
    const sub = await query.get(
      `SELECT s.*, u.name AS student_name, u.email AS student_email,
              t.title AS test_title, t.test_code, t.subjects
       FROM submissions s
       JOIN users u ON u.id = s.user_id
       JOIN tests t ON t.id = s.test_id
       WHERE s.id = ?`,
      [subId]
    );

    if (!sub) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    let answers = {};
    let device = {};
    try {
      answers = JSON.parse(sub.answers_json || '{}');
      device = JSON.parse(sub.device_info || '{}');
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
        answers
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to retrieve submission details' });
  }
});

/**
 * GET /api/admin/export/csv
 * Export results to CSV
 */
router.get('/export/csv', async (req, res) => {
  try {
    const results = await query.all(
      `SELECT s.id, u.name AS student_name, u.email AS student_email,
              t.title AS test_title, s.total_score, s.max_marks,
              s.correct_count, s.incorrect_count, s.unattempted_count,
              s.accuracy_percent, s.time_taken_sec, s.device_info, s.submitted_at
       FROM submissions s
       JOIN users u ON u.id = s.user_id
       JOIN tests t ON t.id = s.test_id
       ORDER BY s.submitted_at DESC`
    );

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
