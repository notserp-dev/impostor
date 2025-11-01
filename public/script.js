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
  noLobbies: document.getElementById('no-lobbies'),
  leaveBtn: document.getElementById('leave-btn'),
  lobbyName: document.getElementById('lobby-name'),
  lobbyCode: document.getElementById('lobby-code'),
  youInfo: document.getElementById('you-info'),
  playersList: document.getElementById('players-list'),
  startBtn: document.getElementById('start-btn'),
  phaseBanner: document.getElementById('status'),
  phaseTitle: document.getElementById('phase-title'),
  phaseSubtitle: document.getElementById('phase-subtitle'),
  phaseInstructions: document.getElementById('phase-instructions'),
  wordDisplay: document.getElementById('word-display'),
  wordHint: document.getElementById('word-hint'),
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
  roleChip: document.getElementById('role-chip'),
  roleLabel: document.getElementById('role-label'),
  roleHint: document.getElementById('role-hint'),
  roundChip: document.getElementById('round-chip'),
  roundCounter: document.getElementById('round-counter'),
  phaseSteps: Array.from(document.querySelectorAll('#phase-track .phase-step')),
};

const PHASE_SEQUENCE = ['waiting', 'clues', 'discussion', 'voting', 'impostor_guess', 'ended'];

const PHASE_COPY = {
  waiting: (view) => {
    const you = view.you;
    const total = view.players.length;
    const missing = Math.max(0, 3 - total);
    return {
      title: 'Oczekiwanie w lobby',
      subtitle: you.isHost
        ? total >= 3
          ? 'Kliknij „Rozpocznij grę”, gdy każdy jest gotowy.'
          : `Potrzebujesz jeszcze ${missing} graczy, aby rozpocząć.`
        : 'Host decyduje, kiedy zaczynamy. W międzyczasie zaproś znajomych.',
      tip: view.code
        ? `Udostępnij kod ${view.code}, by inni mogli dołączyć.`
        : 'Każdy z listy publicznej może dołączyć do Twojego lobby.',
    };
  },
  clues: (view) => {
    const you = view.players.find((p) => p.isSelf) || view.you;
    const isImpostor = Boolean(you?.isImpostor);
    const yourTurn = view.round?.currentPlayer === state.playerId && you?.alive;
    if (!you?.alive) {
      return {
        title: 'Obserwuj wskazówki',
        subtitle: 'Zostałeś wyeliminowany — kibicuj ekipie i analizuj skojarzenia.',
        tip: 'Nie zdradzaj tajnego hasła innym graczom.',
      };
    }
    if (isImpostor) {
      return {
        title: 'Blefuj jak impostor',
        subtitle: yourTurn
          ? 'Wymyśl skojarzenie, które nie zdradzi, że nie znasz hasła.'
          : 'Śledź wpisy załogi i przygotuj wiarygodną odpowiedź.',
        tip: 'Inspiruj się cudzymi słowami, ale unikaj zbyt ogólnych lub identycznych odpowiedzi.',
      };
    }
    return {
      title: 'Czas na skojarzenia',
      subtitle: yourTurn
        ? 'Podaj krótkie słowo związane z hasłem, nie zdradzając go wprost.'
        : 'Czytaj uważnie odpowiedzi, aby później wypatrzyć impostora.',
      tip: 'Unikaj powtórzeń i zbyt oczywistych podpowiedzi — impostor też czyta.',
    };
  },
  discussion: (view) => {
    const you = view.players.find((p) => p.isSelf) || view.you;
    return {
      title: 'Czas dyskusji',
      subtitle: you?.alive
        ? 'Porównaj skojarzenia, zadawaj pytania i szukaj nieścisłości.'
        : 'Jesteś poza grą — obserwuj, jak reszta analizuje wskazówki.',
      tip: 'Czat tekstowy jest włączony tylko w tej fazie, więc wykorzystaj go maksymalnie.',
    };
  },
  voting: (view) => {
    const you = view.players.find((p) => p.isSelf) || view.you;
    const voted = you?.vote;
    return {
      title: 'Głosowanie',
      subtitle: you?.alive
        ? voted
          ? 'Oddałeś głos. Poczekaj, aż pozostali zakończą decyzję.'
          : 'Wskaż podejrzanego lub pomiń, jeśli nie masz pewności.'
        : 'Nie żyjesz — obserwuj, kogo wybiorą inni.',
      tip: 'Jeśli głosy się podzielą, rozpocznie się kolejna runda z nowym hasłem.',
    };
  },
  impostor_guess: (view) => {
    const you = view.players.find((p) => p.isSelf) || view.you;
    const isImpostor = Boolean(you?.isImpostor);
    return {
      title: 'Ostatnia szansa',
      subtitle: isImpostor
        ? 'Masz jedną próbę, by odgadnąć sekretne hasło.'
        : 'Załoga czeka, czy impostorowi uda się odgadnąć hasło.',
      tip: isImpostor
        ? 'Wykorzystaj skojarzenia innych, aby jak najlepiej strzelić.'
        : 'Jeśli impostor trafi, mimo eliminacji wygra tę partię.',
    };
  },
  ended: (view) => {
    const winner = view.round?.winner;
    return {
      title: 'Gra zakończona',
      subtitle:
        winner === 'impostor'
          ? 'Impostor triumfuje! Zagrajcie jeszcze raz, aby się odegrać.'
          : winner === 'crewmates'
          ? 'Załoga zwyciężyła! Spróbujcie kolejnego hasła.'
          : 'Runda dobiegła końca. Możesz rozpocząć kolejną grę.',
      tip: 'Host może uruchomić nową rundę przyciskiem „Rozpocznij grę”.',
    };
  },
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

  renderHeader(view);
  renderPhaseTrack(view);
  renderPhaseCopy(view);
  renderPlayers(view);
  renderClueSection(view);
  renderClues(view);
  renderTimers(view);
  renderVoting(view);
  renderGuess(view);
  renderEnd(view);
  renderChat(view.chat);

  elements.startBtn.disabled = !view.you.isHost || (view.state !== 'waiting' && view.state !== 'ended');
}

