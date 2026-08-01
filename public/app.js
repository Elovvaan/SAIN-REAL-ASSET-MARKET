const state = {
  marketplace: null,
  activeView: 'marketplace'
};

const root = document.querySelector('#view-root');
const pageTitle = document.querySelector('#page-title');
const sanePanel = document.querySelector('#sane-panel');
const chatLog = document.querySelector('#chat-log');
const saneInput = document.querySelector('#sane-input');

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0
});

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderMetrics(data) {
  const metrics = [
    ['Verified Value', money.format(data.verifiedValue), 'Across active marketplace state'],
    ['Active Projects', data.activeProjects, 'Productive work in motion'],
    ['Asset Accounts', data.participatingAssets, 'Permanent registered assets'],
    ['Open Positions', data.openPositions, 'Service and capital participation'],
    ['Completion Watch', data.completionCandidates, 'Possible SRA intervention']
  ];

  return `
    <section class="metric-grid">
      ${metrics.map(([label, value, note]) => `
        <article class="metric-card">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
          <small>${escapeHtml(note)}</small>
        </article>
      `).join('')}
    </section>
  `;
}

function renderProjectRows(projects) {
  return projects.map((project) => `
    <article class="project-row">
      <div class="project-main">
        <div class="project-title">
          <div class="project-symbol">◇</div>
          <div>
            <h3>${escapeHtml(project.title)}</h3>
            <p>${escapeHtml(project.id)} · ${escapeHtml(project.region)}</p>
          </div>
        </div>
        <div class="project-signal">
          <strong>${escapeHtml(project.signal)}</strong>
          <span>productive signal</span>
        </div>
      </div>
      <div class="progress-wrap">
        <div class="progress-labels">
          <span>Project progress</span>
          <span>${project.progress}%</span>
        </div>
        <div class="progress-track"><div class="progress-bar" style="width:${project.progress}%"></div></div>
      </div>
      <div class="project-meta">
        <span class="badge open">${escapeHtml(project.status)}</span>
        <span class="badge">${escapeHtml(project.stage)}</span>
        <span class="badge">Verified ${money.format(project.verifiedValue)}</span>
        <span class="badge">Pool ${project.fundingProgress}%</span>
      </div>
    </article>
  `).join('');
}

function renderActivity(items) {
  return items.map((item) => `
    <div class="activity-item">
      <span class="activity-time">${escapeHtml(item.time)}</span>
      <div>
        <strong>${escapeHtml(item.label)}</strong>
        <span>${escapeHtml(item.project)}</span>
      </div>
    </div>
  `).join('');
}

function renderAssets(assets) {
  return assets.map((asset) => `
    <div class="asset-row">
      <div>
        <strong>${escapeHtml(asset.name)}</strong>
        <p>${escapeHtml(asset.id)} · ${escapeHtml(asset.type)} · ${asset.lifecycleEvents} lifecycle events</p>
      </div>
      <div class="asset-state">
        <strong>${escapeHtml(asset.state)}</strong>
        <span>${escapeHtml(asset.valueSignal)}</span>
      </div>
    </div>
  `).join('');
}

function renderMarketplace() {
  const data = state.marketplace;
  pageTitle.textContent = 'Marketplace';
  root.innerHTML = `
    ${renderMetrics(data)}
    <section class="content-grid">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Productive Opportunities</h2>
            <p>Live projects organized through Verified Value.</p>
          </div>
          <span class="badge open">${escapeHtml(data.marketStatus)}</span>
        </div>
        <div class="project-list">${renderProjectRows(data.projects)}</div>
      </div>
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Market Activity</h2>
            <p>The marketplace moving in real time.</p>
          </div>
        </div>
        <div class="activity-list">${renderActivity(data.activity)}</div>
      </div>
    </section>
  `;
}

function renderAssetsView() {
  pageTitle.textContent = 'Asset Accounts';
  root.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Permanent Asset Accounts</h2>
          <p>Identity, lifecycle, operating state, and Verified Value history.</p>
        </div>
      </div>
      <div class="asset-list">${renderAssets(state.marketplace.assets)}</div>
    </section>
  `;
}

function renderProjectsView() {
  pageTitle.textContent = 'Projects';
  root.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Active Project Workspaces</h2>
          <p>Schedules, roles, milestones, pools, and completion pathways.</p>
        </div>
      </div>
      <div class="project-list">${renderProjectRows(state.marketplace.projects)}</div>
    </section>
  `;
}

function renderPlaceholder(title, description) {
  pageTitle.textContent = title;
  root.innerHTML = `
    <section class="empty-view">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(description)}</p>
      <button class="primary-button" id="placeholder-sane">Shape this with Sane</button>
    </section>
  `;
  document.querySelector('#placeholder-sane')?.addEventListener('click', openSane);
}

function renderActiveView() {
  const views = {
    marketplace: renderMarketplace,
    assets: renderAssetsView,
    projects: renderProjectsView,
    participants: () => renderPlaceholder('Participants', 'One identity, multiple hats, and project-specific participation context.'),
    pools: () => renderPlaceholder('Market Pools', 'Capital, materials, and productive capacity organized around real projects.'),
    activity: () => renderPlaceholder('Life Record', 'The permanent economic biography of every productive asset in SRA.')
  };

  (views[state.activeView] || renderMarketplace)();
}

function openSane() {
  sanePanel.classList.add('open');
  saneInput.focus();
}

function closeSane() {
  sanePanel.classList.remove('open');
}

function appendMessage(text, type) {
  const message = document.createElement('div');
  message.className = `message ${type === 'user' ? 'user-message' : 'sane-message'}`;
  message.textContent = text;
  chatLog.append(message);
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function sendMessage(prefilled) {
  const message = (prefilled ?? saneInput.value).trim();
  if (!message) return;

  appendMessage(message, 'user');
  saneInput.value = '';

  try {
    const response = await fetch('/api/sane/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });

    if (!response.ok) throw new Error('Sane could not respond.');
    const payload = await response.json();
    appendMessage(payload.reply, 'sane');
  } catch (error) {
    appendMessage('The conversational service is temporarily unavailable, but the marketplace remains active.', 'sane');
  }
}

document.querySelectorAll('.nav-item').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    state.activeView = button.dataset.view;
    renderActiveView();
  });
});

document.querySelector('#open-sane').addEventListener('click', openSane);
document.querySelector('#close-sane').addEventListener('click', closeSane);
document.querySelector('#send-message').addEventListener('click', () => sendMessage());
saneInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', () => sendMessage(button.dataset.prompt));
});

async function initialize() {
  try {
    const response = await fetch('/api/marketplace');
    if (!response.ok) throw new Error('Marketplace unavailable');
    state.marketplace = await response.json();
    renderActiveView();
  } catch (error) {
    root.innerHTML = '<div class="empty-view"><h2>SRA could not load</h2><p>Check the Railway service and API health endpoint.</p></div>';
  }
}

initialize();
