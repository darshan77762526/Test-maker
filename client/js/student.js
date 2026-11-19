/**
 * Student Examination Catalog & Test Launcher
 */
window.StudentModule = {
  init() {
    const refreshBtn = document.getElementById('btn-refresh-tests');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.loadDashboard());
    }
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

    const container = document.getElementById('student-tests-grid');
    if (!container) return;

    container.innerHTML = `
      <div class="col-span-full py-12 text-center text-slate-400">
        <i class="fa-solid fa-spinner fa-spin text-2xl mb-2"></i>
        <p class="text-xs">Loading available examination papers...</p>
      </div>
    `;

    try {
      const res = await fetch('/api/tests', {
        headers: { 'Authorization': 'Bearer ' + App.token }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load test papers');

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

      let actionSection = '';
      if (test.hasSubmitted) {
        if (!test.hideResultsStudent && test.userScore !== null) {
          actionSection = `
            <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center justify-between">
              <div>
                <span class="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">Submitted</span>
                <span class="text-base font-extrabold text-emerald-700">Score: ${test.userScore}</span>
              </div>
              <a href="/api/tests/${test.id}/run?token=${App.token}" target="_blank" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1">
                <span>Review</span>
                <i class="fa-solid fa-arrow-up-right-from-square"></i>
              </a>
            </div>
          `;
        } else {
          actionSection = `
            <div class="bg-slate-100 border border-slate-200 rounded-xl p-3 text-center">
              <span class="text-xs font-bold text-slate-700 flex items-center justify-center gap-1.5">
                <i class="fa-solid fa-check-circle text-emerald-600"></i>
                <span>Attempt Completed</span>
              </span>
              <p class="text-[11px] text-slate-500 mt-0.5">Responses secured. Results managed by Admin.</p>
            </div>
          `;
        }
      } else {
        actionSection = `
          <a href="/api/tests/${test.id}/run?token=${App.token}" target="_blank" class="w-full py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs rounded-xl shadow-sm transition flex items-center justify-center gap-2">
            <span>Enter CBT Examination</span>
            <i class="fa-solid fa-arrow-right"></i>
          </a>
        `;
      }

      return `
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition overflow-hidden flex flex-col justify-between p-5 space-y-4">
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 uppercase">${test.testCode}</span>
              <span class="text-[11px] text-slate-500 font-medium"><i class="fa-regular fa-clock mr-1 text-slate-400"></i>${test.durationMinutes} Mins (${durationHours}h)</span>
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
  }
};

window.addEventListener('DOMContentLoaded', () => {
  window.StudentModule.init();
});
