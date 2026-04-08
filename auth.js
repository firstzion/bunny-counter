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

  // --- Account indicator dropdown ---
  const indicator  = document.getElementById('account-indicator');
  const dropdown   = document.getElementById('account-dropdown');
  const signOutBtn = document.getElementById('btn-sign-out');

  indicator.addEventListener('click', e => {
    e.stopPropagation();
    dropdown.hidden = !dropdown.hidden;
  });

  signOutBtn.addEventListener('click', async () => {
    dropdown.hidden = true;
    await signOut();
  });

  // Close dropdown on any outside tap
  document.addEventListener('click', () => {
    if (dropdown) dropdown.hidden = true;
  });
}
