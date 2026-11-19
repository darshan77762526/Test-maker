/**
 * Authentication Module (Login & Student Self-Registration)
 */
window.AuthModule = {
  init() {
    this.bindForms();
    this.bindPasswordToggles();
  },

  bindPasswordToggles() {
    const toggleLoginPass = document.getElementById('toggle-login-pass');
    const loginPass = document.getElementById('login-password');
    if (toggleLoginPass && loginPass) {
      toggleLoginPass.addEventListener('click', () => {
        const isPass = loginPass.type === 'password';
        loginPass.type = isPass ? 'text' : 'password';
        toggleLoginPass.innerHTML = isPass ? '<i class="fa-regular fa-eye-slash"></i>' : '<i class="fa-regular fa-eye"></i>';
      });
    }
  },

  bindForms() {
    // 1. Login Form Submit
    const formLogin = document.getElementById('form-login');
    if (formLogin) {
      formLogin.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        const btn = document.getElementById('btn-submit-login');

        const screenSize = `${window.screen.width}x${window.screen.height}`;

        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Verifying credentials...</span>';

        try {
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-screen-size': screenSize
            },
            body: JSON.stringify({ email, password, screenSize })
          });

          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || data.message || 'Login failed');
          }

          App.setAuth(data.token, data.user);
          App.toast(`Welcome back, ${data.user.name}!`, 'success');

          window.location.hash = data.user.role === 'ADMIN' ? '#/admin' : '#/student';
        } catch (err) {
          App.toast(err.message, 'error');
        } finally {
          btn.disabled = false;
          btn.innerHTML = '<span>Sign In to Examination Portal</span><i class="fa-solid fa-arrow-right"></i>';
        }
      });
    }

    // 2. Register Form Submit
    const formRegister = document.getElementById('form-register');
    if (formRegister) {
      formRegister.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('reg-name').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const password = document.getElementById('reg-password').value;
        const confirmPassword = document.getElementById('reg-confirm-password').value;
        const btn = document.getElementById('btn-submit-register');

        if (password !== confirmPassword) {
          App.toast('Passwords do not match. Please re-enter.', 'error');
          return;
        }

        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Creating account...</span>';

        try {
          const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password })
          });

          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || data.message || 'Registration failed');
          }

          App.toast('Account created successfully! Please log in.', 'success');
          formRegister.reset();
          window.location.hash = '#/login';
        } catch (err) {
          App.toast(err.message, 'error');
        } finally {
          btn.disabled = false;
          btn.innerHTML = '<span>Register & Continue</span><i class="fa-solid fa-user-plus"></i>';
        }
      });
    }
  }
};

window.addEventListener('DOMContentLoaded', () => {
  window.AuthModule.init();
});
