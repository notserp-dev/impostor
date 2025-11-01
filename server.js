const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PUBLIC_DIR = path.join(__dirname, 'public');

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const { pathname } = parsedUrl;

  if (pathname.startsWith('/api/')) {
    await handleApi(req, res, parsedUrl);
    return;
  }

  serveStatic(req, res, pathname);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const lobbies = new Map();

const words = [
  'kosmos',
  'jezioro',
  'komputer',
  'zamek',
  'kawa',
  'rower',
  'teatr',
  'smok',
  'biblioteka',
  'góra',
  'mikrofon',
  'laboratorium',
  'ogród',
  'wulkan',
  'kamera',
  'pirat',
  'lody',
  'planeta',
  'szachy',
  'tęcza',
  'robot',
  'delfin',
  'kaktus',
  'zamek',
  'balon',
  'pizza',
  'muzeum',
  'kredka',
  'latarnia',
  'statek',
  'zamek',
];

class Lobby {
  constructor({ name, isPrivate, host }) {
    this.id = createId();
    this.name = name;
    this.isPrivate = Boolean(isPrivate);
    this.code = this.isPrivate ? generateCode() : null;
    this.hostId = host.id;
    this.settings = {
      discussionSeconds: 120,
      votingSeconds: 60,
      impostorGuessSeconds: 45,
    };
    this.players = new Map();
    this.players.set(host.id, host);
    this.state = 'waiting';
    this.round = null;
    this.chat = [];
    this.createdAt = Date.now();
    this.timeouts = new Set();
  }

  addPlayer(player) {
    this.players.set(player.id, player);
    this.broadcastState();
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;
    if (player.connection) {
      player.connection.end();
    }
    this.players.delete(playerId);
    if (this.players.size === 0) {
      lobbies.delete(this.id);
      return;
    }
    if (playerId === this.hostId) {
      const nextHost = this.getAlivePlayers()[0] || [...this.players.values()][0];
      if (nextHost) {
        nextHost.role = 'host';
        this.hostId = nextHost.id;
      }
    }
    if (this.round && this.round.impostorId === playerId) {
      this.endGame('crewmates');
      return;
    }
    if (this.round) {
      this.round.order = this.round.order.filter((id) => this.players.has(id) && this.players.get(id).alive);
      this.round.index = Math.min(this.round.clues.length, this.round.order.length);
      if (this.state === 'clues') {
        if (this.round.index >= this.round.order.length) {
          this.startDiscussion();
        }
      }
      if (this.state === 'voting') {
        if (this.getAlivePlayers().length <= 1) {
          this.endGame('impostor');
          return;
        }
        if (this.getAlivePlayers().every((p) => p.vote !== null)) {
          this.finalizeVoting();
          return;
        }
      }
    }
    this.broadcastState();
  }

  getAlivePlayers() {
    return [...this.players.values()].filter((p) => p.alive);
  }

  resetPlayersForRound() {
    for (const player of this.players.values()) {
      player.alive = true;
      player.vote = null;
      player.clue = null;
      player.isImpostor = false;
    }
  }

  startGame(requestingPlayerId) {
    if (requestingPlayerId !== this.hostId) {
      throw new Error('Only host can start the game');
    }
    if (this.state !== 'waiting' && this.state !== 'ended') {
      throw new Error('Gra już trwa');
    }
    if (this.players.size < 3) {
      throw new Error('At least 3 players are required');
    }
    this.resetPlayersForRound();
    this.state = 'clues';
    this.round = {
      number: 1,
      word: this.pickWord(),
      impostorId: null,
      order: [],
      index: 0,
      clues: [],
      discussionEndsAt: null,
      votingEndsAt: null,
      impostorGuessEndsAt: null,
    };
    const alive = this.getAlivePlayers();
    const impostor = alive[Math.floor(Math.random() * alive.length)];
    impostor.isImpostor = true;
    this.round.impostorId = impostor.id;
    this.round.order = shuffle(alive.map((p) => p.id));
    this.broadcastState();
  }

  pickWord() {
    return words[Math.floor(Math.random() * words.length)];
  }

  ensureTurn(playerId) {
    if (!this.round) throw new Error('No active round');
    const expected = this.round.order[this.round.index];
    if (expected !== playerId) {
      throw new Error('Not your turn');
    }
  }

