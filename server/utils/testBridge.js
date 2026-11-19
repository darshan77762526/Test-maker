/**
 * Generates the bridge client-side script injected into CBT HTML tests.
 * Manages:
 * - Single active session enforcement via real-time heartbeat
 * - Immediate lock-out if user logged in on another device
 * - Seamless submission and recording to server database
 * - Instant detailed performance analysis for student
 * - Automatic rewatch & review mode for previously attempted papers
 */
function createBridgeScript(testId, userToken, userName, pastSubmission = null) {
  const pastAnswersStr = pastSubmission && pastSubmission.answers_json ? pastSubmission.answers_json : 'null';

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
    background: rgba(15, 23, 42, 0.95);
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
  #cbt-toast-sync {
    display: none;
    position: fixed;
    top: 56px;
    right: 20px;
    z-index: 99999;
    background: #10b981;
    color: white;
    padding: 10px 18px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 700;
    box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3);
    font-family: 'Inter', sans-serif;
  }
</style>

<div id="cbt-top-banner">
  <span>Candidate: <strong style="color:#f8fafc;">${userName}</strong></span>
  <span>&bull;</span>
  <span id="cbt-status-text" style="color:#22c55e;">● Live Session Verified</span>
  <span>&bull;</span>
  <a href="/#/student" id="cbt-exit-btn">← Exit to Dashboard</a>
</div>

<div id="cbt-toast-sync">✓ Attempt Saved & Secured to Cloud Portal</div>

<div id="cbt-bridge-overlay">
  <div class="cbt-bridge-card">
    <div class="cbt-bridge-badge" id="cbt-overlay-badge">SESSION TERMINATED</div>
    <h2 style="font-size: 22px; font-weight: 800; margin-bottom: 12px;" id="cbt-overlay-title">Multiple Device Login Detected</h2>
    <p style="font-size: 14px; color: #94a3b8; line-height: 1.6;" id="cbt-overlay-msg">
      Your account was logged in from another device. For examination security, only one device session can be active at a time.
    </p>
    <button class="cbt-bridge-btn" onclick="window.location.href='/#/login'">Return to Login</button>
  </div>
</div>

<script>
(function() {
  const TEST_ID = ${testId};
  const TOKEN = "${userToken}";
  const PAST_ANSWERS = ${pastAnswersStr};
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

  // 1. Live Session Heartbeat
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
      console.warn('Heartbeat check jitter:', e);
    }
  }

  heartbeatTimer = setInterval(sendHeartbeat, 15000);

  // 2. Test Submission & Sync
  async function handleExamSubmission() {
    if (isExamSubmitted) return;
    isExamSubmitted = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);

    // Collect response state
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

    // Show saved toast
    const toast = document.getElementById('cbt-toast-sync');
    if (toast) {
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 4000);
    }

    // Save to server
    try {
      await fetch('/api/tests/' + TEST_ID + '/submit', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.error('Failed to sync submission to server:', err);
    }

    // Always show full detailed analysis to candidate
    try {
      if (typeof window.showScreen === 'function') window.showScreen('results');
      if (typeof window.renderResults === 'function') window.renderResults();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {}
  }

  // Hook into submitExam
  const originalSubmitExam = window.submitExam;
  window.submitExam = function() {
    if (typeof originalSubmitExam === 'function') {
      try { originalSubmitExam.apply(this, arguments); } catch (e) {}
    }
    handleExamSubmission();
  };

  window.addEventListener('DOMContentLoaded', () => {
    // 3. Rewatch Mode for previously submitted attempts
    if (PAST_ANSWERS) {
      isExamSubmitted = true;
      document.getElementById('cbt-status-text').innerHTML = '● Reviewing Saved Attempt';
      document.getElementById('cbt-status-text').style.color = '#38bdf8';

      setTimeout(() => {
        try {
          if (typeof window.state !== 'undefined') {
            window.state.answers = typeof PAST_ANSWERS === 'string' ? JSON.parse(PAST_ANSWERS) : PAST_ANSWERS;
            if (typeof window.showScreen === 'function') window.showScreen('results');
            if (typeof window.renderResults === 'function') window.renderResults();
          }
        } catch (e) {
          console.error('Error loading saved attempt:', e);
        }
      }, 300);
    }

    const confirmBtn = document.getElementById('btn-confirm-submit');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        setTimeout(handleExamSubmission, 200);
      });
    }
  });

  window.addEventListener('beforeunload', function(e) {
    if (!isExamSubmitted) {
      e.preventDefault();
      e.returnValue = 'You have an active exam session. Are you sure you want to exit?';
    }
  });
})();
</script>
`;
}

module.exports = { createBridgeScript };
