const api = {
  async createLobby(formData) {
    const payload = Object.fromEntries(formData.entries());
    payload.isPrivate = formData.get('isPrivate') === 'on';
    return request('/api/create-lobby', payload);
  },
  async joinLobby(formData) {
    const payload = Object.fromEntries(formData.entries());
    if (!payload.lobbyId) delete payload.lobbyId;
    if (!payload.code) delete payload.code;
    return request('/api/join', payload);
  },
  async listLobbies() {
    const res = await fetch('/api/lobbies');
    return res.json();
  },
  async startGame() {
    return request('/api/start', credentials());
  },
  async submitClue(clue) {
    const data = credentials();
    data.clue = clue;
    return request('/api/submit-clue', data);
  },
  async vote(target) {
    const data = credentials();
    data.target = target;
    return request('/api/vote', data);
  },
  async impostorGuess(guess) {
    const data = credentials();
    data.guess = guess;
    return request('/api/impostor-guess', data);
  },
  async sendChat(message) {
    const data = credentials();
    data.message = message;
    return request('/api/chat', data);
  },
  async leave() {
    return request('/api/leave', credentials());
  },
};

const state = {
  lobbyId: null,
  playerId: null,
  token: null,
  eventSource: null,
  view: null,
};

const elements = {
  lobbyPanel: document.getElementById('lobby-panel'),
  gamePanel: document.getElementById('game-panel'),
  createForm: document.getElementById('create-form'),
  joinForm: document.getElementById('join-form'),
  publicList: document.getElementById('public-lobbies'),
  leaveBtn: document.getElementById('leave-btn'),
  lobbyName: document.getElementById('lobby-name'),
  lobbyCode: document.getElementById('lobby-code'),
  youInfo: document.getElementById('you-info'),
  playersList: document.getElementById('players-list'),
  startBtn: document.getElementById('start-btn'),
  status: document.getElementById('status'),
  wordDisplay: document.getElementById('word-display'),
  turnInfo: document.getElementById('turn-info'),
  clueSection: document.getElementById('clue-section'),
  clueForm: document.getElementById('clue-form'),
  cluesSection: document.getElementById('clues-list'),
  cluesList: document.getElementById('clues'),
  discussion: document.getElementById('discussion'),
  discussionTimer: document.getElementById('discussion-timer'),
  voting: document.getElementById('voting'),
  votingTimer: document.getElementById('voting-timer'),
  voteForm: document.getElementById('vote-form'),
  impostorGuess: document.getElementById('impostor-guess'),
  guessTimer: document.getElementById('guess-timer'),
  guessForm: document.getElementById('guess-form'),
  endSection: document.getElementById('end-section'),
  endMessage: document.getElementById('end-message'),
  chatForm: document.getElementById('chat-form'),
  chatLog: document.getElementById('chat-log'),
};

let timerInterval = null;

function credentials() {
  return {
    lobbyId: state.lobbyId,
    playerId: state.playerId,
    token: state.token,
  };
}

async function request(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

function connectEvents() {
  if (state.eventSource) {
    state.eventSource.close();
  }
  const params = new URLSearchParams({
    lobby: state.lobbyId,
    player: state.playerId,
    token: state.token,
  });
  const es = new EventSource(`/api/events?${params.toString()}`);
  es.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleEvent(data);
  };
  es.onerror = () => {
    es.close();
    setTimeout(connectEvents, 2000);
  };
  state.eventSource = es;
}

function handleEvent(event) {
  switch (event.type) {
    case 'state':
      state.view = event.payload;
      render();
      break;
    case 'chat':
      addChatMessage(event.payload);
      break;
  }
}

function render() {
  const view = state.view;
  if (!view) return;

  elements.lobbyPanel.hidden = true;
  elements.gamePanel.hidden = false;

  elements.lobbyName.textContent = `${view.name}`;
  elements.lobbyCode.textContent = view.code ? `Kod: ${view.code}` : '';
  elements.youInfo.textContent = `${view.you.name}${view.you.isHost ? ' (Host)' : ''}`;

  renderPlayers(view);
  renderStatus(view);
  renderClueSection(view);
  renderClues(view);
  renderTimers(view);
  renderVoting(view);
  renderGuess(view);
  renderEnd(view);
  renderChat(view.chat);

  elements.startBtn.disabled = !view.you.isHost || view.state !== 'waiting';
}

