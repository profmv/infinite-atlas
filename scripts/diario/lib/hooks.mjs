// Tradução de eventos de hook do Claude Code em escrita no diário. Cada hook é um processo node novo:
// resolve a raiz, pega a trava, lê o estado, escreve, grava o estado. Nunca lança: erro vai para
// docs/diario/.estado/erros.log e o hook sai 0 (docs/ARQUITETURA.md).
import { readFileSync, writeFileSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, isAbsolute, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PASTA_DIARIO, PASTA_SCRIPTS } from './config.mjs';
import { resolver, arquivosAlheios } from './raiz.mjs';
import { comEstado, registrarErro } from './estado.mjs';
import { colherTexto, tamanho } from './transcrito.mjs';
import {
  criarPasta, abrirSessao, novoPedido, novaAcao, textoAgente, linhaSolta, fecharSessao,
  dentro, mostrarCaminho, canon, lerHead, indicePendente,
} from './registro.mjs';
import { agora, carimbo, sha12, redigir, recortar, cerca, citar, inline, destrutivo, fatiar, encurtar } from './util.mjs';

const CAPTURA_MAX = 512 * 1024;
const CLI = fileURLToPath(new URL('../diario.mjs', import.meta.url)).replace(/\\/g, '/');
const FERRAMENTAS_ARQUIVO = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
// Comando que só chama o próprio CLI (`diario …`, `node "…/diario.mjs" …`, com `cd` antes) não vira
// ação. Basta um segmento de outra coisa (`git reset --hard; diario nota x`) para o comando inteiro
// ser registrado. Segmentos: separados por ; & | e quebra de linha fora de aspas.
// Substituição ($( ), crase), aspa escapada e redirecionamento executam ou escrevem algo além do
// CLI: o comando com qualquer um deles é sempre registrado. Idem \r e separadores Unicode de linha
// (o shell pode tratá-los como fim de comando), aspas tipográficas (o PowerShell as trata como aspas,
// o bash não), e parêntese, chave ou # fora de aspas (subexpressão, subshell, @{} do PowerShell, que
// avalia o valor de cada chave como comando, bloco de script, comentário).
// Só conta como CLI o do plugin: `diario` sem caminho (bin/ do plugin no PATH), o bin/diario do
// plugin, o scripts/diario.mjs do plugin ou a cópia vendorizada em <raiz>/scripts/diario/. Um
// `diario.mjs` ou `./diario` qualquer é outro programa e é registrado. Com `cd` no comando, caminho
// relativo é resolvido de outra pasta, que o hook não sabe qual é: só vale `diario` sem caminho ou absoluto.
// `${…}` (${x@P}, ${x:-$(…)}, ${a[$(…)]}) e `$[…]` podem executar conteúdo de variável: registrado.
const RE_EXECUTA_MAIS = /\$\(|\$\[|\$\{|`|\\["']|[<>\r\x85\u2018-\u201E]|\p{Zl}|\p{Zp}/u;
const RE_SEG_BIN = /^(["']?)((?:[^\s"';&|]*[/\\])?)diario\1(?=\s|$)/;
const RE_SEG_NODE = /^node(?:\.exe)?\s+(?:"([^"]*)"|'([^']*)'|([^\s"']+))(?=\s|$)/;
const RE_SEG_CD = /^(?:cd|pushd|Set-Location)(?=\s|$)/i;
// Só subcomandos que registram no diário ou só leem são isentos; instalar (escreve AGENTS.md, hooks,
// cópia vendorizada) e hook são ações como quaisquer outras. Lista em COMANDOS de scripts/diario.mjs.
const ISENTOS = new Set(['', 'ajuda', '--help', '-h', 'nota', 'decisao', 'fase', 'resumo', 'iniciar', 'pedido', 'acao', 'encerrar', 'status', 'verificar', 'indice']);
const subIsento = (resto) => { const m = resto.match(/^\s*$|^\s+(["']?)([^\s"']+)\1(?=\s|$)/); return !!m && ISENTOS.has(m[2] ?? ''); };
const RE_HANDOFF = /handoff/i;
const chave = (p) => { const c = canon(p); return process.platform === 'win32' ? c.toLowerCase() : c; };

function segmentos(cmd) {
  const out = [];
  let atual = '', aspa = null;
  for (const c of cmd) {
    if (aspa) { if (c === aspa) aspa = null; atual += c; } else if (c === '"' || c === "'") { aspa = c; atual += c; } else if ('(){}#'.includes(c)) return null; else if (';&|\n'.includes(c)) { out.push(atual); atual = ''; } else atual += c;
  }
  out.push(atual);
  return out.map((x) => x.trim()).filter(Boolean);
}
export function chamaDiario(cmd, { cwd = process.cwd(), raiz = cwd } = {}) {
  if (RE_EXECUTA_MAIS.test(String(cmd || ''))) return false;
  const seg = segmentos(String(cmd || ''));
  if (!seg) return false;
  const permitidos = new Set([CLI, join(CLI, '..', '..', 'bin', 'diario'), join(raiz, PASTA_SCRIPTS, 'diario.mjs')].map(chave));
  const temCd = seg.some((x) => RE_SEG_CD.test(x));
  const ok = (p) => (!temCd || isAbsolute(p)) && permitidos.has(chave(resolve(cwd, p)));
  const ehCli = (x) => {
    let m = x.match(RE_SEG_NODE);
    if (m) { const p = m[1] ?? m[2] ?? m[3]; return /(?:^|[/\\])diario\.mjs$/.test(p) && ok(p) && subIsento(x.slice(m[0].length)); }
    m = x.match(RE_SEG_BIN);
    return !!m && (!m[2] || ok(m[2] + 'diario')) && subIsento(x.slice(m[0].length));
  };
  return seg.some(ehCli) && seg.every((x) => ehCli(x) || RE_SEG_CD.test(x));
}

// ---- Ponto de entrada -----------------------------------------------------------------------
// Devolve o objeto a imprimir em stdout (JSON de controle do hook) ou null.
export function tratarHook(entrada, env = process.env) {
  let ctx = null;
  try {
    ctx = resolver(entrada.cwd || process.cwd(), env);
    if (ctx.modo === 'desligado') return null;
    const sid = entrada.session_id || env.CLAUDE_CODE_SESSION_ID;
    if (!sid) return null;
    const ev = entrada.hook_event_name;
    const trat = TRATADORES[ev];
    if (!trat) return null;
    // Pasta com DIARIO_*.md alheio e sem .estado/: o plugin nunca gravou aqui; nem o estado ele cria.
    if (ctx.situacao !== 'nova' && !existsSync(join(ctx.dirDiario, '.estado')) && arquivosAlheios(ctx.dirDiario).length) return null;
    if (ev === 'SessionStart') return sessionStart(ctx, entrada, sid);
    // Pasta nunca criada e sessão desconhecida: só eventos que carregam trabalho abrem sessão.
    if (ctx.situacao === 'nova' && !ABREM.has(ev)) return null;
    // DIARIO_*.md alheio que apareceu com a sessão aberta: varrer a cada ação custaria caro (D3),
    // então a sessão confere a cada pedido e fim de turno (fora da trava, que é disputada); achando,
    // para de gravar (e o Stop não bloqueia) até o arquivo sumir ou ser reivindicado.
    const alheio = (ev === 'UserPromptSubmit' || ev === 'Stop') ? arquivosAlheios(ctx.dirDiario).length > 0 : null;
    const r = comEstado(ctx.dirDiario, ctx.config, (estado) => {
      let s = estado.sessoes[sid];
      if (!s || s.encerrado) {
        if (!ABREM.has(ev)) return null;
        s = abrir(ctx, estado, sid, entrada, 'desconhecida');
        if (!s) return null;
      }
      if (alheio !== null) s.desligada = alheio;
      if (s.desligada) return null;
      return trat(ctx, estado, s, entrada, sid);
    });
    indicePendente(ctx);
    return r;
  } catch (e) {
    if (ctx) registrarErro(ctx.dirDiario, e);
    return null;
  }
}

// Eventos que abrem sessão se ela ainda não existe (plugin instalado no meio da sessão, retomada).
const ABREM = new Set(['UserPromptSubmit', 'PostToolUse', 'PostToolUseFailure', 'Stop']);

function abrir(ctx, estado, sid, entrada, source, head) {
  if (ctx.situacao === 'nova') { criarPasta(ctx); ctx.situacao = 'propria'; }
  if (arquivosAlheios(ctx.dirDiario).length) return null; // DIARIO_*.md sem marcador: o projeto escreve aqui
  return abrirSessao(ctx, estado, { sid, source, transcript: entrada.transcript_path || '', head });
}

// ---- SessionStart ---------------------------------------------------------------------------
// Sob a trava só a abertura (N, nome, arquivo, estado). git antes e índice depois (C10): sessões
// que começam juntas esperam só umas pelas escritas das outras, não por git nem pela varredura do índice.
function sessionStart(ctx, entrada, sid) {
  const head = lerHead(ctx.raiz);
  const s = comEstado(ctx.dirDiario, ctx.config, (estado) => abrir(ctx, estado, sid, entrada, entrada.source || 'startup', head));
  indicePendente(ctx);
  if (!s || !ctx.config.contextoInicial) return null;
  const arq = `${PASTA_DIARIO}/${s.arquivo}`;
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext:
        `Diário desta sessão: ${arq} (gravado pelos hooks; não edite). Acrescente pelo comando \`diario\`: ` +
        `\`diario decisao "<o quê>" --porque "<motivo>"\`, \`diario nota "<texto>"\`, \`diario fase "<nome>"\`; ` +
        `depois de escrever um handoff, \`diario resumo "<2–3 linhas>"\`.` +
        // Windows: o PowerShell não roda o `bin/diario` (sh) e um .cmd seria injetável (docs/DECISOES.md, D7).
        (process.platform === 'win32' ? ` No PowerShell, troque \`diario\` por \`node "${CLI}"\`.` : ''),
    },
  };
}

