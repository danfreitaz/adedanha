// API única do Adedanha.
// GET  ?op=list                         → canais públicos
// GET  ?op=room&code=&pid=&since=       → estado da sala (com "relógio" do jogo)
// POST {op:'create'|'join'|'act', ...}  → ações
const store = require('../lib/store');
const G = require('../lib/game');

const send = (res, status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
const code5 = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    if (req.method === 'GET') {
      if (q.op === 'list') return send(res, 200, { rooms: await store.list() });
      if (q.op === 'room') {
        const code = String(q.code || '').toUpperCase();
        const since = parseInt(q.since) || -1;
        const now = Date.now();
        const { result, seq } = await store.mutate(code, st => {
          let changed = G.tick(st, now);
          const p = st.players[q.pid];
          if (p && now - p.lastSeen > 15000) { p.lastSeen = now; changed = true; }
          return { changed, result: st };
        });
        if (seq === since) return send(res, 200, { same: true, seq, now });
        return send(res, 200, { seq, state: G.view(result, q.pid, now) });
      }
      return send(res, 400, { error: 'op inválida' });
    }

    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const now = Date.now();
    if (b.op === 'create') {
      const st = G.newRoom(b.name, b.settings, now);
      const me = G.join(st, b.nick, now);
      let code;
      for (let i = 0; i < 6; i++) { code = code5(); if (await store.insert(code, st)) break; code = null; }
      if (!code) throw new Error('Não consegui criar o canal, tente de novo.');
      return send(res, 200, { code, ...me });
    }
    const code = String(b.code || '').toUpperCase();
    if (b.op === 'join') {
      const { result } = await store.mutate(code, st => { G.tick(st, now); return { changed: true, result: G.join(st, b.nick, now) }; });
      return send(res, 200, { code, ...result });
    }
    if (b.op === 'act') {
      const { result, seq } = await store.mutate(code, st => {
        const p = st.players[b.pid];
        if (!p || p.key !== b.key) throw Object.assign(new Error('Sessão expirada. Entre no canal de novo.'), { status: 401 });
        G.tick(st, now);
        G.act(st, b.pid, b.action, b.data || {}, now);
        G.tick(st, now);
        return { changed: true, result: st };
      });
      return send(res, 200, { seq, state: G.view(result, b.pid, now) });
    }
    return send(res, 400, { error: 'op inválida' });
  } catch (e) {
    send(res, e.status || 400, { error: e.message || 'Erro' });
  }
};