  submitClue(playerId, clue) {
    if (this.state !== 'clues') throw new Error('Not accepting clues');
    this.ensureTurn(playerId);
    const trimmed = String(clue || '').trim();
    if (!trimmed) throw new Error('Clue cannot be empty');
    this.round.clues.push({ playerId, clue: trimmed });
    this.round.index += 1;
    if (this.round.index >= this.round.order.length) {
      this.startDiscussion();
    }
    this.broadcastState();
  }

  startDiscussion() {
    this.clearTimers();
    this.state = 'discussion';
    const duration = this.settings.discussionSeconds * 1000;
    this.round.discussionEndsAt = Date.now() + duration;
    this.schedule(() => this.startVoting(), duration);
    this.broadcastState();
  }

  startVoting() {
    this.clearTimers();
    this.state = 'voting';
    this.round.votingEndsAt = Date.now() + this.settings.votingSeconds * 1000;
    for (const player of this.players.values()) {
      player.vote = null;
    }
    this.schedule(() => this.finalizeVoting(), this.settings.votingSeconds * 1000);
    this.broadcastState();
  }

  castVote(playerId, target) {
    if (this.state !== 'voting') throw new Error('Not voting stage');
    const player = this.players.get(playerId);
    if (!player.alive) throw new Error('Only alive players can vote');
    if (target !== 'skip' && !this.players.has(target)) {
      throw new Error('Invalid vote target');
    }
    player.vote = target;
    if (this.getAlivePlayers().every((p) => p.vote !== null)) {
      this.finalizeVoting();
    } else {
      this.broadcastState();
    }
  }

  finalizeVoting() {
    if (this.state !== 'voting') return;
    this.clearTimers();
    const tally = new Map();
    for (const player of this.getAlivePlayers()) {
      const vote = player.vote || 'skip';
      tally.set(vote, (tally.get(vote) || 0) + 1);
    }
    let eliminated = null;
    let maxVotes = 0;
    let tie = false;
    for (const [target, count] of tally.entries()) {
      if (count > maxVotes) {
        maxVotes = count;
        eliminated = target;
        tie = false;
      } else if (count === maxVotes) {
        tie = true;
      }
    }
    if (tie || eliminated === 'skip') {
      this.startNextRound();
      return;
    }
    const eliminatedPlayer = this.players.get(eliminated);
    if (!eliminatedPlayer) {
      this.startNextRound();
      return;
    }
    eliminatedPlayer.alive = false;
    if (eliminatedPlayer.isImpostor) {
      this.state = 'impostor_guess';
      const duration = this.settings.impostorGuessSeconds * 1000;
      this.round.impostorGuessEndsAt = Date.now() + duration;
      this.schedule(() => this.endGame('crewmates'), duration);
    } else {
      this.endGame('impostor');
    }
    this.broadcastState();
  }

  startNextRound() {
    this.clearTimers();
    if (!this.round) return;
    this.state = 'clues';
    this.round = {
      number: this.round.number + 1,
      word: this.pickWord(),
      impostorId: null,
      order: [],
      index: 0,
      clues: [],
      discussionEndsAt: null,
      votingEndsAt: null,
      impostorGuessEndsAt: null,
    };
    const alive = this.getAlivePlayers();
    if (alive.length < 3) {
      this.endGame('impostor');
      return;
    }
    for (const player of alive) {
      player.vote = null;
      player.clue = null;
      player.isImpostor = false;
    }
    const impostor = alive[Math.floor(Math.random() * alive.length)];
    impostor.isImpostor = true;
    this.round.impostorId = impostor.id;
    this.round.order = shuffle(alive.map((p) => p.id));
    this.broadcastState();
  }

  impostorGuess(playerId, guess) {
    if (this.state !== 'impostor_guess') throw new Error('Not impostor guess stage');
    if (this.round.impostorId !== playerId) throw new Error('Only impostor may guess');
    const normalized = String(guess || '').trim().toLowerCase();
    if (!normalized) throw new Error('Guess cannot be empty');
    const correct = normalized === this.round.word.toLowerCase();
    if (correct) {
      this.endGame('impostor');
    } else {
      this.endGame('crewmates');
    }
    this.broadcastState();
  }

  endGame(winner) {
    this.clearTimers();
    this.state = 'ended';
    this.round.winner = winner;
    this.broadcastState();
  }