// ---- Texto do agente ------------------------------------------------------------------------
// Colhe o que o agente escreveu desde a última colheita. s.ultimoTexto evita repetir o texto que o
// Stop gravou pelo fallback (last_assistant_message) quando o transcrito ainda não tinha sido escrito.
function colher(ctx, s, entrada) {
  if (entrada.agent_id) return; // evento de subagente: o transcrito principal não mudou por ele
  if (!s.transcrito && entrada.transcript_path) { s.transcrito = entrada.transcript_path; s.offset = tamanho(s.transcrito); return; }
  if (!s.transcrito) return;
  const r = colherTexto(s.transcrito, s.offset || 0);
  s.offset = r.offset;
  const textos = r.textos.filter((t) => sha12(t) !== s.ultimoTexto);
  if (textos.length) { s.ultimoTexto = null; textoAgente(ctx, s, textos); }
  return textos.length;
}

// ---- UserPromptSubmit -----------------------------------------------------------------------
function userPromptSubmit(ctx, estado, s, entrada) {
  colher(ctx, s, entrada);
  const p = String(entrada.prompt ?? '');
  if (/^\s*<task-notification>/.test(p)) {
    const m = p.match(/<summary>([\s\S]*?)<\/summary>/);
    novaAcao(ctx, estado, s, 'Notificação de tarefa: ' + inline(fatiar(redigir((m ? m[1] : 'sem resumo').trim()), 0, 300)));
    return null;
  }
  novoPedido(ctx, estado, s, p);
  return null;
}