function renderPlayers(view) {
  elements.playersList.innerHTML = '';
  view.players.forEach((player) => {
    const li = document.createElement('li');
    if (player.isSelf) li.classList.add('self');
    li.innerHTML = `<span>${player.name}${player.isHost ? ' 👑' : ''}</span>`;
    const status = document.createElement('span');
    status.className = 'status';
    status.textContent = player.alive ? 'aktywny' : 'wyeliminowany';
    li.appendChild(status);
    elements.playersList.appendChild(li);
  });
}

function renderStatus(view) {
  let text = '';
  switch (view.state) {
    case 'waiting':
      text = 'Oczekiwanie na rozpoczęcie gry.';
      break;
    case 'clues':
      if (view.round.currentPlayer === state.playerId) {
        text = 'Twoja kolej na wpisanie wskazówki!';
      } else {
        const player = view.players.find((p) => p.id === view.round.currentPlayer);
        text = player ? `Czekamy na wskazówkę od ${player.name}.` : 'Czekamy na wskazówkę.';
      }
      break;
    case 'discussion':
      text = 'Dyskusja w toku. Przekonaj innych!';
      break;
    case 'voting':
      text = 'Czas głosowania! Wybierz podejrzanego lub pomiń.';
      break;
    case 'impostor_guess':
      text = 'Impostor próbuje odgadnąć hasło!';
      break;
    case 'ended':
      text = 'Gra zakończona.';
      break;
  }
  const you = view.players.find((p) => p.isSelf);
  if (you && !you.alive && view.state !== 'waiting' && view.state !== 'ended') {
    text += ' Zostałeś wyeliminowany.';
  }
  elements.status.textContent = text;
}

function renderClueSection(view) {
  const round = view.round;
  if (!round) {
    elements.clueSection.hidden = true;
    return;
  }
  const word = round.word;
  const isImpostor = view.players.find((p) => p.id === state.playerId)?.isImpostor;
  const alive = view.players.find((p) => p.id === state.playerId)?.alive;

  const showCard = !!round && alive;
  const isYourTurn = view.state === 'clues' && round.currentPlayer === state.playerId && alive;
  elements.clueSection.hidden = !showCard;
  elements.wordDisplay.textContent = word ? word : 'Jesteś Impostorem! Brak hasła.';
  elements.turnInfo.textContent = isImpostor
    ? 'Spróbuj wtopić się w tłum.'
    : isYourTurn
    ? 'Podaj słowo powiązane z hasłem.'
    : 'Oczekuj na swoją kolej.';
  elements.clueForm.hidden = !isYourTurn;
}

function renderClues(view) {
  const round = view.round;
  if (!round || round.clues.length === 0) {
    elements.cluesSection.hidden = true;
    elements.cluesList.innerHTML = '';
    return;
  }
  elements.cluesSection.hidden = false;
  elements.cluesList.innerHTML = '';
  round.clues.forEach((entry, index) => {
    const player = view.players.find((p) => p.id === entry.playerId);
    const li = document.createElement('li');
    li.innerHTML = `<span>${index + 1}. ${player ? player.name : 'Gracz'}</span><span>${entry.clue}</span>`;
    elements.cluesList.appendChild(li);
  });
}

function renderTimers(view) {
  clearInterval(timerInterval);
  const discussionEndsAt = view.round?.discussionEndsAt;
  const votingEndsAt = view.round?.votingEndsAt;
  const guessEndsAt = view.round?.impostorGuessEndsAt;

  elements.discussion.hidden = !(view.state === 'discussion');
  elements.voting.hidden = !(view.state === 'voting');
  elements.impostorGuess.hidden = !(view.state === 'impostor_guess' && view.round?.canGuess);

  const hasTimers = discussionEndsAt || votingEndsAt || guessEndsAt;
  updateTimers();
  if (hasTimers) {
    timerInterval = setInterval(updateTimers, 1000);
  } else {
    timerInterval = null;
  }

  function updateTimers() {
    if (discussionEndsAt) {
      const remaining = Math.max(0, Math.ceil((discussionEndsAt - Date.now()) / 1000));
      elements.discussionTimer.textContent = remaining;
    }
    if (votingEndsAt) {
      const remaining = Math.max(0, Math.ceil((votingEndsAt - Date.now()) / 1000));
      elements.votingTimer.textContent = remaining;
    }
    if (guessEndsAt) {
      const remaining = Math.max(0, Math.ceil((guessEndsAt - Date.now()) / 1000));
      elements.guessTimer.textContent = remaining;
    }
  }
}