  addChat(playerId, message) {
    const player = this.players.get(playerId);
    if (!player) throw new Error('Unknown player');
    const trimmed = String(message || '').trim();
    if (!trimmed) throw new Error('Empty message');
    if (this.state !== 'discussion' && this.state !== 'waiting') {
      throw new Error('Czat jest dostępny tylko podczas dyskusji');
    }
    const entry = {
      id: createId(),
      playerId,
      name: player.name,
      message: trimmed,
      timestamp: Date.now(),
    };
    this.chat.push(entry);
    if (this.chat.length > 200) {
      this.chat.splice(0, this.chat.length - 200);
    }
    this.broadcast({ type: 'chat', payload: entry });
  }

  schedule(fn, delay) {
    const timeout = setTimeout(() => {
      this.timeouts.delete(timeout);
      fn();
    }, delay);
    this.timeouts.add(timeout);
  }

  clearTimers() {
    for (const timeout of this.timeouts) {
      clearTimeout(timeout);
    }
    this.timeouts.clear();
  }

  setConnection(playerId, res) {
    const player = this.players.get(playerId);
    if (!player) return;
    if (player.connection) {
      player.connection.end();
    }
    player.connection = res;
    res.on('close', () => {
      if (player.connection === res) {
        player.connection = null;
      }
    });
  }

  broadcastState() {
    for (const player of this.players.values()) {
      if (player.connection) {
        sendEvent(player.connection, {
          type: 'state',
          payload: this.serializeForPlayer(player.id),
        });
      }
    }
  }

  broadcast(event) {
    for (const player of this.players.values()) {
      if (player.connection) {
        sendEvent(player.connection, event);
      }
    }
  }

  serializeForPlayer(playerId) {
    const player = this.players.get(playerId);
    const players = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      isHost: p.id === this.hostId,
      isSelf: p.id === playerId,
      isImpostor: p.id === playerId ? !!p.isImpostor : undefined,
      vote: this.state === 'voting' ? p.vote : undefined,
    }));
    const roundView = this.round
      ? {
          number: this.round.number,
          clues: this.round.clues.map((c) => ({
            playerId: c.playerId,
            clue: c.clue,
          })),
          currentPlayer: this.state === 'clues' ? this.round.order[this.round.index] : null,
          discussionEndsAt: this.round.discussionEndsAt,
          votingEndsAt: this.round.votingEndsAt,
          impostorGuessEndsAt: this.round.impostorGuessEndsAt,
          word: player.isImpostor ? null : this.round.word,
          canGuess: this.state === 'impostor_guess' && player.isImpostor,
          winner: this.round.winner || null,
        }
      : null;
    return {
      lobbyId: this.id,
      name: this.name,
      state: this.state,
      players,
      you: {
        id: player.id,
        name: player.name,
        isHost: player.id === this.hostId,
        alive: player.alive,
      },
      settings: this.settings,
      chat: this.chat.slice(-50),
      round: roundView,
      code: this.isPrivate ? this.code : null,
    };
  }
}