// ---- PostToolUse / PostToolUseFailure -------------------------------------------------------
// Shell que cita a pasta do diário (relativa à raiz ou absoluta, / ou \, sem caixa) ou é destrutivo.
function shellQueImporta(ctx, ti) {
  if (typeof ti.command !== 'string') return false;
  if (destrutivo(ti.command)) return true;
  const cmd = ti.command.replace(/\\/g, '/').toLowerCase();
  return [mostrarCaminho(ctx.raiz, ctx.dirDiario), ctx.dirDiario].some((p) => cmd.includes(String(p).replace(/\\/g, '/').toLowerCase()));
}
function postTool(ctx, estado, s, entrada) {
  const nome = entrada.tool_name || '?';
  const ti = entrada.tool_input || {};
  const cfg = ctx.config;
  if (cfg.ignorarFerramentas.includes(nome)) return null;
  if (typeof ti.command === 'string' && chamaDiario(ti.command, { cwd: entrada.cwd || ctx.raiz, raiz: ctx.raiz })) return null;
  const arquivo = caminhoArquivo(ti, entrada.cwd);
  // Edição do próprio diário pelo agente (tirar o marcador do README desliga o plugin; apagar entrada
  // some com o rastro): uma linha ⚠️ sem o diff, contada como destrutiva.
  const manual = !!arquivo && FERRAMENTAS_ARQUIVO.has(nome) && dentro(ctx.dirDiario, arquivo);

  // Subagente com 'nada' não é registrado, salvo edição manual do diário ou shell que cita a pasta
  // do diário ou é destrutivo: esses viram linha.
  let sub = entrada.agent_id ? (cfg.subagentes || 'linha') : null;
  if (sub === 'nada') { if (!manual && !shellQueImporta(ctx, ti)) return null; sub = 'linha'; }
  colher(ctx, s, entrada);

  const falhou = entrada.hook_event_name === 'PostToolUseFailure';
  const f = formatar(ctx, entrada, falhou);
  if (manual) Object.assign(f, { titulo: `⚠️ ${nome} — edição manual do diário: ${inline(mostrarCaminho(ctx.raiz, arquivo))}`, corpo: f.status, destrutivo: true });
  if (f.destrutivo) s.destrutivas++;
  if (falhou) s.falhas++;
  if (arquivo && FERRAMENTAS_ARQUIVO.has(nome) && !falhou && !manual) {
    const rel = mostrarCaminho(ctx.raiz, arquivo);
    if (!s.tocados.includes(rel)) s.tocados.push(rel);
    // Handoff = .md com "handoff" no trecho abaixo da raiz (projeto em pasta "handoffs" ou
    // plan-handoff.mjs não contam).
    if (/\.md$/i.test(rel) && RE_HANDOFF.test(dentro(ctx.raiz, arquivo) ? rel : basename(arquivo))) s.handoff = true;
  }

  if (sub === 'linha') {
    const quem = entrada.agent_type ? `subagente ${entrada.agent_type}` : 'subagente';
    novaAcao(ctx, estado, s, `↳ ${quem}: ${f.titulo}${f.status ? ' ' + f.status : ''}`);
    return null;
  }
  // O id da ação precisa existir antes, para nomear a captura de script.
  if (!s.nAtual) novoPedido(ctx, estado, s, '(ação sem pedido registrado nesta sessão)', 'Continuação');
  const id = `${s.nAtual}.${s.k + 1}`;
  const capturas = cfg.copiarScriptsExternos ? capturar(ctx, s, id, scriptsExternos(ctx, nome, ti, arquivo, entrada.cwd)) : [];
  const corpo = [f.corpo, ...capturas.map((c) => `cópia: \`${c}\``)].filter(Boolean).join('\n');
  novaAcao(ctx, estado, s, f.titulo + (f.status && !f.corpo ? ' ' + f.status : ''), corpo);
  return null;
}

