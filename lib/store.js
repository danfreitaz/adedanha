// Persistência: Neon Postgres (DATABASE_URL) ou memória (dev local).
// Concorrência otimista: cada sala tem um `seq`; gravação só passa se o seq não mudou.
let sql = null;
if (process.env.DATABASE_URL) {
  const { neon } = require('@neondatabase/serverless');
  sql = neon(process.env.DATABASE_URL);
}
const mem = new Map();
let ready = false;

async function init() {
  if (!sql || ready) return;
  await sql`create table if not exists rooms (
    code text primary key, name text not null, phase text not null, players int not null default 0,
    seq int not null default 0, state jsonb not null, updated_at timestamptz not null default now())`;
  await sql`create index if not exists rooms_updated_idx on rooms (updated_at desc)`;
  ready = true;
}

async function get(code) {
  if (!sql) { const r = mem.get(code); return r ? { seq: r.seq, state: JSON.parse(r.state) } : null; }
  await init();
  const rows = await sql`select seq, state from rooms where code = ${code}`;
  return rows[0] || null;
}

async function insert(code, state) {
  const n = Object.keys(state.players).length;
  if (!sql) { if (mem.has(code)) return false; mem.set(code, { seq: 1, state: JSON.stringify(state), name: state.name, phase: state.phase, players: n, updated: Date.now() }); return true; }
  await init();
  await sql`delete from rooms where updated_at < now() - interval '1 day'`;
  const r = await sql`insert into rooms (code, name, phase, players, seq, state) values (${code}, ${state.name}, ${state.phase}, ${n}, 1, ${JSON.stringify(state)}) on conflict do nothing returning code`;
  return r.length > 0;
}

async function save(code, seq, state) {
  const n = Object.keys(state.players).length;
  if (!sql) {
    const r = mem.get(code);
    if (!r || r.seq !== seq) return false;
    mem.set(code, { seq: seq + 1, state: JSON.stringify(state), name: state.name, phase: state.phase, players: n, updated: Date.now() });
    return true;
  }
  const r = await sql`update rooms set state = ${JSON.stringify(state)}, seq = seq + 1, phase = ${state.phase}, players = ${n}, updated_at = now()
    where code = ${code} and seq = ${seq} returning seq`;
  return r.length > 0;
}

// Lê, aplica fn(state) e grava com retentativas. fn retorna {changed, result}.
async function mutate(code, fn) {
  for (let i = 0; i < 8; i++) {
    const row = await get(code);
    if (!row) throw Object.assign(new Error('Canal não encontrado.'), { status: 404 });
    const { changed, result } = fn(row.state, row.seq);
    if (!changed) return { result, seq: row.seq };
    if (await save(code, row.seq, row.state)) return { result, seq: row.seq + 1 };
    await new Promise(r => setTimeout(r, 30 + Math.random() * 120));
  }
  throw Object.assign(new Error('Canal congestionado, tente de novo.'), { status: 409 });
}

async function list() {
  if (!sql) {
    return [...mem.entries()].filter(([, r]) => r.players > 0 && Date.now() - r.updated < 300000)
      .map(([code, r]) => ({ code, name: r.name, phase: r.phase, players: r.players }));
  }
  await init();
  return sql`select code, name, phase, players from rooms where players > 0 and updated_at > now() - interval '5 minutes' order by players desc, updated_at desc limit 50`;
}

module.exports = { get, insert, mutate, list };
