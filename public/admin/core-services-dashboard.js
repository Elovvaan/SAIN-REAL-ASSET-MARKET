(() => {
  let timer = null;

  const number = (value) => Number(value || 0).toLocaleString();
  const when = (value) => value ? new Date(value).toLocaleString() : 'Waiting';

  async function request(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Request failed.');
    return payload;
  }

  function ensurePanel() {
    const anchor = document.querySelector('#hybrid-liquidity-admin') || document.querySelector('#listing-authorization');
    if (!anchor || document.querySelector('#sra-core-services-dashboard')) return;
    anchor.insertAdjacentHTML('afterend', `<section id="sra-core-services-dashboard" style="margin-top:16px;padding:16px;border:1px solid #29452f;border-radius:14px;background:#07120a">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><h3 style="margin:0">SRA Core Services</h3><p style="margin:4px 0;color:#9ab5a0">The platform heartbeat reports what each engine sees, what moved, and what needs attention.</p></div><strong id="core-services-state" style="color:#75d18a">CHECKING</strong></div>
      <div id="core-heartbeat-summary" style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:12px 0"></div>
      <div id="core-movement-summary" style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:12px 0"></div>
      <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:12px">
        <div><h4 style="margin:0 0 8px">Engine cycle</h4><div id="core-engine-list" style="display:grid;gap:7px"></div></div>
        <div><h4 style="margin:0 0 8px">Operational explanation</h4><p id="core-services-reply" style="color:#c5d8c8"></p><div id="core-services-attention" style="display:grid;gap:6px"></div><p id="core-services-next" style="color:#9ab5a0"></p></div>
      </div>
      <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:14px"><button id="refresh-core-services">Refresh pulse</button><button id="run-core-services-cycle" class="primary">Run cycle now</button></div>
      <p id="core-services-message" style="color:#9ab5a0">Loading the latest platform cycle.</p>
    </section>`);
    document.querySelector('#refresh-core-services').addEventListener('click', load);
    document.querySelector('#run-core-services-cycle').addEventListener('click', runCycle);
  }

  function card(label, value) {
    return `<div style="padding:10px;border:1px solid #1f3925;border-radius:10px"><span style="display:block;color:#89a78f;font-size:10px">${label}</span><strong style="font-size:17px">${value}</strong></div>`;
  }

  function render(brief) {
    document.querySelector('#core-services-state').textContent = String(brief.state || 'UNKNOWN').replaceAll('_', ' ');
    const heartbeat = brief.heartbeat || {};
    document.querySelector('#core-heartbeat-summary').innerHTML = [
      ['Scheduler', heartbeat.schedulerState || 'UNKNOWN'],
      ['Cycles', number(heartbeat.cycleCount)],
      ['Completed engines', number(heartbeat.completedEngines)],
      ['Failed engines', number(heartbeat.failedEngines)],
      ['Latest cycle', when(heartbeat.completedAt)]
    ].map(([label, value]) => card(label, value)).join('');

    const movement = brief.movement || {};
    document.querySelector('#core-movement-summary').innerHTML = [
      ['Observations', number(movement.observations)],
      ['Coin Positions', number(movement.coinPositions)],
      ['Instruments', number(movement.instruments)],
      ['Live listings', number(movement.liveListings)],
      ['Prepared listings', number(movement.preparedListings)]
    ].map(([label, value]) => card(label, value)).join('');

    document.querySelector('#core-engine-list').innerHTML = (brief.engines || []).map((engine) => `<div style="padding:9px;border:1px solid ${engine.state === 'FAILED' ? '#6b2c2c' : '#1f3925'};border-radius:9px;display:flex;justify-content:space-between;gap:10px"><div><strong>${engine.name.replaceAll('_', ' ')}</strong>${engine.error ? `<div style="color:#e69b9b;font-size:11px">${engine.error}</div>` : ''}</div><span style="color:${engine.state === 'FAILED' ? '#ef8f8f' : '#75d18a'}">${engine.state}</span></div>`).join('') || '<div style="color:#89a78f">Waiting for the first completed cycle.</div>';
    document.querySelector('#core-services-reply').textContent = brief.reply || '';
    document.querySelector('#core-services-attention').innerHTML = (brief.attention || []).map((item) => `<div style="padding:8px;border-radius:8px;background:#101a12;color:#d6c995">${item}</div>`).join('') || '<div style="color:#75d18a">No core-services exception is currently reported.</div>';
    document.querySelector('#core-services-next').textContent = brief.nextAction || '';
    document.querySelector('#core-services-message').textContent = heartbeat.latestCycleId ? `Latest cycle ${heartbeat.latestCycleId}` : 'Waiting for the first cycle.';
  }

  async function load() {
    ensurePanel();
    if (!document.querySelector('#sra-core-services-dashboard')) return;
    try { render(await request('/api/sane/core-services/brief')); }
    catch (error) { document.querySelector('#core-services-message').textContent = error.message; }
  }

  async function runCycle() {
    const button = document.querySelector('#run-core-services-cycle');
    button.disabled = true;
    button.textContent = 'Running cycle...';
    try {
      const result = await request('/api/sane/core-services/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trigger: 'ADMIN_DASHBOARD' }) });
      window.append?.(`SRA Core Services cycle ${result.cycleId || ''} completed with state ${result.state || result.reason}.`, 'agent');
      await load();
    } catch (error) {
      document.querySelector('#core-services-message').textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = 'Run cycle now';
    }
  }

  const observer = new MutationObserver(() => ensurePanel());
  window.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { ensurePanel(); void load(); }, 700);
    timer = setInterval(() => { if (document.querySelector('#admin-view:not(.hidden)')) void load(); }, 15000);
    timer.unref?.();
  });
})();
