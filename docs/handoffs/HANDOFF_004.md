# Handoff 004 - Infinite Atlas: motor nest ligado, falta verificar e commitar

Criado: 2026-10-15 16:32
Atualizado: 2026-10-15 16:34
Branch: master | HEAD: 210461b (edicoes NAO commitadas em index.html e README.md) | Status: interrompido | Handoff anterior: docs/handoffs/HANDOFF_003.md

## PONTO DE PARADA (16:34)
- Passo 1 do "Proximo passo" (verificacao no navegador) em andamento. Preview "atlas" rodando
  (serverId 1032add8..., tabId "seed", http://localhost:8765).
- PROVADO no navegador: pagina carrega, WebGL2 ok, os 3 programas (field, julia, nest) compilam e
  linkam (program() lanca excecao se nao; console vazio), Relief renderiza como antes (screenshot).
- Bloqueio do Browser pane: requestAnimationFrame so dispara 1 frame por screenshot (medido: 0 frames
  em 1 s via contador rAF; document.visibilityState = "visible"). Transicao de modelo precisa ~2 s de
  tempo simulado (dt limitado a 0.1 => >=20 frames), entao trocar modelo via screenshots e inviavel.
- Tentativa: shim `window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16)`
  injetado via javascript_tool; o rAF pendente nao dispara para pegar o shim; o screenshot seguinte
  deu timeout ("page did not finish rendering"). Pagina ficou com model select = microscope e uma
  transicao pendente.
- Opcoes para retomar: (a) recarregar a aba com localStorage "infinite-atlas:model" = "microscope"
  (e depois cosmos, psychedelic, julia) e tirar screenshot: o modelo inicial nao precisa de transicao,
  1 frame basta para ver o visual; (b) pedir ao usuario para abrir http://localhost:8765 no Chrome
  dele e olhar cada modelo (zoom/continuidade so se ve com animacao real).

## Objetivo e criterio de pronto
- Pedido do usuario (2026-10-15): manter Relief e Relief + textures SEM mudanca; adicionar Microscope,
  Cosmos, Psychedelic; corrigir Julia ("so roda, nao tem zoom"). Continuidade, sem "show de slides".
- Pronto: 6 modelos no seletor, Julia com zoom visivel, README atualizado, verificado no navegador,
  commit + push em master (Pages atualiza sozinho).

## PROVADO
- Compilacao dos 3 shaders e render do Relief (ver PONTO DE PARADA). README editado por subagente Sonnet (relatou: tabela com 6 modelos, secoes
  "Nested worlds" e "Psychedelic" em How it works, paragrafo do Julia reescrito); conteudo nao relido.

## NAO PROVADO
- Todo o codigo novo: nao compilado, nao visto no navegador.

## Feito (index.html, sem commit)
- Sessao 003: seletor 6 modelos, MODELS/ENGINE, HASH separado, Psychedelic no FIELD_FRAG (kal, ramo
  uMode>0.5), NEST_FRAG completo, nestProg, fix Julia (periodo q iteracoes, rq/aq).
- Sessao 004 (esta):
  - Bloco "Nested worlds state" logo apos newJulia(): STYLES, STAINS, objeto `nest`, fract,
    newNestLevel (runs de 3-6 oitavas, hue em passeio refletido em [0,1]), syncNest, panNest, zoomNest,
    vorAt (espelho de vor + hashes h/h2 em VO), rhoOf, galaxyM, nestPot, steerNest (gradiente por
    diferenca finita h=0.01, deriva nest.wa, velocidade suavizada vx/vy, limite (0.3+1.2sp)dt), initNest
    (60 passos de steer com dt=0.05).
  - octaves(): julia usa log2(rq); nest usa nest.d.
  - describe(): julia "turns X deg per rq x cycle"; nest "H&E stain > tissue > cells" / "Deep field > ...";
    psychedelic "Kaleidoscope of K > coastline > contours".
  - reseed por ENGINE; setModel: fade direto so relief<->textured; resto via transition, initNest quando
    entra em nest ou troca microscope<->cosmos.
  - drawNest (buffers nb*, uniforms conforme handoff 003); frame loop e draw dispatch por ENGINE;
    init chama initNest(startModel ou "microscope").
- README.md: atualizado pelo subagente (ver PROVADO).

## Decisoes e motivos
- Relief/Relief + textures intocados (usuario). Psychedelic reusa o campo (uMode=0 nao muda nada).
- Julia: periodo L^q, porque 1 iteracao gira ~360*p/q graus para so 1.06-1.2x de zoom.
- Steering microscope: potencial w*R*(1-bd/R)^2, R=min(2.6,0.22/sc); cosmos: -w*min(2.6,0.5/sc)*log m.
  Camadas de u=-NKC ate n+1, peso smooth(-NKC,-NKC+2.5,u)*(1-smooth(-0.5,1,u)).
- Hint do rodape nao mudou (atalhos continuam validos).
- NAO REABRIR: camadas independentes sorteadas que somem no fim grosso (causa do "show de slides").

## Proximo passo
1. Abrir preview (preview_start name "atlas", porta 8765, de .claude/launch.json); checar console
   (erros de compile GLSL aparecem como excecao em program()).
2. Testar cada modelo (M cicla; localStorage "infinite-atlas:model"); olhar Julia com zoom, nest
   com camadas aparecendo dentro das celulas/bracos; ajustar ganhos de steer se tremer.
3. Reler README.md rapidamente.
4. Commit (sem docs/ e .claude/), mensagem terminando com
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; push em master; checar Pages.

## Riscos e o que nao fazer
- Nao editar docs/diario/* nem scripts/diario; nao commitar docs/ nem .claude/launch.json.
- Nome `NB` ja existe (buffer de layerAt); nest usa nb*, VO, NEST_FREQ.
- WebGL do Browser pane ja falhou antes; fallback: simulacao node + checagem do usuario.
- Checar Pages: `gh api repos/profmv/infinite-atlas/pages/builds/latest`.

## Prompt de retomada
Projeto C:\Repo\Jogos\infinite-atlas (pagina WebGL2 de arquivo unico, https://profmv.github.io/infinite-atlas/).
index.html e README.md tem edicoes nao commitadas que implementam 6 modelos (Relief, Relief + textures,
Microscope, Cosmos, Psychedelic, Julia spiral) com motores field/nest/julia. Todo o codigo esta escrito
mas nunca foi rodado. Falta: verificar no Browser pane (preview "atlas", porta 8765) cada modelo e o
console, corrigir o que quebrar, depois commit (sem docs/ e .claude/) e push em master.
Nao altere o visual de Relief e Relief + textures. Detalhes em docs/handoffs/HANDOFF_004.md.
