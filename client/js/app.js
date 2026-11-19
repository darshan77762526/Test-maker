/**
 * Core Application Router and State Controller
 */
window.App = {
  token: localStorage.getItem('cbt_token') || null,
  user: JSON.parse(localStorage.getItem('cbt_user') || 'null'),
  currentRoute: '',

  init() {
    this.bindEvents();
    this.updateNav();
    this.route();
    window.addEventListener('hashchange', () => this.route());
  },

  bindEvents() {
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => this.logout());
    }
  },

  setAuth(token, user) {
    this.token = token;
    this.user = user;
    localStorage.setItem('cbt_token', token);
    localStorage.setItem('cbt_user', JSON.stringify(user));
    this.updateNav();
  },

  async logout() {
    try {
      if (this.token) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + this.token }
        });
      }
    } catch (e) {}
    localStorage.removeItem('cbt_token');
    localStorage.removeItem('cbt_user');
    this.token = null;
    this.user = null;
    this.updateNav();
    window.location.hash = '#/login';
    this.toast('You have been securely logged out.', 'info');
  },

  updateNav() {
    const navUserInfo = document.getElementById('nav-user-info');
    const navUserName = document.getElementById('nav-user-name');
    const navUserRole = document.getElementById('nav-user-role');

    if (this.token && this.user) {
      navUserInfo.classList.remove('hidden');
      navUserName.innerText = this.user.name;
      navUserRole.innerText = this.user.role === 'ADMIN' ? 'Administrator' : 'Candidate';
    } else {
      navUserInfo.classList.add('hidden');
    }
  },

  toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const el = document.createElement('div');
    const bg = type === 'error' ? 'bg-red-600' : type === 'success' ? 'bg-emerald-600' : 'bg-slate-800';
    const icon = type === 'error' ? 'fa-circle-exclamation' : type === 'success' ? 'fa-circle-check' : 'fa-circle-info';

    el.className = `${bg} text-white px-4 py-3 rounded-xl shadow-xl text-xs font-semibold flex items-center gap-2.5 pointer-events-auto transform transition-all duration-300 translate-y-2 opacity-0`;
    el.innerHTML = `<i class="fa-solid ${icon}"></i><span>${message}</span>`;
    container.appendChild(el);

    requestAnimationFrame(() => {
      el.classList.remove('translate-y-2', 'opacity-0');
    });

    setTimeout(() => {
      el.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => el.remove(), 300);
    }, 4000);
  },

  route() {
    let hash = window.location.hash || '#/login';
    this.currentRoute = hash;

    // Check authorization gates
    if (!this.token) {
      if (hash !== '#/register') {
        hash = '#/login';
        window.location.hash = '#/login';
      }
    } else {
      if (hash === '#/login' || hash === '#/register' || hash === '#/') {
        hash = this.user?.role === 'ADMIN' ? '#/admin' : '#/student';
        window.location.hash = hash;
      }
    }

    // Role guard for admin
    if (hash.startsWith('#/admin') && this.user?.role !== 'ADMIN') {
      this.toast('Administrator access required.', 'error');
      window.location.hash = '#/student';
      return;
    }

    // Toggle view containers
    const views = ['login', 'register', 'student', 'admin'];
    views.forEach(v => {
      const el = document.getElementById(`view-${v}`);
      if (el) el.classList.add('hidden');
    });

    if (hash === '#/login') {
      document.getElementById('view-login')?.classList.remove('hidden');
    } else if (hash === '#/register') {
      document.getElementById('view-register')?.classList.remove('hidden');
    } else if (hash.startsWith('#/student')) {
      document.getElementById('view-student')?.classList.remove('hidden');
      if (window.StudentModule) window.StudentModule.loadDashboard();
    } else if (hash.startsWith('#/admin')) {
      document.getElementById('view-admin')?.classList.remove('hidden');
      if (window.AdminModule) window.AdminModule.loadDashboard();
    }
  }
};

window.addEventListener('DOMContentLoaded', () => {
  window.App.init();
});
