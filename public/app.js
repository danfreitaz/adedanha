// Adedanha32 — cliente
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const PRESET_CATS = ['Nome', 'CEP', 'Animal', 'Fruta', 'Cor', 'Objeto', 'Comida', 'Profissão', 'Marca', 'Filme/Série', 'Parte do corpo', 'Minha sogra é…', 'Verbo', 'Esporte', 'Bebida', 'Inseto', 'Ave', 'Flor', 'Instrumento', 'Time de futebol', 'Celebridade', 'Banda/Cantor', 'Personagem', 'Jogo'];
const ALL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const S = {
  view: 'lobby', code: null, me: null, st: null, seq: -1, offset: 0, lag: null,
  sound: localStorage.getItem('ad_sound') !== '0', poll: null, lobbyPoll: null,
  renderedKey: null, sentStopping: null, lastLogT: 0, saveTimer: null, busy: false,
};
const now = () => Date.now() + S.offset;

/* ---------- API ---------- */
async function api(method, params) {
  const t0 = performance.now();
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  let u = '/api/game';
  if (method === 'GET') u += '?' + new URLSearchParams(params); else opts.body = JSON.stringify(params);
  const r = await fetch(u, opts);
  const j = await r.json().catch(() => ({ error: 'Resposta inválida do servidor' }));
  S.lag = Math.round(performance.now() - t0);
  $('#sbLag').textContent = `Lag: ${S.lag}ms`;
  if (!r.ok) throw Object.assign(new Error(j.error || 'Erro'), { status: r.status });
  if (j.now) S.offset = j.now - Date.now() + S.lag / 2;
  return j;
}
const act = (action, data = {}) => api('POST', { op: 'act', code: S.code, pid: S.me.pid, key: S.me.key, action, data }).then(applyState);

/* ---------- Som (beeps de PC speaker) ---------- */
let ac;
function beep(seq) {
  if (!S.sound) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    let t = ac.currentTime;
    for (const [f, d] of seq) {
      if (f) { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'square'; o.frequency.value = f; g.gain.value = .04; o.connect(g).connect(ac.destination); o.start(t); o.stop(t + d); }
      t += d;
    }
  } catch { }
}
const SFX = {
  join: [[880, .05], [1320, .07]], msg: [[1200, .03]], tick: [[660, .04]],
  letter: [[523, .08], [659, .08], [784, .08], [1046, .16]], stop: [[300, .12], [0, .03], [300, .12], [0, .03], [200, .3]],
  win: [[523, .1], [659, .1], [784, .1], [1046, .1], [784, .1], [1046, .3]], err: [[180, .15]],
};

/* ---------- Diálogos ---------- */
function dialog({ title = 'Adedanha32', icon = 'info', html, buttons = [{ label: 'OK', value: true }], input }) {
  return new Promise(res => {
    $('#dlgTitle').textContent = title;
    $('#dlgIco').dataset.icon = icon; $('#dlgIco').dataset.size = 32;
    $('#dlgBody').innerHTML = html + (input ? `<input class="field" id="dlgInput" maxlength="${input.max || 24}" value="${esc(input.value || '')}" placeholder="${esc(input.placeholder || '')}" spellcheck="false">` : '');
    $('#dlgBtns').innerHTML = buttons.map((b, i) => `<button class="btn ${i === 0 ? 'primary' : ''}" data-v="${i}">${esc(b.label)}</button>`).join('');
    paintIcons($('#modal'));
    $('#modal').hidden = false;
    const inp = $('#dlgInput');
    const close = v => { $('#modal').hidden = true; res(v); };
    $('#dlgBtns').onclick = e => { const b = e.target.closest('button'); if (!b) return; const opt = buttons[b.dataset.v]; close(opt.value === true && inp ? inp.value.trim() : opt.value); };
    $('#modal [data-close]').onclick = () => close(null);
    if (inp) { inp.focus(); inp.select(); inp.onkeydown = e => { if (e.key === 'Enter') close(inp.value.trim()); if (e.key === 'Escape') close(null); }; }
    else $('#dlgBtns .btn').focus();
  });
}
const alertBox = (html, icon = 'warn') => { beep(SFX.err); return dialog({ html: `<p>${html}</p>`, icon }); };

