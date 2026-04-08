'use strict';

// ===== Auth State =====
let currentUser = null;

const SKIP_AUTH_KEY = 'bunny-skip-auth';

// ===== Init =====
// Sets up onAuthStateChange listener and routes to the right screen.
// onReady is called once when a valid session is established (on load or after magic link).
function initAuth(onReady) {
  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    currentUser = session?.user ?? null;
    updateAccountIndicator();

    if (event === 'INITIAL_SESSION') {
      if (currentUser) {
        hideLoginOverlay();
        localStorage.removeItem(SKIP_AUTH_KEY);
        await onReady?.();
      } else {
        // Only show the login overlay if the user hasn't dismissed it before
        if (!localStorage.getItem(SKIP_AUTH_KEY)) {
          showLoginOverlay();
        }
        updateSignInFooterBtn();
      }
    } else if (event === 'SIGNED_IN') {
      hideLoginOverlay();
      localStorage.removeItem(SKIP_AUTH_KEY);
      updateSignInFooterBtn();
      await onReady?.();
    } else if (event === 'SIGNED_OUT') {
      showLoginOverlay();
      updateSignInFooterBtn();
    }
  });
}

// ===== Magic Link =====
async function sendMagicLink(email) {
  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
  return error;
}

// ===== Sign Out =====
async function signOut() {
  await supabaseClient.auth.signOut();
}

// ===== Login Overlay =====
function showLoginOverlay() {
  document.getElementById('overlay-login').classList.remove('hidden');
}

function hideLoginOverlay() {
  document.getElementById('overlay-login').classList.add('hidden');
}

// ===== Account Indicator =====
function updateAccountIndicator() {
  const indicator = document.getElementById('account-indicator');
  const emailEl   = document.getElementById('account-email');
  if (!indicator) return;

  if (currentUser) {
    indicator.hidden = false;
    const email = currentUser.email || '';
    emailEl.textContent = email.length > 22 ? email.slice(0, 20) + '…' : email;
  } else {
    indicator.hidden = true;
  }
}

function updateSignInFooterBtn() {
  const btn = document.getElementById('btn-sign-in-footer');
  if (!btn) return;
  // Show "Sign In" in footer only when skipped AND not authenticated
  btn.hidden = !(!currentUser && localStorage.getItem(SKIP_AUTH_KEY));
}

// ===== Legal Documents =====
let _legalPrivacy = null;
let _legalTerms   = null;

function parseRtfToMarkdown(rtf) {
  // Content starts after the last \cf0 control word
  const startMarker = '\\cf0 ';
  const idx = rtf.lastIndexOf(startMarker);
  if (idx === -1) return rtf;
  let text = rtf.slice(idx + startMarker.length);
  text = text.replace(/\s*\}$/, '');   // remove trailing RTF closing brace
  text = text.replace(/\\\n/g, '\n');  // RTF hard line breaks → real newlines
  return text.trim();
}

async function loadLegalContent() {
  if (_legalPrivacy !== null) return; // already loaded
  try {
    const [pr, tr] = await Promise.all([
      fetch('./privacy-policy.rtf').then(r => r.text()),
      fetch('./terms-of-service.rtf').then(r => r.text()),
    ]);
    _legalPrivacy = parseRtfToMarkdown(pr);
    _legalTerms   = parseRtfToMarkdown(tr);
  } catch {
    _legalPrivacy = '# Privacy Policy\n\nFailed to load content. Please try again.';
    _legalTerms   = '# Terms & Conditions\n\nFailed to load content. Please try again.';
  }
}

function renderMarkdown(text) {
  if (typeof marked !== 'undefined') return marked.parse(text);
  // Plain-text fallback if marked.js didn't load
  return '<pre style="white-space:pre-wrap;font-family:inherit">' +
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>';
}

function showLegalModal(initialTab) {
  document.getElementById('modal-legal').classList.remove('hidden');
  loadLegalContent().then(() => switchLegalTab(initialTab || 'privacy'));
}

function hideLegalModal() {
  document.getElementById('modal-legal').classList.add('hidden');
}

