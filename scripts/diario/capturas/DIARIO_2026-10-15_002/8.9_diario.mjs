#!/usr/bin/env node
// CLI do diário. `diario hook` é o que os hooks do plugin chamam (JSON no stdin); o resto é o agente
// (ou um humano) acrescentando ao diário. Agentes sem hook usam iniciar/pedido/acao/encerrar.
// Sessão: CLAUDE_CODE_SESSION_ID > DIARIO_SESSAO > --sessao > a mais recente aberta.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PASTA_DIARIO, PASTA_SCRIPTS, MARCADOR } from './lib/config.mjs';
import { resolver, arquivosAlheios } from './lib/raiz.mjs';
import { comEstado, lerEstado, registrarErro } from './lib/estado.mjs';
import {
  criarPasta, vendorizar, abrirSessao, acharSessao, novoPedido, novaAcao, secao, fecharSessao,
  gerarIndice, verificar, reivindicar, indicePendente,
} from './lib/registro.mjs';
import { lerEntrada, citar, inline, agora } from './lib/util.mjs';
import { tratarHook } from './lib/hooks.mjs';

const AJUDA = `diario — diário do projeto (${PASTA_DIARIO}/)

  diario nota "<texto>"                     observação livre
  diario decisao "<o quê>" --porque "<motivo>"
  diario fase "<nome>"                      abre uma seção de fase
  diario resumo "<2–3 linhas>"              resumo da sessão (obrigatório depois de handoff)
  diario status                             raiz, modo, sessão ativa
  diario verificar                          portão de formato (sai 1 se houver erro)
  diario indice                             regenera INDICE.md
  diario instalar [--agents-md] [--reivindicar]

Agentes sem hooks:
  diario iniciar [--agente <nome>]          abre sessão e imprime o id (exporte DIARIO_SESSAO)
  diario pedido "<texto>"   |   diario acao "<título>" [--detalhe "<texto>"]   |   diario encerrar [motivo]
`;

// ---- Argumentos -----------------------------------------------------------------------------
// Só opções conhecidas são opção; qualquer outro `--x` é texto (`diario nota rodei --dry-run ok`).
// `--` sozinho encerra as opções.
const OPC_VALOR = new Set(['porque', 'detalhe', 'sessao', 'agente']);
const OPC_FLAG = new Set(['reivindicar', 'agents-md']);
function args(argv) {
  const pos = [], opc = {};
  for (let i = 0, fim = false; i < argv.length; i++) {
    const a = argv[i];
    if (!fim && a === '--') { fim = true; continue; }
    const eq = a.indexOf('=');
    const k = a.startsWith('--') && !fim ? a.slice(2, eq < 0 ? undefined : eq) : null;
    if (k && OPC_FLAG.has(k) && eq < 0) opc[k] = true;
    else if (k && OPC_VALOR.has(k)) {
      if (eq >= 0) opc[k] = a.slice(eq + 1);
      else if (i + 1 < argv.length) opc[k] = argv[++i];
      else opc[k] = true;
    } else pos.push(a);
  }
  return { pos, opc, texto: pos.join(' ').trim() };
}

const umaLinha = (t) => String(t).replace(/\s*[\r\n]+\s*/g, ' ').trim();
const sair = (msg, codigo = 0) => { (codigo ? process.stderr : process.stdout).write(msg.endsWith('\n') ? msg : msg + '\n'); process.exit(codigo); };

// ---- Contexto e sessão ----------------------------------------------------------------------
function contexto({ exigirProprio = true } = {}) {
  const ctx = resolver(process.cwd());
  if (exigirProprio && ctx.modo === 'desligado') sair(`diário desligado: ${ctx.motivo}. Nada gravado.`);
  return ctx;
}