/* ---------- Nick ---------- */
function getNick() { return $('#nick').value.trim(); }
async function ensureNick() {
  let n = getNick();
  if (!n) {
    n = await dialog({ title: 'Identificação', icon: 'user', html: '<p>Escolha seu nick para entrar no IRC:</p>', input: { max: 16, placeholder: 'SeuNick' }, buttons: [{ label: 'OK', value: true }, { label: 'Cancelar', value: null }] });
    if (!n) return null;
    $('#nick').value = n;
  }
  localStorage.setItem('ad_nick', n);
  return n;
}

/* ---------- LOBBY ---------- */
function showLobby() {
  stopPolling();
  S.view = 'lobby'; S.code = null; S.me = null; S.st = null; S.seq = -1; S.renderedKey = null;
  history.replaceState(null, '', location.pathname);
  $('#room').hidden = true; $('#lobby').hidden = false;
  $('#mainTitle').textContent = 'Adedanha32 - [Lista de Canais: irc.arcadia.net]';
  $('#sbConn').textContent = 'Conectado: irc.arcadia.net';
  $('#sbInfo').textContent = 'Escolha um canal ou crie o seu.';
  document.title = 'Adedanha32 — irc.arcadia.net';
  loadRooms();
  S.lobbyPoll = setInterval(loadRooms, 5000);
}
async function loadRooms() {
  try {
    const { rooms } = await api('GET', { op: 'list' });
    const box = $('#roomList');
    if (!rooms.length) { box.innerHTML = '<div class="empty">*** Nenhum canal ativo. Crie o primeiro! →</div>'; return; }
    const label = p => ({ lobby: '<span class="st-lobby">aguardando</span>', final: '<span class="st-lobby">fim de jogo</span>' }[p] || '<span class="st-play">em jogo</span>');
    box.innerHTML = rooms.map(r => `<div class="item" tabindex="0" data-code="${esc(r.code)}"><span>#${esc(r.name)}</span><span>${r.players}</span><span>${label(r.phase)}</span></div>`).join('');
  } catch (e) { $('#roomList').innerHTML = `<div class="empty">*** Erro ao listar: ${esc(e.message)}</div>`; }
}
$('#roomList').addEventListener('click', e => { const it = e.target.closest('.item'); if (it) joinRoom(it.dataset.code); });
$('#roomList').addEventListener('keydown', e => { const it = e.target.closest('.item'); if (it && e.key === 'Enter') joinRoom(it.dataset.code); });
$('#btnRefresh').onclick = loadRooms;
$('#btnJoinCode').onclick = async () => {
  const c = await dialog({ title: 'Entrar com código', icon: 'link', html: '<p>Código do canal (5 letras):</p>', input: { max: 5, placeholder: 'ABCDE' }, buttons: [{ label: 'Entrar', value: true }, { label: 'Cancelar', value: null }] });
  if (c) joinRoom(c.toUpperCase());
};
$('#btnCreate').onclick = async () => {
  const nick = await ensureNick(); if (!nick) return;
  const name = $('#newName').value.trim() || `${nick}-sala`;
  try {
    const r = await api('POST', { op: 'create', name, nick });
    saveMe(r.code, r); enterRoom(r.code);
  } catch (e) { alertBox(esc(e.message)); }
};
$('#newName').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnCreate').click(); });

function saveMe(code, r) { localStorage.setItem('ad_me_' + code, JSON.stringify({ pid: r.pid, key: r.key })); }
function loadMe(code) { try { return JSON.parse(localStorage.getItem('ad_me_' + code)); } catch { return null; } }

async function joinRoom(code) {
  code = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) return;
  const saved = loadMe(code);
  if (saved) {
    try { const r = await api('GET', { op: 'room', code, pid: saved.pid, since: -1 }); if (r.state?.players?.[saved.pid]) return enterRoom(code); } catch { }
  }
  const nick = await ensureNick(); if (!nick) return;
  try { const r = await api('POST', { op: 'join', code, nick }); saveMe(code, r); enterRoom(code); }
  catch (e) { alertBox(esc(e.message)); if (location.hash) history.replaceState(null, '', location.pathname); }
}

