/**
 * Student Examination Catalog, History & Retake Controller
 */
window.StudentModule = {
  init() {
    this.bindTabs();
    this.bindButtons();
  },

  bindTabs() {
    const tabBtns = document.querySelectorAll('.student-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-target');
        tabBtns.forEach(b => {
          b.classList.remove('active', 'text-sky-600', 'border-sky-600');
          b.classList.add('text-slate-600', 'border-transparent');
        });
        btn.classList.add('active', 'text-sky-600', 'border-sky-600');
        btn.classList.remove('text-slate-600', 'border-transparent');

        document.querySelectorAll('.student-tab-content').forEach(c => c.classList.add('hidden'));
        document.getElementById(target)?.classList.remove('hidden');

        if (target === 'student-tab-catalog') this.loadCatalog();
        if (target === 'student-tab-history') this.loadAttempts();
      });
    });
  },

  bindButtons() {
    document.getElementById('btn-refresh-tests')?.addEventListener('click', () => this.loadCatalog());
    document.getElementById('btn-refresh-history')?.addEventListener('click', () => this.loadAttempts());
  },

  async loadDashboard() {
    if (!App.token) return;

    // Update candidate welcome card
    const welcomeEl = document.getElementById('student-welcome-name');
    if (welcomeEl && App.user) {
      welcomeEl.innerText = `Welcome, ${App.user.name}`;
    }

    const deviceEl = document.getElementById('student-device-info');
    if (deviceEl) {
      deviceEl.innerText = `Resolution: ${window.screen.width}x${window.screen.height} • Browser Verified`;
    }

    this.checkBroadcast();
    await this.loadCatalog();
    this.loadAttempts(true);
  },

  async checkBroadcast() {
    try {
      const res = await App.apiFetch('/api/tests/broadcast');
      const data = await res.json();
      const banner = document.getElementById('student-broadcast-alert');
      const msgEl = document.getElementById('student-broadcast-msg');
      if (banner && data.broadcast && data.broadcast.active && data.broadcast.message) {
        if (msgEl) msgEl.innerText = data.broadcast.message;
        banner.classList.remove('hidden');
        if (data.broadcast.level === 'urgent') {
          banner.className = 'bg-red-600 text-white p-4 rounded-xl font-bold text-xs flex items-center justify-between shadow-md animate-pulse';
        } else {
          banner.className = 'bg-amber-500 text-slate-950 p-4 rounded-xl font-bold text-xs flex items-center justify-between shadow-md';
        }
      } else if (banner) {
        banner.classList.add('hidden');
      }
    } catch (e) {}
  },

  async loadCatalog() {
    this.checkBroadcast();
    const container = document.getElementById('student-tests-grid');
    if (!container) return;

    container.innerHTML = `
      <div class="col-span-full py-12 text-center text-slate-400">
        <i class="fa-solid fa-spinner fa-spin text-2xl mb-2"></i>
        <p class="text-xs">Loading available examination papers...</p>
      </div>
    `;

    try {
      const res = await App.apiFetch('/api/tests');
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'SESSION_TERMINATED') {
          App.showSessionTerminated(data.message, data.reason);
          return;
        }
        throw new Error(data.error || 'Failed to load test papers');
      }

      this.renderTests(data.tests || []);
    } catch (err) {
      container.innerHTML = `
        <div class="col-span-full py-12 text-center text-red-500">
          <i class="fa-solid fa-triangle-exclamation text-2xl mb-2"></i>
          <p class="text-xs font-semibold">${err.message}</p>
        </div>
      `;
    }
  },

  renderTests(tests) {
    const container = document.getElementById('student-tests-grid');
    if (!container) return;

    if (tests.length === 0) {
      container.innerHTML = `
        <div class="col-span-full py-16 text-center bg-white rounded-2xl border border-slate-200">
          <i class="fa-regular fa-folder-open text-4xl text-slate-300 mb-2"></i>
          <h4 class="font-bold text-slate-700 text-sm">No Active CBT Tests</h4>
          <p class="text-xs text-slate-400 mt-1">Please check back when your administrator publishes the test paper.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = tests.map(test => {
      const durationHours = (test.durationMinutes / 60).toFixed(1).replace('.0', '');
      const subjectBadges = test.subjects.map(s => 
        `<span class="px-2 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 text-[11px] font-semibold">${s}</span>`
      ).join(' ');

      // Timezone-tolerant dynamic window evaluation using local device clock
      const now = new Date();
      let isUpcoming = false;
      let isExpired = false;

      function parseClientDate(str) {
        if (!str) return null;
        const d = new Date(str);
        if (!isNaN(d.getTime())) return d;
        const d2 = new Date(String(str).replace(' ', 'T'));
        if (!isNaN(d2.getTime())) return d2;
        return null;
      }

      const startDate = parseClientDate(test.windowStart);
      const endDate = parseClientDate(test.windowEnd);

      if (startDate) {
        isUpcoming = startDate > now;
      }
      if (endDate) {
        isExpired = endDate < now;
      }

      let windowBadge = '';
      if (isUpcoming && startDate) {
        windowBadge = `<span class="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold"><i class="fa-regular fa-clock mr-1"></i>Opens ${startDate.toLocaleDateString()} ${startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`;
      } else if (isExpired) {
        windowBadge = `<span class="px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 text-[10px] font-bold"><i class="fa-solid fa-lock mr-1"></i>Window Closed</span>`;
      } else if (endDate) {
        windowBadge = `<span class="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold"><i class="fa-solid fa-calendar-check mr-1"></i>Active until ${endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`;
      }

      const clientTz = new Date().getTimezoneOffset();

      let actionSection = '';
      if (test.hasSubmitted) {
        let retakeBtn = '';
        if (isExpired) {
          retakeBtn = `
            <button disabled class="py-2 bg-slate-200 text-slate-400 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm text-center cursor-not-allowed">
              <i class="fa-solid fa-lock"></i>
              <span>Closed</span>
            </button>
          `;
        } else {
          retakeBtn = `
            <a href="/api/tests/${test.id}/run?token=${App.token}&retake=1&tz=${clientTz}" target="_blank" class="py-2 bg-amber-500 hover:bg-amber-600 text-slate-900 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm text-center">
              <i class="fa-solid fa-rotate-right"></i>
              <span>Retake</span>
            </a>
          `;
        }

        actionSection = `
          <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Completed Attempt</span>
              <span class="text-xs font-extrabold ${test.userScore >= 0 ? 'text-emerald-700' : 'text-red-600'}">Score: ${test.userScore !== null ? test.userScore : 0}</span>
            </div>
            <div class="grid grid-cols-2 gap-2 pt-1">
              <a href="/api/tests/${test.id}/run?token=${App.token}&tz=${clientTz}" target="_blank" class="py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm text-center">
                <i class="fa-solid fa-square-poll-vertical"></i>
                <span>Rewatch</span>
              </a>
              ${retakeBtn}
            </div>
          </div>
        `;
      } else {
        if (isUpcoming) {
          actionSection = `
            <button disabled class="w-full py-2.5 bg-slate-100 text-slate-400 font-bold text-xs rounded-xl border border-slate-200 cursor-not-allowed flex items-center justify-center gap-2">
              <i class="fa-solid fa-lock text-slate-400"></i>
              <span>Exam Window Not Open</span>
            </button>
          `;
        } else if (isExpired) {
          actionSection = `
            <button disabled class="w-full py-2.5 bg-slate-100 text-slate-400 font-bold text-xs rounded-xl border border-slate-200 cursor-not-allowed flex items-center justify-center gap-2">
              <i class="fa-solid fa-ban text-slate-400"></i>
              <span>Exam Window Closed</span>
            </button>
          `;
        } else {
          actionSection = `
            <a href="/api/tests/${test.id}/run?token=${App.token}&tz=${clientTz}" target="_blank" class="w-full py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs rounded-xl shadow-sm transition flex items-center justify-center gap-2">
              <span>Enter CBT Examination</span>
              <i class="fa-solid fa-arrow-right"></i>
            </a>
          `;
        }
      }

      return `
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition overflow-hidden flex flex-col justify-between p-5 space-y-4">
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 uppercase">${test.testCode}</span>
              <div class="flex items-center gap-2">
                ${windowBadge}
                <span class="text-[11px] text-slate-500 font-medium"><i class="fa-regular fa-clock mr-1 text-slate-400"></i>${test.durationMinutes} Mins (${durationHours}h)</span>
              </div>
            </div>
            <h4 class="font-bold text-base text-slate-900 leading-snug">${test.title}</h4>
            <p class="text-xs text-slate-500 line-clamp-2">${test.description || 'Official Computer Based Test'}</p>
            <div class="flex flex-wrap gap-1.5 pt-1">
              ${subjectBadges}
              <span class="px-2 py-0.5 rounded bg-slate-50 text-slate-600 border border-slate-200 text-[11px] font-medium">${test.totalQuestions} Questions</span>
            </div>
          </div>
          <div class="pt-2 border-t border-slate-100">
            ${actionSection}
          </div>
        </div>
      `;
    }).join('');
  },

  async loadAttempts(silent = false) {
    const tbody = document.getElementById('student-history-body');
    if (!tbody) return;

    if (!silent) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> Loading test attempts...</td></tr>`;
    }

    try {
      const res = await App.apiFetch('/api/tests/my-attempts');
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'SESSION_TERMINATED') {
          App.showSessionTerminated(data.message, data.reason);
          return;
        }
        throw new Error(data.error || 'Failed to fetch attempt history');
      }

      const attempts = data.attempts || [];
      if (attempts.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" class="text-center py-10 text-slate-400">
              <i class="fa-regular fa-folder-open text-2xl mb-2 block"></i>
              You haven't completed any examinations yet. Select an exam from the Catalog to begin.
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = attempts.map(a => {
        const timeMins = Math.round(a.timeTakenSec / 60);
        return `
          <tr class="hover:bg-slate-50 transition">
            <td class="py-3 px-4">
              <div class="font-bold text-slate-900">${a.testTitle}</div>
              <div class="text-[11px] font-mono text-slate-500">${a.testCode}</div>
            </td>
            <td class="py-3 px-4 text-center font-extrabold text-sm ${a.totalScore >= 0 ? 'text-emerald-700' : 'text-red-600'}">
              ${a.totalScore} <span class="text-slate-400 font-normal text-[11px]">/ ${a.maxMarks}</span>
            </td>
            <td class="py-3 px-4 text-center font-bold text-slate-700">${a.accuracy}%</td>
            <td class="py-3 px-4 text-center text-[11px]">
              <span class="text-emerald-700 font-bold">${a.correct}</span> / 
              <span class="text-red-600 font-bold">${a.incorrect}</span> / 
              <span class="text-slate-400">${a.unattempted}</span>
            </td>
            <td class="py-3 px-4 text-center text-slate-600 font-mono text-xs">${timeMins}m</td>
            <td class="py-3 px-4 text-slate-500 text-xs">${new Date(a.submittedAt).toLocaleDateString()} ${new Date(a.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
            <td class="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
              <a href="/api/tests/${a.testId}/run?token=${App.token}&tz=${new Date().getTimezoneOffset()}" target="_blank" class="inline-flex items-center gap-1 px-2.5 py-1 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 font-bold text-[11px] rounded transition">
                <i class="fa-solid fa-eye"></i>
                <span>Rewatch</span>
              </a>
              <a href="/api/tests/${a.testId}/run?token=${App.token}&retake=1&tz=${new Date().getTimezoneOffset()}" target="_blank" class="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-bold text-[11px] rounded transition">
                <i class="fa-solid fa-rotate-right"></i>
                <span>Retake</span>
              </a>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-red-500">${err.message}</td></tr>`;
    }
  }
};

window.addEventListener('DOMContentLoaded', () => {
  window.StudentModule.init();
});
