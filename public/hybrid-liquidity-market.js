(() => {
  async function loadMarkets() {
    const response = await fetch('/api/sane/hybrid-liquidity/markets', { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const payload = await response.json();
    render(payload.markets || [], payload.status || {});
  }

  function render(markets, status) {
    const terminal = document.querySelector('.live-terminal');
    if (!terminal) return;
    let panel = document.querySelector('#hybrid-liquidity-market-view');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'hybrid-liquidity-market-view';
      panel.style.cssText = 'margin-top:16px;border:1px solid #243a58;border-radius:16px;background:#07111f;padding:16px;color:#eef5ff';
      terminal.insertAdjacentElement('afterend', panel);
    }
    panel.innerHTML = `<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><small style="color:#e3b73b;font-weight:800;letter-spacing:.12em">HYBRID LIQUIDITY LAYER</small><h3 style="margin:4px 0">Continuous Reference Markets</h3><p style="margin:0;color:#9eb2ca">Reference prices and event probabilities around verified SRA instruments. These are not executed trades.</p></div><strong style="color:#75aef0">${String(status.boundary || 'REFERENCE_ONLY').replaceAll('_', ' ')}</strong></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:14px">${markets.length ? markets.map(card).join('') : '<div style="color:#9eb2ca;padding:16px;border:1px dashed #2a4364;border-radius:12px">No approved reference markets yet. Administration can define one around a verified SRA instrument.</div>'}</div>`;
  }

  function card(market) {
    const mode = String(market.mode || '').replaceAll('_', ' ');
    const sources = market.indexMethodology?.referenceSources || [];
    return `<article style="border:1px solid #263f60;border-radius:12px;padding:13px;background:#091625"><div style="display:flex;justify-content:space-between;gap:8px"><strong>${market.marketIdentity || 'SRA / USD'}</strong><span style="color:#e3b73b;font-size:11px">${mode}</span></div><div style="font-size:12px;color:#9eb2ca;margin-top:8px">Underlying: ${market.underlyingInstrumentId || '—'}</div><div style="font-size:12px;color:#9eb2ca">Index: ${market.indexMethodology?.method || '—'}</div><div style="font-size:12px;color:#9eb2ca">Sources: ${sources.join(', ') || '—'}</div><div style="margin-top:10px;padding:8px;border-radius:8px;background:#050b13;color:#75aef0;font-size:11px">Execution ${market.executionState || 'DISABLED'} · Reference only</div></article>`;
  }

  const observer = new MutationObserver(() => { if (document.querySelector('.live-terminal')) void loadMarkets(); });
  window.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(loadMarkets, 1000);
  });
  window.addEventListener('sra:marketplace-refreshed', loadMarkets);
})();