/* ---------- SALA ---------- */
function enterRoom(code) {
  clearInterval(S.lobbyPoll);
  S.view = 'room'; S.code = code; S.me = loadMe(code); S.seq = -1; S.renderedKey = null; S.lastLogT = 0; S.sentStopping = null;
  history.replaceState(null, '', '#' + code);
  $('#lobby').hidden = true; $('#room').hidden = false;
  $('#log').innerHTML = '';
  $('#sbConn').textContent = `Conectado: #${code}`;
  beep(SFX.join);
  pollRoom();
  S.poll = setInterval(pollRoom, 1100);
  $('#chatInput').focus();
}
function stopPolling() { clearInterval(S.poll); clearInterval(S.lobbyPoll); S.poll = null; }
let polling = false;
async function pollRoom() {
  if (polling || !S.code) return;
  polling = true;
  try {
    const needLetter = S.st?.phase === 'playing' && !S.st.letter && now() >= S.st.roundStart;
    const r = await api('GET', { op: 'room', code: S.code, pid: S.me.pid, since: needLetter ? -1 : S.seq });
    if (!r.same) applyState(r);
  } catch (e) {
    if (e.status === 404) { stopPolling(); await alertBox('Esse canal não existe mais.'); showLobby(); }
    else $('#sbInfo').textContent = '*** Conexão instável: ' + e.message;
  } finally { polling = false; }
}

function applyState(r) {
  if (!r || !r.state || S.view !== 'room') return;
  if (r.seq < S.seq) return;
  if (S.st && S.st.letter !== r.state.letter) setTimeout(() => document.querySelectorAll('#game input.ans').forEach(markInput));
  S.seq = r.seq;
  const prev = S.st; const st = S.st = r.state;
  if (!st.players[S.me.pid]) {
    stopPolling();
    alertBox('Você foi desconectado do canal (Ping timeout).').then(showLobby);
    return;
  }
  // sons em transições
  if (prev) {
    if (prev.phase !== 'playing' && st.phase === 'playing') setTimeout(() => beep(SFX.letter), Math.max(0, st.roundStart - now()));
    if (prev.phase === 'playing' && st.phase === 'stopping') { beep(SFX.stop); if (st.stopBy) flashStop(); }
    if (prev.phase !== 'final' && st.phase === 'final') beep(SFX.win);
  }
  // Fim de rodada chegando: garante que as respostas foram enviadas
  if (st.phase === 'stopping' && S.sentStopping !== st.round) { S.sentStopping = st.round; saveAnswers(true); }
  renderLog(st); renderNicks(st); renderGame(st);
}

function flashStop() { const f = $('#stopflash'); f.hidden = false; f.style.animation = 'none'; f.offsetHeight; f.style.animation = ''; setTimeout(() => f.hidden = true, 1300); }

/* ----- Log estilo mIRC ----- */
const hhmm = t => new Date(t).toTimeString().slice(0, 5);
function renderLog(st) {
  const box = $('#log');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
  const fresh = st.log.filter(l => l.t > S.lastLogT);
  if (!fresh.length) return;
  for (const l of fresh) {
    const p = document.createElement('p');
    const ts = `<span class="ts">[${hhmm(l.t)}]</span> `;
    if (l.type === 'msg') p.innerHTML = `${ts}&lt;<b style="color:${esc(l.color)}">${esc(l.nick)}</b>&gt; ${esc(l.text)}`;
    else if (l.type === 'action') p.innerHTML = `${ts}<span class="action">* ${esc(l.nick)} ${esc(l.text)}</span>`;
    else p.innerHTML = `${ts}<span class="${l.type === 'nick' ? 'nickc' : esc(l.type)}">*** ${esc(l.text)}</span>`;
    box.appendChild(p);
    if (S.lastLogT && l.type === 'msg' && l.nick !== st.players[S.me.pid]?.nick) beep(SFX.msg);
  }
  S.lastLogT = fresh[fresh.length - 1].t;
  while (box.children.length > 300) box.firstChild.remove();
  if (atBottom || fresh.length) box.scrollTop = box.scrollHeight;
}
function localLog(text, cls = 'sys') {
  const p = document.createElement('p');
  p.innerHTML = `<span class="ts">[${hhmm(Date.now())}]</span> <span class="${cls}">${text}</span>`;
  $('#log').appendChild(p); $('#log').scrollTop = 1e9;
}

