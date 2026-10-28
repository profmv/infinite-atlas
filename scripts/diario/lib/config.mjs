// Padrões do plugin. É o ÚNICO lugar onde eles valem: docs/CONFIGURACAO.md aponta para cá.
// O projeto sobrepõe só as chaves que quiser em scripts/diario/config.json.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PASTA_DIARIO = 'docs/diario';
export const PASTA_SCRIPTS = 'scripts/diario';
// Afirmação de posse, visível para quem abrir a pasta. Vai no topo do README.md da pasta e de cada
// DIARIO_*.md. Pasta sem ela (ou com um DIARIO_*.md sem ela) é do projeto: o plugin não grava.
export const MARCADOR = '[Gerido pelo plugin gerador-diario-projeto]';
export const LINHAS_MARCADOR = 5; // o marcador conta só se estiver nas primeiras N linhas

export const PADROES = {
  modo: 'proprio',               // 'proprio' grava; 'desligado' não grava nada
  contextoInicial: true,         // SessionStart injeta ~70 tokens dizendo qual é o diário ativo
  bloquearStopSemResumo: true,   // depois de escrever handoff, pede UMA vez `diario resumo`
  subagentes: 'linha',           // ações de subagente: 'linha' (uma linha), 'completo' ou 'nada' (salvo o que toca o diário ou é destrutivo: postTool)
  saidaMaxLinhas: 40,            // stdout/stderr: metade do início, metade do fim
  saidaMaxChars: 4000,
  linhaMaxChars: 400,
  diffMaxLinhas: 60,
  promptMaxChars: 8000,
  textoAgenteMaxChars: 6000,
  copiarScriptsExternos: true,   // script fora da raiz escrito/executado vira cópia em scripts/diario/capturas/
  extensoesScript: ['.ps1', '.psm1', '.sh', '.bash', '.bat', '.cmd', '.py', '.mjs', '.cjs', '.js', '.ts', '.sql', '.p', '.i', '.w', '.cls'],
  ignorarFerramentas: ['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'TodoWrite', 'ToolSearch', 'TaskList', 'TaskGet', 'TaskOutput', 'BashOutput'],
  travaEsperaMs: 5000,
  travaVelhaMs: 10000,
};

export function carregarConfig(raiz) {
  let proj = {};
  try { proj = JSON.parse(readFileSync(join(raiz, PASTA_SCRIPTS, 'config.json'), 'utf8').replace(/^﻿/, '')); } catch { /* sem config: padrões */ }
  return { ...PADROES, ...(proj && typeof proj === 'object' ? proj : {}) };
}
