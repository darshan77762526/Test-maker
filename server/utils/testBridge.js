/**
 * Generates the bridge client-side script injected into CBT HTML tests.
 * Manages:
 * - Single active session enforcement via real-time heartbeat
 * - Automated Proctoring Snapshots (Feature 2)
 * - Live Admin Emergency Broadcast & Errata Banner (Feature 5)
 * - Seamless submission and recording to server database & cloud
 * - Instant detailed performance analysis for student
 * - Automatic rewatch & retake mode
 * - Ultra-smooth instructions checkbox & start button controller
 */
function createBridgeScript(testId, userToken, userName, pastSubmission = null) {
  const safeTestId = JSON.stringify(String(testId));
  const safeUserToken = JSON.stringify(String(userToken || ''));
  let safePastAnswers = 'null';
  try {
    if (pastSubmission && pastSubmission.answers_json) {
      const parsed = typeof pastSubmission.answers_json === 'string' 
        ? JSON.parse(pastSubmission.answers_json) 
        : pastSubmission.answers_json;
      safePastAnswers = JSON.stringify(parsed);
    }
  } catch (e) {
    safePastAnswers = 'null';
  }

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
  /* Live Emergency Errata / Broadcast Banner (Feature 5) */
  #cbt-broadcast-banner {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 100000;
    background: #b91c1c;
    color: #ffffff;
    padding: 10px 20px;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 700;
    text-align: center;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    animation: cbtPulse 2s infinite ease-in-out;
  }
  @keyframes cbtPulse {
    0%, 100% { background-color: #b91c1c; }
    50% { background-color: #dc2626; }
  }
  #cbt-broadcast-banner.warning {
    background: #d97706;
  }
  /* Ultra-smooth Proceed button overrides */
  #btn-start-exam {
    cursor: pointer !important;
    transition: all 0.15s ease !important;
    touch-action: manipulation;
  }
  #cbt-proctor-container {
    display: none;
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 9999;
    width: 140px;
    border-radius: 10px;
    overflow: hidden;
    border: 2px solid #0284c7;
    box-shadow: 0 10px 25px rgba(0,0,0,0.4);
    background: #000;
  }
  #cbt-proctor-video {
    width: 100%;
    height: auto;
    display: block;
    transform: scaleX(-1);
  }
</style>

<!-- Live Broadcast Errata Ticker (Feature 5) -->
<div id="cbt-broadcast-banner">
  <span id="cbt-broadcast-text">⚠ LIVE EXAMINATION ANNOUNCEMENT: Please read carefully</span>
</div>

<!-- Proctoring Webcam Stream Container (Feature 2) -->
<div id="cbt-proctor-container">
  <video id="cbt-proctor-video" autoplay playsinline muted></video>
</div>
<canvas id="cbt-proctor-canvas" width="320" height="240" style="display:none;"></canvas>

<div id="cbt-top-banner">
  <span>Candidate: <strong style="color:#f8fafc;">${userName}</strong></span>
  <span>&bull;</span>
  <span id="cbt-status-text" style="color:#22c55e;">● Live Session Verified</span>
  <span id="cbt-proctor-badge" style="display:none; color:#38bdf8;">
    <span>&bull;</span>
    <span>📷 Proctor Active</span>
  </span>
  <span id="cbt-retake-container" style="display:none;">
    <span>&bull;</span>
    <a href="/api/tests/${testId}/run?token=${userToken}&retake=1" id="cbt-retake-btn" style="color:#fbbf24; font-weight:700;">↻ Retake Exam</a>
  </span>
  <span>&bull;</span>
  <a href="/#/student" id="cbt-exit-btn">← Exit to Dashboard</a>
</div>

<div id="cbt-toast-sync">✓ Attempt Saved & Secured to Cloud Portal</div>

