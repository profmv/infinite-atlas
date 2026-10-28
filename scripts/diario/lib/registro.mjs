// Escrita no diário: abrir/retomar sessão, entradas, ações, fechamento, índice e verificação.
// Regra de formato (docs/FORMATO.md): só o plugin escreve na coluna 0 (#, ##, ### N., - **N.k**);
// todo conteúdo alheio (prompt, texto do agente, saída, diff) vai citado (> ) ou recuado em cerca,
// para que a varredura de numeração nunca confunda conteúdo com estrutura.
import { appendFileSync, writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync, copyFileSync, readdirSync, statSync, realpathSync, renameSync } from 'node:fs';
import { join, dirname, relative, isAbsolute, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { MARCADOR, PASTA_SCRIPTS, PASTA_DIARIO } from './config.mjs';
import { RE_ARQUIVO, listarDiarios, proximoArquivo, varrerUltimoN, garantirPastas, registrarErro } from './estado.mjs';
import { temMarcador, arquivosAlheios, situacaoPasta } from './raiz.mjs';
import { agora, dataISO, hora, carimbo, citar, redigir, recortar, inline, encurtar, dormir } from './util.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));

// ---- Caminhos -------------------------------------------------------------------------------
// Canônico: no Windows o cwd pode vir em nome curto 8.3 (C:\Users\MARCOS~1) e o file_path da
// ferramenta em nome longo; realpathSync.native expande (o realpathSync JS não). Caminho ainda
// inexistente: canoniza o ancestral mais próximo que existe e reanexa o resto.
export function canon(p) {
  let resto = '';
  for (let a = String(p); ; ) {
    try { return join(realpathSync.native(a), resto); } catch { /* sobe um nível */ }
    const pai = dirname(a);
    if (pai === a) return p;
    resto = join(basename(a), resto); a = pai;
  }
}
const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const rel = (raiz, p) => relative(canon(raiz), canon(p));
export function dentro(raiz, p) {
  if (!p) return false;
  const r = relative(norm(canon(raiz)), norm(canon(p)));
  return !r.startsWith('..') && !isAbsolute(r);
}
export const mostrarCaminho = (raiz, p) => (dentro(raiz, p) ? rel(raiz, p) : String(p)).split('\\').join('/');
export const recuar = (texto, n = 2) => texto.split('\n').map((l) => (l ? ' '.repeat(n) + l : l)).join('\n');

// ---- Pasta e textos fixos -------------------------------------------------------------------
const README = `# Diário do projeto
${MARCADOR}

Gravado em tempo real pelos hooks do plugin: um arquivo por sessão, \`DIARIO_AAAA-MM-DD_XXX.md\`
(sequência do dia), entradas \`### N.\` numeradas no projeto inteiro, ações \`N.k\`. Índice em
\`INDICE.md\`. Não edite os arquivos à mão: o agente acrescenta notas, decisões, fases e o resumo
com o comando \`diario\` (ou \`node ${PASTA_SCRIPTS}/diario.mjs\`, para agentes sem o plugin).

Para devolver esta pasta ao projeto, apague a linha de marcação acima: o plugin para de gravar.
`;

export function criarPasta(ctx) {
  mkdirSync(ctx.dirDiario, { recursive: true });
  const rd = join(ctx.dirDiario, 'README.md');
  if (!existsSync(rd)) writeFileSync(rd, README);
  vendorizar(ctx.raiz);
}

// Copia o CLI para scripts/diario/ do projeto (agentes sem hook usam essa cópia). Só se a versão mudou.
export function vendorizar(raiz) {
  const origemScripts = dirname(AQUI);                 // <plugin>/scripts
  const destino = join(raiz, PASTA_SCRIPTS);
  if (norm(origemScripts) === norm(destino)) return;   // já é a cópia vendorizada
  let versao = '?';
  try { versao = JSON.parse(readFileSync(join(dirname(origemScripts), '.claude-plugin', 'plugin.json'), 'utf8')).version; } catch { return; }
  const marca = join(destino, 'VERSAO');
  try { if (readFileSync(marca, 'utf8').trim() === versao) return; } catch { /* primeira vez */ }
  mkdirSync(join(destino, 'lib'), { recursive: true });
  copyFileSync(join(origemScripts, 'diario.mjs'), join(destino, 'diario.mjs'));
  for (const n of readdirSync(AQUI)) if (n.endsWith('.mjs')) copyFileSync(join(AQUI, n), join(destino, 'lib', n));
  writeFileSync(marca, versao + '\n');
}

function git(raiz, args) {
  try { return execFileSync('git', ['-C', raiz, ...args], { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim(); } catch { return ''; }
}
// Lido ANTES da trava por quem pode abrir sessão (git leva até 3 s; C10) e passado a abrirSessao.
export const lerHead = (raiz) => git(raiz, ['rev-parse', 'HEAD']);

// ---- Sessão ---------------------------------------------------------------------------------
// s.solto: o último bloco não foi ação (item de lista); a próxima ação precisa de linha em branco antes.
// Toda escrita no DIARIO_*.md passa por limpo(): segredo redigido aqui, para nenhum chamador escapar,
// e fim de linha que não seja \n neutralizado. \r e U+2028/2029 são fim de linha para o CommonMark e
// para a regex /m da varredura, mas citar/recuar só quebram em \n: sem isto, "a\r### 9." punha
// estrutura falsa na coluna 0.
export const limpo = (t) => redigir(String(t)).replace(/\r\n/g, '\n').replace(/\r/g, '␍').replace(/[\u2028\u2029]/g, ' ');
const celula = (t) => String(t).replace(/\s+/g, ' ').replace(/\|/g, '\\|').replace(/`/g, "'");
const anexar = (ctx, s, texto, ehAcao = false) => { appendFileSync(join(ctx.dirDiario, s.arquivo), limpo(texto)); s.atividade = Date.now(); s.solto = !ehAcao; };

// Abre (startup/clear/desconhecida) ou retoma (resume/compact de sessão conhecida). Devolve a sessão.
// Roda sob a trava: aqui só o que precisa ser atômico (N, escolha do nome e criação do arquivo). O
// índice fica marcado em ctx.indiceSujo e é regenerado depois da trava (indicePendente). head: HEAD
// lido antes da trava; sem ele (caminho raro: sessão aberta por evento que não é SessionStart), lê aqui.
export function abrirSessao(ctx, estado, { sid, source = 'startup', transcript = '', agente = 'Claude Code', head }) {
  const d = agora();
  const ja = estado.sessoes[sid];
  if (ja && existsSync(join(ctx.dirDiario, ja.arquivo)) && source !== 'startup' && source !== 'clear') {
    if (ja.encerrado) {
      anexar(ctx, ja, `\n## Retomada [${carimbo(d, ja.data)}] (${celula(source)})\n`); ja.encerrado = false;
      ctx.indiceSujo = true; // a linha dela volta a "aberta"
    } else if (source === 'compact') anexar(ctx, ja, `\n> ⟳ [${carimbo(d, ja.data)}] Contexto compactado; sessão continua.\n`);
    if (transcript) { ja.transcrito = transcript; ja.offset = tamanhoSeguro(transcript); }
    return ja;
  }
  // Arquivo novo: o estado pode não saber de ### N. que entraram por fora dele (pasta reivindicada,
  // marcador devolvido à mão). A varredura custa ~2 ms para 18 arquivos e só roda aqui.
  estado.ultimoN = Math.max(estado.ultimoN, varrerUltimoN(ctx.dirDiario));
  const data = dataISO(d);
  const arquivo = proximoArquivo(ctx.dirDiario, data);
  const seq = arquivo.match(RE_ARQUIVO)[2];
  writeFileSync(join(ctx.dirDiario, arquivo), limpo(
    `# Diário — ${data} · sessão ${seq}\n${MARCADOR} Gravado pelos hooks; o agente acrescenta com \`diario\`. Não edite à mão.\n\n` +
    `| Início | Sessão | Origem | Agente |\n|---|---|---|---|\n| ${data} ${hora(d)} | \`${celula(String(sid).slice(0, 8))}\` | ${celula(source)} | ${celula(agente)} |\n`));
  const s = {
    arquivo, data, source, inicio: d.getTime(), atividade: Date.now(), head: head ?? lerHead(ctx.raiz),
    transcrito: transcript, offset: tamanhoSeguro(transcript), nAtual: null, k: 0, itens: 0,
    pedidos: 0, acoes: 0, falhas: 0, destrutivas: 0, tocados: [], handoff: false, resumo: false, stopBloqueado: false, encerrado: false,
  };
  estado.sessoes[sid] = s;
  ctx.indiceSujo = true;
  return s;
}
function tamanhoSeguro(p) { try { return p ? statSync(p).size : 0; } catch { return 0; } }

// Sessão para o CLI: id do ambiente > mais recente aberta.
export function acharSessao(estado, sid) {
  if (sid && estado.sessoes[sid]) return [sid, estado.sessoes[sid]];
  const abertas = Object.entries(estado.sessoes).filter(([, s]) => !s.encerrado).sort((a, b) => b[1].atividade - a[1].atividade);
  return abertas[0] || [null, null];
}

// ---- Entradas e ações -----------------------------------------------------------------------
export function novoPedido(ctx, estado, s, texto, titulo = 'Pedido') {
  const d = agora();
  const n = ++estado.ultimoN;
  s.nAtual = n; s.k = 0; s.pedidos++; s.itens++;
  const r = recortar(redigir(texto), 10000, ctx.config.promptMaxChars, 100000);
  anexar(ctx, s, `\n### ${n}. [${carimbo(d, s.data)}] ${titulo}\n\n${citar(r.texto || '(vazio)')}\n${r.nota ? `\n_${r.nota}_\n` : ''}`);
  return n;
}

// corpo: linhas já formatadas, sem recuo; o recuo de item de lista é aplicado aqui.
export function novaAcao(ctx, estado, s, titulo, corpo = '') {
  const d = agora();
  if (!s.nAtual) novoPedido(ctx, estado, s, '(ação sem pedido registrado nesta sessão)', 'Continuação');
  s.k++; s.itens++; s.acoes++;
  const id = `${s.nAtual}.${s.k}`;
  const sep = s.k === 1 || s.solto ? '\n' : '';
  // Título é uma linha só, venha de onde vier (subagent_type, nome de ferramenta de MCP…).
  const umaLinha = String(titulo).replace(/\s*[\r\n]+\s*/g, ' ');
  anexar(ctx, s, `${sep}- **${id}** [${carimbo(d, s.data)}] ${umaLinha}\n${corpo ? recuar(corpo) + '\n' : ''}`, true);
  return id;
}

export function textoAgente(ctx, s, textos) {
  const junto = textos.join('\n\n').trim();
  if (!junto) return;
  const r = recortar(redigir(junto), 100000, ctx.config.textoAgenteMaxChars, 100000);
  s.itens++;
  anexar(ctx, s, `\n**Agente [${carimbo(agora(), s.data)}]:**\n\n${citar(r.texto)}\n${r.nota ? `\n_${r.nota}_\n` : ''}`);
}

export function secao(ctx, s, titulo, corpo = '') {
  s.itens++;
  anexar(ctx, s, `\n## ${titulo} [${carimbo(agora(), s.data)}]\n${corpo ? '\n' + corpo + '\n' : ''}`);
}

export function linhaSolta(ctx, s, texto) { anexar(ctx, s, `\n${texto}\n`); }

// ---- Fechamento -----------------------------------------------------------------------------
const duracao = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

export function fecharSessao(ctx, estado, sid, motivo = '') {
  const s = estado.sessoes[sid];
  if (!s || s.encerrado) return null;
  const arq = join(ctx.dirDiario, s.arquivo);
  if (!existsSync(arq)) { delete estado.sessoes[sid]; return null; }
  if (!s.itens) {
    // Sessão sem nada: some, se for a última do dia (não deixa buraco na sequência).
    const doDia = listarDiarios(ctx.dirDiario).filter((n) => n.includes(`DIARIO_${s.data}`));
    if (doDia[doDia.length - 1] === s.arquivo) { unlinkSync(arq); delete estado.sessoes[sid]; ctx.indiceSujo = true; return 'removida'; }
  }
  const d = agora();
  const linhas = [
    '| Duração | Pedidos | Ações | Falhas | ⚠️ Destrutivas | Motivo |', '|---|---|---|---|---|---|',
    `| ${duracao(d.getTime() - s.inicio)} | ${s.pedidos} | ${s.acoes} | ${s.falhas} | ${s.destrutivas} | ${celula(motivo || '—')} |`,
  ];
  if (s.tocados.length) linhas.push('', `**Arquivos tocados (${s.tocados.length}):** ` + s.tocados.map((t) => inline(t)).join(', '));
  if (s.head) {
    const log = git(ctx.raiz, ['log', '--format=%h %s', `${s.head}..HEAD`]);
    if (log) linhas.push('', '**Commits:**', '', ...log.split('\n').slice(0, 50).map((l) => { const i = l.indexOf(' '); return '- `' + l.slice(0, i) + '` ' + redigir(l.slice(i + 1)); }));
  }
  const ids = [...new Set((readFileSync(arq, 'utf8').match(/\b(?:ADR|ERR|LIC|DEC|RISCO|INC)-\d+\b/g) || []))];
  if (ids.length) linhas.push('', '**IDs citados:** ' + ids.join(', '));
  s.encerrado = true; s.itens++;
  appendFileSync(arq, limpo(`\n---\n\n## Encerramento [${carimbo(d, s.data)}]\n\n${linhas.join('\n')}\n`));
  ctx.indiceSujo = true;
  return 'encerrada';
}

// ---- Índice ---------------------------------------------------------------------------------
// Sessão aberta (sem encerramento, ou retomada depois do último) só mostra o que não muda enquanto ela
// corre: assim o INDICE.md continua igual ao regenerado e `verificar` passa no meio da sessão.
const ultimo = (texto, re) => { let m = null; for (const x of texto.matchAll(re)) m = x; return m; };
function resumoDe(nome, texto) {
  const ini = texto.match(/^\| (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) \| `([^`]*)` \| ([^|]*) \|/m);
  const fim = ultimo(texto, /^## Encerramento \[([^\]]+)\]/gm);
  const retomada = ultimo(texto, /^## Retomada \[/gm);
  if (!fim || (retomada && retomada.index > fim.index)) return `| [${nome}](${nome}) | ${ini ? ini[1] : '—'} | — | — | aberta |  |`;
  const nums = [...texto.matchAll(/^### (\d+)\./gm)].map((m) => +m[1]);
  const acoes = (texto.match(/^- \*\*\d+\.\d+\*\*/gm) || []).length;
  const res = ultimo(texto, /^## Resumo \[[^\]]+\]\n\n(.+)/gm);
  const faixa = nums.length ? (nums.length > 1 ? `${nums[0]}–${nums[nums.length - 1]}` : `${nums[0]}`) : '—';
  let resumo = res ? res[1].replace(/^>\s?/, '').replace(/\|/g, '\\|').trim() : '';
  resumo = encurtar(resumo, 100);
  return `| [${nome}](${nome}) | ${ini ? ini[1] : '—'} | ${faixa} | ${acoes} | ${fim[1]} | ${resumo} |`;
}

export function textoIndice(dirDiario) {
  const linhas = listarDiarios(dirDiario).map((n) => { try { return resumoDe(n, readFileSync(join(dirDiario, n), 'utf8').replace(/\r\n/g, '\n')); } catch { return ''; } }).filter(Boolean);
  return `# Índice do diário\n${MARCADOR} Gerado por \`diario indice\`; não edite à mão.\n\n| Arquivo | Início | Entradas | Ações | Encerrada | Resumo |\n|---|---|---|---|---|---|\n${linhas.join('\n')}${linhas.length ? '\n' : ''}`;
}

