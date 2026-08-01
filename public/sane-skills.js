(() => {
  const originalFetch = window.fetch.bind(window);

  function renderSkillTrace(payload) {
    if (!Array.isArray(payload?.executionPlan) || !payload.executionPlan.length) return;
    const chatLog = document.querySelector('#chat-log');
    if (!chatLog) return;
    const trace = document.createElement('div');
    trace.className = 'message sane-skill-trace';
    const skills = payload.executionPlan
      .map((step) => `<span class="sane-skill-chip"><small>${step.order}</small>${String(step.skillLabel).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}</span>`)
      .join('');
    trace.innerHTML = `<div class="sane-skill-trace-head"><strong>Sane skill plan</strong><span>${String(payload.operatingTier || 'UNIVERSAL').replaceAll('_',' ')}</span></div><div class="sane-skill-chip-row">${skills}</div>`;
    chatLog.append(trace);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const target = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    if (target.includes('/api/sane/message')) {
      response.clone().json().then(renderSkillTrace).catch(() => {});
    }
    return response;
  };
})();
