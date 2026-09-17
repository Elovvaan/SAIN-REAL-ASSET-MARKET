(() => {
  if (window.__sraAdminFinancingFilePickerInstalled) return;
  window.__sraAdminFinancingFilePickerInstalled = true;

  let sourceInput = null;
  let scrollX = 0;
  let scrollY = 0;

  const picker = document.createElement('input');
  picker.type = 'file';
  picker.hidden = true;
  picker.tabIndex = -1;
  picker.setAttribute('aria-hidden', 'true');
  picker.dataset.sraPersistentFinancingPicker = 'true';
  document.body.append(picker);

  function currentDocumentInput() {
    return document.querySelector('[data-admin-financing-evidence] input[name="documents"]');
  }

  function restoreScroll() {
    window.scrollTo({ left: scrollX, top: scrollY, behavior: 'auto' });
  }

  function copyFiles(target, files) {
    if (!target || !files?.length) return false;
    try {
      const transfer = new DataTransfer();
      [...files].forEach((file) => transfer.items.add(file));
      target.files = transfer.files;
      target.dispatchEvent(new Event('change', { bubbles: false }));
      return true;
    } catch (error) {
      console.error('Unable to preserve selected financing documents.', error);
      return false;
    }
  }

  // Legacy broad mutation broadcasts are not workflow handoffs. They used to
  // wake unrelated mounted workstations (Native Asset, Financial Records,
  // Treasury presentation, Operations Queue, and others) after an isolated
  // action completed. Keep mutations local; explicit tab/click/handoff events
  // remain available to the workflow that owns them.
  window.addEventListener('sra:admin-mutated', (event) => {
    event.stopImmediatePropagation();
  }, true);

  function containEvidencePanel(panel) {
    if (!panel || panel.dataset.sraEvidenceBoundary === 'true') return;
    panel.dataset.sraEvidenceBoundary = 'true';

    // Let the control itself finish first, then stop the event at the financing
    // panel boundary. Administration/workspace ancestors must never interpret
    // document selection, classification, attachment, retry, or continuation
    // as navigation or refresh work.
    panel.addEventListener('click', (event) => event.stopPropagation());
    panel.addEventListener('change', (event) => event.stopPropagation());
  }

  document.querySelectorAll('[data-admin-financing-evidence]').forEach(containEvidencePanel);

  const evidenceObserver = new MutationObserver((records) => {
    records.forEach((record) => {
      record.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches('[data-admin-financing-evidence]')) containEvidencePanel(node);
        node.querySelectorAll?.('[data-admin-financing-evidence]').forEach(containEvidencePanel);
      });
    });
  });
  evidenceObserver.observe(document.body, { childList: true, subtree: true });

  // The native file input is the one special case: use the persistent picker so
  // the selected FileList survives without replacing or rerendering the open
  // financing record.
  document.addEventListener('click', (event) => {
    const input = event.target?.closest?.('[data-admin-financing-evidence] input[name="documents"]');
    if (!input) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    sourceInput = input;
    scrollX = window.scrollX;
    scrollY = window.scrollY;
    picker.accept = input.accept || '';
    picker.multiple = Boolean(input.multiple);
    picker.value = '';
    picker.click();
    restoreScroll();
    requestAnimationFrame(restoreScroll);
  }, true);

  // The programmatic click on the persistent picker must never reach the shell.
  picker.addEventListener('click', (event) => event.stopImmediatePropagation());

  picker.addEventListener('change', () => {
    const files = picker.files;
    const target = sourceInput?.isConnected ? sourceInput : currentDocumentInput();
    copyFiles(target, files);
    restoreScroll();
    requestAnimationFrame(restoreScroll);
    sourceInput = null;
  });
})();