function renderHeader(view) {
  elements.lobbyName.textContent = view.name;
  elements.lobbyCode.textContent = view.code ? `Kod prywatny: ${view.code}` : `ID lobby: ${view.lobbyId}`;
  elements.youInfo.textContent = `${view.you.name}${view.you.isHost ? ' · Host' : ''}`;

  if (view.round?.number) {
    elements.roundChip.hidden = false;
    elements.roundCounter.textContent = view.round.number;
  } else {
    elements.roundChip.hidden = true;
  }

  renderRoleChip(view);
}

function renderRoleChip(view) {
  const player = view.players.find((p) => p.isSelf);
  if (!player) {
    elements.roleChip.hidden = true;
    return;
  }
  const roundActive = Boolean(view.round);
  if (!roundActive) {
    elements.roleChip.hidden = false;
    elements.roleLabel.textContent = 'Oczekiwanie';
    elements.roleHint.textContent = 'Rola zostanie przydzielona po rozpoczęciu gry.';
    elements.roleChip.style.background = 'rgba(0, 0, 0, 0.35)';
    elements.roleChip.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    return;
  }

  const isImpostor = Boolean(player.isImpostor);
  elements.roleChip.hidden = false;
  elements.roleLabel.textContent = isImpostor ? 'Impostor' : 'Załogant';
  elements.roleHint.textContent = isImpostor
    ? 'Blefuj i zgadnij hasło na końcu.'
    : 'Współpracuj, by namierzyć impostora.';
  elements.roleChip.style.background = isImpostor
    ? 'rgba(255, 93, 122, 0.4)'
    : 'rgba(92, 255, 193, 0.25)';
  elements.roleChip.style.borderColor = isImpostor ? 'rgba(255, 93, 122, 0.6)' : 'rgba(92, 255, 193, 0.5)';
}

function renderPhaseTrack(view) {
  const activePhase = view.state;
  const activeIndex = PHASE_SEQUENCE.indexOf(activePhase);
  elements.phaseSteps.forEach((step) => {
    const phase = step.dataset.phase;
    const index = PHASE_SEQUENCE.indexOf(phase);
    const isPast = index !== -1 && index < activeIndex;
    const isActive = index === activeIndex;
    step.classList.toggle('past', isPast);
    step.classList.toggle('active', isActive);
  });
}

function renderPhaseCopy(view) {
  const generator = PHASE_COPY[view.state] || PHASE_COPY.waiting;
  const copy = generator(view);
  elements.phaseTitle.textContent = copy.title;
  elements.phaseSubtitle.textContent = copy.subtitle;
  elements.phaseInstructions.textContent = copy.tip;
}