function sendEvent(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function createId() {
  return crypto.randomBytes(8).toString('hex');
}

function generateCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function shuffle(arr) {
  const clone = arr.slice();
  for (let i = clone.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  return clone;
}

async function handleApi(req, res, parsedUrl) {
  const { pathname, query } = parsedUrl;

  if (pathname === '/api/events' && req.method === 'GET') {
    handleEvents(req, res, query);
    return;
  }

  if (pathname === '/api/lobbies' && req.method === 'GET') {
    const list = [...lobbies.values()]
      .filter((l) => !l.isPrivate)
      .map((l) => ({
        id: l.id,
        name: l.name,
        players: l.players.size,
        createdAt: l.createdAt,
      }));
    json(res, { lobbies: list });
    return;
  }

  if (pathname === '/api/create-lobby' && req.method === 'POST') {
    const body = await readJson(req);
    const name = String(body?.name || '').trim() || 'Lobby';
    const playerName = String(body?.playerName || '').trim() || 'Gracz';
    const isPrivate = Boolean(body?.isPrivate);
    const player = createPlayer(playerName, true);
    const lobby = new Lobby({ name, isPrivate, host: player });
    lobbies.set(lobby.id, lobby);
    json(res, {
      lobbyId: lobby.id,
      playerId: player.id,
      token: player.token,
      code: lobby.code,
    });
    return;
  }

  if (pathname === '/api/join' && req.method === 'POST') {
    const body = await readJson(req);
    const playerName = String(body?.playerName || '').trim() || 'Gracz';
    let lobby = null;
    if (body?.lobbyId) {
      lobby = lobbies.get(body.lobbyId);
    } else if (body?.code) {
      lobby = [...lobbies.values()].find((l) => l.code === String(body.code).toUpperCase());
    }
    if (!lobby) {
      json(res, { error: 'Lobby not found' }, 404);
      return;
    }
    const player = createPlayer(playerName, lobby.players.size === 0);
    lobby.addPlayer(player);
    json(res, {
      lobbyId: lobby.id,
      playerId: player.id,
      token: player.token,
      code: lobby.code,
    });
    return;
  }

  if (pathname === '/api/start' && req.method === 'POST') {
    try {
      const { lobby, player } = authenticate(req, await readJson(req));
      lobby.startGame(player.id);
      json(res, { ok: true });
    } catch (error) {
      json(res, { error: error.message }, 400);
    }
    return;
  }

  if (pathname === '/api/submit-clue' && req.method === 'POST') {
    try {
      const { lobby, player, body } = authenticate(req, await readJson(req));
      lobby.submitClue(player.id, body?.clue);
      json(res, { ok: true });
    } catch (error) {
      json(res, { error: error.message }, 400);
    }
    return;
  }

  if (pathname === '/api/vote' && req.method === 'POST') {
    try {
      const { lobby, player, body } = authenticate(req, await readJson(req));
      lobby.castVote(player.id, body?.target);
      json(res, { ok: true });
    } catch (error) {
      json(res, { error: error.message }, 400);
    }
    return;
  }

  if (pathname === '/api/impostor-guess' && req.method === 'POST') {
    try {
      const { lobby, player, body } = authenticate(req, await readJson(req));
      lobby.impostorGuess(player.id, body?.guess);
      json(res, { ok: true });
    } catch (error) {
      json(res, { error: error.message }, 400);
    }
    return;
  }

  if (pathname === '/api/chat' && req.method === 'POST') {
    try {
      const { lobby, player, body } = authenticate(req, await readJson(req));
      lobby.addChat(player.id, body?.message);
      json(res, { ok: true });
    } catch (error) {
      json(res, { error: error.message }, 400);
    }
    return;
  }

  if (pathname === '/api/leave' && req.method === 'POST') {
    try {
      const { lobby, player } = authenticate(req, await readJson(req));
      lobby.removePlayer(player.id);
      json(res, { ok: true });
    } catch (error) {
      json(res, { error: error.message }, 400);
    }
    return;
  }

  json(res, { error: 'Not found' }, 404);
}

function handleEvents(req, res, query) {
  const lobbyId = query.lobby;
  const playerId = query.player;
  const token = query.token;
  const lobby = lobbies.get(lobbyId);
  if (!lobby) {
    res.writeHead(404);
    res.end();
    return;
  }
  const player = lobby.players.get(playerId);
  if (!player || player.token !== token) {
    res.writeHead(403);
    res.end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');
  lobby.setConnection(playerId, res);
  sendEvent(res, { type: 'state', payload: lobby.serializeForPlayer(playerId) });
}

function createPlayer(name, isHost) {
  return {
    id: createId(),
    token: createId(),
    name,
    alive: true,
    vote: null,
    isImpostor: false,
    connection: null,
    role: isHost ? 'host' : 'player',
  };
}

function authenticate(req, body) {
  const lobbyId = body?.lobbyId;
  const playerId = body?.playerId;
  const token = body?.token;
  if (!lobbyId || !playerId || !token) {
    throw new Error('Missing credentials');
  }
  const lobby = lobbies.get(lobbyId);
  if (!lobby) throw new Error('Lobby not found');
  const player = lobby.players.get(playerId);
  if (!player || player.token !== token) throw new Error('Invalid player');
  return { lobby, player, body };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        req.connection.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        const parsed = data ? JSON.parse(data) : {};
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  }).catch((error) => {
    console.error('Failed to parse JSON', error);
    return {};
  });
}

function json(res, payload, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}