/* ----- Lista de nicks ----- */
function renderNicks(st) {
  const ids = Object.keys(st.players).sort((a, b) => st.players[b].score - st.players[a].score || st.players[a].joinedAt - st.players[b].joinedAt);
  const ready = new Set(st.ready || []);
  $('#nicks').innerHTML = `<h4>${ids.length} usuário${ids.length > 1 ? 's' : ''}</h4>` + ids.map(id => {
    const p = st.players[id];
    const op = id === st.hostId ? '<b title="operador">@</b>' : '&nbsp;';
    const rd = ['voting', 'results'].includes(st.phase) && ready.has(id) ? '<span class="rd" title="pronto">✓</span>' : '';
    return `<div class="nick ${id === S.me.pid ? 'me' : ''}">${op}<span style="color:${esc(p.color)}">${esc(p.nick)}</span>${rd}<span class="sc">${p.score}</span></div>`;
  }).join('');
  const meHost = st.hostId === S.me.pid;
  $('#roomTitle').textContent = `#${st.name} [${ids.length}] [+nt] — código ${S.code}${meHost ? ' — você é @' : ''}`;
  $('#mainTitle').textContent = `Adedanha32 - [#${st.name}]`;
  document.title = `#${st.name} — Adedanha32`;
}

/* ----- Painel do jogo ----- */
let timerLoop = null;
function renderGame(st) {
  const key = `${st.phase === 'stopping' ? 'playing' : st.phase}|${st.round}|${st.hostId === S.me.pid}|${st.phase === 'lobby' || st.phase === 'final' ? JSON.stringify(st.settings) + Object.keys(st.players).length : ''}`;
  const g = $('#game');
  if (key !== S.renderedKey) {
    S.renderedKey = key;
    g.innerHTML = ({ lobby: viewLobby, final: viewFinal, playing: viewPlaying, stopping: viewPlaying, voting: viewVoting, results: viewResults }[st.phase] || (() => ''))(st);
    paintIcons(g);
    bindGame(st);
  }
  updateDynamic(st);
  clearInterval(timerLoop);
  timerLoop = setInterval(() => S.st && updateDynamic(S.st), 250);
}

const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function viewSettings(st) {
  const s = st.settings;
  const cats = [...new Set([...PRESET_CATS, ...s.categories])];
  return `<fieldset class="group"><legend>Modos do canal (só o @ altera)</legend>
    <div class="cats">${cats.map(c => `<label><input type="checkbox" data-cat="${esc(c)}" ${s.categories.includes(c) ? 'checked' : ''}> ${esc(c)}</label>`).join('')}</div>
    <div class="row" style="margin:8px 0"><input class="field" id="customCat" maxlength="20" placeholder="Categoria nova…"><button class="btn" id="addCat"><span data-icon="plus"></span>Adicionar</button></div>
    <div class="cfg-grid">
      <span>Rodadas:</span><span><select id="cfgRounds">${[3, 5, 7, 10, 15].map(n => `<option ${n == s.rounds ? 'selected' : ''}>${n}</option>`).join('')}</select></span>
      <span>Tempo:</span><span><select id="cfgTime">${[45, 60, 90, 120, 180].map(n => `<option value="${n}" ${n == s.time ? 'selected' : ''}>${n}s</option>`).join('')}</select></span>
      <span>Letras:</span><span class="letters">${ALL_LETTERS.split('').map(l => `<button class="btn ${s.letters.includes(l) ? 'on' : ''}" data-letter="${l}">${l}</button>`).join('')}</span>
    </div></fieldset>`;
}
function settingsSummary(st) {
  const s = st.settings;
  return `<p><b>Categorias:</b> ${s.categories.map(esc).join(' · ')}</p><p><b>${s.rounds}</b> rodadas · <b>${s.time}s</b> cada · letras: <code>${s.letters}</code></p>`;
}
function viewLobby(st) {
  const host = st.hostId === S.me.pid;
  const n = Object.keys(st.players).length;
  return `<div class="phase-head"><span data-icon="hourglass"></span><h2>Aguardando jogadores</h2><span class="pill">${n} no canal</span></div>
    <div class="terminal"><div class="term-info">
      <div class="line">C:\\ARCADIA&gt; adedanha.exe /canal:${esc(st.name)}</div>
      <div class="line">Convide a galera: código <b>${S.code}</b> ou o link (ícone 🔗 na barra)</div>
      <div class="line cursor">${host ? 'Você é o operador. Ajuste as regras e aperte INICIAR.' : `Esperando @${esc(st.players[st.hostId]?.nick || '?')} iniciar…`}</div>
    </div></div>
    <div class="foot" style="margin:10px 0">${host ? `<button class="btn primary" id="btnStart"><span data-icon="dice"></span> INICIAR PARTIDA</button>` : ''}
    <span class="others">${n < 2 ? 'Dá pra jogar sozinho, mas é mais divertido a três. 😉' : ''}</span></div>
    ${host ? viewSettings(st) : `<fieldset class="group"><legend>Regras</legend>${settingsSummary(st)}</fieldset>`}`;
}

