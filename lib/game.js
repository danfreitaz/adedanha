// Regras do Adedanha — funções puras sobre o estado da sala.
const { norm, lookup } = require('./dict');

const DEFAULT_CATS = ['Nome', 'CEP', 'Animal', 'Fruta', 'Cor', 'Objeto', 'Comida', 'Profissão'];
const ALL_LETTERS = 'ABCDEFGHIJLMNOPQRSTUVZ';
const NICK_COLORS = ['#000080', '#008000', '#c00000', '#800080', '#c06000', '#008080', '#0000ff', '#606000', '#c000c0', '#404040', '#00a000', '#a00040'];
const TIMEOUT_MS = 45000;
const COUNTDOWN_MS = 3500;
const STOP_GRACE_MS = 3000;
const VOTE_MS = 75000;
const RESULTS_MS = 30000;
const MAX_PLAYERS = 12;

const rid = (n = 12) => Array.from({ length: n }, () => 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 32)]).join('');
const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);

function newRoom(name, settings, now) {
  return {
    name: clean(name, 24).replace(/^#+/, '').replace(/\s+/g, '-') || 'arcadia',
    hostId: null,
    settings: normSettings(settings),
    players: {},
    phase: 'lobby',
    round: 0, letter: null, usedLetters: [],
    roundStart: 0, roundEnd: 0, stopAt: 0, stopBy: null, phaseEnd: 0,
    answers: {}, checks: {}, votes: {}, ready: [], roundScores: {}, voters: [],
    log: [{ t: now, type: 'sys', text: 'Canal criado. Digite /help para ver os comandos.' }],
    created: now,
  };
}

function normSettings(s = {}) {
  let cats = Array.isArray(s.categories) ? s.categories.map(c => clean(c, 20)).filter(Boolean) : DEFAULT_CATS;
  cats = [...new Set(cats)].slice(0, 12);
  if (cats.length < 3) cats = DEFAULT_CATS;
  let letters = String(s.letters || ALL_LETTERS).toUpperCase().replace(/[^A-Z]/g, '');
  letters = [...new Set(letters)].join('');
  if (letters.length < 5) letters = ALL_LETTERS;
  return {
    categories: cats,
    rounds: Math.min(26, Math.max(1, parseInt(s.rounds) || 5)),
    time: Math.min(300, Math.max(30, parseInt(s.time) || 90)),
    letters,
  };
}

function log(st, type, text, nick, color) {
  st.log.push({ t: Date.now(), type, text: clean(text, 300), nick, color });
  if (st.log.length > 80) st.log.splice(0, st.log.length - 80);
}

const ids = st => Object.keys(st.players).sort((a, b) => st.players[a].joinedAt - st.players[b].joinedAt);

function ensureHost(st) {
  if (st.hostId && st.players[st.hostId]) return;
  const first = ids(st)[0];
  st.hostId = first || null;
  if (first) log(st, 'sys', `${st.players[first].nick} agora é operador (@) do canal`);
}

// Avança o relógio do jogo. Retorna true se mudou algo.
function tick(st, now) {
  const before = JSON.stringify([st.phase, Object.keys(st.players).length, st.hostId]);
  for (const id of ids(st)) {
    if (now - st.players[id].lastSeen > TIMEOUT_MS) {
      log(st, 'quit', `${st.players[id].nick} saiu (Ping timeout)`);
      delete st.players[id];
    }
  }
  ensureHost(st);
  const n = Object.keys(st.players).length;
  if (n === 0) return true;

  if (st.phase === 'playing' && now >= st.roundEnd) {
    st.phase = 'stopping'; st.stopAt = now + STOP_GRACE_MS; st.stopBy = null;
    log(st, 'stop', '⏰ TEMPO ESGOTADO!');
  }
  if (st.phase === 'stopping' && now >= st.stopAt) startVoting(st, now);
  if (st.phase === 'voting') {
    const need = st.voters.filter(id => st.players[id]);
    if (now >= st.phaseEnd || (need.length && need.every(id => st.ready.includes(id)))) finishRound(st, now);
  }
  if (st.phase === 'results') {
    const need = ids(st);
    if (now >= st.phaseEnd || need.every(id => st.ready.includes(id))) nextOrFinal(st, now);
  }
  return before !== JSON.stringify([st.phase, Object.keys(st.players).length, st.hostId]);
}

function startRound(st, now) {
  let pool = st.settings.letters.split('').filter(l => !st.usedLetters.includes(l));
  if (!pool.length) { st.usedLetters = []; pool = st.settings.letters.split(''); }
  st.letter = pool[Math.floor(Math.random() * pool.length)];
  st.usedLetters.push(st.letter);
  st.round += 1;
  st.phase = 'playing';
  st.roundStart = now + COUNTDOWN_MS;
  st.roundEnd = st.roundStart + st.settings.time * 1000;
  st.answers = {}; st.checks = {}; st.votes = {}; st.ready = []; st.roundScores = {}; st.stopBy = null;
  log(st, 'round', `Rodada ${st.round}/${st.settings.rounds} — LETRA ${st.letter}`);
}

function startVoting(st, now) {
  st.phase = 'voting';
  st.phaseEnd = now + VOTE_MS;
  st.ready = []; st.votes = {};
  st.voters = ids(st);
  const L = norm(st.letter);
  for (const id of st.voters) {
    st.checks[id] = {};
    const a = st.answers[id] || {};
    for (const cat of st.settings.categories) {
      const w = norm(a[cat]);
      let c;
      if (!w) c = 'empty';
      else if (w[0] !== L.toLowerCase()) c = 'bad';
      else c = lookup(cat, w);
      st.checks[id][cat] = c;
    }
  }
  log(st, 'sys', 'Apuração! Clique nas respostas dos outros para contestar (ou aceitar as que o dicionário não achou).');
}

// Validade final de uma resposta após os votos
function isValid(st, pid, cat) {
  const c = st.checks[pid]?.[cat];
  if (!c || c === 'empty' || c === 'bad') return false;
  const base = c !== 'unk';
  const others = st.voters.filter(v => v !== pid && st.players[v]).length;
  const v = (st.votes[pid]?.[cat] || []).filter(x => st.players[x]).length;
  const flipped = others > 0 && v * 2 > others;
  return flipped ? !base : base;
}

function finishRound(st, now) {
  const cats = st.settings.categories;
  st.roundScores = {};
  for (const pid of st.voters) st.roundScores[pid] = {};
  for (const cat of cats) {
    const valid = st.voters.filter(pid => isValid(st, pid, cat));
    const count = {};
    for (const pid of valid) { const w = norm(st.answers[pid][cat]); count[w] = (count[w] || 0) + 1; }
    for (const pid of st.voters) {
      let pts = 0;
      if (valid.includes(pid)) pts = count[norm(st.answers[pid][cat])] > 1 ? 5 : 10;
      st.roundScores[pid][cat] = pts;
    }
  }
  for (const pid of st.voters) {
    const tot = Object.values(st.roundScores[pid]).reduce((a, b) => a + b, 0);
    if (st.players[pid]) st.players[pid].score += tot;
  }
  st.phase = 'results';
  st.phaseEnd = now + RESULTS_MS;
  st.ready = [];
  const best = st.voters.filter(p => st.players[p]).sort((a, b) => sum(st.roundScores[b]) - sum(st.roundScores[a]))[0];
  if (best) log(st, 'sys', `Fim da rodada ${st.round}. Melhor da rodada: ${st.players[best].nick} (+${sum(st.roundScores[best])})`);
}
const sum = o => Object.values(o || {}).reduce((a, b) => a + b, 0);

function nextOrFinal(st, now) {
  if (st.round >= st.settings.rounds) {
    st.phase = 'final';
    const rank = ids(st).sort((a, b) => st.players[b].score - st.players[a].score);
    if (rank[0]) log(st, 'win', `🏆 ${st.players[rank[0]].nick} venceu com ${st.players[rank[0]].score} pontos!`);
  } else startRound(st, now);
}

function filledAll(st, pid) {
  const a = st.answers[pid] || {};
  const L = st.letter.toLowerCase();
  return st.settings.categories.every(c => { const w = norm(a[c]); return w && w[0] === L; });
}

// Aplica uma ação de jogador. Lança Error(msg) se inválida.
function act(st, pid, action, data, now) {
  const p = st.players[pid];
  if (!p) throw new Error('Você não está neste canal.');
  p.lastSeen = now;
  const isHost = st.hostId === pid;
  switch (action) {
    case 'ping': return;
    case 'chat': {
      let text = clean(data.text, 300);
      if (!text) return;
      if (text.startsWith('/me ')) return log(st, 'action', text.slice(4), p.nick, p.color);
      if (text.startsWith('/nick ')) {
        const nick = uniqueNick(st, clean(text.slice(6), 16).replace(/\s+/g, '_'), pid);
        if (!nick) throw new Error('Nick inválido.');
        log(st, 'nick', `${p.nick} agora é conhecido como ${nick}`); p.nick = nick; return;
      }
      if (text.startsWith('/')) throw new Error('Comando desconhecido. Use /me, /nick, /help');
      return log(st, 'msg', text, p.nick, p.color);
    }
    case 'settings':
      if (!isHost) throw new Error('Só o operador (@) muda as regras.');
      if (!['lobby', 'final'].includes(st.phase)) throw new Error('Só dá pra mudar entre partidas.');
      st.settings = normSettings({ ...st.settings, ...data });
      return log(st, 'mode', `${p.nick} mudou as regras: ${st.settings.categories.length} categorias, ${st.settings.rounds} rodadas, ${st.settings.time}s`);
    case 'start':
      if (!isHost) throw new Error('Só o operador (@) inicia a partida.');
      if (!['lobby', 'final'].includes(st.phase)) throw new Error('Partida já em andamento.');
      for (const id of ids(st)) st.players[id].score = 0;
      st.round = 0; st.usedLetters = [];
      log(st, 'sys', `${p.nick} iniciou a partida!`);
      return startRound(st, now);
    case 'answer': {
      if (!['playing', 'stopping'].includes(st.phase)) return;
      const out = {};
      for (const c of st.settings.categories) out[c] = clean(data.answers?.[c], 40);
      st.answers[pid] = out;
      return;
    }
    case 'stop': {
      if (st.phase !== 'playing') return;
      if (now < st.roundStart) throw new Error('Calma, a rodada nem começou!');
      if (data.answers) act(st, pid, 'answer', data, now);
      if (!filledAll(st, pid)) throw new Error(`Preencha todas as categorias com a letra ${st.letter} antes do STOP!`);
      st.phase = 'stopping'; st.stopAt = now + STOP_GRACE_MS; st.stopBy = p.nick;
      return log(st, 'stop', `✋ STOP! gritado por ${p.nick}`);
    }
    case 'vote': {
      if (st.phase !== 'voting') return;
      const { target, cat } = data;
      if (target === pid || !st.checks[target]?.[cat]) return;
      if (['empty', 'bad'].includes(st.checks[target][cat])) return;
      st.votes[target] = st.votes[target] || {};
      const arr = st.votes[target][cat] = st.votes[target][cat] || [];
      const i = arr.indexOf(pid);
      if (i >= 0) arr.splice(i, 1); else arr.push(pid);
      return;
    }
    case 'ready':
      if (!['voting', 'results'].includes(st.phase)) return;
      if (!st.ready.includes(pid)) st.ready.push(pid);
      return;
    case 'leave':
      log(st, 'part', `${p.nick} saiu do canal`);
      delete st.players[pid];
      return ensureHost(st);
    default: throw new Error('Ação desconhecida.');
  }
}

function uniqueNick(st, nick, exceptId) {
  nick = nick.replace(/[^\p{L}\p{N}_\-\[\]\\^{}|`]/gu, '').slice(0, 16);
  if (!nick) return null;
  const taken = new Set(Object.entries(st.players).filter(([id]) => id !== exceptId).map(([, p]) => p.nick.toLowerCase()));
  let n = nick, i = 1;
  while (taken.has(n.toLowerCase())) n = `${nick.slice(0, 14)}${++i}`;
  return n;
}

function join(st, nick, now) {
  if (Object.keys(st.players).length >= MAX_PLAYERS) throw new Error('Canal lotado (máx. 12).');
  nick = uniqueNick(st, clean(nick, 16).replace(/\s+/g, '_'));
  if (!nick) throw new Error('Escolha um nick válido.');
  const pid = rid(10), key = rid(16);
  const used = new Set(Object.values(st.players).map(p => p.color));
  const color = NICK_COLORS.find(c => !used.has(c)) || NICK_COLORS[0];
  st.players[pid] = { nick, key, score: 0, joinedAt: now, lastSeen: now, color };
  log(st, 'join', `${nick} entrou em #${st.name}`);
  ensureHost(st);
  return { pid, key };
}

// O que cada jogador pode ver (esconde chaves e respostas alheias durante a rodada)
function view(st, viewer, now) {
  const players = {};
  for (const [id, p] of Object.entries(st.players)) players[id] = { nick: p.nick, score: p.score, color: p.color, joinedAt: p.joinedAt };
  let answers = st.answers;
  if (['playing', 'stopping'].includes(st.phase)) {
    answers = {};
    for (const [id, a] of Object.entries(st.answers)) {
      answers[id] = id === viewer ? a : { _filled: Object.values(a).filter(Boolean).length };
    }
  }
  const validity = {};
  if (['voting', 'results', 'final'].includes(st.phase)) {
    for (const pid of st.voters) { validity[pid] = {}; for (const c of st.settings.categories) validity[pid][c] = isValid(st, pid, c); }
  }
  return {
    name: st.name, hostId: st.hostId, settings: st.settings, players, phase: st.phase, round: st.round,
    letter: (st.phase === 'playing' && now < st.roundStart) ? null : st.letter,
    roundStart: st.roundStart, roundEnd: st.roundEnd, stopAt: st.stopAt, stopBy: st.stopBy, phaseEnd: st.phaseEnd,
    answers, checks: st.checks, votes: st.votes, ready: st.ready, roundScores: st.roundScores, voters: st.voters,
    validity, log: st.log, now,
  };
}

module.exports = { newRoom, tick, act, join, view, rid, DEFAULT_CATS, ALL_LETTERS };
