(() => {
  document.addEventListener('click', (event) => {
    if (!window.accessState?.session) return;
    const button = event.target.closest('.nav-item');
    if (!button) return;
    if (button.dataset.view === 'marketplace' || button.dataset.view === 'positions') {
      document.body.classList.add('workspace-open');
      document.querySelector('.nav-item[data-view="workspace"]')?.classList.remove('active');
    }
  }, true);
})();