function viewPlaying(st) {
  const mine = st.answers[S.me.pid] || {};
  return `<div class="phase-head"><span data-icon="pencil"></span><h2>Rodada <b>${st.round}</b>/${st.settings.rounds}</h2><span class="pill" id="phasePill">valendo!</span></div>
    <div class="terminal">
      <div class="bigletter" id="bigLetter">?</div>
      <div class="term-info">
        <div class="line" id="termL1">&gt; sorteando letra…</div>
        <div class="line" id="termL2"></div>
        <div class="timebar" id="timebar">${'<i></i>'.repeat(30)}</div>
      </div>
    </div>
    <div class="answers">${st.settings.categories.map((c, i) => `<label><span>${esc(c)}<small id="ck${i}"></small></span><input class="field ans" data-cat="${esc(c)}" maxlength="40" value="${esc(mine[c] || '')}" spellcheck="false" autocomplete="off" disabled></label>`).join('')}</div>
    <div class="foot"><button class="stopbtn" id="btnStop" disabled><span data-icon="stop" data-size="24"></span>STOP!</button><span class="others" id="others"></span></div>`;
}

function answerCell(st, pid, cat) {
  const a = st.answers[pid]?.[cat] || '';
  const ck = st.checks[pid]?.[cat];
  const icon = { ok: 'ok', unk: 'unk', bad: 'bad', empty: 'bad', livre: 'free' }[ck] || 'unk';
  const votes = st.votes[pid]?.[cat] || [];
  const valid = st.validity[pid]?.[cat];
  const mine = pid === S.me.pid;
  const iv = votes.includes(S.me.pid);
  const pts = st.phase !== 'voting' ? `<span class="pts">${st.roundScores?.[pid]?.[cat] ?? 0}</span>` : '';
  const votable = st.phase === 'voting' && !mine && !['bad', 'empty'].includes(ck);
  return `<td class="${votable ? 'cell' : ''} ${mine ? 'mine' : ''} ${valid ? 'valid' : 'invalid'} ${iv ? 'voted' : ''}" ${votable ? `data-target="${pid}" data-cat="${esc(cat)}" title="${iv ? 'Retirar meu voto' : ck === 'unk' ? 'Votar para ACEITAR' : 'Votar para CONTESTAR'}"` : ''}>
    <span data-icon="${icon}"></span> ${a ? esc(a.toUpperCase()) : '—'}${votes.length ? `<span class="vc">[${votes.length}✋]</span>` : ''}${pts}</td>`;
}
function scoreTable(st) {
  const ids = st.voters.filter(id => st.players[id]);
  const head = `<tr><th>Categoria</th>${ids.map(id => `<th style="color:${esc(st.players[id].color)}">${esc(st.players[id].nick)}${id === S.me.pid ? ' (você)' : ''}</th>`).join('')}</tr>`;
  const rows = st.settings.categories.map(c => `<tr><th>${esc(c)}</th>${ids.map(id => answerCell(st, id, c)).join('')}</tr>`).join('');
  const tot = st.phase !== 'voting' ? `<tr class="total"><td>Rodada</td>${ids.map(id => `<td>+${Object.values(st.roundScores[id] || {}).reduce((a, b) => a + b, 0)}</td>`).join('')}</tr>
    <tr class="total"><td>Total</td>${ids.map(id => `<td>${st.players[id].score}</td>`).join('')}</tr>` : '';
  return `<div class="tbl-wrap"><table class="grid">${head}${rows}${tot}</table></div>`;
}
const legend = `<div class="legend"><span><span data-icon="ok"></span>achei no dicionário</span><span><span data-icon="unk"></span>não achei (vale se aceitarem)</span><span><span data-icon="free"></span>categoria livre</span><span><span data-icon="bad"></span>vazia/letra errada</span></div>`;
function viewVoting(st) {
  return `<div class="phase-head"><span data-icon="book"></span><h2>Apuração — letra <b>${st.letter}</b></h2><span class="pill" id="phasePill"></span></div>
    <p>Clique numa resposta alheia para <b>contestar</b> (ou <b>aceitar</b>, se o dicionário não achou). A maioria dos outros jogadores decide.</p>
    ${legend}<div id="tbl">${scoreTable(st)}</div>
    <div class="foot"><button class="btn primary" id="btnReady"><span data-icon="ok"></span> Pronto, pode apurar</button><span class="others" id="others"></span></div>`;
}
function viewResults(st) {
  return `<div class="phase-head"><span data-icon="trophy"></span><h2>Resultado da rodada ${st.round} — letra <b>${st.letter}</b></h2><span class="pill" id="phasePill"></span></div>
    ${legend}${scoreTable(st)}
    <div class="foot"><button class="btn primary" id="btnReady">${st.round >= st.settings.rounds ? 'Ver resultado final' : 'Próxima rodada'} →</button><span class="others" id="others"></span></div>`;
}
function viewFinal(st) {
  const ids = Object.keys(st.players).sort((a, b) => st.players[b].score - st.players[a].score);
  const medal = ['🥇', '🥈', '🥉'];
  const host = st.hostId === S.me.pid;
  const w = st.players[ids[0]];
  const art = `     ___________
    '._==_==_=_.'
    .-\\:      /-.
   | (|:.     |) |
    '-|:.     |-'
      \\::.    /
       '::. .'
         ) (
       _.' '._
      '-------'`;
  return `<div class="phase-head"><span data-icon="trophy"></span><h2>Fim de jogo!</h2></div>
    <div class="center"><pre class="podium">${esc(art)}</pre>
    <p class="big">${esc(w?.nick || '?')} venceu!</p></div>
    <table class="grid" style="max-width:420px;margin:0 auto">${ids.map((id, i) => `<tr><td>${medal[i] || (i + 1) + 'º'}</td><td style="color:${esc(st.players[id].color)}">${esc(st.players[id].nick)}</td><td>${st.players[id].score} pts</td></tr>`).join('')}</table>
    ${host ? viewSettings(st) : ''}
    <div class="foot center" style="justify-content:center">${host ? '<button class="btn primary" id="btnStart"><span data-icon="dice"></span> JOGAR DE NOVO</button>' : `<span class="others">Esperando @${esc(st.players[st.hostId]?.nick || '?')} começar outra…</span>`}</div>`;
}

