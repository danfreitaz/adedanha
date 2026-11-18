# Adedanha32 — irc.arcadia.net

Adedanha (Stop!) multiplayer no navegador, com cara de mIRC dos anos 90: fonte Fixedsys, janelas Windows 9x, terminal de fósforo verde e ícones pixel-art em SVG.

- **Sem login**: só um nick. Salas públicas aparecem na "Lista de Canais" enquanto tiver gente.
- **Dicionário grande**: ~359 mil palavras pt-BR, ~64 mil prenomes (IBGE) e ~5,6 mil lugares (municípios, estados, países, cidades do mundo).
- **Apuração justa**: o dicionário marca cada resposta; os outros jogadores clicam para contestar ou aceitar, e vale o que a maioria decidir.
- Única = 10, repetida = 5, inválida = 0.
- Chat estilo IRC com `/me`, `/nick`, `/clear` e `/sair`. Sons de PC speaker (dá pra desligar).

## Stack

- Front estático em `public/` (HTML, CSS e JS puro, sem build)
- Uma função serverless da Vercel: `api/game.js`
- Neon Postgres: uma tabela `rooms` com o estado de cada sala em JSONB e concorrência otimista (`seq`)
- Dicionários compactados em `data/*.txt.gz`, empacotados na função (`vercel.json → includeFiles`)

## Rodar local

```bash
npm install
npm run dev        # http://localhost:3000 (sem DATABASE_URL usa memória)
```

## Deploy

1. Na Vercel, importe o repositório (Framework: **Other**, sem build command).
2. Adicione a variável de ambiente `DATABASE_URL` com a connection string do Neon.
3. A tabela é criada sozinha na primeira requisição. Se preferir criar antes:

```sql
create table if not exists rooms (
  code text primary key, name text not null, phase text not null,
  players int not null default 0, seq int not null default 0,
  state jsonb not null, updated_at timestamptz not null default now());
create index if not exists rooms_updated_idx on rooms (updated_at desc);
```

Salas sem atividade por um dia são apagadas automaticamente quando alguém cria uma sala nova.

## Créditos dos dados

- Palavras: [pythonprobr/palavras](https://github.com/pythonprobr/palavras) e [fserb/pt-br](https://github.com/fserb/pt-br)
- Nomes: [datasets-br/prenomes](https://github.com/datasets-br/prenomes) (Censo IBGE)
- Municípios e estados: [kelvins/municipios-brasileiros](https://github.com/kelvins/municipios-brasileiros)
- Países: [umpirsky/country-list](https://github.com/umpirsky/country-list)
- Fonte: Fixedsys Excelsior 3.01 (domínio público)