<div id="cbt-bridge-overlay" onclick="localStorage.clear(); window.location.href='/#/login';" style="cursor:pointer;">
  <div class="cbt-bridge-card" onclick="localStorage.clear(); window.location.href='/#/login';" style="border: 2px solid #ef4444; border-radius: 24px; padding: 40px 32px; box-shadow: 0 25px 60px rgba(239, 68, 68, 0.4); max-width: 520px; width: 90%; background: #0f172a; cursor: pointer;">
    <div class="cbt-bridge-badge" id="cbt-overlay-badge" style="background: #ef4444; font-size: 12px; font-weight: 900; letter-spacing: 0.12em; padding: 8px 20px; border-radius: 9999px;">SESSION TERMINATED</div>
    <h2 style="font-size: 28px; font-weight: 900; margin: 16px 0 12px 0; color: #ffffff;" id="cbt-overlay-title">Session Terminated</h2>
    <p style="font-size: 15px; color: #cbd5e1; line-height: 1.6; margin-bottom: 24px;" id="cbt-overlay-msg">
      Your examination session has been terminated by the Administrator.
    </p>
    <button class="cbt-bridge-btn" style="background: #ef4444; width: 100%; padding: 15px; font-size: 16px; font-weight: 900; border-radius: 14px; cursor: pointer; border: none; color: #ffffff; box-shadow: 0 10px 25px rgba(239, 68, 68, 0.5);" onclick="localStorage.clear(); window.location.href='/#/login';">OK</button>
    <div style="font-size: 12px; color: #64748b; margin-top: 16px; font-weight: 600;">Tap OK or tap anywhere to log out</div>
  </div>
</div>

