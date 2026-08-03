(() => {
  function signedIn() {
    return Boolean(window.accessState?.session);
  }

  function removePublicOnlyElements() {
    document.querySelectorAll('.public-feature-rail,.public-home-actions').forEach((element) => element.remove());
    document.querySelector('#access-actions')?.classList.remove('public-top-access-hidden');
  }

  function syncShell() {
    const workspaceButton = document.querySelector('.nav-item[data-view="workspace"]');
    if (!workspaceButton) return;

    if (signedIn()) {
      removePublicOnlyElements();
      workspaceButton.classList.remove('role-hidden');
      return;
    }

    document.body.classList.remove('workspace-open');
    workspaceButton.classList.add('role-hidden');
    workspaceButton.classList.remove('active');
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('.nav-item');
    if (!button) return;

    if (button.dataset.view === 'workspace') {
      event.preventDefault();
      event.stopImmediatePropagation();
      const opening = !document.body.classList.contains('workspace-open');
      document.body.classList.toggle('workspace-open', opening);
      document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
      button.classList.toggle('active', opening);
      document.querySelector('#context-title')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }

    if (signedIn()) {
      document.body.classList.remove('workspace-open');
      document.querySelector('.nav-item[data-view="workspace"]')?.classList.remove('active');
    }
  }, true);

  const observer = new MutationObserver(syncShell);
  window.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
    syncShell();
  });
})();
