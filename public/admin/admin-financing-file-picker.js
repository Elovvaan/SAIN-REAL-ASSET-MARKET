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

  // The programmatic click on the persistent picker must never reach the
  // administration shell. Shell-level click handlers can otherwise rerender
  // the active workspace while the operating-system file dialog is opening.
  picker.addEventListener('click', (event) => {
    event.stopImmediatePropagation();
  });

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

    // Opening the OS picker is not a navigation or workspace action. Keep the
    // financing record at the exact scroll position from which it was opened.
    restoreScroll();
    requestAnimationFrame(restoreScroll);
  }, true);

  picker.addEventListener('change', () => {
    const files = picker.files;
    const target = sourceInput?.isConnected ? sourceInput : currentDocumentInput();
    copyFiles(target, files);
    restoreScroll();
    requestAnimationFrame(restoreScroll);
    sourceInput = null;
  });
})();