function bindGame(st) {
  const g = $('#game');
  const sendSettings = patch => act('settings', patch).catch(e => alertBox(esc(e.message)));
  g.querySelectorAll('[data-cat][type=checkbox]').forEach(cb => cb.onchange = () => {
    const cats = [...g.querySelectorAll('[data-cat][type=checkbox]:checked')].map(x => x.dataset.cat);
    if (cats.length < 3) { cb.checked = true; return alertBox('Mínimo de 3 categorias.'); }
    sendSettings({ categories: cats });
  });
  const add = $('#addCat');
  if (add) {
    const doAdd = () => { const v = $('#customCat').value.trim(); if (!v) return; sendSettings({ categories: [...st.settings.categories, v] }); };
    add.onclick = doAdd; $('#customCat').onkeydown = e => { if (e.key === 'Enter') doAdd(); };
  }
  const r = $('#cfgRounds'); if (r) r.onchange = () => sendSettings({ rounds: +r.value });
  const t = $('#cfgTime'); if (t) t.onchange = () => sendSettings({ time: +t.value });
  g.querySelectorAll('[data-letter]').forEach(b => b.onclick = () => {
    const set = new Set(st.settings.letters.split(''));
    set.has(b.dataset.letter) ? set.delete(b.dataset.letter) : set.add(b.dataset.letter);
    if (set.size < 5) return alertBox('Deixe pelo menos 5 letras.');
    sendSettings({ letters: [...set].sort().join('') });
  });
  const start = $('#btnStart'); if (start) start.onclick = () => act('start').catch(e => alertBox(esc(e.message)));

  g.querySelectorAll('input.ans').forEach(inp => {
    inp.addEventListener('input', () => { markInput(inp); clearTimeout(S.saveTimer); S.saveTimer = setTimeout(() => saveAnswers(), 600); updateStopBtn(); });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const all = [...g.querySelectorAll('input.ans')]; const i = all.indexOf(inp);
        if (i < all.length - 1) all[i + 1].focus(); else if (!$('#btnStop').disabled) $('#btnStop').click();
      }
    });
  });
  const stop = $('#btnStop');
  if (stop) stop.onclick = async () => { stop.disabled = true; try { await act('stop', { answers: collect() }); } catch (e) { alertBox(esc(e.message)); updateStopBtn(); } };

  g.querySelectorAll('td.cell').forEach(td => td.onclick = async () => {
    td.classList.toggle('voted');
    try { const r = await act('vote', { target: td.dataset.target, cat: td.dataset.cat }); } catch (e) { alertBox(esc(e.message)); }
  });
  const ready = $('#btnReady'); if (ready) ready.onclick = () => { ready.disabled = true; act('ready').catch(e => alertBox(esc(e.message))); };
}

