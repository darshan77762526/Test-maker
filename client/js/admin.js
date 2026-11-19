/**
 * Admin Console Controller:
 * Live Sessions, Device Auditing, Test Uploading, Results Analytics
 */
window.AdminModule = {
  activeSessionsInterval: null,

  init() {
    this.bindTabs();
    this.bindUploadForm();
    this.bindModal();
    this.bindButtons();
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
        formData.append('hideResultsStudent', hideResultsRadio ? hideResultsRadio.value : '1');

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

          // Refresh stats and navigate to tests tab
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

        return `
          <tr class="hover:bg-slate-50 transition">
            <td class="py-3 px-4 font-mono font-bold text-slate-800 uppercase">${t.testCode}</td>
            <td class="py-3 px-4">
              <div class="font-bold text-slate-900">${t.title}</div>
              <div class="text-[11px] text-slate-500">${t.subjects.join(', ')}</div>
            </td>
            <td class="py-3 px-4 text-center font-bold text-slate-700">${t.totalQuestions}</td>
            <td class="py-3 px-4 text-center text-slate-600">${t.durationMinutes}m</td>
            <td class="py-3 px-4 text-center font-bold text-sky-700">${t.totalAttempts}</td>
            <td class="py-3 px-4 text-center">${policyBadge}</td>
            <td class="py-3 px-4 text-right">
              <div class="flex items-center justify-end gap-2">
                <a href="/api/tests/${t.id}/run?token=${App.token}" target="_blank" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-bold transition">Preview</a>
                <button onclick="AdminModule.deleteTest(${t.id})" class="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded text-[11px] font-bold transition">Delete</button>
              </div>
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
        App.toast('Test results policy updated', 'success');
        this.loadTests();
      }
    } catch (e) {
      App.toast('Error updating policy', 'error');
    }
  },

  async deleteTest(testId) {
    if (!confirm('Are you sure you want to delete this CBT paper and all candidate attempts?')) return;
    try {
      const res = await fetch(`/api/admin/tests/${testId}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + App.token }
      });
      if (res.ok) {
        App.toast('Test paper deleted', 'info');
        this.loadTests();
        this.loadStats();
      }
    } catch (e) {
      App.toast('Error deleting test', 'error');
    }
  }
};

window.addEventListener('DOMContentLoaded', () => {
  window.AdminModule.init();
});
