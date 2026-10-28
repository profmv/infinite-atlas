# Handoff 002 - Infinite Atlas: novos modos (microscopio, cosmos, psicodelico) + fix Julia

Criado: 2026-10-15 16:06
Branch: master | HEAD: 210461b | Status: iniciando | Handoff anterior: docs/handoffs/HANDOFF_001.md

## Objetivo e criterio de pronto
- Pedido do usuario (2026-10-15): manter Relief e Relief + textures SEM mudanca ("ficou legal, nao mude");
  adicionar modos novos com estruturas diferentes: (a) objetos vistos ao microscopio, (b) universo,
  (c) psicodelico. Corrigir o modo Julia spiral, que "so roda, nao tem zoom".
- Todos os modos novos seguem o principio de continuidade: as estruturas persistem e ganham detalhe
  com o zoom, sem efeito "show de slides" (pedido anterior do usuario, ver HANDOFF_001).
- Pronto quando: novos modelos no seletor #model, Julia com zoom visivel, README atualizado,
  commit + push em master (Pages atualiza sozinho).

## PROVADO
- Estado de partida: commit 210461b em master, publicado em https://profmv.github.io/infinite-atlas/
  com modelos relief, textured, julia (ver HANDOFF_001).

## NAO PROVADO
- Nada do trabalho novo foi feito ainda.

## Diagnostico do Julia (lido no codigo, index.html ~linhas 765-1054)
- Periodo do zoom = 1 aplicacao do multiplicador L = r*e^{i*theta}, r em 1.06-1.20, theta = 2*pi*(p/q +- 0.006).
- Por periodo: zoom de so 1.06-1.20x, rotacao de ~360*p/q graus (ex.: -91 graus por 1.10x).
  Na velocidade padrao (0.05 oct/s) o giro domina e o zoom quase nao aparece.
- Plano: usar o q-esimo iterado como periodo (L^q, angulo ~ 2*pi*p, rotacao liquida ~0), zoom r^q por
  periodo; tirar o jitter ou compensar a deriva; garantir zoom visivel.

## Decisoes e motivos
- Relief e Relief + textures nao mudam (usuario).
- NAO REABRIR: camadas independentes sorteadas por oitava (causa do "show de slides").

## Proximo passo
1. Ler index.html inteiro (~1090 linhas).
2. Corrigir Julia (periodo L^q).
3. Modo psicodelico: sugestao, reaproveitar o campo F persistente com dobra caleidoscopica e cores ciclicas.
4. Microscopio e Cosmos: estruturas aninhadas persistentes (celulas dentro de celulas; galaxias com
   estrelas que viram galaxias), com o mesmo esquema de frames por oitava do relief.
5. Generalizar setModel (fade escuro entre programas diferentes), MODELS, describe(), README.
6. Verificar no Browser pane (launch.json "atlas", porta 8765); commit + push.

## Riscos e o que nao fazer
- Nao editar docs/diario/* nem scripts/diario (hooks).
- Nao commitar docs/ nem .claude/launch.json.
- WebGL do Browser pane pode estar desativado; fallback: simulacao node + checagem do usuario.
- Checar Pages: `gh api repos/profmv/infinite-atlas/pages/builds/latest`.

## Prompt de retomada
Projeto C:\Repo\Jogos\infinite-atlas (pagina WebGL2 de arquivo unico, publicada em
https://profmv.github.io/infinite-atlas/, commit 210461b). Sem mexer nos modos Relief e Relief + textures,
corrija o modo Julia spiral (hoje so gira; use o periodo L^q para o zoom aparecer) e adicione modos novos
ao seletor #model: Microscope (objetos ao microscopio), Cosmos (universo) e Psychedelic, todos com zoom
continuo onde as formas persistem e ganham detalhe. Atualize README, verifique no navegador e faca
commit + push em master. Detalhes em docs/handoffs/HANDOFF_002.md e HANDOFF_001.md.
