(() => {
  const accessPanel = document.getElementById('accessPanel');
  const accessMessage = document.getElementById('accessMessage');
  const consolePanel = document.getElementById('consolePanel');
  const eventList = document.getElementById('eventList');
  const emptyState = document.getElementById('emptyState');
  const status = document.getElementById('connectionStatus');
  const pauseButton = document.getElementById('pauseButton');
  const refreshButton = document.getElementById('refreshButton');
  const eventLabels = {
    console: 'CONSOLE',
    player_chat: 'CHAT',
    player_command: 'COMANDO',
  };
  const maxVisibleEvents = 300;
  let latestId = '0';
  let paused = false;
  let authorized = false;

  function setStatus(message, state) {
    status.textContent = message;
    status.dataset.state = state || '';
  }

  function showAccessError(message, showLogin) {
    accessMessage.textContent = message;
    accessPanel.hidden = false;
    consolePanel.hidden = true;
    accessPanel.querySelector('.fisco-login').hidden = !showLogin;
    pauseButton.disabled = true;
    refreshButton.disabled = true;
    authorized = false;
  }

  function addEvent(event) {
    const article = document.createElement('article');
    article.className = 'console-event';

    const metadata = document.createElement('div');
    const time = document.createElement('time');
    time.className = 'console-event-time';
    time.dateTime = event.timestamp;
    const parsedDate = new Date(event.timestamp);
    time.textContent = Number.isNaN(parsedDate.getTime())
      ? event.timestamp
      : parsedDate.toLocaleString('pt-BR');
    metadata.appendChild(time);

    if (event.player) {
      const player = document.createElement('span');
      player.className = 'console-event-player';
      player.textContent = event.player;
      metadata.appendChild(player);
    }

    const type = document.createElement('span');
    type.className = 'console-event-type';
    type.dataset.type = event.type;
    type.textContent = eventLabels[event.type] || 'EVENTO';

    const message = document.createElement('p');
    message.className = 'console-event-message';
    message.textContent = event.message;

    article.append(metadata, type, message);
    eventList.appendChild(article);
    latestId = String(event.id);
  }

  async function loadEvents(initial) {
    if (!authorized || paused || document.hidden) return;

    const url = new URL('/api/minecraft-console/events', location.origin);
    if (!initial) url.searchParams.set('afterId', latestId);

    try {
      const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
      if (response.status === 401) {
        showAccessError('Sua sessão expirou. Entre novamente para acessar o painel.', true);
        setStatus('Login necessário', 'error');
        return;
      }
      if (response.status === 403) {
        showAccessError('Sua conta Discord não está autorizada a consultar estes registros.', false);
        setStatus('Acesso não autorizado', 'error');
        return;
      }
      if (!response.ok) throw new Error(`O servidor respondeu com HTTP ${response.status}.`);

      const { events } = await response.json();
      events.forEach(addEvent);
      while (eventList.children.length > maxVisibleEvents) {
        eventList.firstElementChild.remove();
      }
      emptyState.hidden = eventList.children.length > 0;
      accessPanel.hidden = true;
      consolePanel.hidden = false;
      pauseButton.disabled = false;
      refreshButton.disabled = false;
      setStatus('Conectado · atualização automática', 'connected');
    } catch (error) {
      setStatus(error.message || 'Falha ao carregar os eventos.', 'error');
    }
  }

  async function initialize() {
    try {
      const response = await fetch('/auth/me', { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error(`O servidor respondeu com HTTP ${response.status}.`);
      const { user } = await response.json();
      if (!user) {
        showAccessError('Entre com Discord. O acesso aos registros também depende de autorização.', true);
        setStatus('Login necessário', '');
        return;
      }

      authorized = true;
      await loadEvents(true);
      window.setInterval(() => loadEvents(false), 4_000);
    } catch (error) {
      showAccessError('Não foi possível verificar o login. Tente novamente em instantes.', true);
      setStatus(error.message || 'Falha de conexão', 'error');
    }
  }

  pauseButton.addEventListener('click', () => {
    paused = !paused;
    pauseButton.textContent = paused ? 'Retomar' : 'Pausar';
    setStatus(paused ? 'Atualização pausada' : 'Conectado · atualização automática', paused ? '' : 'connected');
    if (!paused) loadEvents(false);
  });
  refreshButton.addEventListener('click', () => loadEvents(false));
  initialize();
})();
