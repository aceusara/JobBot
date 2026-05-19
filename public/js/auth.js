// auth.js — Supabase auth + modal management
// Reads window._supabase (set by supabase-config.js)
(function () {
  'use strict';

  // Lazy getter — reads window._supabase at call time, not at parse time.
  // supabase-config.js runs first but window._supabase may not be set
  // until the IIFE inside it completes, so we must not capture it eagerly.
  const sb = () => window._supabase;
  let currentUser = null;

  // ── DOM helpers ──────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const show = el => el && el.classList.remove('hidden');
  const hide = el => el && el.classList.add('hidden');
  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ── Modal view configs ───────────────────────────────────
  const VIEWS = {
    signup: {
      title: 'Create your account',
      sub: 'Free forever. No credit card needed. Unlock all 5 tools instantly.',
      submitLabel: 'Create free account',
      showName: true, showPwd: true, showConfirm: true,
      showGoogle: true, showForgot: false,
      toggle: 'Already have an account? <a onclick="setModalView(\'login\')">Log in</a>',
      showTerms: true,
    },
    login: {
      title: 'Welcome back',
      sub: 'Sign in to access all your tools.',
      submitLabel: 'Log in',
      showName: false, showPwd: true, showConfirm: false,
      showGoogle: true, showForgot: true,
      toggle: "Don't have an account? <a onclick=\"setModalView('signup')\">Sign up free</a>",
      showTerms: false,
    },
    forgot: {
      title: 'Reset your password',
      sub: "Enter your email and we'll send you a link to create a new password.",
      submitLabel: 'Send reset link',
      showName: false, showPwd: false, showConfirm: false,
      showGoogle: false, showForgot: false,
      toggle: '<a onclick="setModalView(\'login\')">← Back to log in</a>',
      showTerms: false,
    },
    'update-password': {
      title: 'Set new password',
      sub: 'Choose a strong new password for your account.',
      submitLabel: 'Update password',
      showName: false, showPwd: true, showConfirm: true,
      showGoogle: false, showForgot: false,
      toggle: '',
      showTerms: false,
    },
  };

  // ── Open / close ─────────────────────────────────────────
  window.openModal = function (view = 'signup') {
    setModalView(view);
    $('modal-backdrop').classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => { $('modal-inp-email')?.focus(); }, 150);
  };

  window.closeModal = function () {
    $('modal-backdrop').classList.remove('open');
    document.body.style.overflow = '';
  };

  // ── Render a modal view ──────────────────────────────────
  window.setModalView = function (view) {
    const cfg = VIEWS[view];
    if (!cfg) return;
    $('auth-card').dataset.view = view;

    // Show form, hide other views
    show($('modal-form-view'));
    hide($('modal-verify-view'));
    hide($('modal-reset-sent-view'));

    // Titles
    $('modal-title').textContent = cfg.title;
    $('modal-sub').textContent = cfg.sub;
    $('modal-submit-btn').textContent = cfg.submitLabel;

    // Fields
    const toggle = fn => el => el && (cfg[fn] ? show(el) : hide(el));
    toggle('showName')($('modal-field-name'));
    toggle('showPwd')($('modal-field-pwd'));
    toggle('showConfirm')($('modal-field-confirm'));
    toggle('showGoogle')($('modal-google-wrap'));
    toggle('showForgot')($('modal-forgot-wrap'));
    toggle('showTerms')($('modal-terms'));

    // OR text
    if ($('modal-or-text')) {
      $('modal-or-text').textContent = view === 'login' ? 'or log in with email' : 'or sign up with email';
    }

    // Toggle row
    $('modal-toggle-row').innerHTML = cfg.toggle;

    // pwd bar visibility
    if ($('pwd-bar-wrap')) {
      $('pwd-bar-wrap').style.display = cfg.showPwd ? '' : 'none';
    }

    clearModalMessages();
    clearModalFields();
  };

  function clearModalFields() {
    ['modal-inp-name', 'modal-inp-email', 'modal-inp-pwd', 'modal-inp-confirm']
      .forEach(id => { const el = $(id); if (el) el.value = ''; });
    updatePwdStrength('');
  }

  function clearModalMessages() {
    const err = $('modal-err'), ok = $('modal-ok');
    if (err) { err.textContent = ''; err.classList.remove('show'); }
    if (ok) { ok.textContent = ''; ok.classList.remove('show'); }
  }

  function showModalErr(msg) {
    const el = $('modal-err');
    el.textContent = msg; el.classList.add('show');
    $('modal-ok').classList.remove('show');
  }

  function showModalOk(msg) {
    const el = $('modal-ok');
    el.textContent = msg; el.classList.add('show');
    $('modal-err').classList.remove('show');
  }

  function setSubmitLoading(on) {
    const btn = $('modal-submit-btn');
    btn.disabled = on;
    if (on) btn.textContent = 'Please wait…';
    else btn.textContent = VIEWS[$('auth-card').dataset.view]?.submitLabel || 'Submit';
  }

  // ── Handle submit ────────────────────────────────────────
  window.handleModalSubmit = async function () {
    const view = $('auth-card').dataset.view;
    const email = $('modal-inp-email')?.value?.trim() || '';
    const password = $('modal-inp-pwd')?.value || '';
    const name = $('modal-inp-name')?.value?.trim() || '';
    const confirm = $('modal-inp-confirm')?.value || '';
    clearModalMessages();

    if (view === 'signup') {
      if (!name) return showModalErr('Please enter your name.');
      if (!email || !email.includes('@')) return showModalErr('Please enter a valid email address.');
      if (password.length < 8) return showModalErr('Password must be at least 8 characters.');
      if (password !== confirm) return showModalErr('Passwords do not match.');
      setSubmitLoading(true);
      let signUpResult;
      try { signUpResult = await sb().auth.signUp({ email, password, options: { data: { full_name: name } } }); }
      catch (e) { setSubmitLoading(false); return showModalErr('Connection error. Please try again.'); }
      setSubmitLoading(false);
      if (signUpResult.error) return showModalErr(friendlyError(signUpResult.error.message));
      $('verify-email-display').textContent = email;
      hide($('modal-form-view'));
      show($('modal-verify-view'));

    } else if (view === 'login') {
      if (!email || !email.includes('@')) return showModalErr('Please enter your email.');
      if (!password) return showModalErr('Please enter your password.');
      setSubmitLoading(true);
      let loginResult;
      try { loginResult = await sb().auth.signInWithPassword({ email, password }); }
      catch (e) { setSubmitLoading(false); return showModalErr('Connection error. Please try again.'); }
      setSubmitLoading(false);
      if (loginResult.error) return showModalErr(friendlyError(loginResult.error.message));
      closeModal();
      window.toast('Signed in successfully', 's');

    } else if (view === 'forgot') {
      if (!email || !email.includes('@')) return showModalErr('Please enter your email.');
      setSubmitLoading(true);
      const { error } = await sb().auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/#type=recovery`,
      });
      setSubmitLoading(false);
      if (error) return showModalErr(friendlyError(error.message));
      hide($('modal-form-view'));
      show($('modal-reset-sent-view'));

    } else if (view === 'update-password') {
      if (password.length < 8) return showModalErr('Password must be at least 8 characters.');
      if (password !== confirm) return showModalErr('Passwords do not match.');
      setSubmitLoading(true);
      const { error } = await sb().auth.updateUser({ password });
      setSubmitLoading(false);
      if (error) return showModalErr(friendlyError(error.message));
      showModalOk('Password updated successfully!');
      setTimeout(closeModal, 1800);
    }
  };

  // ── Google OAuth ─────────────────────────────────────────
  window.handleGoogleAuth = async function () {
    try {
      const { error } = await sb().auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) showModalErr(friendlyError(error.message));
    } catch (e) {
      showModalErr('Could not open Google sign-in. Check your Supabase configuration.');
    }
  };

  // ── Sign out ─────────────────────────────────────────────
  window.signOut = async function () {
    await sb().auth.signOut();
    window.toast('Signed out', 'i');
    if (window.onSignOut) window.onSignOut();
  };

  // ── Password strength ─────────────────────────────────────
  window.updatePwdStrength = function (pwd) {
    const fill = $('pwd-fill-bar'), txt = $('pwd-strength-txt');
    if (!fill) return;
    if (!pwd) { fill.style.width = '0'; txt.textContent = ''; return; }
    let s = 0;
    if (pwd.length >= 8) s++;
    if (pwd.length >= 12) s++;
    if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) s++;
    if (/\d/.test(pwd)) s++;
    if (/[^A-Za-z0-9]/.test(pwd)) s++;
    const lvls = [
      { p: '20%', c: '#EF4444', l: 'Too weak' },
      { p: '40%', c: '#F97316', l: 'Weak' },
      { p: '60%', c: '#EAB308', l: 'Fair' },
      { p: '80%', c: '#84CC16', l: 'Good' },
      { p: '100%', c: '#22C55E', l: 'Strong' },
    ];
    const lv = lvls[Math.min(s - 1, 4)] || lvls[0];
    fill.style.width = lv.p; fill.style.background = lv.c;
    txt.textContent = lv.l; txt.style.color = lv.c;
  };

  // ── Auth state observer ──────────────────────────────────
  function updateNavForAuth(user) {
    currentUser = user;
    const authed = !!user;
    const guestBtns = $('nav-guest-btns');
    const userWrap = $('nav-user-wrap');
    if (authed) {
      hide(guestBtns);
      show(userWrap);
      const name = user.user_metadata?.full_name || user.email?.split('@')[0] || 'User';
      const initials = name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase()).join('').slice(0, 2);
      const nameEl = $('nav-user-name');
      const avEl = $('nav-user-av');
      if (nameEl) nameEl.textContent = name;
      if (avEl) avEl.textContent = initials;
      // Update welcome message
      const hwEl = $('home-welcome');
      if (hwEl) hwEl.textContent = `Welcome back, ${name.split(' ')[0]} 👋`;
    } else {
      show(guestBtns);
      hide(userWrap);
    }
    if (window.onAuthStateUpdate) window.onAuthStateUpdate(user);
  }

  // ── Friendly errors ──────────────────────────────────────
  function friendlyError(msg) {
    const m = (msg || '').toLowerCase();
    if (m.includes('auth not configured') || m.includes('credentials')) return 'Auth is not configured yet — add your Supabase credentials to supabase-config.js.';
    if (m.includes('invalid login') || m.includes('invalid credentials')) return 'Incorrect email or password.';
    if (m.includes('email not confirmed')) return 'Please check your email and confirm your account first.';
    if (m.includes('user already registered')) return 'An account with this email already exists. Try logging in.';
    if (m.includes('password should be')) return 'Password must be at least 8 characters.';
    if (m.includes('rate limit')) return 'Too many attempts. Please wait a moment and try again.';
    if (m.includes('fetch') || m.includes('network')) return 'Network error. Check your connection and try again.';
    return msg || 'Something went wrong. Please try again.';
  }

  // ── Init ─────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    // Backdrop click
    $('modal-backdrop')?.addEventListener('click', e => {
      if (e.target === $('modal-backdrop')) closeModal();
    });

    // Escape key
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
    });

    // Enter key in fields
    ['modal-inp-name', 'modal-inp-email', 'modal-inp-pwd', 'modal-inp-confirm'].forEach(id => {
      $(id)?.addEventListener('keydown', e => {
        if (e.key === 'Enter') handleModalSubmit();
      });
    });

    // Password recovery in URL
    if (window.location.hash.includes('type=recovery')) {
      openModal('update-password');
    }

    // Supabase auth state
    sb().auth.onAuthStateChange((event, session) => {
      updateNavForAuth(session?.user || null);
    });
  });

  // ── Public ───────────────────────────────────────────────
  window.getUser = () => currentUser;
  window.isAuthed = () => !!currentUser;

})();