function caminhoArquivo(ti, cwd) {
  const p = ti.file_path || ti.notebook_path || ti.path;
  if (typeof p !== 'string' || !p) return '';
  return isAbsolute(p) ? p : resolve(cwd || process.cwd(), p);
}

// Monta título, status e corpo de uma ação de ferramenta.
export function formatar(ctx, entrada, falhou) {
  const nome = entrada.tool_name || '?';
  const ti = entrada.tool_input || {};
  const tr = entrada.tool_response;
  const cfg = ctx.config;
  const cortar = (t, maxL = cfg.saidaMaxLinhas) => recortar(redigir(t), maxL, cfg.saidaMaxChars, cfg.linhaMaxChars);
  const bloco = (rotulo, t, lang = '', maxL) => {
    const r = cortar(t, maxL);
    return r.texto ? `${rotulo ? rotulo + ':\n' : ''}${cerca(r.texto, lang)}${r.nota ? `\n_${r.nota}_` : ''}` : '';
  };
  const erro1 = () => fatiar(String(entrada.error || 'erro').split('\n')[0].trim(), 0, 200);

  // Shell: qualquer ferramenta com tool_input.command (Bash, PowerShell).
  if (typeof ti.command === 'string') {
    const ms = entrada.duration_ms ?? (tr && tr.durationMs);
    const perigoso = destrutivo(ti.command);
    let status;
    if (falhou) status = `→ FALHOU (${erro1()})`;
    else if (tr && tr.interrupted) status = '→ interrompido';
    else status = '→ ok' + (Number.isFinite(ms) ? ` · ${Math.round(ms)} ms` : '');
    const lang = /powershell/i.test(nome) ? 'powershell' : 'bash';
    const partes = [cerca(redigir(ti.command.replace(/\r\n/g, '\n')), lang), status];
    if (falhou) partes.push(bloco('saída', String(entrada.error || '').split('\n').slice(1).join('\n')));
    else if (tr && typeof tr === 'object') { partes.push(bloco('saída', tr.stdout), bloco('stderr', tr.stderr)); }
    else if (typeof tr === 'string') partes.push(bloco('saída', tr));
    const titulo = `${perigoso ? '⚠️ ' : ''}${nome}${ti.description ? ' — ' + fatiar(redigir(String(ti.description)).replace(/\s+/g, ' '), 0, 200) : ''}`;
    return { titulo, status, corpo: partes.filter(Boolean).join('\n'), destrutivo: perigoso };
  }

  const arq = caminhoArquivo(ti, entrada.cwd);
  const rel = arq ? mostrarCaminho(ctx.raiz, arq) : '';
  const statusFalha = falhou ? `→ FALHOU (${erro1()})` : '';

  if (nome === 'Write') {
    const verbo = tr && tr.type === 'update' ? 'reescreveu' : 'criou';
    let info = '';
    if (!falhou) {
      try { const disco = readFileSync(arq); info = `${contarLinhas(disco.toString('utf8'))} · sha256 ${sha12(disco)}`; }
      catch { info = `${contarLinhas(String(ti.content ?? ''))} (arquivo não lido do disco)`; }
    }
    return { titulo: `Write — ${verbo} ${inline(rel)}`, status: statusFalha, corpo: [info, statusFalha].filter(Boolean).join('\n') };
  }

  if (nome === 'Edit' || nome === 'MultiEdit') {
    const diff = textoDiff(tr, ti);
    const corpo = [statusFalha, diff ? bloco('', diff, 'diff', cfg.diffMaxLinhas) : ''].filter(Boolean).join('\n');
    const n = Array.isArray(ti.edits) ? ` (${ti.edits.length} trechos)` : ti.replace_all ? ' (todas as ocorrências)' : '';
    return { titulo: `${nome} — ${inline(rel)}${n}`, status: statusFalha, corpo };
  }

  if (nome === 'Agent' || nome === 'Task') {
    const modelo = (tr && tr.resolvedModel) || ti.model || '';
    const extras = [ti.subagent_type || 'general-purpose', modelo, tr && tr.isAsync ? 'assíncrono' : '', ti.run_in_background ? 'em segundo plano' : '']
      .filter(Boolean).map((x) => fatiar(redigir(String(x)).replace(/\s+/g, ' '), 0, 100));
    const desc = fatiar(redigir(String(ti.description || '')).replace(/\s+/g, ' '), 0, 200);
    return { titulo: `Agent — ${extras.join(' · ')}${desc ? ' — ' + desc : ''}`, status: statusFalha, corpo: statusFalha };
  }

  // Qualquer outra: parâmetros em uma linha, até 300 caracteres.
  let j = ''; try { j = JSON.stringify(ti); } catch { j = String(ti); }
  j = redigir(j);
  j = encurtar(j, 300);
  return { titulo: `${nome} ${inline(j)}`, status: statusFalha, corpo: statusFalha };
}

