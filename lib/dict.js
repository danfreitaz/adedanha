// Dicionários pt-BR: ~359 mil palavras, ~64 mil prenomes (IBGE), ~5,6 mil lugares.
// Carregados sob demanda (só na apuração da rodada) e mantidos em memória enquanto a função estiver quente.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const cache = {};
function load(name) {
  if (cache[name]) return cache[name];
  const file = path.join(process.cwd(), 'data', `${name}.txt.gz`);
  const txt = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
  cache[name] = new Set(txt.split('\n'));
  return cache[name];
}

function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9\- ']/g, '')
    .replace(/\s+/g, ' ').trim();
}

// Que lista usar para cada categoria
function kindOf(cat) {
  const c = norm(cat);
  if (/^(nome|nomes|nome proprio|pessoa)$/.test(c) || c.startsWith('nome ')) return 'nome';
  if (/(cep|cidade|estado|pais|lugar|capital)/.test(c)) return 'lugar';
  if (/(marca|filme|serie|banda|cantor|musica|celebridade|famoso|jogo|personagem|sogra|novela|anime|time)/.test(c)) return 'livre';
  return 'palavra';
}

function inSet(set, w) {
  if (set.has(w)) return true;
  if (set.has(w.replace(/ /g, '-'))) return true;
  if (set.has(w.replace(/-/g, ' '))) return true;
  return false;
}

// Retorna 'ok' (achou), 'unk' (não achou), 'livre' (categoria sem lista)
function lookup(cat, w) {
  const kind = kindOf(cat);
  if (kind === 'livre') return 'livre';
  const words = load('palavras');
  if (kind === 'nome') {
    const nomes = load('nomes');
    const first = w.split(' ')[0];
    return nomes.has(w) || nomes.has(first) ? 'ok' : 'unk';
  }
  if (kind === 'lugar') {
    return inSet(load('lugares'), w) ? 'ok' : 'unk';
  }
  if (inSet(words, w)) return 'ok';
  // expressões compostas ("pé de moleque", "guarda chuva"): todas as palavras relevantes precisam existir
  const parts = w.split(/[ -]/).filter(p => p.length > 2);
  if (parts.length > 1 && parts.every(p => words.has(p))) return 'ok';
  return 'unk';
}

module.exports = { norm, lookup, kindOf };