function collect() { const o = {}; document.querySelectorAll('#game input.ans').forEach(i => o[i.dataset.cat] = i.value.trim()); return o; }
let lastSent = '';
function saveAnswers(force) {
  if (!S.st || !['playing', 'stopping'].includes(S.st.phase)) return;
  const a = collect(); const j = JSON.stringify(a);
  if (!force && j === lastSent) return;
  lastSent = j;
  act('answer', { answers: a }).catch(() => { lastSent = ''; });
}
function markInput(inp) {
  const L = (S.st?.letter || '').toLowerCase();
  const v = norm(inp.value);
  inp.classList.toggle('good', !!v && v[0] === L);
  inp.classList.toggle('wrong', !!v && v[0] !== L);
}
function updateStopBtn() {
  const b = $('#btnStop'); if (!b || !S.st) return;
  const L = (S.st.letter || '').toLowerCase();
  const ok = S.st.phase === 'playing' && now() >= S.st.roundStart && [...document.querySelectorAll('#game input.ans')].every(i => { const v = norm(i.value); return v && v[0] === L; });
  b.disabled = !ok;
}

// Atualizações que mudam a cada tick sem recriar o DOM
function updateDynamic(st) {
  const t = now();
  const pill = $('#phasePill');
  if (st.phase === 'playing' || st.phase === 'stopping') {
    const big = $('#bigLetter'); if (!big) return;
    const counting = st.phase === 'playing' && (t < st.roundStart || !st.letter);
    const inputs = document.querySelectorAll('#game input.ans');
    if (counting) {
      big.classList.add('rolling');
      big.textContent = ALL_LETTERS[Math.floor(t / 70) % 26];
      $('#termL1').textContent = `> sorteando letra… ${Math.ceil((st.roundStart - t) / 1000)}`;
      $('#termL2').textContent = '';
      inputs.forEach(i => i.disabled = true);
    } else {
      big.classList.remove('rolling');
      big.textContent = st.letter || '?';
      const left = st.roundEnd - t;
      if (st.phase === 'playing') {
        $('#termL1').textContent = `> LETRA ${st.letter} — tempo ${fmt(left)}`;
        $('#termL2').innerHTML = `<span class="cursor">&gt; preencha tudo e grite STOP </span>`;
        if (inputs[0]?.disabled) { inputs.forEach(i => { i.disabled = false; markInput(i); }); inputs[0].focus(); }
        if (left < 10000 && left > 0 && Math.floor(left / 1000) !== S._lastTick) { S._lastTick = Math.floor(left / 1000); beep(SFX.tick); }
      } else {
        $('#termL1').textContent = st.stopBy ? `> STOP! por ${st.stopBy}` : '> TEMPO ESGOTADO';
        $('#termL2').textContent = `> recolhendo respostas… ${Math.ceil(Math.max(0, st.stopAt - t) / 1000)}`;
        inputs.forEach(i => i.disabled = true);
        $('#btnStop').disabled = true;
      }
      const frac = Math.max(0, Math.min(1, left / (st.settings.time * 1000)));
      const on = st.phase === 'stopping' ? 0 : Math.ceil(frac * 30);
      const bar = $('#timebar');
      bar.classList.toggle('hot', frac < .2);
      [...bar.children].forEach((i, k) => i.classList.toggle('off', k >= on));
      if (pill) pill.textContent = st.phase === 'stopping' ? 'STOP!' : 'valendo!';
    }
    if (st.phase === 'playing') updateStopBtn();
    const others = Object.keys(st.players).filter(id => id !== S.me.pid).map(id => `${st.players[id].nick}: ${st.answers[id]?._filled ?? 0}/${st.settings.categories.length}`);
    const o = $('#others'); if (o) o.textContent = others.join(' · ');
  }
  if (st.phase === 'voting' || st.phase === 'results') {
    if (pill) pill.textContent = fmt(st.phaseEnd - t);
    const o = $('#others');
    const need = st.phase === 'voting' ? st.voters.filter(id => st.players[id]) : Object.keys(st.players);
    if (o) o.textContent = `prontos: ${(st.ready || []).filter(id => need.includes(id)).length}/${need.length}`;
    const rb = $('#btnReady'); if (rb && st.ready.includes(S.me.pid)) rb.disabled = true;
    if (st.phase === 'voting') {
      // atualiza a tabela sem perder posição
      const tbl = $('#tbl'); const html = scoreTable(st);
      if (tbl && tbl.dataset.h !== html) { tbl.dataset.h = html; tbl.innerHTML = html; paintIcons(tbl); bindGame(st); }
    }
  }
}

