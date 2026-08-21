(() => {
  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

  function ensureStyle() {
    if (document.querySelector('#participant-financing-style')) return;
    const style = document.createElement('style');
    style.id = 'participant-financing-style';
    style.textContent = `
      .participant-financing{display:grid;gap:18px}
      .participant-financing-hero,.participant-financing-card,.participant-financing-success{padding:22px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(255,255,255,.025)}
      .participant-financing-hero{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(260px,.75fr);gap:18px;align-items:start}
      .participant-financing-hero h2{margin:5px 0 8px}.participant-financing-hero p{margin:0;opacity:.78;line-height:1.55}
      .participant-financing-account{display:grid;gap:10px;padding:16px;border-radius:14px;background:rgba(255,255,255,.035)}
      .participant-financing-account span{font-size:12px;opacity:.68}.participant-financing-account strong{font-size:15px;word-break:break-word}
      .participant-financing-form{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}
      .participant-financing-form input,.participant-financing-form select,.participant-financing-form textarea{width:100%;box-sizing:border-box;padding:12px;border:1px solid rgba(255,255,255,.15);border-radius:11px;background:#101010;color:#fff}
      .participant-financing-form textarea{min-height:110px;resize:vertical}.participant-financing-form .wide{grid-column:1/-1}
      .participant-financing-documents{grid-column:1/-1;padding:16px;border:1px dashed rgba(215,166,42,.45);border-radius:13px;background:rgba(215,166,42,.045);display:grid;gap:8px}
      .participant-financing-documents strong{font-size:14px}.participant-financing-documents p,.participant-financing-documents small{margin:0;opacity:.72;line-height:1.45}.participant-financing-documents input{padding:10px;background:#0d0d0d}
      .participant-financing-actions{grid-column:1/-1;display:flex;align-items:center;gap:12px;flex-wrap:wrap}.participant-financing-actions button[disabled]{opacity:.55;cursor:wait}
      .participant-financing-message{font-size:13px;min-height:18px}.participant-financing-message.error{color:#ff9b9b}.participant-financing-message.success{color:#9fe4b0}
      .participant-financing-steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.participant-financing-step{padding:14px;border-radius:13px;background:rgba(255,255,255,.035)}
      .participant-financing-step span{display:block;font-size:11px;opacity:.65;margin-bottom:5px}.participant-financing-step strong{display:block;font-size:13px}.participant-financing-step p{font-size:12px;opacity:.72;line-height:1.45;margin:6px 0 0}
      .participant-financing-success{border-color:rgba(215,166,42,.4);background:rgba(215,166,42,.06)}.participant-financing-success h3{margin:4px 0 8px}.participant-financing-success-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:14px}.participant-financing-success-grid div{padding:12px;border-radius:11px;background:rgba(255,255,255,.04)}.participant-financing-success-grid span{display:block;font-size:11px;opacity:.65;margin-bottom:4px}
      @media(max-width:800px){.participant-financing-hero,.participant-financing-form,.participant-financing-steps,.participant-financing-success-grid{grid-template-columns:1fr}.participant-financing-form .wide{grid-column:auto}}
    `;
    document.head.append(style);
  }

  async function submitRequest(payload) {
    const response = await fetch('/api/funding/opportunities', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Unable to create financing request (${response.status}).`);
    return body;
  }

  async function uploadDocuments(opportunityId, files) {
    const data = new FormData();
    for (const file of files) data.append('documents', file);
    const response = await fetch(`/api/funding/opportunities/${encodeURIComponent(opportunityId)}/documents`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      body: data,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `The financing request was created, but the supporting documents could not be uploaded (${response.status}).`);
    return body;
  }

  function successMarkup(record, documentCount) {
    return `<section class="participant-financing-success" aria-live="polite">
      <p class="eyebrow">REQUEST SUBMITTED</p>
      <h3>Your financing request and supporting documents are now in SRA.</h3>
      <p>The intake package is recorded together and can move into review without exposing administrative controls in your workspace.</p>
      <div class="participant-financing-success-grid">
        <div><span>Request ID</span><strong>${esc(record.opportunityId || 'Recorded')}</strong></div>
        <div><span>Status</span><strong>${esc(record.status || 'RECEIVED')}</strong></div>
        <div><span>Requested amount</span><strong>${money.format(Number(record.requestedAmount || 0))}</strong></div>
        <div><span>Documents submitted</span><strong>${Number(documentCount || 0)}</strong></div>
      </div>
      <div class="participant-financing-actions" style="margin-top:14px"><button class="primary-button" type="button" id="participant-financing-another">Start another request</button></div>
    </section>`;
  }

  function formMarkup() {
    const session = window.accessState?.session || {};
    return `<section class="participant-financing">
      <section class="participant-financing-hero">
        <div>
          <p class="eyebrow">FINANCING</p>
          <h2>Request financing</h2>
          <p>Submit the financing request and supporting documents together. Your signed-in account is attached automatically; you do not need to select or manually enter a participant record.</p>
        </div>
        <div class="participant-financing-account">
          <span>Signed-in account</span><strong>${esc(session.displayName || session.email || 'Current account')}</strong>
          <span>Universal account</span><strong>${esc(session.universalAccountId || 'Linked automatically')}</strong>
        </div>
      </section>

      <section class="participant-financing-card">
        <div><p class="eyebrow">NEW REQUEST</p><h3>What are you looking to finance?</h3></div>
        <form id="participant-financing-form" class="participant-financing-form">
          <input name="title" placeholder="What are you financing?" required>
          <select name="opportunityType" required>
            <option value="">Financing type</option>
            <option value="BUSINESS_ACQUISITION">Business acquisition</option>
            <option value="STARTUP_BUSINESS">Startup business</option>
            <option value="LINE_OF_CREDIT">Line of credit</option>
            <option value="EQUIPMENT">Equipment</option>
            <option value="WORKING_CAPITAL">Working capital</option>
            <option value="CONSTRUCTION">Construction</option>
            <option value="PROJECT">Project</option>
            <option value="INVOICE">Invoice</option>
          </select>
          <select name="purpose" required>
            <option value="">Purpose</option>
            <option value="PURCHASE">Purchase</option>
            <option value="STARTUP_LAUNCH">Startup / launch</option>
            <option value="BUILD">Build</option>
            <option value="DEVELOP">Develop</option>
            <option value="EXPAND">Expand</option>
            <option value="WORKING_CAPITAL">Working capital</option>
            <option value="REFINANCE">Refinance</option>
          </select>
          <input name="requestedAmount" type="number" min="0.01" step="0.01" placeholder="Requested amount" required>
          <textarea class="wide" name="description" placeholder="Describe what you want financed and what the financing will accomplish."></textarea>
          <div class="participant-financing-documents">
            <strong>Supporting documents</strong>
            <p>Attach the documents that support this request now so SRA receives one complete intake package.</p>
            <input id="participant-financing-documents" name="documents" type="file" multiple required accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp,application/pdf,image/*">
            <small>Up to 10 files. Maximum 15 MB per file.</small>
          </div>
          <div class="participant-financing-actions">
            <button class="primary-button" type="submit" id="participant-financing-submit">Submit financing package</button>
            <span class="participant-financing-message" id="participant-financing-message"></span>
          </div>
        </form>
      </section>

      <section class="participant-financing-steps">
        <article class="participant-financing-step"><span>1 · REQUEST + DOCUMENTS</span><strong>Submit one complete intake package</strong><p>Your financing details, signed-in identity, Universal Account, and supporting documents enter together.</p></article>
        <article class="participant-financing-step"><span>2 · INGESTION</span><strong>SRA records and organizes the package</strong><p>The request and evidence are associated to the same financing opportunity.</p></article>
        <article class="participant-financing-step"><span>3 · REVIEW</span><strong>SRA reviews what was submitted</strong><p>If something specific is missing, a targeted follow-up can be requested instead of making documents a separate default step.</p></article>
        <article class="participant-financing-step"><span>4 · STATUS</span><strong>Track the financing lifecycle</strong><p>The participant sees their request state without seeing the administrative workstation.</p></article>
      </section>
    </section>`;
  }

  function bind(root) {
    const form = root.querySelector('#participant-financing-form');
    const submit = root.querySelector('#participant-financing-submit');
    const message = root.querySelector('#participant-financing-message');
    const documentInput = root.querySelector('#participant-financing-documents');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const files = Array.from(documentInput?.files || []);
      if (!files.length) {
        message.className = 'participant-financing-message error';
        message.textContent = 'Add at least one supporting document before submitting.';
        return;
      }
      if (files.length > 10) {
        message.className = 'participant-financing-message error';
        message.textContent = 'You can submit up to 10 documents with one financing request.';
        return;
      }
      const oversized = files.find((file) => file.size > 15 * 1024 * 1024);
      if (oversized) {
        message.className = 'participant-financing-message error';
        message.textContent = `${oversized.name} exceeds the 15 MB per-file limit.`;
        return;
      }
      const values = Object.fromEntries(new FormData(form).entries());
      const payload = {
        title: String(values.title || '').trim(),
        opportunityType: String(values.opportunityType || '').trim(),
        purpose: String(values.purpose || '').trim(),
        requestedAmount: Number(values.requestedAmount),
        currency: 'USD',
        description: String(values.description || '').trim(),
      };
      submit.disabled = true;
      submit.textContent = 'Submitting…';
      message.className = 'participant-financing-message';
      message.textContent = 'Creating the request and attaching supporting documents…';
      try {
        const record = await submitRequest(payload);
        await uploadDocuments(record.opportunityId, files);
        root.innerHTML = successMarkup(record, files.length);
        root.querySelector('#participant-financing-another')?.addEventListener('click', () => render(root));
      } catch (error) {
        submit.disabled = false;
        submit.textContent = 'Submit financing package';
        message.className = 'participant-financing-message error';
        message.textContent = error.message || 'Unable to submit the financing package.';
      }
    });
  }

  function render(root) {
    ensureStyle();
    if (!root) return;
    if (!window.accessState?.session) {
      root.innerHTML = '<section class="participant-financing-card"><h3>Sign in required</h3><p>Sign in before submitting a financing request.</p></section>';
      return;
    }
    root.innerHTML = formMarkup();
    bind(root);
  }

  window.renderParticipantFundingOperations = render;
})();