function switchLegalTab(tab) {
  const content = tab === 'terms' ? _legalTerms : _legalPrivacy;
  const el = document.getElementById('legal-content');
  el.innerHTML = renderMarkdown(content || '');
  el.scrollTop = 0;
  document.querySelectorAll('.modal-tab').forEach(btn => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
}

// ===== Delete Account =====
async function deleteAccount() {
  if (!currentUser) return;
  // showConfirm is defined in app.js (same global scope)
  showConfirm(
    'Delete My Account?',
    'This will permanently delete all your walks, sightings, and account data. This cannot be undone.',
    'Permanently Delete',
    async () => {
      try {
        // RPC deletes sightings, walks, and the auth.users record
        const { error } = await supabaseClient.rpc('delete_user');
        if (error) throw error;

        // Wipe all local state
        localStorage.clear();

        // Clear session state (best-effort — user record is already gone)
        try { await supabaseClient.auth.signOut(); } catch { /* ignore */ }

      } catch (err) {
        console.error('[auth] delete account failed:', err);
        if (typeof showInfo === 'function') {
          showInfo(
            'Deletion Failed',
            'Something went wrong deleting your account. Please try again or contact us at ' +
            '<a href="mailto:thefirstzion@gmail.com">thefirstzion@gmail.com</a>.'
          );
        }
      }
    }
  );
}

// ===== Wire up login form and account controls =====
function setupAuthUI() {
  // --- Login form ---
  const emailInput = document.getElementById('login-email');
  const sendBtn    = document.getElementById('btn-send-magic-link');
  const loginForm  = document.getElementById('login-form');
  const sentMsg    = document.getElementById('login-sent-msg');
  const errMsg     = document.getElementById('login-error-msg');

  sendBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    if (!email || !email.includes('@')) {
      errMsg.textContent = 'Please enter a valid email address.';
      errMsg.hidden = false;
      return;
    }
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';
    errMsg.hidden = true;

    const error = await sendMagicLink(email);
    if (error) {
      errMsg.textContent = error.message || 'Something went wrong. Please try again.';
      errMsg.hidden = false;
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send Magic Link';
    } else {
      loginForm.hidden = true;
      sentMsg.hidden = false;
    }
  });

  emailInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendBtn.click();
  });

  // "Continue without signing in" — persist skip preference
  document.getElementById('btn-continue-without-signin').addEventListener('click', () => {
    localStorage.setItem(SKIP_AUTH_KEY, '1');
    hideLoginOverlay();
    updateSignInFooterBtn();
  });

  // Footer "Sign In" button — re-shows the overlay
  document.getElementById('btn-sign-in-footer').addEventListener('click', () => {
    showLoginOverlay();
  });

  // Privacy & Terms from login screen (accessible before auth)
  document.getElementById('btn-privacy-terms-login').addEventListener('click', () => {
    showLegalModal('privacy');
  });

  // --- Account indicator dropdown ---
  const indicator  = document.getElementById('account-indicator');
  const dropdown   = document.getElementById('account-dropdown');
  const signOutBtn = document.getElementById('btn-sign-out');

  indicator.addEventListener('click', e => {
    e.stopPropagation();
    dropdown.hidden = !dropdown.hidden;
  });

  // Privacy & Terms from account dropdown
  document.getElementById('btn-privacy-terms').addEventListener('click', () => {
    dropdown.hidden = true;
    showLegalModal('privacy');
  });

  // Delete My Account from account dropdown
  document.getElementById('btn-delete-account').addEventListener('click', () => {
    dropdown.hidden = true;
    deleteAccount();
  });

  signOutBtn.addEventListener('click', async () => {
    dropdown.hidden = true;
    await signOut();
  });

  // Close dropdown on any outside tap
  document.addEventListener('click', () => {
    if (dropdown) dropdown.hidden = true;
  });

  // --- Legal modal ---
  document.getElementById('btn-legal-close').addEventListener('click', hideLegalModal);
  document.getElementById('tab-privacy').addEventListener('click', () => switchLegalTab('privacy'));
  document.getElementById('tab-terms').addEventListener('click', () => switchLegalTab('terms'));
  document.getElementById('modal-legal').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-legal')) hideLegalModal();
  });
}
