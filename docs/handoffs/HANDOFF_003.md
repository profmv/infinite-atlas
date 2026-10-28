# Handoff 003 - Infinite Atlas: novos modos (Microscope, Cosmos, Psychedelic) + fix Julia

Criado: 2026-10-15 16:27
Atualizado: 2026-10-15 16:28
Branch: master | HEAD: 210461b (edicoes NAO commitadas em index.html) | Status: interrompido | Handoff anterior: docs/handoffs/HANDOFF_002.md

## PONTO DE PARADA (16:28)
- Psychedelic FEITO no codigo: kal() + ramo `if (uMode > 0.5)` no main do FIELD_FRAG (retorna cedo,
  relief intocado), uMode/uKal na lista de program() e enviados em drawField, field.kal em initField.
- Motor nest: SHADER FEITO (constantes NKC=7, NKF=6, NN=14, NEST_FREQ=2.5; NEST_FRAG com vor(),
  specimen(), galaxy(), main com ld geometrico; `nestProg = program(NEST_FRAG, [...uSty, uHue])`).
- PAROU AQUI: falta todo o lado JS do nest: objeto `nest` {levels Map, d, kind, stain(0..2), hueWalk,
  runSty, runUntil, wa}, newNestLevel (sty em runs de 3-6 oitavas: microscopio 3 estilos, cosmos 3;
  hue = passeio aleatorio), syncNest, panNest, zoomNest, vorAt (espelho JS de vor com hgrad/HG),
  nestPot + steerNest (descrito abaixo), initNest(kind) com ~60 passos de steer para assentar,
  drawNest (buffers Float32/Int32/Uint32 de tamanho NN; uniforms uRes,uTime,uFade,uB=NEST_FREQ,
  uMode=cosmos?1:0, uStain, uU, uCi, uCf, uR, uSeed, uSty, uHue). Depois passo 3 do plano (ligacoes).
- Espelho JS das funcoes para o steering: rho microscopio: sty0 0.13+0.05*h.y; sty1 0.27+0.07*h.x;
  sty2 0.3+0.06*h.x. Galaxia (m): R=0.14+0.1*(0.5+0.5*h.x); g = rot(h.y*pi)*(-r1); g.y*=1+1.4*(0.5+0.5*h2.y);
  espiral se h2.x > (sty<0.5 ? -0.4 : 0.4); m = min(1, 0.03+0.2*exp(-0.9rg)+0.9*clamp(1.4*disc*smooth(0.06,0.25,rg),0,1)).
  Rotacao do GLSL mat2(ca,sa,-sa,ca)*o => x' = ca*ox - sa*oy, y' = sa*ox + ca*oy.

## Objetivo e criterio de pronto
- Pedido do usuario (2026-10-15): manter Relief e Relief + textures SEM mudanca; adicionar modos
  Microscope (objetos ao microscopio), Cosmos (universo), Psychedelic; corrigir Julia ("so roda, nao tem zoom").
- Todos com continuidade: estruturas persistem e ganham detalhe; nada de "show de slides".
- Pronto: 6 modelos no seletor, Julia com zoom visivel, README atualizado, verificado no navegador,
  commit + push em master (Pages atualiza sozinho).

## PROVADO
- Nada do trabalho novo foi rodado ainda (so edicoes de codigo).

## NAO PROVADO
- Todas as edicoes abaixo: nao compiladas, nao vistas no navegador.

## Feito nesta sessao (index.html, sem commit)
- `<select id="model">` (~l.145): opcoes relief, textured, microscope, cosmos, psychedelic, julia.
- MODELS com 6 entradas e novo `ENGINE` (~l.211): relief/textured/psychedelic -> "field",
  microscope/cosmos -> "nest", julia -> "julia".
- `HASH` (string GLSL: pcg2d, hgrad, noised) separado; FIELD_FRAG agora monta o proprio cabecalho e
  ganhou uniforms `uMode, uKal` (ainda NAO usados no main nem enviados por drawField; program() lista
  de nomes ainda sem eles).
- Julia: periodo = q iteracoes. newJulia: jitter reduzido para +-0.002 volta; `julia.rq = r^q`,
  `julia.aq = q*th` reduzido a (-pi, pi]. drawJulia: mag = SIGMA0*rq^-D, ang = -aq*D,
  hueOff = m*q*0.045, bandOff = m*q*0.35. Frame loop: D += sp*dt/log2(rq).
  FALTA: octaves() usar (m+D)*log2(rq); describe() mostrar "q arms · x(rq) per cycle".