// Quebra final não abre linha nova: 'a\nb\n' tem 2 linhas.
export function contarLinhas(t) {
  const n = t ? t.replace(/\r?\n$/, '').split('\n').length : 0;
  return `${n} ${n === 1 ? 'linha' : 'linhas'}`;
}

// Diff de Edit/MultiEdit: structuredPatch do tool_response; sem ele, old_string/new_string.
export function textoDiff(tr, ti) {
  const hunks = tr && Array.isArray(tr.structuredPatch) ? tr.structuredPatch : null;
  if (hunks && hunks.length) {
    return hunks.map((h) => [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...(h.lines || [])].join('\n')).join('\n');
  }
  const pares = Array.isArray(ti.edits) ? ti.edits : [ti];
  const linhas = [];
  for (const e of pares) {
    if (typeof e.old_string !== 'string' && typeof e.new_string !== 'string') continue;
    linhas.push('@@', ...String(e.old_string ?? '').split('\n').map((l) => '-' + l), ...String(e.new_string ?? '').split('\n').map((l) => '+' + l));
  }
  return linhas.join('\n');
}

// ---- Captura de scripts fora da raiz --------------------------------------------------------
// Script escrito ou executado fora do projeto some quando a pasta temporária é limpa; a cópia fica.
function scriptsExternos(ctx, nome, ti, arquivo, cwd) {
  const exts = ctx.config.extensoesScript;
  const candidatos = [];
  if (arquivo && FERRAMENTAS_ARQUIVO.has(nome)) candidatos.push(arquivo);
  if (typeof ti.command === 'string') {
    for (const m of ti.command.matchAll(/"([^"]+)"|'([^']+)'|(\S+)/g)) {
      const t = m[1] ?? m[2] ?? m[3];
      if (exts.includes(extname(t).toLowerCase())) candidatos.push(isAbsolute(t) ? t : resolve(cwd || process.cwd(), t));
    }
  }
  const unicos = [...new Map(candidatos.map((p) => [chave(p), p])).values()]; // mesmo arquivo com outra grafia
  return unicos.filter((p) => exts.includes(extname(p).toLowerCase()) && !dentro(ctx.raiz, p) && existsSync(p));
}

