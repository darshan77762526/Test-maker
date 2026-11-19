/**
 * Generates the bridge client-side script injected into CBT HTML tests.
 * Manages:
 * - Single active session enforcement via real-time heartbeat
 * - Immediate lock-out if user logged in on another device
 * - Interception of test submission and transmission to Admin backend
 * - Conditional hiding of results according to Admin test policy
 */
function createBridgeScript(testId, hideResultsStudent, userToken, userName) {
  return `
<!-- CBT PLATFORM RUNNER & SECURITY BRIDGE -->
<style>
  #cbt-bridge-overlay {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 999999;
    background: rgba(15, 23, 42, 0.95);
    backdrop-filter: blur(8px);
    color: #ffffff;
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    align-items: center;
    justify-content: center;
    padding: 24px;
    text-align: center;
  }
  .cbt-bridge-card {
    max-width: 520px;
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 16px;
    padding: 32px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  }
  .cbt-bridge-badge {
    display: inline-block;
    padding: 6px 14px;
    background: #ef4444;
    color: #fff;
    font-weight: 700;
    border-radius: 9999px;
    font-size: 13px;
    margin-bottom: 16px;
    letter-spacing: 0.05em;
  }
  .cbt-bridge-btn {
    margin-top: 24px;
    padding: 12px 28px;
    background: #0284c7;
    color: #fff;
    font-weight: 700;
    font-size: 14px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .cbt-bridge-btn:hover {
    background: #0369a1;
  }
  #cbt-top-banner {
    position: fixed;
    top: 0;
    right: 0;
    z-index: 99999;
    padding: 6px 16px;
    background: rgba(15, 23, 42, 0.9);
    border-bottom-left-radius: 8px;
    border-left: 1px solid #334155;
    border-bottom: 1px solid #334155;
    font-size: 12px;
    color: #94a3b8;
    display: flex;
    align-items: center;
    gap: 12px;
    font-family: 'Inter', sans-serif;
  }
  #cbt-top-banner a {
    color: #38bdf8;
    text-decoration: none;
    font-weight: 600;
  }
  #cbt-top-banner a:hover {
    text-decoration: underline;
  }
</style>

<div id="cbt-top-banner">
  <span>Candidate: <strong style="color:#f8fafc;">${userName}</strong></span>
  <span>&bull;</span>
  <span style="color:#22c55e;">● Live Session Verified</span>
  <span>&bull;</span>
  <a href="/#/student" id="cbt-exit-btn">← Exit Test</a>
</div>

<div id="cbt-bridge-overlay">
  <div class="cbt-bridge-card">
    <div class="cbt-bridge-badge" id="cbt-overlay-badge">SESSION TERMINATED</div>
    <h2 style="font-size: 22px; font-weight: 800; margin-bottom: 12px;" id="cbt-overlay-title">Multiple Device Login Detected</h2>
    <p style="font-size: 14px; color: #94a3b8; line-height: 1.6;" id="cbt-overlay-msg">
      Your account was logged in from another device. For examination security and anti-cheating compliance, only one device can access the test session at any given time.
    </p>
    <button class="cbt-bridge-btn" onclick="window.location.href='/#/login'">Return to Login</button>
  </div>
</div>

<script>
(function() {
  const TEST_ID = ${testId};
  const HIDE_RESULTS = ${hideResultsStudent ? 'true' : 'false'};
  const TOKEN = "${userToken}";
  let isExamSubmitted = false;
  let heartbeatTimer = null;

  function showOverlay(title, msg, badge) {
    const overlay = document.getElementById('cbt-bridge-overlay');
    if (title) document.getElementById('cbt-overlay-title').innerText = title;
    if (msg) document.getElementById('cbt-overlay-msg').innerText = msg;
    if (badge) document.getElementById('cbt-overlay-badge').innerText = badge;
    overlay.style.display = 'flex';
    if (window.timerHandle) clearInterval(window.timerHandle);
  }

  // 1. Live Session Heartbeat & Device Conflict Detection
  async function sendHeartbeat() {
    if (isExamSubmitted) return;
    try {
      const res = await fetch('/api/sessions/ping', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + TOKEN,
          'Content-Type': 'application/json',
          'x-screen-size': window.innerWidth + 'x' + window.innerHeight
        }
      });
      const data = await res.json();
      if (!res.ok || data.error === 'SESSION_TERMINATED') {
        clearInterval(heartbeatTimer);
        showOverlay(
          'Active Session Terminated',
          data.message || 'You have logged in on another device or your session was revoked by Administrator.',
          'SESSION EXPIRED'
        );
      }
    } catch (e) {
      console.warn('Heartbeat check failed (network jitter):', e);
    }
  }

  heartbeatTimer = setInterval(sendHeartbeat, 15000);

  // 2. Intercept Submission and Sync with Platform
  async function handleExamSubmission() {
    if (isExamSubmitted) return;
    isExamSubmitted = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);

    // Extract state from CBT page
    let totalScore = 0;
    let correctCount = 0;
    let incorrectCount = 0;
    let unattemptedCount = 0;
    let answersData = {};
    let timeTakenSec = 0;

    try {
      if (typeof window.state !== 'undefined' && window.state.answers) {
        answersData = window.state.answers;
        timeTakenSec = (window.TOTAL_DURATION_SEC || 10800) - (window.state.remainingSec || 0);

        if (typeof window.QUESTIONS !== 'undefined') {
          window.QUESTIONS.forEach(q => {
            const userAns = answersData[q.num];
            if (userAns && userAns.response !== null && userAns.response !== undefined && userAns.response !== '') {
              const respStr = String(userAns.response).trim();
              const ansStr = String(q.answer).trim();
              if (respStr === ansStr) {
                correctCount++;
                totalScore += 4;
              } else {
                incorrectCount++;
                totalScore -= 1;
              }
            } else {
              unattemptedCount++;
            }
          });
        }
      }
    } catch (err) {
      console.error('Error computing submission stats:', err);
    }

    const payload = {
      testId: TEST_ID,
      totalScore,
      correctCount,
      incorrectCount,
      unattemptedCount,
      timeTakenSec,
      answersJson: answersData
    };

    try {
      const resp = await fetch('/api/tests/' + TEST_ID + '/submit', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      const resData = await resp.json();
      console.log('Submission synced to server:', resData);
    } catch (err) {
      console.error('Failed to sync submission to server:', err);
    }

    // Check policy: Hide results from students?
    if (HIDE_RESULTS) {
      // Hide results container if shown
      const resView = document.getElementById('view-results');
      if (resView) resView.style.display = 'none';

      showOverlay(
        'Exam Submitted Successfully!',
        'Your responses and time metrics have been recorded securely. As per examination rules, detailed results are accessible to the Administrator only.',
        'COMPLETED'
      );
      document.querySelector('.cbt-bridge-btn').innerText = 'Return to Dashboard';
      document.querySelector('.cbt-bridge-btn').onclick = function() {
        window.location.href = '/#/student';
      };
    }
  }

  // Hook into native submitExam function
  const originalSubmitExam = window.submitExam;
  window.submitExam = function() {
    if (typeof originalSubmitExam === 'function') {
      try { originalSubmitExam.apply(this, arguments); } catch (e) {}
    }
    handleExamSubmission();
  };

  // Also hook into confirm submit button if present
  window.addEventListener('DOMContentLoaded', () => {
    const confirmBtn = document.getElementById('btn-confirm-submit');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        setTimeout(handleExamSubmission, 200);
      });
    }
  });

  // Prompt before leaving
  window.addEventListener('beforeunload', function(e) {
    if (!isExamSubmitted) {
      e.preventDefault();
      e.returnValue = 'You have an active exam session. Are you sure you want to leave?';
    }
  });
})();
</script>
`;
}

module.exports = { createBridgeScript };