## Plano detalhado do que falta
1. Psychedelic (no shader do campo, mesmo mundo do relief): no main, `if (uMode > 0.5) s = kal(s)`
   (dobra caleidoscopica: K = uKal setores espelhados, rotacao lenta 0.02*uTime); no fim, se uMode>0.5,
   cor = hue3(Q + 0.03*uTime + 0.16*F) saturada (anti-alias: cinza quando 0.16*fw grande) + linhas
   brilhantes dos niveis aninhados (mesmo esquema de tiers uEfr) em cor complementar + costa branca.
   field.kal aleatorio (5..9) em initField. drawField envia uMode (model==="psychedelic") e uKal.
2. Motor "nest" (novo NEST_FRAG + estado JS `nest`): camadas por oitava como o relief (frame cx,cy,cs,sn,
   seed por camada), NKC=7 grossas, NKF=6 finas, NN=14, NEST_FREQ=2.5. Cada camada = Voronoi 3x3 com
   site = celula + 0.5 + 0.38*hgrad(celula, seed) (JS espelha com hgrad existente). Hash por celula:
   hgrad(id, seed^0x51ed27) e hgrad(id, seed^0x2c1b3c6d).
   - Densidade filha m_k: ld = 0.5*ld + w_k*log(m_k); alpha da camada = w_k*exp(ld) (produto com pesos
     geometricos: estrelas seguem bracos, celulas dentro de celulas, sem escurecer com a profundidade).
   - Peso: fade fino por tamanho de pixel; fade grosso smoothstep(-NKC, -NKC+2.5, u).
   - Steering JS: microscopio repele bordas (bd = min(e, |rr-rho|)) das camadas grossas, raio
     R = min(2.6, 0.22/sc) em unidades de tela; cosmos sobe gradiente de log m. Gradiente por diferenca
     finita (h=0.01), + deriva lenta; limite de velocidade (0.3+1.2*sp)*dt. Assim paredes grossas saem
     pela borda da tela antes da camada sumir.
   - Microscope: estilos por camada em "runs": 0 tecido (Voronoi + nucleo), 1 celulas redondas,
     2 diatomaceas (raios/aneis). Tintas por mundo (uStain): H&E (absorbancia, fundo claro),
     fluorescencia (emissao, fundo escuro), Giemsa. Abertura circular de microscopio.
   - Cosmos: galaxia por celula (espiral/eliptica, R 0.14-0.24, inclinacao), ponto gaussiano quando
     nao resolvida (fluxo conservado), ganho menor para camadas grossas, tone map 1-exp(-c).
3. Ligar: setModel (fade direto so relief<->textured; resto via transition com initNest quando entra em
   nest ou troca microscope<->cosmos), reseed por ENGINE, octaves(), describe(), frame loop e draw
   dispatch por ENGINE, hint, README (tabela de modelos + "How it works").
4. Verificar no Browser pane (preview_start "atlas", porta 8765): console sem erro, cada modelo.
5. Commit (fim: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`) e push em master.

## Decisoes e motivos
- Relief/Relief + textures intocados (usuario). Psychedelic reusa o mesmo campo (uMode=0 nao muda nada).
- Julia: periodo L^q em vez de L, porque 1 iteracao gira ~360*p/q graus para so 1.06-1.2x de zoom.
- NAO REABRIR: camadas independentes sorteadas que somem no fim grosso (causa do "show de slides").

## Riscos e o que nao fazer
- Nao editar docs/diario/* nem scripts/diario; nao commitar docs/ nem .claude/launch.json.
- Nome `NB` ja existe (buffer de layerAt): usar NEST_FREQ etc.
- WebGL do Browser pane ja falhou antes; fallback: simulacao node + checagem do usuario.
- Checar Pages: `gh api repos/profmv/infinite-atlas/pages/builds/latest`.

## Prompt de retomada
Projeto C:\Repo\Jogos\infinite-atlas (pagina WebGL2 de arquivo unico, publicada em
https://profmv.github.io/infinite-atlas/). index.html tem edicoes nao commitadas: seletor com 6 modelos,
ENGINE, HASH separado, fix do Julia (periodo L^q). Falta: Psychedelic (uMode/uKal no FIELD_FRAG),
motor "nest" para Microscope e Cosmos, ligacoes de UI, README, verificacao no navegador e commit+push.
Siga "Plano detalhado" em docs/handoffs/HANDOFF_003.md. Nao altere o visual de Relief e Relief + textures.
