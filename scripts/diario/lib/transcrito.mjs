// Texto que o agente escreveu entre as ferramentas. Só existe no transcrito (JSONL). O formato é
// interno do Claude Code: qualquer surpresa degrada para "nada colhido", nunca para erro.
import { openSync, readSync, closeSync, statSync } from 'node:fs';

export function tamanho(caminho) { try { return statSync(caminho).size; } catch { return 0; } }

// Lê do offset até a última linha completa. Devolve { textos, offset } com o novo offset.
export function colherTexto(caminho, offset = 0) {
  const tam = tamanho(caminho);
  if (!caminho || tam <= offset) return { textos: [], offset: Math.min(offset, tam) };
  let fd;
  try {
    fd = openSync(caminho, 'r');
    const len = Math.min(tam - offset, 32 << 20); // teto de 32 MB por colheita
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, offset);
    const ultimaQuebra = buf.lastIndexOf(0x0a);
    if (ultimaQuebra < 0) return { textos: [], offset };
    const textos = [];
    for (const linha of buf.toString('utf8', 0, ultimaQuebra).split('\n')) {
      if (!linha.includes('"assistant"') || !linha.includes('"text"')) continue;
      let j; try { j = JSON.parse(linha); } catch { continue; }
      if (j.type !== 'assistant' || j.isSidechain || !j.message || !Array.isArray(j.message.content)) continue;
      if (j.message.model === '<synthetic>') continue;
      for (const b of j.message.content) if (b && b.type === 'text' && b.text && b.text.trim()) textos.push(b.text.trim());
    }
    return { textos, offset: offset + ultimaQuebra + 1 };
  } catch { return { textos: [], offset }; } finally { if (fd !== undefined) closeSync(fd); }
}