function capturar(ctx, s, id, caminhos) {
  const feitos = [];
  if (!caminhos.length) return feitos;
  const pasta = join(ctx.raiz, PASTA_SCRIPTS, 'capturas', s.arquivo.replace(/\.md$/, ''));
  const usados = new Set();
  for (const p of caminhos) {
    try {
      if (statSync(p).size > CAPTURA_MAX) continue;
      mkdirSync(pasta, { recursive: true });
      // Mesmo nome em pastas diferentes: a segunda leva sufixo, em vez de sobrescrever a primeira.
      let nomeAlvo = `${id}_${basename(p)}`;
      for (let n = 2; usados.has(nomeAlvo.toLowerCase()); n++) nomeAlvo = `${id}_${n}_${basename(p)}`;
      usados.add(nomeAlvo.toLowerCase());
      const alvo = join(pasta, nomeAlvo);
      writeFileSync(alvo, redigir(readFileSync(p, 'utf8'))); // pasta versionável: segredo do script não entra
      feitos.push(mostrarCaminho(ctx.raiz, alvo));
    } catch { /* sem cópia: a ação continua registrada */ }
  }
  return feitos;
}

// ---- Stop -----------------------------------------------------------------------------------
function stop(ctx, estado, s, entrada) {
  const n = colher(ctx, s, entrada);
  const ultimo = String(entrada.last_assistant_message || '').trim();
  if (!n && ultimo && sha12(ultimo) !== s.ultimoTexto) {
    // Transcrito ainda sem o texto final (ou ilegível): grava pelo payload e lembra o hash.
    textoAgente(ctx, s, [ultimo]);
    s.ultimoTexto = sha12(ultimo);
  }
  if (ctx.config.bloquearStopSemResumo && s.handoff && !s.resumo && !s.stopBloqueado && !entrada.stop_hook_active) {
    s.stopBloqueado = true;
    return {
      decision: 'block',
      reason: 'Esta sessão escreveu um handoff e o diário ainda não tem resumo. Rode `diario resumo "<2–3 linhas: o que foi feito e o próximo passo>"` e encerre.',
    };
  }
  return null;
}

// ---- SubagentStop, PreCompact, SessionEnd ---------------------------------------------------
function subagentStop(ctx, estado, s, entrada) {
  const modo = ctx.config.subagentes || 'linha';
  if (modo === 'nada') return null;
  const quem = `Subagente ${entrada.agent_type || '?'}${entrada.agent_id ? ' `' + String(entrada.agent_id).slice(0, 8) + '`' : ''} terminou`;
  const msg = redigir(String(entrada.last_assistant_message || '').trim());
  if (modo === 'linha') {
    const l1 = msg.split('\n').find((l) => l.trim()) || '';
    novaAcao(ctx, estado, s, quem + (l1 ? ': ' + inline(encurtar(l1, 200)) : ''));
    return null;
  }
  const r = recortar(msg, 100000, ctx.config.textoAgenteMaxChars, 100000);
  novaAcao(ctx, estado, s, quem, r.texto ? citar(r.texto) + (r.nota ? `\n_${r.nota}_` : '') : '');
  return null;
}

function preCompact(ctx, estado, s, entrada) {
  colher(ctx, s, entrada);
  linhaSolta(ctx, s, `> ⟳ [${carimbo(agora(), s.data)}] Compactação de contexto (${inline(fatiar(redigir(String(entrada.trigger || '?')), 0, 40))}).`);
  return null;
}

function sessionEnd(ctx, estado, s, entrada, sid) {
  colher(ctx, s, entrada);
  fecharSessao(ctx, estado, sid, fatiar(String(entrada.reason || ''), 0, 60));
  return null;
}

const TRATADORES = {
  SessionStart: true,
  UserPromptSubmit: userPromptSubmit,
  PostToolUse: postTool,
  PostToolUseFailure: postTool,
  Stop: stop,
  SubagentStop: subagentStop,
  PreCompact: preCompact,
  SessionEnd: sessionEnd,
};
