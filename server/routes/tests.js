const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');
const { createBridgeScript } = require('../utils/testBridge');
const firebaseStore = require('../firebase');

const uploadDir = process.env.UPLOAD_DIR || (process.env.VERCEL ? '/tmp/uploads' : path.join(__dirname, '..', 'uploads'));
if (!fs.existsSync(uploadDir)) {
  try { fs.mkdirSync(uploadDir, { recursive: true }); } catch (e) {}
}

function renderWindowNotice(status, title, targetDate) {
  const isUpcoming = status === 'UPCOMING';
  const heading = isUpcoming ? 'Examination Window Not Open Yet' : 'Examination Window Has Closed';
  const badge = isUpcoming ? 'UPCOMING EXAM' : 'WINDOW EXPIRED';
  const message = isUpcoming 
    ? `This examination is scheduled to unlock on <strong>${new Date(targetDate).toLocaleString()}</strong>. Candidate entry is strictly restricted prior to the scheduled window.`
    : `The examination window for this paper concluded on <strong>${new Date(targetDate).toLocaleString()}</strong>. Late submissions or re-entries are locked as per examination regulations.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${heading} — National Testing Platform</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      background: radial-gradient(ellipse at center, #1e293b 0%, #0f172a 100%);
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      max-width: 520px;
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
      background: ${isUpcoming ? '#0284c7' : '#ef4444'};
      color: #ffffff;
      font-weight: 800;
      font-size: 11px;
      letter-spacing: 0.1em;
      border-radius: 9999px;
      margin-bottom: 20px;
    }
    h1 { font-size: 20px; font-weight: 800; margin-bottom: 12px; color: #ffffff; }
    h2 { font-size: 15px; font-weight: 600; color: #38bdf8; margin-bottom: 16px; }
    p { font-size: 13px; color: #94a3b8; line-height: 1.6; margin-bottom: 28px; }
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
    <div class="badge">${badge}</div>
    <h1>${heading}</h1>
    <h2>${title}</h2>
    <p>${message}</p>
    <a href="/#/student" class="btn">Return to Candidate Dashboard</a>
  </div>
</body>
</html>`;
}

/**
 * GET /api/tests/broadcast
 * Public / authenticated broadcast feed for candidate dashboard
 */
router.get('/broadcast', async (req, res) => {
  let broadcast = null;
  if (firebaseStore.isAvailable()) {
    try {
      broadcast = await firebaseStore.getBroadcast();
    } catch (e) {}
  }
  return res.json({ broadcast });
});

/**
 * GET /api/tests
 * Returns available tests for students with attempt status & Window Scheduling (Feature 3)
 */