function renderPlayers(view) {
  elements.playersList.innerHTML = '';
  const current = view.round?.currentPlayer;
  view.players.forEach((player) => {
    const li = document.createElement('li');
    if (player.isSelf) li.classList.add('self');
    if (!player.alive) li.classList.add('eliminated');
    if (current && current === player.id && view.state === 'clues') {
      li.classList.add('current');
    }

    const name = document.createElement('div');
    name.className = 'player-name';
    name.textContent = player.name;
    if (player.isHost) {
      const hostBadge = document.createElement('span');
      hostBadge.className = 'host-badge';
      hostBadge.textContent = 'Host';
      name.appendChild(hostBadge);
    }

    const status = document.createElement('span');
    status.className = 'player-status';
    status.textContent = player.alive ? 'Aktywny' : 'Wyeliminowany';

    li.appendChild(name);
    li.appendChild(status);
    elements.playersList.appendChild(li);
  });
}

function renderClueSection(view) {
  const round = view.round;
  const you = view.players.find((p) => p.isSelf);
  const isCluePhase = view.state === 'clues';
  if (!round || !you || !isCluePhase) {
    elements.clueSection.hidden = true;
    elements.clueForm.hidden = true;
    elements.clueForm.reset();
    return;
  }
  const alive = you.alive;
  const isImpostor = Boolean(you.isImpostor);
  const isYourTurn = round.currentPlayer === state.playerId && alive;
  elements.clueSection.hidden = false;

  const word = round.word;
  if (isImpostor) {
    elements.wordDisplay.textContent = '???';
    elements.wordHint.textContent = 'Nie znasz hasła — improwizuj!';
  } else if (word) {
    elements.wordDisplay.textContent = word;
    elements.wordHint.textContent = 'To tajne hasło dla załogi.';
  } else {
    elements.wordDisplay.textContent = '';
    elements.wordHint.textContent = '';
  }

  if (!alive) {
    elements.turnInfo.textContent = 'Obserwujesz tę rundę.';
  } else if (isYourTurn) {
    elements.turnInfo.textContent = 'Twój ruch! Wpisz krótkie skojarzenie.';
  } else {
    const player = view.players.find((p) => p.id === round.currentPlayer);
    elements.turnInfo.textContent = player
      ? `Czekamy na wskazówkę od gracza ${player.name}.`
      : 'Czekamy na kolejną wskazówkę.';
  }

  elements.clueForm.hidden = !isYourTurn;
  if (isYourTurn && elements.clueForm.clue) {
    elements.clueForm.clue.focus();
  }
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
    li.dataset.order = index + 1;

    const playerSpan = document.createElement('span');
    playerSpan.className = 'clue-player';
    playerSpan.textContent = player ? player.name : 'Gracz';

    const clueSpan = document.createElement('span');
    clueSpan.className = 'clue-text';
    clueSpan.textContent = entry.clue;

    li.appendChild(playerSpan);
    li.appendChild(clueSpan);
    elements.cluesList.appendChild(li);
  });
}

function renderTimers(view) {
  clearInterval(timerInterval);
  const discussionEndsAt = view.round?.discussionEndsAt;
  const votingEndsAt = view.round?.votingEndsAt;
  const guessEndsAt = view.round?.impostorGuessEndsAt;

  elements.discussion.hidden = view.state !== 'discussion';

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
  const you = view.players.find((p) => p.isSelf);
  if (view.state !== 'voting' || !you?.alive) {
    elements.voting.hidden = true;
    elements.voteForm.reset();
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
  const voted = you?.vote;
  elements.voteForm.querySelector('button').disabled = !!voted;
  select.disabled = !!voted;
  if (voted && voted !== 'skip') {
    select.value = voted;
  }
}

function renderGuess(view) {
  const you = view.players.find((p) => p.isSelf);
  const canGuess = view.state === 'impostor_guess' && view.round?.canGuess && you?.isImpostor;
  if (!canGuess) {
    elements.impostorGuess.hidden = true;
    elements.guessForm.reset();
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
  elements.chatForm.querySelector('input').placeholder = enabled
    ? 'Napisz wiadomość'
    : 'Czat aktywny tylko w lobby i dyskusji';
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
    elements.noLobbies.hidden = data.lobbies.length > 0;
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
  elements.roleChip.hidden = true;
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
  event.target.reset();
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