/* ---------- Chat ---------- */
$('#chatForm').onsubmit = async e => {
  e.preventDefault();
  const inp = $('#chatInput'); const text = inp.value.trim(); if (!text) return;
  inp.value = '';
  if (text === '/help') return localLog('Comandos: /me ação · /nick novo · /clear · /sair · /som', 'sys');
  if (text === '/clear') { $('#log').innerHTML = ''; return; }
  if (text === '/sair' || text === '/part' || text === '/quit') return leave();
  if (text === '/som') return toggleSound();
  try { await act('chat', { text }); } catch (err) { localLog('*** ' + esc(err.message), 'err'); }
};

async function leave() {
  if (S.view !== 'room') return;
  const ok = await dialog({ title: 'Sair', icon: 'door', html: `<p>Sair do canal #${esc(S.st?.name || '')}?</p>`, buttons: [{ label: 'Sair', value: 1 }, { label: 'Ficar', value: 0 }] });
  if (!ok) return;
  try { await act('leave'); } catch { }
  localStorage.removeItem('ad_me_' + S.code);
  showLobby();
}

/* ---------- Barra de ferramentas ---------- */
function toggleSound() {
  S.sound = !S.sound; localStorage.setItem('ad_sound', S.sound ? '1' : '0');
  const ic = $('#tSound span'); ic.dataset.icon = S.sound ? 'speaker' : 'mute'; paintIcons($('#tSound'));
  if (S.sound) beep(SFX.join);
}
$('#tSound').onclick = toggleSound;
$('#tConnect').onclick = $('#tList').onclick = () => S.view === 'room' ? leave() : loadRooms();
$('#btnX').onclick = () => leave();
$('#tShare').onclick = async () => {
  if (S.view !== 'room') return alertBox('Entre num canal primeiro.', 'info');
  const link = `${location.origin}/#${S.code}`;
  try { await navigator.clipboard.writeText(link); $('#sbInfo').textContent = `Link copiado: ${link}`; } catch { dialog({ html: `<p>Mande este link pra galera:</p><p><code>${esc(link)}</code></p>`, icon: 'link' }); }
};
const helpHTML = `<p><b>Adedanha</b> (ou Stop!) para 2 a 12 pessoas.</p>
  <p>1. O @ do canal escolhe as categorias e inicia.<br>2. Uma letra é sorteada; preencha todas as categorias com ela.<br>3. Quem completar tudo pode gritar <b>STOP!</b> e a rodada acaba para todos.<br>4. Na apuração, o dicionário (~360 mil palavras, 64 mil nomes, 5 mil lugares) marca cada resposta. Clique nas respostas dos outros para contestar ou aceitar: vale o que a maioria decidir.<br>5. Resposta única = 10, repetida = 5, inválida = 0.</p>
  <p>Chat: <code>/me</code>, <code>/nick</code>, <code>/clear</code>, <code>/sair</code>.</p>`;
$('#tHelp').onclick = document.querySelector('.menu-help').onclick = () => dialog({ title: 'Ajuda — Como jogar', icon: 'help', html: helpHTML });

/* ---------- Relógio e inicialização ---------- */
setInterval(() => $('#clock').textContent = new Date().toTimeString().slice(0, 5), 1000);
$('#clock').textContent = new Date().toTimeString().slice(0, 5);
$('#favicon').href = 'data:image/svg+xml,' + encodeURIComponent(iconSVG('logo', 32).replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'));
$('#nick').value = localStorage.getItem('ad_nick') || '';
$('#nick').addEventListener('change', () => localStorage.setItem('ad_nick', getNick()));
if (!S.sound) $('#tSound span').dataset.icon = 'mute';
paintIcons();
window.addEventListener('hashchange', () => { const c = location.hash.slice(1); if (c && c !== S.code) joinRoom(c); });
window.addEventListener('beforeunload', () => saveAnswers(true));
const startHash = location.hash.slice(1);
showLobby();
if (startHash) joinRoom(startHash);