// Roda FORA da trava (C10): dois processos podem gerar ao mesmo tempo. Escrita atômica (temporário em
// .estado/ + rename, ninguém lê índice pela metade) e releitura depois de escrever: se um concorrente
// mais lento renomeou por cima um índice velho, a volta seguinte vê a diferença e regrava. Quem
// renomeia por último sempre relê depois, então o índice final reflete o diário, desde que toda
// mudança que afete o índice chame gerarIndice depois dela (ctx.indiceSujo + indicePendente).
export function gerarIndice(dirDiario) {
  const alvo = join(dirDiario, 'INDICE.md');
  for (let volta = 0; volta < 5; volta++) {
    const novo = textoIndice(dirDiario);
    let atual = null; try { atual = readFileSync(alvo, 'utf8'); } catch { /* novo */ }
    if (atual !== null && atual.replace(/\r\n/g, '\n') === novo) return;
    const tmp = join(garantirPastas(dirDiario), `INDICE.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
    writeFileSync(tmp, novo);
    for (let i = 0; ; i++) {
      try { renameSync(tmp, alvo); break; } catch (e) {
        // Windows: destino aberto por outro processo (leitor, antivírus) recusa o rename de passagem.
        if (i >= 20 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) { try { unlinkSync(tmp); } catch { /* já foi */ } throw e; }
        dormir(10);
      }
    }
  }
}

// Depois de soltar a trava: regenera o índice se o trabalho sob ela mudou algo que ele mostra.
// Falha aqui não desfaz o que já foi gravado nem derruba o hook: vai para erros.log.
export function indicePendente(ctx) {
  if (!ctx.indiceSujo) return;
  ctx.indiceSujo = false;
  try { gerarIndice(ctx.dirDiario); } catch (e) { registrarErro(ctx.dirDiario, e); }
}

// ---- Verificação (portão) -------------------------------------------------------------------
export function verificar(dirDiario) {
  const erros = [], avisos = [];
  const sit = situacaoPasta(dirDiario);
  if (sit.situacao === 'nova') return { erros, avisos: ['pasta do diário ainda não existe'] };
  if (sit.situacao === 'projeto') return { erros, avisos: [sit.motivo + ' (nada a verificar pelo plugin)'] };
  for (const n of arquivosAlheios(dirDiario)) erros.push(`${n}: DIARIO_*.md sem "${MARCADOR}" (escrita fora do plugin; o plugin não grava enquanto existir)`);
  const vistos = new Map();
  const doPadrao = new Set(listarDiarios(dirDiario));
  for (const n of readdirSync(dirDiario)) if (/^DIARIO_.*\.md$/i.test(n) && !doPadrao.has(n) && temMarcador(join(dirDiario, n))) avisos.push(`${n}: fora do padrão de nome; não conferido`);
  for (const nome of doPadrao) {
    if (!/_\d{3}\.md$/.test(nome)) avisos.push(`${nome}: nome legado (esperado DIARIO_AAAA-MM-DD_XXX.md)`);
    const t = readFileSync(join(dirDiario, nome), 'utf8');
    if (!/^# Diário/.test(t)) erros.push(`${nome}: primeira linha deveria ser "# Diário …"`);
    let n = null, k = 0, ultimo = 0;
    // Mesmas quebras que a regex /m da varredura (e o CommonMark) reconhecem; \r\n de checkout do git conta como uma.
    t.split(/\r\n|[\n\r\u2028\u2029]/).forEach((l, i) => {
      const e = l.match(/^### (\d+)\./);
      if (e) {
        const v = +e[1];
        if (vistos.has(v)) erros.push(`${nome}:${i + 1}: entrada ${v} repetida (já em ${vistos.get(v)})`);
        else vistos.set(v, nome);
        if (v <= ultimo) erros.push(`${nome}:${i + 1}: entrada ${v} fora de ordem (depois de ${ultimo})`);
        ultimo = Math.max(ultimo, v); n = v; k = 0; return;
      }
      const a = l.match(/^- \*\*(\d+)\.(\d+)\*\*/);
      if (a) {
        if (+a[1] !== n) erros.push(`${nome}:${i + 1}: ação ${a[1]}.${a[2]} fora da entrada ${n ?? '(nenhuma)'}`);
        else if (+a[2] !== k + 1) erros.push(`${nome}:${i + 1}: ação ${a[1]}.${a[2]} esperava ${n}.${k + 1}`);
        k = +a[2];
      }
    });
  }
  let indice = null; try { indice = readFileSync(join(dirDiario, 'INDICE.md'), 'utf8'); } catch { /* ausente */ }
  if (listarDiarios(dirDiario).length && indice?.replace(/\r\n/g, '\n') !== textoIndice(dirDiario)) erros.push('INDICE.md desatualizado: rode `diario indice`');
  return { erros, avisos };
}

// ---- Reivindicação explícita (diario instalar --reivindicar) --------------------------------
// Única operação que escreve em arquivo que o plugin não criou: insere a linha de marcação no topo
// (temMarcador lê só o começo do arquivo: uma 1ª linha enorme empurraria a linha 2 para fora).
export function reivindicar(ctx) {
  const mudados = [];
  mkdirSync(ctx.dirDiario, { recursive: true });
  const marcar = (arq, padrao) => {
    if (existsSync(arq)) {
      if (temMarcador(arq)) return;
      writeFileSync(arq, MARCADOR + '\n\n' + readFileSync(arq, 'utf8'));
      if (!temMarcador(arq)) throw new Error(`marcação inserida mas não reconhecida em ${arq}`);
    } else writeFileSync(arq, padrao);
    mudados.push(basename(arq));
  };
  marcar(join(ctx.dirDiario, 'README.md'), README);
  // Todo DIARIO_*.md que desliga o plugin (arquivosAlheios), não só os de nome no padrão.
  for (const n of new Set([...listarDiarios(ctx.dirDiario), ...arquivosAlheios(ctx.dirDiario)])) marcar(join(ctx.dirDiario, n), '');
  vendorizar(ctx.raiz);
  return mudados;
}

export { PASTA_DIARIO };
