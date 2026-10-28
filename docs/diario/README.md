# Diário do projeto
[Gerido pelo plugin gerador-diario-projeto]

Gravado em tempo real pelos hooks do plugin: um arquivo por sessão, `DIARIO_AAAA-MM-DD_XXX.md`
(sequência do dia), entradas `### N.` numeradas no projeto inteiro, ações `N.k`. Índice em
`INDICE.md`. Não edite os arquivos à mão: o agente acrescenta notas, decisões, fases e o resumo
com o comando `diario` (ou `node scripts/diario/diario.mjs`, para agentes sem o plugin).

Para devolver esta pasta ao projeto, apague a linha de marcação acima: o plugin para de gravar.