<script>
(function() {
  const TEST_ID = ${safeTestId};
  const TOKEN = ${safeUserToken};
  const PAST_ANSWERS = ${safePastAnswers};
  let isExamSubmitted = false;
  let heartbeatTimer = null;
  let proctorStream = null;
  const proctoringSnapshots = [];

  function showOverlay(title, msg, badge) {
    const overlay = document.getElementById('cbt-bridge-overlay');
    if (title) document.getElementById('cbt-overlay-title').innerText = title;
    if (msg) document.getElementById('cbt-overlay-msg').innerText = msg;
    if (badge) document.getElementById('cbt-overlay-badge').innerText = badge;
    overlay.style.display = 'flex';
    if (window.timerHandle) clearInterval(window.timerHandle);
  }

  // 1. Live Session Heartbeat & Errata Broadcast Receiver (Feature 5)
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
          'Session Terminated',
          data.message || 'Your examination session has been terminated by the Administrator.',
          'SESSION TERMINATED'
        );
        return;
      }

      // Feature 5: Emergency Broadcast Banner
      const broadcastBar = document.getElementById('cbt-broadcast-banner');
      const broadcastText = document.getElementById('cbt-broadcast-text');
      if (data.activeBroadcast && data.activeBroadcast.active && data.activeBroadcast.message) {
        broadcastText.innerText = '📢 [OFFICIAL EXAM ERRATA]: ' + data.activeBroadcast.message;
        broadcastBar.style.display = 'block';
        if (data.activeBroadcast.level === 'warning') {
          broadcastBar.className = 'warning';
        } else {
          broadcastBar.className = '';
        }
      } else {
        broadcastBar.style.display = 'none';
      }
    } catch (e) {
      console.warn('Heartbeat check jitter:', e);
    }
  }

  // Fast 3-second heartbeat for instant termination response
  heartbeatTimer = setInterval(sendHeartbeat, 3000);
  setTimeout(sendHeartbeat, 1000);

  // 2. Automated Proctoring Webcam Capture (Feature 2)
  async function initProctoring() {
    if (PAST_ANSWERS) return; // Do not record webcam in rewatch mode
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        proctorStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' }
        });
        const video = document.getElementById('cbt-proctor-video');
        if (video) {
          video.srcObject = proctorStream;
          video.play().catch(() => {});
        }
        document.getElementById('cbt-proctor-badge').style.display = 'inline';
        document.getElementById('cbt-proctor-container').style.display = 'block';

        // Capture initial entry frame
        setTimeout(() => takeProctorSnapshot('exam_entry'), 1800);
        // Periodic snapshot at 15 minutes
        setTimeout(() => takeProctorSnapshot('midway_check'), 15 * 60 * 1000);
      }
    } catch (err) {
      console.log('Webcam proctoring permission deferred or unavailable:', err.message);
    }
  }

  function takeProctorSnapshot(triggerName) {
    try {
      const video = document.getElementById('cbt-proctor-video');
      const canvas = document.getElementById('cbt-proctor-canvas');
      if (!video || !canvas || !proctorStream) return;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, 320, 240);
      const dataUri = canvas.toDataURL('image/jpeg', 0.65);
      proctoringSnapshots.push({
        trigger: triggerName,
        timestamp: new Date().toISOString(),
        photo: dataUri
      });
    } catch (e) {
      console.warn('Proctor snapshot error:', e);
    }
  }

  // 3. Test Submission & Sync with Proctoring Photos
  async function handleExamSubmission() {
    if (isExamSubmitted) return;
    isExamSubmitted = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);

    // Take final completion proctor snapshot
    takeProctorSnapshot('exam_submit');

    // Call native renderResults first to ensure UI and metrics are computed
    try {
      if (typeof window.renderResults === 'function') {
        window.renderResults();
      }
    } catch (e) {
      console.warn('renderResults error:', e);
    }

    // Collect response state
    let totalScore = 0;
    let correctCount = 0;
    let incorrectCount = 0;
    let unattemptedCount = 0;
    let answersData = {};
    let timeTakenSec = 0;

    // First try reading the computed score from DOM
    const scoreEl = document.getElementById('res-total-score');
    const correctEl = document.getElementById('res-correct');
    const incorrectEl = document.getElementById('res-incorrect');
    const unattemptedEl = document.getElementById('res-unattempted');

    if (scoreEl && scoreEl.textContent.trim() !== '') {
      totalScore = parseFloat(scoreEl.textContent.trim()) || 0;
      if (correctEl) correctCount = parseInt(correctEl.textContent.trim(), 10) || 0;
      if (incorrectEl) incorrectCount = parseInt(incorrectEl.textContent.trim(), 10) || 0;
      if (unattemptedEl) unattemptedCount = parseInt(unattemptedEl.textContent.trim(), 10) || 0;
    }

    try {
      if (typeof window.state !== 'undefined' && window.state.answers) {
        answersData = window.state.answers;
        timeTakenSec = (window.TOTAL_DURATION_SEC || 10800) - (window.state.remainingSec || 0);

        if (!scoreEl && typeof window.QUESTIONS !== 'undefined') {
          totalScore = 0;
          correctCount = 0;
          incorrectCount = 0;
          unattemptedCount = 0;
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
      answersJson: answersData,
      proctoringPhotos: proctoringSnapshots
    };

    // Show saved toast
    const toast = document.getElementById('cbt-toast-sync');
    if (toast) {
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 4000);
    }

    // Stop webcam stream cleanly
    if (proctorStream) {
      proctorStream.getTracks().forEach(t => t.stop());
      const pCont = document.getElementById('cbt-proctor-container');
      if (pCont) pCont.style.display = 'none';
    }

    // Save to server & cloud Firebase
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

    // Show Retake Button in Top Banner
    const retakeCont = document.getElementById('cbt-retake-container');
    if (retakeCont) retakeCont.style.display = 'inline';

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

  // 4. Instructions Checkbox & Start Button Controller (Instant, Smooth & Bug-Proof)
  function initExamControls() {
    const chk = document.getElementById('chk-declare');
    const startBtn = document.getElementById('btn-start-exam');
    if (!startBtn) return;

    function ensureEnabled() {
      startBtn.removeAttribute('disabled');
      startBtn.disabled = false;
      startBtn.classList.remove('disabled:bg-slate-300', 'disabled:cursor-not-allowed');
      startBtn.classList.add('bg-sky-600', 'hover:bg-sky-700');
      startBtn.style.backgroundColor = '#0284c7';
      startBtn.style.color = '#ffffff';
      startBtn.style.cursor = 'pointer';
      startBtn.style.pointerEvents = 'auto';
      startBtn.style.opacity = '1';
    }

    function launchExam() {
      if (chk) chk.checked = true;
      ensureEnabled();
      initProctoring(); // Initialize camera snapshot engine

      if (typeof window.clearSavedProgress === 'function') window.clearSavedProgress();

      if (typeof window.beginFreshExam === 'function') {
        try { window.beginFreshExam(); } catch (e) {}
      } else if (typeof window.showScreen === 'function') {
        try {
          window.showScreen('exam');
          if (typeof window.visitQuestion === 'function') window.visitQuestion(0);
          if (typeof window.startTimer === 'function') window.startTimer();
        } catch (e) {}
      }

      // Guarantee immediate DOM transition across all devices and browsers
      const vInst = document.getElementById('view-instructions');
      const vExam = document.getElementById('view-exam');
      const vRes = document.getElementById('view-results');
      if (vInst) vInst.classList.add('hidden');
      if (vExam) vExam.classList.remove('hidden');
      if (vRes) vRes.classList.add('hidden');
      if (typeof window.visitQuestion === 'function') {
        try { window.visitQuestion(0); } catch (e) {}
      }
      if (typeof window.startTimer === 'function') {
        try { window.startTimer(); } catch (e) {}
      }
      window.scrollTo({ top: 0, behavior: 'instant' });
    }

    if (chk) {
      chk.addEventListener('change', ensureEnabled);
      chk.addEventListener('input', ensureEnabled);
      chk.addEventListener('click', ensureEnabled);
    }

    // Direct click or touch on Proceed to Exam button auto-checks and starts immediately
    startBtn.onclick = function(e) {
      launchExam();
    };
    startBtn.addEventListener('click', () => {
      launchExam();
    });
    startBtn.addEventListener('touchend', () => {
      launchExam();
    });

    ensureEnabled();
  }

  // Run immediately and across all lifecycle checkpoints
  initExamControls();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initExamControls);
  }
  setTimeout(initExamControls, 50);
  setTimeout(initExamControls, 200);
  setTimeout(initExamControls, 500);
  setTimeout(initExamControls, 1000);

  // Keep button enabled continuously against any external override
  const keepEnabledInterval = setInterval(() => {
    const startBtn = document.getElementById('btn-start-exam');
    if (startBtn) {
      if (startBtn.disabled || startBtn.style.pointerEvents === 'none') {
        startBtn.disabled = false;
        startBtn.removeAttribute('disabled');
        startBtn.style.backgroundColor = '#0284c7';
        startBtn.style.pointerEvents = 'auto';
        startBtn.style.opacity = '1';
        startBtn.style.cursor = 'pointer';
      }
    }
  }, 250);

  window.addEventListener('DOMContentLoaded', () => {
    // 5. Rewatch & Review Mode for previously submitted attempts
    if (PAST_ANSWERS) {
      isExamSubmitted = true;
      const statusText = document.getElementById('cbt-status-text');
      if (statusText) {
        statusText.innerHTML = '● Reviewing Saved Attempt';
        statusText.style.color = '#38bdf8';
      }
      const retakeContainer = document.getElementById('cbt-retake-container');
      if (retakeContainer) retakeContainer.style.display = 'inline';

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
    } else {
      // Prompt for camera warm-up on fresh test load
      setTimeout(initProctoring, 1000);
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
    if (proctorStream) {
      proctorStream.getTracks().forEach(t => t.stop());
    }
  });
})();
</script>
`;
}

module.exports = { createBridgeScript };