// Roda fn(estado, sid, s) sob a trava, abrindo sessão se não houver nenhuma aberta. Índice depois dela.
function naSessao(ctx, opc, fn, { abrir = true, agente } = {}) {
  if (ctx.situacao === 'nova') { criarPasta(ctx); ctx.situacao = 'propria'; }
  const alheios = arquivosAlheios(ctx.dirDiario);
  if (alheios.length) sair(`diário desligado: ${alheios[0]} não traz "${MARCADOR}". Nada gravado.`);
  const r = comEstado(ctx.dirDiario, ctx.config, (estado) => {
    const pedido = process.env.CLAUDE_CODE_SESSION_ID || process.env.DIARIO_SESSAO || (typeof opc.sessao === 'string' ? opc.sessao : '');
    // Id pedido e desconhecido abre sessão própria: nunca cai na sessão de outro agente concorrente.
    let [sid, s] = pedido ? (estado.sessoes[pedido] ? [pedido, estado.sessoes[pedido]] : [null, null]) : acharSessao(estado, '');
    if (s && s.encerrado) [sid, s] = [null, null];
    if (!s) {
      if (!abrir) return fn(estado, null, null);
      sid = pedido || `cli-${agora().getTime().toString(36)}`;
      s = abrirSessao(ctx, estado, { sid, source: 'cli', agente: agente || process.env.DIARIO_AGENTE || 'CLI' });
    }
    return fn(estado, sid, s);
  });
  indicePendente(ctx);
  return r;
}

// ---- Bloco para AGENTS.md -------------------------------------------------------------------
const BLOCO_AGENTS = `
## Diário do projeto
${MARCADOR}

Todo trabalho neste repositório fica registrado em \`${PASTA_DIARIO}/\`. Agentes sem o plugin:
\`node ${PASTA_SCRIPTS}/diario.mjs iniciar --agente <nome>\` ao começar (exporte o id impresso em
\`DIARIO_SESSAO\`), \`pedido "<texto>"\` a cada pedido, \`acao "<o que fez>"\` a cada ação,
\`decisao "<o quê>" --porque "<motivo>"\` e \`encerrar\` ao fim. Não edite os arquivos à mão.
`;

