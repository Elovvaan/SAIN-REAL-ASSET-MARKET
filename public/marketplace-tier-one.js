(() => {
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function askSain(prompt) {
    const input = document.querySelector('#sane-input');
    if (!input) return;
    input.value = prompt;
    input.focus();
  }

  function shortestWindow(opportunities) {
    const values = opportunities
      .map((item) => String(item.participationWindow || '').match(/\d+/))
      .filter(Boolean)
      .map((match) => Number(match[0]));
    return values.length ? `${Math.min(...values)} months` : 'Not available';
  }

  function opportunityMarkup(item) {
    return `<button class="tier-one-opportunity" data-open-opportunity="${pEsc(item.id)}">
      <div class="tier-one-opportunity-head">
        <span class="badge open">${pEsc(String(item.stage || '').replaceAll('_', ' '))}</span>
        <span aria-hidden="true">›</span>
      </div>
      <h3>${pEsc(item.title)}</h3>
      <p>${pEsc(item.assetName)} · ${pEsc(item.region)}</p>
      <div class="tier-one-opportunity-metrics">
        <span><small>Verified Value</small><strong>${money.format(Number(item.verifiedValue || 0))}</strong></span>
        <span><small>Potential Gain</small><strong class="gain-value">+${pEsc(item.projectedGainRate)}%</strong></span>
        <span><small>Window</small><strong>${pEsc(item.participationWindow)}</strong></span>
        <span><small>Status</small><strong>${pEsc(item.completionState)}</strong></span>
      </div>
      <small class="projection-note">Market signal only. Not yet realized.</small>
    </button>`;
  }

  renderSignedInMarketplace = function renderSignedInMarketplaceTierOne() {
    const root = document.querySelector('#view-root');
    const opportunities = participationState.opportunities || [];
    const totalVerified = opportunities.reduce((sum, item) => sum + Number(item.verifiedValue || 0), 0);
    const strongest = [...opportunities].sort((a, b) => Number(b.projectedGainRate || 0) - Number(a.projectedGainRate || 0))[0];

    document.body.classList.add('workspace-open');
    document.querySelector('#page-title').textContent = 'Living Marketplace';
    document.querySelector('#context-title').textContent = 'Marketplace';
    document.querySelector('#context-status').textContent = 'LIVE';

    root.innerHTML = `<section class="tier-one-marketplace">
      <section class="tier-one-market-summary" aria-label="Marketplace summary">
        <div><span>Live opportunities</span><strong>${opportunities.length}</strong></div>
        <div><span>Verified Value represented</span><strong>${money.format(totalVerified)}</strong></div>
        <div><span>Marketplace status</span><strong class="gain-value">LIVE</strong></div>
      </section>

      <section class="tier-one-signal-grid" aria-label="Daily marketplace signals">
        <article>
          <p class="eyebrow">DAILY SIGNAL</p>
          <span>Strongest current signal</span>
          <strong>${strongest ? `+${pEsc(strongest.projectedGainRate)}%` : '—'}</strong>
          <small>${strongest ? pEsc(strongest.title) : 'No current opportunity'}</small>
        </article>
        <article>
          <p class="eyebrow">ACCESS SIGNAL</p>
          <span>Shortest projected window</span>
          <strong>${shortestWindow(opportunities)}</strong>
          <small>Based on current published opportunities</small>
        </article>
        <article>
          <p class="eyebrow">VERIFIED SIGNAL</p>
          <span>Value currently represented</span>
          <strong>${money.format(totalVerified)}</strong>
          <small>Supported by published Verified Value records</small>
        </article>
      </section>

      <section class="tier-one-coin-card" aria-label="SRA Coin access">
        <div class="tier-one-coin-mark">SRA</div>
        <div>
          <p class="eyebrow">UNIVERSAL ACCOUNT ACCESS</p>
          <h2>SRA Coin</h2>
          <p>Universal users can discover the SRA Coin, understand its role in the marketplace, and begin the available access workflow when coin issuance and purchase rails are active.</p>
        </div>
        <div class="tier-one-coin-actions">
          <button class="secondary-button" id="explain-sra-coin">Explain SRA Coin</button>
          <button class="primary-button" id="review-coin-access">Review coin access</button>
        </div>
      </section>

      <section class="tier-one-live-market">
        <div class="tier-one-section-head">
          <div><p class="eyebrow">LIVE MARKET</p><h2>Opportunities</h2></div>
          <p>Open an opportunity to review its Verified Value, market signals, participation window, and available positions.</p>
        </div>
        <div class="tier-one-opportunity-grid">${opportunities.map(opportunityMarkup).join('')}</div>
      </section>
    </section>`;

    root.querySelectorAll('[data-open-opportunity]').forEach((button) => button.addEventListener('click', () => openOpportunity(button.dataset.openOpportunity)));
    document.querySelector('#explain-sra-coin')?.addEventListener('click', () => askSain('Explain the SRA Coin, its role in the Living Marketplace, and how Universal users can engage with it.'));
    document.querySelector('#review-coin-access')?.addEventListener('click', () => askSain('Show me the current SRA Coin access options available to my Universal Account. Do not represent unavailable purchase or issuance functions as active.'));
  };
})();
