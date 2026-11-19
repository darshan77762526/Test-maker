const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');
const { createBridgeScript } = require('../utils/testBridge');

/**
 * GET /api/tests
 * Returns available tests for students/admins with submission status
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const tests = await query.all(
      `SELECT t.id, t.test_code, t.title, t.description, t.duration_minutes, 
              t.total_questions, t.subjects, t.hide_results_student, t.created_at,
              s.id AS submission_id, s.total_score, s.submitted_at
       FROM tests t
       LEFT JOIN submissions s ON s.test_id = t.id AND s.user_id = ?
       WHERE t.is_active = 1
       ORDER BY t.id DESC`,
      [req.user.id]
    );

    const formatted = tests.map(t => {
      let subjectsList = [];
      try {
        subjectsList = typeof t.subjects === 'string' ? JSON.parse(t.subjects) : t.subjects;
      } catch (e) {
        subjectsList = [t.subjects];
      }

      return {
        id: t.id,
        testCode: t.test_code,
        title: t.title,
        description: t.description,
        durationMinutes: t.duration_minutes,
        totalQuestions: t.total_questions,
        subjects: subjectsList || [],
        hideResultsStudent: !!t.hide_results_student,
        createdAt: t.created_at,
        hasSubmitted: !!t.submission_id,
        submissionId: t.submission_id,
        userScore: !t.hide_results_student || req.user.role === 'ADMIN' ? t.total_score : null,
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
 * Serves the CBT HTML file injected with the platform security & sync bridge
 */
router.get('/:id/run', authenticate, async (req, res) => {
  try {
    const testId = req.params.id;
    const test = await query.get('SELECT * FROM tests WHERE id = ? AND is_active = 1', [testId]);

    if (!test) {
      return res.status(404).send('<h3>Test not found or inactive.</h3>');
    }

    const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
    const filePath = path.join(uploadDir, test.file_name);

    if (!fs.existsSync(filePath)) {
      return res.status(404).send('<h3>Test file not found on server storage.</h3>');
    }

    let html = fs.readFileSync(filePath, 'utf8');

    // Create the security & sync bridge
    const bridgeCode = createBridgeScript(
      test.id,
      !!test.hide_results_student && req.user.role !== 'ADMIN',
      req.session.token,
      req.user.name
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
 * Records student submission, scores, time taken, and device telemetry
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
      answersJson = {}
    } = req.body;

    const test = await query.get('SELECT * FROM tests WHERE id = ?', [testId]);
    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }

    const totalAttempted = correctCount + incorrectCount;
    const accuracy = totalAttempted > 0 ? ((correctCount / totalAttempted) * 100).toFixed(1) : 0;
    const maxMarks = (test.total_questions || 75) * 4;

    const deviceInfo = JSON.stringify({
      os: req.session.deviceOs,
      browser: req.session.deviceBrowser,
      ip: req.session.ipAddress
    });

    const result = await query.run(
      `INSERT INTO submissions 
       (user_id, test_id, session_id, total_score, max_marks, correct_count, incorrect_count, 
        unattempted_count, accuracy_percent, time_taken_sec, answers_json, device_info)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        testId,
        req.session.id,
        totalScore,
        maxMarks,
        correctCount,
        incorrectCount,
        unattemptedCount,
        accuracy,
        timeTakenSec,
        typeof answersJson === 'string' ? answersJson : JSON.stringify(answersJson),
        deviceInfo
      ]
    );

    return res.json({
      message: 'Submission successfully recorded',
      submissionId: result.lastID,
      score: !test.hide_results_student || req.user.role === 'ADMIN' ? totalScore : null,
      hideResultsStudent: !!test.hide_results_student
    });
  } catch (error) {
    console.error('Submit test error:', error);
    return res.status(500).json({ error: 'Failed to record test submission' });
  }
});

/**
 * GET /api/tests/:id/my-result
 * Retrieves candidate's own submission details (if permitted)
 */
router.get('/:id/my-result', authenticate, async (req, res) => {
  try {
    const testId = req.params.id;
    const test = await query.get('SELECT * FROM tests WHERE id = ?', [testId]);

    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }

    if (test.hide_results_student && req.user.role !== 'ADMIN') {
      return res.status(403).json({
        error: 'RESTRICTED',
        message: 'Examination results are restricted to Administrator access only.'
      });
    }

    const submission = await query.get(
      `SELECT * FROM submissions WHERE test_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1`,
      [testId, req.user.id]
    );

    if (!submission) {
      return res.status(404).json({ error: 'No submission found for this test' });
    }

    let answers = {};
    try {
      answers = JSON.parse(submission.answers_json || '{}');
    } catch (e) {}

    return res.json({
      submission: {
        id: submission.id,
        totalScore: submission.total_score,
        maxMarks: submission.max_marks,
        correct: submission.correct_count,
        incorrect: submission.incorrect_count,
        unattempted: submission.unattempted_count,
        accuracy: submission.accuracy_percent,
        timeTakenSec: submission.time_taken_sec,
        submittedAt: submission.submitted_at,
        answers
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error loading test results' });
  }
});

module.exports = router;
