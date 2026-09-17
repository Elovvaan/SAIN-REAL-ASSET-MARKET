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

  // Financing evidence controls belong to the open opportunity. They must not
  // bubble into administration-shell handlers, which can treat an ordinary
  // form interaction as a workspace action and rerender/reposition the panel.
  document.addEventListener('click', (event) => {
    const evidence = event.target?.closest?.('[data-admin-financing-evidence]');
    if (!evidence) return;

    const input = event.target?.closest?.('input[name="documents"]');
    if (input) {
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
      return;
    }

    // Buttons inside the evidence panel still receive their own target-level
    // handlers after capture completes, but the click cannot reach ancestors.
    event.stopPropagation();
  }, true);

  // Changing the document classification is local state only. Do not let the
  // admin shell interpret the select interaction as navigation/refresh work.
  document.addEventListener('change', (event) => {
    if (event.target?.matches?.('[data-admin-financing-evidence] select[name="documentType"]')) {
      event.stopPropagation();
    }
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