router.get('/', authenticate, async (req, res) => {
  try {
    let tests = [];
    try {
      tests = await query.all(
        `SELECT t.id, t.test_code, t.title, t.description, t.duration_minutes, 
                t.total_questions, t.subjects, t.hide_results_student, t.window_start, t.window_end, t.created_at,
                s.id AS submission_id, s.total_score, s.submitted_at
         FROM tests t
         LEFT JOIN submissions s ON s.test_id = t.id AND s.user_id = ?
         WHERE t.is_active = 1
         ORDER BY t.id DESC`,
        [req.user.id]
      );
    } catch (e) {}

    // Cloud recovery from Firebase
    if (firebaseStore.isAvailable()) {
      try {
        const fbTests = await firebaseStore.getTests();
        const fbUserSubs = await firebaseStore.getStudentSubmissions(req.user.id);

        if (fbTests && fbTests.length > 0) {
          for (const fbt of fbTests) {
            if (fbt.is_active === 0) continue;
            let existing = tests.find(t => String(t.id) === String(fbt.id) || t.test_code === fbt.test_code);
            const userSub = fbUserSubs.find(s => String(s.test_id) === String(fbt.id));

            if (!existing) {
              const newTestObj = {
                id: fbt.id,
                test_code: fbt.test_code,
                title: fbt.title,
                description: fbt.description || '',
                duration_minutes: fbt.duration_minutes || 180,
                total_questions: fbt.total_questions || 75,
                subjects: fbt.subjects,
                hide_results_student: fbt.hide_results_student ? 1 : 0,
                window_start: fbt.window_start || null,
                window_end: fbt.window_end || null,
                created_at: fbt.created_at || new Date().toISOString(),
                submission_id: userSub ? userSub.id : null,
                total_score: userSub ? userSub.total_score : null,
                submitted_at: userSub ? userSub.submitted_at : null
              };
              tests.push(newTestObj);
            } else {
              if (fbt.window_start) existing.window_start = fbt.window_start;
              if (fbt.window_end) existing.window_end = fbt.window_end;
              if (!existing.submission_id && userSub) {
                existing.submission_id = userSub.id;
                existing.total_score = userSub.total_score;
                existing.submitted_at = userSub.submitted_at;
              }
            }
          }
        }
      } catch (fbErr) {
        console.error('Firebase test sync error:', fbErr.message);
      }
    }

    const now = new Date();

    const formatted = tests.map(t => {
      let subjectsList = [];
      try {
        subjectsList = typeof t.subjects === 'string' ? JSON.parse(t.subjects) : t.subjects;
      } catch (e) {
        subjectsList = [t.subjects];
      }

      // Compute scheduling window status
      let windowStatus = 'ACTIVE';
      if (t.window_start && new Date(t.window_start) > now) {
        windowStatus = 'UPCOMING';
      } else if (t.window_end && new Date(t.window_end) < now) {
        windowStatus = 'EXPIRED';
      }

      return {
        id: t.id,
        testCode: t.test_code,
        title: t.title,
        description: t.description,
        durationMinutes: t.duration_minutes,
        totalQuestions: t.total_questions,
        subjects: subjectsList || [],
        hideResultsStudent: false,
        createdAt: t.created_at,
        windowStart: t.window_start || null,
        windowEnd: t.window_end || null,
        windowStatus,
        hasSubmitted: !!t.submission_id,
        submissionId: t.submission_id,
        userScore: t.total_score !== null && t.total_score !== undefined ? t.total_score : null,
        submittedAt: t.submitted_at
      };
    });

    return res.json({ tests: formatted });
  } catch (error) {
    console.error('Fetch tests error:', error);
    return res.status(500).json({ error: 'Failed to retrieve tests' });
  }
});

/**
 * GET /api/tests/:id/run
 * Serves the CBT HTML file with security, proctoring & scheduling window enforcement
 */
