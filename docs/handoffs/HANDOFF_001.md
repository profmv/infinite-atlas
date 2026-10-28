# Handoff 001 - Infinite Atlas: zoom continuo com 3 modelos

Criado: 2026-10-15 11:38
Atualizado: 2026-10-15 11:48
Branch: master | HEAD: 210461b | Status: publicado | Handoff anterior: nenhum

## Objetivo e criterio de pronto
- Pedido do usuario: o zoom deve ser "pleno continuismo", como um microscopio: as formas
  permanecem e ganham detalhe, sem o efeito "show de slides" de estruturas que somem.
- Usuario escolheu: implementar TODOS os modelos, com um seletor na UI.
- Pronto quando: os 3 modelos (Relief, Relief + textures, Julia spiral) renderizam e fazem zoom
  continuo no navegador; seletor funciona (tecla M alterna, salvo em localStorage);
  README atualizado; commit + push em master (GitHub Pages atualiza sozinho).

## PROVADO
- Site publicado: repo profmv/infinite-atlas publico, Pages em master /, URL
  https://profmv.github.io/infinite-atlas/ retornou http=200, run=completed/success, titulo "Infinite Atlas".

## PROVADO (atualizacao)
- Os 3 modelos renderizaram no Browser pane sem erro de console (screenshots); seletor e localStorage ok.
- Simulacao CPU (node, 200 oitavas): costa fica perto do centro; fold continuo ao cruzar profundidade inteira (-71.33693 vs -71.33692).
- Commit 210461b em master; Pages build 'built 210461b'; pagina ao vivo contem 'Julia spiral'.

## NAO PROVADO
- Movimento ao vivo e o fade da curva de nivel mais grossa (ultima edicao) nao foram vistos: o pane ficou oculto e o WebGL do pane foi desativado.
- Paridade bit-a-bit do hash pcg2d JS x GLSL nao foi testada diretamente (so indiretamente: a
  costa aparecia perto do centro da tela).

## Feito nesta sessao
- index.html reescrito inteiro (~800 linhas), commit 210461b:
  - Campo fBm persistente: KC=11, KF=5, N=17, BASE_FREQ=3, A=0.62, QA=0.06, COORD0=4096.
  - Oitavas grossas dobradas em patch de Taylor 2a ordem (field.P/field.Q, foldInto, syncLevels).
  - zoomField renormaliza por A^-dz; panField move frames de camada + shiftTaylor.
  - steer(): passo de Newton para F=0 no centro + deriva tangencial ao longo da costa.
  - Shader FIELD_FRAG: noised() com pcg2d, hillshade, curvas de nivel em niveis 2^e aninhados,
    linha de costa; uTex liga camadas de textura (texLayer, 7 familias).
  - Shader JULIA_FRAG: funcao de Poincare no ponto fixo repulsor a=L/2, c=a-a^2, zoom periodico.
  - UI: select #model, tecla M, transicao escura ao trocar para/de Julia, reseed por modelo.

## Decisoes e motivos
- Tres modelos com seletor: decisao do usuario.
- Campo unico com Taylor folding: mantem precisao em qualquer profundidade (pedido de continuidade).
- Julia via Poincare: zoom exato e infinito com numeros pequenos na GPU.
- NAO REABRIR: modelo antigo de camadas independentes sorteadas (causa do "show de slides").

## Proximo passo
1. Abrir index.html no Browser pane (servidor estatico local, ex.: `npx http-server -p 8080`
   via .claude/launch.json, ou file://). Checar console por erro de compilacao de shader.
2. Testar cada modelo no seletor; zoom continuo, costa no centro, texturas, Julia.
3. Corrigir o que falhar.
4. Atualizar README.md (descrever os 3 modelos; remover referencia a artifacts/preview.jpg inexistente).
5. Commit (terminar com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`) e push em master.

## Riscos e o que nao fazer
- Nao editar docs/diario/* nem scripts/diario manualmente (diario da sessao, gerado por hooks).
- uniform1uiv para uSeed exige Uint32Array; ivec2 uCi exige Int32Array (ja feito).
- Comando que funcionou para checar Pages: `gh api repos/profmv/infinite-atlas/pages/builds/latest`.

## Prompt de retomada
Projeto C:\Repo\Jogos\infinite-atlas (pagina WebGL2 de arquivo unico, publicada em
https://profmv.github.io/infinite-atlas/). index.html foi reescrito com 3 modelos de zoom continuo
(Relief, Relief + textures, Julia spiral) e um seletor #model, mas ainda nao foi testado nem commitado.
Abra a pagina no navegador, corrija erros de shader/JS, verifique os 3 modelos, atualize o README
e faca commit + push em master. Leia docs/handoffs/HANDOFF_001.md para detalhes.
