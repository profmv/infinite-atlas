// Estado compartilhado entre processos de hook (cada hook é um processo node novo).
// Fica em docs/diario/.estado/ (ignorado pelo git). Toda leitura-escrita passa pela trava.
import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, writeSync, unlinkSync, statSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { dormir } from './util.mjs';

export const RE_ARQUIVO = /^DIARIO_(\d{4}-\d{2}-\d{2})(?:_(\d+))?\.md$/;
export const RE_ENTRADA = /^### (\d+)\./gm;

const dirEstado = (dirDiario) => join(dirDiario, '.estado');

export function garantirPastas(dirDiario) {
  const de = dirEstado(dirDiario);
  mkdirSync(de, { recursive: true });
  const gi = join(de, '.gitignore');
  if (!existsSync(gi)) writeFileSync(gi, '*\n');
  return de;
}

// Trava por arquivo exclusivo (openSync 'wx') com dono (pid + nonce) dentro. Trava mais velha que
// travaVelhaMs é de processo morto: nunca abaixo do timeout do hook (10 s), senão um hook vivo e
// lento perde a trava. Quebrar é renomear para nome único (só um processo consegue) e conferir que
// o renomeado ainda é velho; se não for, alguém travou no meio e a trava volta. Soltar só apaga a
// trava se ela ainda for nossa.
const OCUPADA = new Set(['EEXIST', 'EPERM', 'EACCES', 'EBUSY']);

export function comTrava(dirDiario, cfg, fn) {
  const trava = join(garantirPastas(dirDiario), 'trava');
  const velha = Math.max(cfg.travaVelhaMs ?? 10000, 10000);
  const limite = Date.now() + (cfg.travaEsperaMs ?? 5000);
  const dono = `${process.pid}:${randomBytes(6).toString('hex')}`;
  for (let espera = 5; ; espera = Math.min(espera * 2, 100)) {
    try { const fd = openSync(trava, 'wx'); try { writeSync(fd, dono); } finally { closeSync(fd); } break; } catch (e) {
      // Windows: trava apagada por um enquanto outro ainda a tem aberta fica "delete pending" e o
      // open devolve EPERM/EACCES/EBUSY em vez de EEXIST; é trava ocupada, não erro.
      if (!OCUPADA.has(e.code)) throw e;
      try {
        if (Date.now() - statSync(trava).mtimeMs > velha) {
          const lixo = `${trava}.${dono.replace(':', '_')}`;
          renameSync(trava, lixo);
          if (Date.now() - statSync(lixo).mtimeMs > velha) unlinkSync(lixo);
          else if (!existsSync(trava)) renameSync(lixo, trava);
          else unlinkSync(lixo);
          continue;
        }
      } catch { /* trava sumiu ou está sendo apagada: espera e tenta de novo */ }
      if (Date.now() > limite) throw new Error('trava do diário ocupada: ' + trava);
      dormir(espera);
    }
  }
  try { return fn(); } finally {
    // Soltar pode falhar de passagem no Windows (antivírus ou outro processo com a trava aberta);
    // trava não solta fica órfã até travaVelhaMs e derruba quem espera. Tenta de novo; se não der, registra.
    for (let i = 0; ; i++) {
      try { if (readFileSync(trava, 'utf8') === dono) unlinkSync(trava); break; } catch (e) {
        if (e.code === 'ENOENT') break;
        if (i >= 20) { registrarErro(dirDiario, new Error(`trava não solta (${e.code}): ${trava}`)); break; }
        dormir(10);
      }
    }
  }
}

export function listarDiarios(dirDiario) {
  let nomes = [];
  try { nomes = readdirSync(dirDiario).filter((n) => RE_ARQUIVO.test(n)); } catch { /* sem pasta */ }
  return nomes.sort((a, b) => chave(a).localeCompare(chave(b)));
}
// Ordem cronológica: data, depois sequência (DIARIO_data.md conta como 1).
function chave(nome) { const m = nome.match(RE_ARQUIVO); return `${m[1]}_${String(m[2] ? +m[2] : 1).padStart(6, '0')}`; }

export function varrerUltimoN(dirDiario) {
  let max = 0;
  for (const n of listarDiarios(dirDiario)) {
    let t = ''; try { t = readFileSync(join(dirDiario, n), 'utf8'); } catch { continue; }
    for (const m of t.matchAll(RE_ENTRADA)) max = Math.max(max, +m[1]);
  }
  return max;
}

// Próximo nome do dia: DIARIO_AAAA-MM-DD_XXX.md. Nomes legados (sem sufixo = 1, _2 = 2) contam.
export function proximoArquivo(dirDiario, data) {
  let seq = 0;
  for (const n of listarDiarios(dirDiario)) {
    const m = n.match(RE_ARQUIVO);
    if (m[1] === data) seq = Math.max(seq, m[2] ? +m[2] : 1);
  }
  return `DIARIO_${data}_${String(seq + 1).padStart(3, '0')}.md`;
}

export function lerEstado(dirDiario) {
  try {
    const e = JSON.parse(readFileSync(join(dirEstado(dirDiario), 'estado.json'), 'utf8'));
    if (e && typeof e === 'object' && e.sessoes && Number.isInteger(e.ultimoN)) return e;
  } catch { /* ausente ou corrompido: reconstrói */ }
  return { versao: 1, ultimoN: varrerUltimoN(dirDiario), sessoes: {} };
}

export function gravarEstado(dirDiario, estado) {
  const alvo = join(garantirPastas(dirDiario), 'estado.json');
  const tmp = alvo + '.' + process.pid + '.tmp';
  writeFileSync(tmp, JSON.stringify(estado, null, 1));
  renameSync(tmp, alvo);
}

// Lê, deixa fn mudar e grava, tudo sob a trava.
export function comEstado(dirDiario, cfg, fn) {
  return comTrava(dirDiario, cfg, () => {
    const estado = lerEstado(dirDiario);
    const r = fn(estado);
    gravarEstado(dirDiario, estado);
    return r;
  });
}

export function registrarErro(dirDiario, err) {
  try {
    const de = garantirPastas(dirDiario);
    writeFileSync(join(de, 'erros.log'), `${new Date().toISOString()} ${err && err.stack ? err.stack : err}\n`, { flag: 'a' });
  } catch { /* último recurso: silêncio, hook nunca quebra a sessão */ }
}
