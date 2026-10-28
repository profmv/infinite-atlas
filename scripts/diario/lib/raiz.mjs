// Onde fica o diário e de quem é a pasta.
//
// Raiz: DIARIO_RAIZ > primeiro ancestral do cwd (até a raiz git, inclusive) que tenha docs/diario/ ou
// diario/ > o próprio cwd. Nunca a raiz git por padrão: em monorepo cada projeto tem o seu diário.
//
// Posse (docs/DECISOES.md, D1): a pasta é do plugin só se o README.md dela trouxer MARCADOR nas
// primeiras linhas. Pasta com conteúdo e sem a afirmação é do projeto: modo desligado.
import { existsSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { PASTA_DIARIO, MARCADOR, LINHAS_MARCADOR, carregarConfig } from './config.mjs';

const ehPasta = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const conteudo = (p) => { try { return readdirSync(p).filter((n) => n !== '.estado'); } catch { return []; } };

// Lê só o começo do arquivo: o marcador tem de estar nas primeiras linhas.
export function temMarcador(arquivo) {
  let fd;
  try {
    fd = openSync(arquivo, 'r');
    const buf = Buffer.alloc(2048);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.toString('utf8', 0, n).split('\n').slice(0, LINHAS_MARCADOR).some((l) => l.includes(MARCADOR));
  } catch { return false; } finally { if (fd !== undefined) closeSync(fd); }
}

// Situação de uma pasta de diário: 'nova' (não existe ou vazia), 'propria' ou 'projeto'.
export function situacaoPasta(dir) {
  if (!ehPasta(dir)) return { situacao: 'nova' };
  const itens = conteudo(dir);
  if (!itens.length) return { situacao: 'nova' };
  if (!temMarcador(join(dir, 'README.md'))) {
    return { situacao: 'projeto', motivo: `${dir} já existe sem "${MARCADOR}" no README.md: diário governado pelo projeto` };
  }
  return { situacao: 'propria' };
}

// Varredura completa (SessionStart, verificar, status): um DIARIO_*.md sem o marcador é escrita alheia.
export function arquivosAlheios(dir) {
  return conteudo(dir).filter((n) => /^DIARIO_.*\.md$/i.test(n) && !temMarcador(join(dir, n)));
}

export function resolver(cwd = process.cwd(), env = process.env) {
  let raiz = null, achada = null;
  if (env.DIARIO_RAIZ) raiz = resolve(env.DIARIO_RAIZ);
  else {
    for (let d = resolve(cwd); ; d = dirname(d)) {
      // docs/diario vazio é reivindicável; diario/ na raiz (estilo Magnabi) só conta se tiver conteúdo.
      const docs = join(d, PASTA_DIARIO), solta = join(d, 'diario');
      if (ehPasta(docs)) { raiz = d; achada = docs; break; }
      if (ehPasta(solta) && conteudo(solta).length) { raiz = d; achada = solta; break; }
      if (existsSync(join(d, '.git')) || dirname(d) === d) break;
    }
    raiz = raiz || resolve(cwd);
  }
  const dirDiario = join(raiz, PASTA_DIARIO);
  const config = carregarConfig(raiz);
  // Pasta de diário alheia achada fora de docs/diario (ex.: diario/ na raiz) desliga o plugin.
  if (achada && achada !== dirDiario) {
    return { raiz, dirDiario, config, modo: 'desligado', situacao: 'projeto', motivo: `${achada} é o diário do projeto (fora de ${PASTA_DIARIO})` };
  }
  const s = situacaoPasta(dirDiario);
  if (s.situacao === 'projeto') return { raiz, dirDiario, config, modo: 'desligado', ...s };
  const modo = config.modo === 'desligado' ? 'desligado' : 'proprio';
  return { raiz, dirDiario, config, modo, situacao: s.situacao, motivo: modo === 'desligado' ? 'config.json: modo "desligado"' : '' };
}