// ---- Comandos -------------------------------------------------------------------------------
const COMANDOS = {
  hook() {
    let ctxErro = null;
    try {
      const out = tratarHook(lerEntrada());
      if (out) process.stdout.write(JSON.stringify(out));
    } catch (e) { try { ctxErro = resolver(process.cwd()); registrarErro(ctxErro.dirDiario, e); } catch { /* silêncio */ } }
    process.exit(0); // hook nunca quebra a sessão
  },

  nota({ texto, opc }) {
    if (!texto) sair('uso: diario nota "<texto>"', 2);
    const ctx = contexto();
    const id = naSessao(ctx, opc, (estado, sid, s) => novaAcao(ctx, estado, s, 'Nota', citar(texto)));
    sair(`nota registrada (${id})`);
  },

  decisao({ texto, opc }) {
    if (!texto || typeof opc.porque !== 'string' || !opc.porque.trim()) sair('uso: diario decisao "<o quê>" --porque "<motivo>"', 2);
    const ctx = contexto();
    const id = naSessao(ctx, opc, (estado, sid, s) => novaAcao(ctx, estado, s, 'Decisão', citar(`Decisão: ${texto}\nPor quê: ${opc.porque.trim()}`)));
    sair(`decisão registrada (${id})`);
  },

  fase({ texto, opc }) {
    if (!texto) sair('uso: diario fase "<nome>"', 2);
    const ctx = contexto();
    naSessao(ctx, opc, (estado, sid, s) => secao(ctx, s, 'Fase: ' + umaLinha(texto)));
    sair('fase registrada');
  },

  resumo({ texto, opc }) {
    if (!texto) sair('uso: diario resumo "<2–3 linhas>"', 2);
    const ctx = contexto();
    naSessao(ctx, opc, (estado, sid, s) => { secao(ctx, s, 'Resumo', citar(texto)); s.resumo = true; });
    sair('resumo registrado');
  },

  iniciar({ opc }) {
    const ctx = contexto();
    const r = naSessao(ctx, opc, (estado, sid, s) => ({ sid, arquivo: s.arquivo }), { agente: typeof opc.agente === 'string' ? opc.agente : undefined });
    sair(`${r.sid}\n${PASTA_DIARIO}/${r.arquivo}`);
  },

  pedido({ texto, opc }) {
    if (!texto) sair('uso: diario pedido "<texto>"', 2);
    const ctx = contexto();
    const n = naSessao(ctx, opc, (estado, sid, s) => novoPedido(ctx, estado, s, texto));
    sair(`entrada ${n}`);
  },

  acao({ texto, opc }) {
    if (!texto) sair('uso: diario acao "<título>" [--detalhe "<texto>"]', 2);
    const ctx = contexto();
    const corpo = typeof opc.detalhe === 'string' ? citar(opc.detalhe) : '';
    const id = naSessao(ctx, opc, (estado, sid, s) => novaAcao(ctx, estado, s, inline(umaLinha(texto)), corpo));
    sair(`ação ${id}`);
  },

  encerrar({ texto, opc }) {
    const ctx = contexto();
    const r = naSessao(ctx, opc, (estado, sid, s) => (s ? fecharSessao(ctx, estado, sid, umaLinha(texto) || 'cli') : null), { abrir: false });
    sair(r ? `sessão ${r}` : 'nenhuma sessão aberta');
  },

  status() {
    const ctx = contexto({ exigirProprio: false });
    const linhas = [`raiz: ${ctx.raiz}`, `pasta: ${ctx.dirDiario}`, `modo: ${ctx.modo}${ctx.motivo ? ' (' + ctx.motivo + ')' : ''}`, `situação: ${ctx.situacao}`];
    if (ctx.situacao !== 'nova' && ctx.modo !== 'desligado') {
      const alheios = arquivosAlheios(ctx.dirDiario);
      if (alheios.length) linhas.push(`escrita alheia (plugin não grava): ${alheios.join(', ')}`);
      const estado = lerEstado(ctx.dirDiario);
      const pedido = process.env.CLAUDE_CODE_SESSION_ID || process.env.DIARIO_SESSAO || '';
      const [sid, s] = acharSessao(estado, pedido);
      linhas.push(`última entrada: ${estado.ultimoN}`);
      linhas.push(s ? `sessão: ${sid} → ${s.arquivo}${s.encerrado ? ' (encerrada)' : ''} · ${s.pedidos} pedidos, ${s.acoes} ações` : 'sessão: nenhuma aberta');
    }
    sair(linhas.join('\n'));
  },

  verificar() {
    const ctx = contexto({ exigirProprio: false });
    const { erros, avisos } = verificar(ctx.dirDiario);
    const out = [...erros.map((e) => 'ERRO  ' + e), ...avisos.map((a) => 'aviso ' + a)];
    out.push(erros.length ? `${erros.length} erro(s).` : 'diário ok.');
    sair(out.join('\n'), erros.length ? 1 : 0);
  },

  indice() {
    const ctx = contexto();
    if (ctx.situacao === 'nova') sair('pasta do diário ainda não existe');
    const alheios = arquivosAlheios(ctx.dirDiario);
    if (alheios.length) sair(`diário desligado: ${alheios[0]} não traz "${MARCADOR}". Nada gravado.`);
    gerarIndice(ctx.dirDiario);
    sair('INDICE.md regenerado');
  },

  instalar({ opc }) {
    const ctx = contexto({ exigirProprio: false });
    const feito = [];
    if (opc.reivindicar) {
      const m = reivindicar(ctx);
      feito.push(m.length ? `marcação inserida em: ${m.join(', ')}` : 'pasta já marcada');
    } else if (ctx.modo === 'desligado') {
      sair(`diário desligado: ${ctx.motivo}.\nPara o plugin assumir a pasta: diario instalar --reivindicar`);
    } else {
      if (ctx.situacao === 'nova') criarPasta(ctx); else vendorizar(ctx.raiz);
      feito.push(`${PASTA_DIARIO}/ pronto; CLI em ${PASTA_SCRIPTS}/diario.mjs`);
    }
    if (opc['agents-md']) {
      const alvo = join(ctx.raiz, 'AGENTS.md');
      const atual = existsSync(alvo) ? readFileSync(alvo, 'utf8') : '';
      if (atual.includes(MARCADOR)) feito.push('AGENTS.md já tem o bloco');
      else { writeFileSync(alvo, atual.replace(/\n*$/, atual ? '\n' : '') + BLOCO_AGENTS); feito.push('bloco acrescentado ao AGENTS.md'); }
    }
    sair(feito.join('\n'));
  },
};

// ---- Principal ------------------------------------------------------------------------------
const [cmd, ...resto] = process.argv.slice(2);
if (!cmd || cmd === 'ajuda' || cmd === '--help' || cmd === '-h') sair(AJUDA);
const f = COMANDOS[cmd];
if (!f) sair(`comando desconhecido: ${cmd}\n\n${AJUDA}`, 2);
try { f(args(resto)); } catch (e) { sair(`diario ${cmd}: ${e.message}`, 1); }