function renderVoting(view) {
  if (view.state !== 'voting') {
    elements.voting.hidden = true;
    return;
  }
  elements.voting.hidden = false;
  const select = elements.voteForm.querySelector('select');
  select.innerHTML = '';
  const skipOption = document.createElement('option');
  skipOption.value = 'skip';
  skipOption.textContent = 'Pomiń głos';
  select.appendChild(skipOption);
  view.players
    .filter((p) => p.alive)
    .forEach((player) => {
      const option = document.createElement('option');
      option.value = player.id;
      option.textContent = player.name;
      select.appendChild(option);
    });
  const you = view.players.find((p) => p.isSelf);
  const voted = you?.vote;
  elements.voteForm.querySelector('button').disabled = !!voted;
  select.disabled = !!voted;
}

function renderGuess(view) {
  if (!(view.state === 'impostor_guess' && view.round?.canGuess)) {
    elements.impostorGuess.hidden = true;
    return;
  }
  elements.impostorGuess.hidden = false;
}

function renderEnd(view) {
  if (view.state !== 'ended') {
    elements.endSection.hidden = true;
    return;
  }
  elements.endSection.hidden = false;
  const winner = view.round?.winner;
  elements.endMessage.textContent =
    winner === 'impostor'
      ? 'Impostor odniósł zwycięstwo!'
      : winner === 'crewmates'
      ? 'Załoga wygrała!'
      : 'Gra dobiegła końca.';
}

function renderChat(messages) {
  elements.chatLog.innerHTML = '';
  messages.forEach(addChatMessage);
  const enabled = ['discussion', 'waiting'].includes(state.view?.state);
  elements.chatForm.querySelector('input').disabled = !enabled;
  elements.chatForm.querySelector('button').disabled = !enabled;
}

function addChatMessage(entry) {
  const div = document.createElement('div');
  div.className = 'chat-message';
  const time = new Date(entry.timestamp);
  const timestamp = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  div.innerHTML = `<strong>${entry.name}</strong><span>${timestamp}</span><p>${entry.message}</p>`;
  elements.chatLog.appendChild(div);
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
}

async function refreshLobbyList() {
  try {
    const data = await api.listLobbies();
    elements.publicList.innerHTML = '';
    data.lobbies
      .sort((a, b) => a.createdAt - b.createdAt)
      .forEach((lobby) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${lobby.name}</span><span>${lobby.players} graczy</span>`;
        li.addEventListener('click', () => quickJoin(lobby.id));
        elements.publicList.appendChild(li);
      });
  } catch (error) {
    console.error(error);
  }
}

async function quickJoin(lobbyId) {
  const playerName = prompt('Twoja nazwa gracza');
  if (!playerName) return;
  const data = await request('/api/join', { lobbyId, playerName });
  if (data.error) {
    alert(data.error);
    return;
  }
  joinSuccess(data);
}

function joinSuccess(data) {
  state.lobbyId = data.lobbyId;
  state.playerId = data.playerId;
  state.token = data.token;
  connectEvents();
}

function resetState() {
  if (state.lobbyId) {
    api.leave().catch(() => {});
  }
  state.lobbyId = null;
  state.playerId = null;
  state.token = null;
  state.view = null;
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  elements.gamePanel.hidden = true;
  elements.lobbyPanel.hidden = false;
}

elements.createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = await api.createLobby(new FormData(event.target));
  if (data.error) {
    alert(data.error);
    return;
  }
  joinSuccess(data);
});

elements.joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = await api.joinLobby(new FormData(event.target));
  if (data.error) {
    alert(data.error);
    return;
  }
  joinSuccess(data);
});

elements.startBtn.addEventListener('click', async () => {
  const res = await api.startGame();
  if (res.error) alert(res.error);
});

elements.clueForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const clue = event.target.clue.value.trim();
  if (!clue) return;
  const res = await api.submitClue(clue);
  if (res.error) alert(res.error);
});

elements.voteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const target = event.target.target.value;
  const res = await api.vote(target);
  if (res.error) alert(res.error);
});

elements.guessForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const guess = event.target.guess.value.trim();
  if (!guess) return;
  const res = await api.impostorGuess(guess);
  if (res.error) alert(res.error);
});

elements.chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = event.target.message.value.trim();
  if (!message) return;
  event.target.reset();
  const res = await api.sendChat(message);
  if (res.error) alert(res.error);
});

elements.leaveBtn.addEventListener('click', () => {
  if (confirm('Czy na pewno chcesz opuścić lobby?')) {
    resetState();
  }
});

window.addEventListener('beforeunload', () => {
  if (state.lobbyId) {
    navigator.sendBeacon(
      '/api/leave',
      JSON.stringify({ lobbyId: state.lobbyId, playerId: state.playerId, token: state.token })
    );
  }
});

refreshLobbyList();
setInterval(refreshLobbyList, 5000);
