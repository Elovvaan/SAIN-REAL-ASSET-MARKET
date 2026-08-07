(() => {
  if (window.__sraPublicChatRuntimeInstalled) return;
  window.__sraPublicChatRuntimeInstalled = true;

  const input = document.querySelector('#sane-input');
  const sendButton = document.querySelector('#send-message');
  const heartbeat = document.querySelector('#heartbeat-track');
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function activeView() {
    return document.querySelector('.nav-item.active')?.dataset.view || 'marketplace';
  }

  function agentScope() {
    const view = activeView();
    return {
      includeMarketplace: true,
      includeTrialBalance: view === 'activity',
      activeView: view,
    };
  }

  function append(text, type) {
    if (typeof window.appendMessage === 'function') {
      window.appendMessage(text, type);
      return;
    }
    const log = document.querySelector('#chat-log');
    if (!log) return;
    const message = document.createElement('div');
    message.className = `message ${type === 'user' ? 'user-message' : 'sane-message'}`;
    message.textContent = text;
    log.append(message);
    log.scrollTop = log.scrollHeight;
  }

  async function sendMessage(prefilled) {
    const message = String(prefilled ?? input?.value ?? '').trim();
    if (!message || !sendButton) return;
    append(message, 'user');
    if (input) input.value = '';
    sendButton.disabled = true;
    try {
      const response = await fetch('/api/sane/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, scope: agentScope() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Agent request failed.');
      append(payload.message || 'SAIN returned no message.', 'sane');
    } catch (error) {
      append(error.message || 'The SAIN agent is temporarily unavailable.', 'sane');
    } finally {
      sendButton.disabled = false;
      input?.focus();
    }
  }

  async function startHeartbeat() {
    if (!heartbeat) return;
    try {
      const response = await fetch('/api/marketplace', { cache: 'no-store' });
      if (!response.ok) return;
      const marketplace = await response.json();
      const events = Array.isArray(marketplace.activity) && marketplace.activity.length
        ? marketplace.activity.map((item) => `${item.label} · ${item.project}${item.amount ? ` · ${money.format(item.amount)}` : ''}`)
        : ['Verified Value is moving through the network…'];
      let index = 0;
      heartbeat.textContent = events[0];
      if (events.length > 1) {
        window.setInterval(() => {
          index = (index + 1) % events.length;
          heartbeat.textContent = events[index];
        }, 3500);
      }
    } catch {}
  }

  function bind() {
    sendButton?.addEventListener('click', () => void sendMessage());
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void sendMessage();
      }
    });
    document.querySelectorAll('[data-prompt]').forEach((button) => {
      if (button.dataset.publicChatBound === 'true') return;
      button.dataset.publicChatBound = 'true';
      button.addEventListener('click', () => {
        if (input) {
          input.value = button.dataset.prompt || '';
          input.focus();
        }
      });
    });
  }

  window.SRAPublicChat = { sendMessage, activeView };
  bind();
  void startHeartbeat();
})();
