/**
 * Admin Console Controller:
 * Live Sessions, Device Auditing, Test Uploading, Results Analytics,
 * Proctoring Snapshots & Emergency Broadcast Errata Dispatcher
 */
window.AdminModule = {
  activeSessionsInterval: null,

  init() {
    this.bindTabs();
    this.bindUploadForm();
    this.bindModal();
    this.bindButtons();
    this.bindBroadcast();
  },

  bindTabs() {
    const tabBtns = document.querySelectorAll('.admin-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = btn.getAttribute('data-target');
        tabBtns.forEach(b => {
          b.classList.remove('active', 'text-sky-600', 'border-sky-600');
          b.classList.add('text-slate-600', 'border-transparent');
        });
        btn.classList.add('active', 'text-sky-600', 'border-sky-600');
        btn.classList.remove('text-slate-600', 'border-transparent');

        document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.add('hidden'));
        document.getElementById(target)?.classList.remove('hidden');

        // Trigger tab specific loads
        if (target === 'admin-tab-sessions') this.loadSessions();
        if (target === 'admin-tab-results') this.loadResults();
        if (target === 'admin-tab-tests') this.loadTests();
        if (target === 'admin-tab-broadcast') this.loadBroadcast();
      });
    });
  },

  bindButtons() {
    document.getElementById('btn-refresh-sessions')?.addEventListener('click', () => this.loadSessions());
    document.getElementById('btn-refresh-results')?.addEventListener('click', () => this.loadResults());

    document.getElementById('btn-admin-export-csv')?.addEventListener('click', () => {
      window.location.href = `/api/admin/export/csv?token=${App.token}`;
    });
  },

  bindModal() {
    const closeBtn = document.getElementById('btn-close-result-modal');
    const dismissBtn = document.getElementById('btn-dismiss-modal');
    const modal = document.getElementById('modal-result-detail');

    const closeModal = () => modal?.classList.add('hidden');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (dismissBtn) dismissBtn.addEventListener('click', closeModal);
  },

  bindUploadForm() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('upload-file');
    const fileNameDisplay = document.getElementById('file-name-display');
    const form = document.getElementById('form-upload-test');

    if (dropZone && fileInput) {
      dropZone.addEventListener('click', () => fileInput.click());

      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('border-sky-500', 'bg-sky-50');
      });

      ['dragleave', 'dragend'].forEach(ev => {
        dropZone.addEventListener(ev, () => {
          dropZone.classList.remove('border-sky-500', 'bg-sky-50');
        });
      });

      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-sky-500', 'bg-sky-50');
        if (e.dataTransfer.files.length > 0) {
          fileInput.files = e.dataTransfer.files;
          updateFileName();
        }
      });

      fileInput.addEventListener('change', updateFileName);

      function updateFileName() {
        if (fileInput.files && fileInput.files[0]) {
          fileNameDisplay.innerHTML = `<span class="text-sky-700 font-bold">${fileInput.files[0].name}</span> (${(fileInput.files[0].size / 1024 / 1024).toFixed(2)} MB)`;
        }
      }
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!fileInput.files || !fileInput.files[0]) {
          App.toast('Please select an HTML test file to upload', 'error');
          return;
        }

        const btn = document.getElementById('btn-submit-upload');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Parsing & publishing CBT paper...</span>';

        const formData = new FormData();
        formData.append('testFile', fileInput.files[0]);
        formData.append('title', document.getElementById('upload-title').value.trim());
        formData.append('durationMinutes', document.getElementById('upload-duration').value.trim());

        const hideResultsRadio = document.querySelector('input[name="hideResults"]:checked');
        formData.append('hideResultsStudent', hideResultsRadio ? hideResultsRadio.value : '0');

        // Window Scheduling (Feature 3)
        const wStart = document.getElementById('upload-window-start')?.value;
        const wEnd = document.getElementById('upload-window-end')?.value;
        if (wStart) formData.append('windowStart', wStart);
        if (wEnd) formData.append('windowEnd', wEnd);

        try {
          const res = await fetch('/api/admin/upload', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + App.token },
            body: formData
          });

          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to upload test file');

          App.toast('Test paper successfully published and parsed!', 'success');
          form.reset();
          fileNameDisplay.innerText = 'Click or drag & drop CBT HTML here';

          this.loadStats();
          document.querySelector('[data-target="admin-tab-tests"]')?.click();
        } catch (err) {
          App.toast(err.message, 'error');
        } finally {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i><span>Publish CBT Paper</span>';
        }
      });
    }
  },

  bindBroadcast() {
    const bForm = document.getElementById('form-admin-broadcast');
    const clearBtn = document.getElementById('btn-admin-clear-broadcast');

    if (bForm) {
      bForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = document.getElementById('broadcast-message-input')?.value.trim();
        const levelRadio = document.querySelector('input[name="broadcastLevel"]:checked');
        const level = levelRadio ? levelRadio.value : 'urgent';

        if (!msg) return;

        const btn = document.getElementById('btn-submit-broadcast');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Dispatching...</span>';

        try {
          const res = await fetch('/api/admin/broadcast', {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + App.token,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message: msg, level })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);

          App.toast('Live emergency broadcast dispatched!', 'success');
          bForm.reset();
          this.loadBroadcast();
        } catch (err) {
          App.toast(err.message, 'error');
        } finally {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-bullhorn"></i><span>Dispatch Broadcast to All Active Screens</span>';
        }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        try {
          const res = await fetch('/api/admin/broadcast', {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + App.token }
          });
          if (res.ok) {
            App.toast('Active broadcast cleared.', 'info');
            this.loadBroadcast();
          }
        } catch (e) {}
      });
    }
  },

  async loadBroadcast() {
    try {
      const res = await fetch('/api/admin/broadcast', {
        headers: { 'Authorization': 'Bearer ' + App.token }
      });
      const data = await res.json();
      const statusText = document.getElementById('admin-current-broadcast-text');
      const clearBtn = document.getElementById('btn-admin-clear-broadcast');

      if (data.broadcast && data.broadcast.active) {
        if (statusText) {
          statusText.innerHTML = `<span class="text-red-600 font-bold">● Active (${data.broadcast.level || 'urgent'}):</span> "${data.broadcast.message}" <span class="text-[10px] text-slate-400 font-normal">(${new Date(data.broadcast.updatedAt).toLocaleTimeString()})</span>`;
        }
        if (clearBtn) clearBtn.classList.remove('hidden');
      } else {
        if (statusText) statusText.innerText = 'No active broadcast dispatched.';
        if (clearBtn) clearBtn.classList.add('hidden');
      }
    } catch (e) {}
  },

  async loadDashboard() {
    await this.loadStats();
    await this.loadSessions();

    if (this.activeSessionsInterval) clearInterval(this.activeSessionsInterval);
    this.activeSessionsInterval = setInterval(() => {
      const isSessionsTabActive = !document.getElementById('admin-tab-sessions')?.classList.contains('hidden');
      if (isSessionsTabActive && App.user?.role === 'ADMIN') {
        this.loadSessions(true);
        this.loadStats();
      }
    }, 15000);
  },

  async loadStats() {
    try {
      const res = await fetch('/api/admin/stats', {
        headers: { 'Authorization': 'Bearer ' + App.token }
      });
      const data = await res.json();
      if (res.ok) {
        document.getElementById('stat-active-sessions').innerText = data.liveActiveSessions;
        document.getElementById('stat-total-students').innerText = data.totalStudents;
        document.getElementById('stat-total-tests').innerText = data.totalTests;
        document.getElementById('stat-total-submissions').innerText = data.totalSubmissions;
      }
    } catch (e) {}
  },

  async loadSessions(silent = false) {
    const tbody = document.getElementById('table-sessions-body');
    if (!tbody) return;

    if (!silent) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> Polling live devices...</td></tr>`;
    }

    try {
      const res = await fetch('/api/admin/sessions', {
        headers: { 'Authorization': 'Bearer ' + App.token }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch sessions');

      const sessions = data.sessions || [];
      if (sessions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400">No active candidate sessions recorded.</td></tr>`;
        return;
      }

      tbody.innerHTML = sessions.map(s => {
        let statusBadge = '';
        if (s.liveStatus === 'Active') {
          statusBadge = `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200"><span class="pulse-indicator"></span>Active</span>`;
        } else if (s.liveStatus === 'Idle') {
          statusBadge = `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200"><span class="pulse-idle"></span>Idle (${s.secSincePing}s)</span>`;
        } else {
          statusBadge = `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500 border border-slate-200"><span class="pulse-off"></span>Terminated</span>`;
        }

        const actionBtn = s.isActive ? `
          <button onclick="AdminModule.terminateSession(${s.id})" class="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-bold text-[11px] rounded transition">
            Terminate
          </button>
        ` : `<span class="text-slate-400 text-[11px] italic">${s.terminatedReason || 'Closed'}</span>`;

        return `
          <tr class="hover:bg-slate-50 transition">
            <td class="py-3 px-4">
              <div class="font-bold text-slate-900">${s.studentName}</div>
              <div class="text-[11px] text-slate-500">${s.studentEmail}</div>
            </td>
            <td class="py-3 px-4">${statusBadge}</td>
            <td class="py-3 px-4 font-medium text-slate-700"><i class="fa-brands fa-windows mr-1 text-slate-400"></i>${s.deviceOs}</td>
            <td class="py-3 px-4 font-medium text-slate-700">${s.deviceBrowser}</td>
            <td class="py-3 px-4 font-mono text-slate-600">${s.screenSize}</td>
            <td class="py-3 px-4 font-mono text-slate-600">${s.ipAddress}</td>
            <td class="py-3 px-4 text-slate-500">${new Date(s.loginAt).toLocaleTimeString()}</td>
            <td class="py-3 px-4 text-right">${actionBtn}</td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-red-500">${err.message}</td></tr>`;
    }
  },

  async terminateSession(sessionId) {
    if (!confirm('Are you sure you want to force terminate this candidate session?')) return;
    try {
      const res = await fetch(`/api/admin/sessions/${sessionId}/terminate`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + App.token }
      });
      const data = await res.json();
      if (res.ok) {
        App.toast('Candidate session forcefully terminated', 'info');
        this.loadSessions();
        this.loadStats();
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  async loadResults() {
    const tbody = document.getElementById('table-results-body');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> Loading exam submissions...</td></tr>`;

    try {
      const res = await fetch('/api/admin/results', {
        headers: { 'Authorization': 'Bearer ' + App.token }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const results = data.results || [];
      if (results.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400">No candidate submissions recorded yet.</td></tr>`;
        return;
      }

      tbody.innerHTML = results.map(r => {
        const timeMins = Math.round(r.timeTakenSec / 60);
        return `
          <tr class="hover:bg-slate-50 transition">
            <td class="py-3 px-4">
              <div class="font-bold text-slate-900">${r.studentName}</div>
              <div class="text-[11px] text-slate-500">${r.studentEmail}</div>
            </td>
            <td class="py-3 px-4 font-semibold text-slate-800">${r.testTitle}</td>
            <td class="py-3 px-4 text-center font-extrabold text-sm ${r.totalScore >= 0 ? 'text-emerald-700' : 'text-red-600'}">
              ${r.totalScore} <span class="text-slate-400 font-normal text-[11px]">/ ${r.maxMarks}</span>
            </td>
            <td class="py-3 px-4 text-center font-bold text-slate-700">${r.accuracy}%</td>
            <td class="py-3 px-4 text-center text-slate-600 font-mono">${timeMins}m</td>
            <td class="py-3 px-4 text-slate-600 text-[11px]">
              <div>${r.deviceOs} • ${r.deviceBrowser}</div>
              <div class="font-mono text-slate-400 text-[10px]">${r.deviceIp}</div>
            </td>
            <td class="py-3 px-4 text-slate-500">${new Date(r.submittedAt).toLocaleDateString()} ${new Date(r.submittedAt).toLocaleTimeString()}</td>
            <td class="py-3 px-4 text-right">
              <button onclick="AdminModule.openDetailModal(${r.id})" class="px-2.5 py-1 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 font-bold text-[11px] rounded transition">
                View Audit
              </button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-red-500">${err.message}</td></tr>`;
    }
  },

  async openDetailModal(submissionId) {
    const modal = document.getElementById('modal-result-detail');
    if (!modal) return;

    try {
      const res = await fetch(`/api/admin/results/${submissionId}`, {
        headers: { 'Authorization': 'Bearer ' + App.token }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const sub = data.submission;
      document.getElementById('modal-sub-candidate').innerText = `${sub.studentName} (${sub.studentEmail})`;
      document.getElementById('modal-sub-test').innerText = `${sub.testTitle} • ${sub.testCode}`;

      document.getElementById('modal-kpi-score').innerText = `${sub.totalScore} / ${sub.maxMarks}`;
      document.getElementById('modal-kpi-correct').innerText = sub.correct;
      document.getElementById('modal-kpi-incorrect').innerText = sub.incorrect;
      document.getElementById('modal-kpi-accuracy').innerText = `${sub.accuracy}%`;

      document.getElementById('modal-device-text').innerText = `${sub.device?.os || 'Unknown OS'} • ${sub.device?.browser || 'Unknown Browser'}`;
      document.getElementById('modal-ip-text').innerText = sub.device?.ip || 'N/A';
      document.getElementById('modal-time-text').innerText = `${Math.round(sub.timeTakenSec / 60)} minutes (${sub.timeTakenSec} seconds)`;

      const answersList = document.getElementById('modal-answers-list');
      const answersEntries = Object.entries(sub.answers || {});

      if (answersEntries.length === 0) {
        answersList.innerHTML = `<div class="p-4 text-center text-slate-400">No question response stream recorded.</div>`;
      } else {
        answersList.innerHTML = answersEntries.map(([qNum, ans]) => {
          let badge = '';
          if (ans.status === 'answered' || (ans.response !== null && ans.response !== '')) {
            badge = `<span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">Answered: ${ans.response}</span>`;
          } else if (ans.status === 'marked') {
            badge = `<span class="px-2 py-0.5 rounded bg-purple-100 text-purple-800 font-bold text-[10px]">Marked</span>`;
          } else {
            badge = `<span class="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px]">Unattempted</span>`;
          }

          return `
            <div class="px-4 py-2 flex items-center justify-between hover:bg-slate-50">
              <span class="font-bold text-slate-800">Question ${qNum}</span>
              <div class="flex items-center gap-3">
                <span class="text-slate-400 text-[11px]">${ans.timeSec || 0}s spent</span>
                ${badge}
              </div>
            </div>
          `;
        }).join('');
      }

      // Render Proctoring Photos Gallery (Feature 2)
      const proctorGallery = document.getElementById('modal-proctor-gallery');
      const proctorCount = document.getElementById('modal-proctor-count');
      const photos = sub.proctoringPhotos || [];

      if (proctorCount) proctorCount.innerText = `${photos.length} frames captured`;
      if (proctorGallery) {
        if (photos.length === 0) {
          proctorGallery.innerHTML = `<div class="col-span-full py-4 text-center text-slate-400 text-xs">No webcam proctoring frames recorded for this attempt.</div>`;
        } else {
          proctorGallery.innerHTML = photos.map(p => `
            <div class="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm flex flex-col">
              <img src="${p.photo}" alt="Proctor Frame" class="w-full h-24 object-cover cursor-pointer hover:opacity-90" onclick="window.open('${p.photo}', '_blank')" />
              <div class="p-1.5 bg-slate-50 text-[10px] space-y-0.5">
                <div class="font-bold text-slate-700 capitalize">${(p.trigger || 'snapshot').replace('_', ' ')}</div>
                <div class="text-slate-400 font-mono">${new Date(p.timestamp).toLocaleTimeString()}</div>
              </div>
            </div>
          `).join('');
        }
      }

      modal.classList.remove('hidden');
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  async loadTests() {
    const tbody = document.getElementById('table-tests-body');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> Loading test catalog...</td></tr>`;

    try {
      const res = await fetch('/api/admin/tests', {
        headers: { 'Authorization': 'Bearer ' + App.token }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const tests = data.tests || [];
      if (tests.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-400">No tests published yet. Upload your first CBT HTML file above!</td></tr>`;
        return;
      }

      tbody.innerHTML = tests.map(t => {
        const policyBadge = t.hideResultsStudent ? 
          `<button onclick="AdminModule.toggleResultsPolicy(${t.id}, false)" class="px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 font-bold text-[10px] hover:bg-red-100 transition" title="Click to allow students to see results">Admin Only</button>` :
          `<button onclick="AdminModule.toggleResultsPolicy(${t.id}, true)" class="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[10px] hover:bg-emerald-100 transition" title="Click to hide results from students">Students Can View</button>`;

        let windowBadge = '<span class="text-slate-400">Anytime</span>';
        if (t.windowStart || t.windowEnd) {
          const s = t.windowStart ? new Date(t.windowStart).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Open';
          const e = t.windowEnd ? new Date(t.windowEnd).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'No deadline';
          windowBadge = `<span class="font-mono text-[10px] text-sky-700 bg-sky-50 px-2 py-0.5 rounded border border-sky-200">${s} → ${e}</span>`;
        }

        return `
          <tr class="hover:bg-slate-50 transition">
            <td class="py-3 px-4 font-mono font-bold text-slate-700">${t.testCode}</td>
            <td class="py-3 px-4">
              <div class="font-bold text-slate-900">${t.title}</div>
              <div class="text-[11px] text-slate-500">${windowBadge}</div>
            </td>
            <td class="py-3 px-4 text-center font-medium">${t.totalQuestions} Qs</td>
            <td class="py-3 px-4 text-center font-medium">${t.durationMinutes}m</td>
            <td class="py-3 px-4 text-center font-bold text-slate-700">${t.totalAttempts}</td>
            <td class="py-3 px-4 text-center">${policyBadge}</td>
            <td class="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
              <a href="/api/tests/${t.id}/run?token=${App.token}" target="_blank" class="px-2.5 py-1 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 font-bold text-[11px] rounded transition">
                Preview
              </a>
              <button onclick="AdminModule.deleteTest(${t.id})" class="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-bold text-[11px] rounded transition">
                Delete
              </button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-red-500">${err.message}</td></tr>`;
    }
  },

  async toggleResultsPolicy(testId, hideResults) {
    try {
      const res = await fetch(`/api/admin/tests/${testId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer ' + App.token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ hideResultsStudent: hideResults })
      });
      if (res.ok) {
        App.toast('Results visibility policy updated', 'info');
        this.loadTests();
      }
    } catch (e) {}
  },

  async deleteTest(testId) {
    if (!confirm('Are you sure you want to permanently delete this test and its submissions?')) return;
    try {
      const res = await fetch(`/api/admin/tests/${testId}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + App.token }
      });
      const data = await res.json();
      if (res.ok) {
        App.toast('Test paper deleted successfully', 'success');
        this.loadTests();
        this.loadStats();
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      App.toast(err.message, 'error');
    }
  }
};

window.addEventListener('DOMContentLoaded', () => {
  window.AdminModule.init();
});
