(() => {
  const PUBLIC_HOME_VERSION = 'V16';

  function isSignedOut() {
    return !window.accessState?.session;
  }

  function ensurePublicHomeAttributes() {
    document.body.dataset.publicHome = isSignedOut() ? 'active' : 'inactive';
    document.body.dataset.publicHomeVersion = PUBLIC_HOME_VERSION;
  }

  function openAccess(mode) {
    const target = mode === 'signup' ? '#access-signup' : '#access-signin';
    document.querySelector(target)?.click();
  }

  function openSaneWithPrompt(prompt) {
    document.querySelector('#open-sane')?.click();
    const input = document.querySelector('#sane-input');
    if (!input) return;
    input.value = prompt;
    input.focus();
  }

  function bindPermanentPublicFlow() {
    ensurePublicHomeAttributes();
    if (!isSignedOut()) return;

    document.querySelector('[data-public-action="signup"]')?.addEventListener('click', () => openAccess('signup'));
    document.querySelector('[data-public-action="signin"]')?.addEventListener('click', () => openAccess('signin'));
    document.querySelector('[data-public-action="ask-sane"]')?.addEventListener('click', () => {
      document.querySelector('#open-sane')?.click();
    });
    document.querySelectorAll('[data-public-prompt]').forEach((button) => {
      button.addEventListener('click', () => openSaneWithPrompt(button.dataset.publicPrompt || 'Help me understand this marketplace.'));
    });
  }

  window.SRAPublicHome = {
    version: PUBLIC_HOME_VERSION,
    refresh: bindPermanentPublicFlow
  };

  window.addEventListener('DOMContentLoaded', () => setTimeout(bindPermanentPublicFlow, 220));
  window.addEventListener('sra:access-state-changed', bindPermanentPublicFlow);
})();
