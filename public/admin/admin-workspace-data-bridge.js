(() => {
  if (window.__sraAdminWorkspaceDataBridgeInstalled) return;
  window.__sraAdminWorkspaceDataBridgeInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  const WORKSPACE_RECORD_LIMIT = 100;

  function enrichWorkspacePayload(payload) {
    const records = payload?.records;
    if (!records || typeof records !== 'object') return payload;

    const existingInstructions = Array.isArray(records.settlementInstructions) ? records.settlementInstructions : [];
    const treasuryInstructions = (Array.isArray(records.transactions) ? records.transactions : [])
      .filter((record) => String(record?.transactionType || '').toUpperCase() === 'EXTERNAL_TRANSFER_INSTRUCTION')
      .map((record) => ({
        ...record,
        instructionId: record.instructionId || record.transferInstructionId || record.transactionId,
        amount: record.amount ?? record.amountUsd ?? record.quantity,
        receivingAccountReference: record.receivingAccountReference || record.destinationReference || null,
      }));

    if (treasuryInstructions.length) {
      const seen = new Set(existingInstructions.map((record) => record.instructionId || record.transferInstructionId || record.transactionId).filter(Boolean));
      records.settlementInstructions = [
        ...existingInstructions,
        ...treasuryInstructions.filter((record) => {
          const key = record.instructionId || record.transferInstructionId || record.transactionId;
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      ];
    }

    return payload;
  }

  window.fetch = async function sraAdminWorkspaceFetch(input, init) {
    let workspaceRequest = false;
    try {
      const raw = typeof input === 'string' ? input : input?.url;
      if (raw) {
        const url = new URL(raw, window.location.origin);
        if (url.pathname === '/api/admin/workspaces') {
          workspaceRequest = true;
          const requested = Number(url.searchParams.get('limit') || 0);
          if (!requested || requested > WORKSPACE_RECORD_LIMIT) {
            url.searchParams.set('limit', String(WORKSPACE_RECORD_LIMIT));
          }
          const rewritten = raw.startsWith('http') ? url.toString() : `${url.pathname}${url.search}`;
          input = typeof input === 'string' ? rewritten : new Request(rewritten, input);
        }
      }
    } catch (error) {
      console.warn('SAIN workspace data bridge could not normalize the request.', error);
    }

    const response = await nativeFetch(input, init);
    if (!workspaceRequest || !response.ok) return response;

    try {
      const payload = enrichWorkspacePayload(await response.clone().json());
      const headers = new Headers(response.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');
      headers.set('content-type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(payload), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      console.warn('SAIN workspace data bridge could not enrich settlement records.', error);
      return response;
    }
  };

  const style = document.createElement('style');
  style.id = 'sra-admin-workspace-data-bridge-style';
  style.textContent = `
    .admin-workspace-controls .metric { display: none !important; }
    .admin-workspace-controls:empty { display: none; }
  `;
  document.head.append(style);
})();