router.get('/:id/run', authenticate, async (req, res) => {
  try {
    const testId = req.params.id;
    let test = await query.get('SELECT * FROM tests WHERE (id = ? OR test_code = ?) AND is_active = 1', [testId, testId]).catch(() => null);

    if (!test && firebaseStore.isAvailable()) {
      test = await firebaseStore.getTest(testId);
    }

    if (!test) {
      return res.status(404).send('<h3>Test not found or inactive.</h3>');
    }

    // Window Scheduling Enforcement (Feature 3)
    // Only check window for active attempts; rewatch mode is always accessible
    const isRetake = req.query.retake === '1' || req.query.retake === 'true';
    const now = new Date();

    if (test.window_start && new Date(test.window_start) > now) {
      return res.status(403).send(renderWindowNotice('UPCOMING', test.title, test.window_start));
    }
    if (test.window_end && new Date(test.window_end) < now && isRetake) {
      return res.status(403).send(renderWindowNotice('EXPIRED', test.title, test.window_end));
    }

    const fileName = test.file_name || `test_${test.id}.html`;
    const filePath = path.join(uploadDir, fileName);

    if (!fs.existsSync(filePath)) {
      if (test.html_content) {
        try { fs.writeFileSync(filePath, test.html_content, 'utf8'); } catch (e) {}
      } else if (firebaseStore.isAvailable()) {
        const cloudTest = await firebaseStore.getTest(test.id || test.test_code);
        if (cloudTest && cloudTest.html_content) {
          try { fs.writeFileSync(filePath, cloudTest.html_content, 'utf8'); } catch (e) {}
        }
      }
    }

    if (!fs.existsSync(filePath)) {
      const bundled = path.join(__dirname, '..', 'uploads', 'sample_jee_main_2026.html');
      if (fs.existsSync(bundled)) {
        try { fs.copyFileSync(bundled, filePath); } catch (e) {}
      }
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).send('<h3>Test file not found on server storage.</h3>');
    }

    let html = fs.readFileSync(filePath, 'utf8');

    // Retrieve past submission for candidate (Rewatch Mode) unless retake requested
    let pastSubmission = null;

    if (!isRetake) {
      pastSubmission = await query.get(
        'SELECT answers_json, total_score, submitted_at FROM submissions WHERE test_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1',
        [test.id, req.user.id]
      ).catch(() => null);

      if (!pastSubmission && firebaseStore.isAvailable()) {
        const subs = await firebaseStore.getStudentSubmissions(req.user.id);
        const match = subs.find(s => String(s.test_id) === String(test.id));
        if (match) {
          pastSubmission = {
            answers_json: typeof match.answers_json === 'string' ? match.answers_json : JSON.stringify(match.answers_json || {}),
            total_score: match.total_score,
            submitted_at: match.submitted_at
          };
        }
      }
    }

    // Create the security, proctoring & sync bridge
    const bridgeCode = createBridgeScript(
      test.id,
      req.session.token,
      req.user.name,
      pastSubmission
    );

    // Inject before </body>
    if (html.includes('</body>')) {
      html = html.replace('</body>', `${bridgeCode}\n</body>`);
    } else {
      html += `\n${bridgeCode}`;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (error) {
    console.error('Run test error:', error);
    return res.status(500).send('<h3>Error loading exam environment.</h3>');
  }
});

/**
 * POST /api/tests/:id/submit
 * Records student submission, scores, time taken, device info, and Proctoring Photos (Feature 2)
 */
router.post('/:id/submit', authenticate, async (req, res) => {
  try {
    const testId = req.params.id;
    const {
      totalScore = 0,
      correctCount = 0,
      incorrectCount = 0,
      unattemptedCount = 0,
      timeTakenSec = 0,
      answersJson = {},
      proctoringPhotos = []
    } = req.body;

    let test = await query.get('SELECT * FROM tests WHERE id = ? OR test_code = ?', [testId, testId]).catch(() => null);
    if (!test && firebaseStore.isAvailable()) {
      test = await firebaseStore.getTest(testId);
    }

    const totalAttempted = correctCount + incorrectCount;
    const accuracy = totalAttempted > 0 ? parseFloat(((correctCount / totalAttempted) * 100).toFixed(1)) : 0;
    const maxMarks = ((test?.total_questions) || 75) * 4;

    const deviceInfo = JSON.stringify({
      os: req.session.deviceOs || 'Unknown OS',
      browser: req.session.deviceBrowser || 'Unknown Browser',
      ip: req.session.ipAddress || '127.0.0.1'
    });

    const proctoringJson = typeof proctoringPhotos === 'string' ? proctoringPhotos : JSON.stringify(proctoringPhotos || []);
    let submissionId = Date.now();

    try {
      const result = await query.run(
        `INSERT INTO submissions 
         (user_id, test_id, session_id, total_score, max_marks, correct_count, incorrect_count, 
          unattempted_count, accuracy_percent, time_taken_sec, answers_json, proctoring_photos, device_info)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.id,
          test?.id || testId,
          req.session.id,
          totalScore,
          maxMarks,
          correctCount,
          incorrectCount,
          unattemptedCount,
          accuracy,
          timeTakenSec,
          typeof answersJson === 'string' ? answersJson : JSON.stringify(answersJson),
          proctoringJson,
          deviceInfo
        ]
      );
      if (result && result.lastID) submissionId = result.lastID;
    } catch (e) {
      console.error('SQLite submission insert error (falling back to Firebase):', e.message);
    }

    // Sync submission to Firebase Realtime Database
    if (firebaseStore.isAvailable()) {
      await firebaseStore.saveSubmission({
        id: submissionId,
        user_id: req.user.id,
        user_email: req.user.email,
        user_name: req.user.name,
        test_id: test?.id || testId,
        test_code: test?.test_code || 'CBT',
        test_title: test?.title || 'CBT Paper',
        total_score: totalScore,
        max_marks: maxMarks,
        correct_count: correctCount,
        incorrect_count: incorrectCount,
        unattempted_count: unattemptedCount,
        accuracy_percent: accuracy,
        time_taken_sec: timeTakenSec,
        answers_json: typeof answersJson === 'string' ? answersJson : JSON.stringify(answersJson),
        proctoring_photos: proctoringPhotos || [],
        device_info: deviceInfo,
        submitted_at: new Date().toISOString()
      }).catch(err => console.error('[Firebase] saveSubmission error:', err.message));
    }

    return res.json({
      message: 'Submission successfully recorded with proctoring audit',
      submissionId,
      score: totalScore,
      accuracy
    });
  } catch (error) {
    console.error('Submit test error:', error);
    return res.status(500).json({ error: 'Failed to record test submission' });
  }
});

/**
 * GET /api/tests/my-attempts
 * Returns all past test attempts by this candidate with complete stats & analysis
 */
router.get('/my-attempts', authenticate, async (req, res) => {
  try {
    let attempts = [];
    try {
      attempts = await query.all(
        `SELECT s.*, t.title AS test_title, t.test_code
         FROM submissions s
         JOIN tests t ON t.id = s.test_id
         WHERE s.user_id = ?
         ORDER BY s.submitted_at DESC`,
        [req.user.id]
      );
    } catch (e) {}

    if (firebaseStore.isAvailable()) {
      try {
        const fbSubs = await firebaseStore.getStudentSubmissions(req.user.id);
        if (fbSubs && fbSubs.length > 0) {
          fbSubs.forEach(fs => {
            const exists = attempts.find(a => String(a.id) === String(fs.id));
            if (!exists) {
              attempts.push({
                id: fs.id,
                test_id: fs.test_id,
                test_title: fs.test_title || 'CBT Paper',
                test_code: fs.test_code || 'CBT',
                total_score: fs.total_score,
                max_marks: fs.max_marks || 300,
                correct_count: fs.correct_count || 0,
                incorrect_count: fs.incorrect_count || 0,
                unattempted_count: fs.unattempted_count || 0,
                accuracy_percent: fs.accuracy_percent || 0,
                time_taken_sec: fs.time_taken_sec || 0,
                submitted_at: fs.submitted_at
              });
            }
          });
        }
      } catch (e) {}
    }

    attempts.sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0));

    return res.json({
      attempts: attempts.map(a => ({
        id: a.id,
        testId: a.test_id,
        testTitle: a.test_title,
        testCode: a.test_code,
        totalScore: a.total_score,
        maxMarks: a.max_marks || 300,
        correct: a.correct_count || 0,
        incorrect: a.incorrect_count || 0,
        unattempted: a.unattempted_count || 0,
        accuracy: a.accuracy_percent || 0,
        timeTakenSec: a.time_taken_sec || 0,
        submittedAt: a.submitted_at
      }))
    });
  } catch (error) {
    console.error('Fetch student attempts error:', error);
    return res.status(500).json({ error: 'Failed to retrieve test history' });
  }
});

/**
 * GET /api/tests/:id/my-result
 * Retrieves candidate's own submission details
 */
router.get('/:id/my-result', authenticate, async (req, res) => {
  try {
    const testId = req.params.id;
    let submission = await query.get(
      `SELECT * FROM submissions WHERE test_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1`,
      [testId, req.user.id]
    ).catch(() => null);

    if (!submission && firebaseStore.isAvailable()) {
      const subs = await firebaseStore.getStudentSubmissions(req.user.id);
      submission = subs.find(s => String(s.test_id) === String(testId));
    }

    if (!submission) {
      return res.status(404).json({ error: 'No submission found for this test' });
    }

    let answers = {};
    try {
      answers = typeof submission.answers_json === 'string' ? JSON.parse(submission.answers_json) : (submission.answers_json || {});
    } catch (e) {}

    return res.json({
      submission: {
        id: submission.id,
        totalScore: submission.total_score,
        maxMarks: submission.max_marks || 300,
        correct: submission.correct_count || 0,
        incorrect: submission.incorrect_count || 0,
        unattempted: submission.unattempted_count || 0,
        accuracy: submission.accuracy_percent || 0,
        timeTakenSec: submission.time_taken_sec || 0,
        submittedAt: submission.submitted_at,
        answers
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error loading test results' });
  }
});

module.exports = router;
