// Utilitários puros: data, texto, redação de segredos, recorte, cercas e comandos destrutivos.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export function lerEntrada() {
  try {
    const bruto = readFileSync(0, 'utf8').replace(/^\uFEFF/, ''); // tolera BOM (pipe do PowerShell 5.1)
    return JSON.parse(bruto || '{}');
  } catch { return {}; }
}

// DIARIO_AGORA (ISO) fixa o relógio nos testes.
export function agora() {
  const f = process.env.DIARIO_AGORA;
  const d = f ? new Date(f) : new Date();
  return isNaN(d) ? new Date() : d;
}

const p2 = (n) => String(n).padStart(2, '0');
export const dataISO = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const hora = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
// Carimbo de hora; se o dia já não é o do arquivo, inclui a data.
export const carimbo = (d, dataArquivo) => (dataArquivo && dataISO(d) !== dataArquivo ? `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${hora(d)}` : hora(d));

export const sha12 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

export function dormir(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// ---- Segredos ------------------------------------------------------------------------------
// Divide a linha em comandos nos separadores | ; & fora de aspas (o separador fica no pedaço anterior).
// \ e crase (escape do bash e do PowerShell) levam o caractere seguinte, fora de aspas simples. Errar
// para menos cortes é seguro: pedaço maior só faz as regras por programa redigirem mais.
function comandos(linha) {
  const out = [];
  let atual = '', aspa = null, escape = false;
  for (const c of linha) {
    atual += c;
    if (escape) escape = false;
    else if (aspa !== "'" && (c === '\\' || c === '`')) escape = true;
    else if (aspa) { if (c === aspa) aspa = null; } else if (c === '"' || c === "'") aspa = c; else if ('|;&'.includes(c)) { out.push(atual); atual = ''; }
  }
  return [...out, atual];
}
// Valor que não é segredo literal: tipo (password: string), referência (process.env.X, $env:X, ${X},
// %X%, config.secret, this.token), chamada (getToken()), palavra de configuração, ou só pontuação.
// Palavras capitalizadas com ponto (Correct.Horse.Battery) são frase-senha, não referência.
const NAO_SEGREDO = [
  /^(?:string|number|boolean|bool|str|int|float|any|unknown|object|bytes|never|void|null|undefined|true|false|yes|no|on|off|none|inherit|required|optional)(?:\[\])?\??$/i,
  /^(?:process\.env\.|os\.environ|\$env:|%\w+%$)/i, /^\$\{[A-Za-z_][\w:.]*\}$|^\$(?=\D*$)[A-Za-z_][\w:.]*$/, /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\(/,
  /^(?=\D*$)(?![A-Z][a-z]+(?:\.[A-Z][a-z]+)+$)[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/, /^ConvertTo-SecureString$/i, /^[^A-Za-z0-9]*$/,
  // Cmdlet do PowerShell ($password = Read-Host …, $token = (Get-AzAccessToken …).Token): verbos comuns
  // de leitura, não qualquer Palavra-Palavra (frase-senha como Blue-Sky fica redigida); com dígito
  // (New-York2024) é senha.
  /^\(?(?=\D*$)(?:Get|Read|New|Import|Export|Invoke|ConvertTo|ConvertFrom|Select|Unprotect|Protect|Receive|Request|Resolve|Find)-[A-Za-z]\w*$/i,
];
// Linha de um deslocamento: quebras indexadas uma vez por texto e busca binária. Varrer a linha a
// cada casamento é quadrático numa linha longa (JSON minificado: 400 mil caracteres, 12 s).
let idxTexto = null, idxQuebras = [], idxConexao = new Map();
function linhaEm(s, off) {
  if (s !== idxTexto) {
    idxTexto = s; idxQuebras = []; idxConexao = new Map();
    for (let i = s.indexOf('\n'); i >= 0; i = s.indexOf('\n', i + 1)) idxQuebras.push(i);
  }
  let a = 0, b = idxQuebras.length;
  while (a < b) { const m = (a + b) >> 1; if (idxQuebras[m] < off) a = m + 1; else b = m; }
  return a;
}
// A linha tem cara de string de conexão (UID=, Server=…)? Calculado uma vez por linha.
function linhaDeConexao(s, off) {
  const n = linhaEm(s, off);
  if (!idxConexao.has(n)) {
    const linha = s.slice(n ? idxQuebras[n - 1] + 1 : 0, n < idxQuebras.length ? idxQuebras[n] : s.length);
    idxConexao.set(n, /(?:^|;)\s*(?:UID|User ?ID|Server|DSN|Driver|Database)\s*=/i.test(linha));
  }
  return idxConexao.get(n);
}
const naoSegredo = (v) => [v, v.replace(/[)\]}>|:=]+$/, '')].some((x) => NAO_SEGREDO.some((re) => re.test(x)));
// Chave privada: até o END; sem ele (saída cortada por head, recorte, diff parcial), até a última
// linha seguida que parece corpo de PEM (base64, cabeçalho "Chave: valor", vazia, prefixo de diff).
// Quebra de linha real ou \n literal (PEM dentro de string JSON), com ou sem \r antes (CRLF).
// Varredura com lastIndex, não [\s\S]*? numa regex só: cada BEGIN sem END percorria o resto do
// texto (quadrático). Sem END depois de um BEGIN, não há depois dos seguintes: não se procura mais.
const PEM_INI = /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/g;
const PEM_FIM = /-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/g;
// Cabeçalho (Proc-Type: …) antes do base64, e base64 só como linha inteira: senão "Proc" casava como
// base64 e o corpo depois do cabeçalho ficava. \/ é a barra escapada de JSON.
const PEM_CORPO = /(?:(?:\r?\n|(?:\\r)?\\n)[^\S\n]*[+>-]?[^\S\n]*(?:[\w-]+:[^\n\\]*|(?:[A-Za-z0-9+=]|\\?\/)+(?=[^\S\n]*(?:\r?\n|\\[rn]|["']|$)))?[^\S\n]*)*/y;
function pem(t) {
  let out = '', fim = 0, semFim = false, m;
  PEM_INI.lastIndex = 0;
  while ((m = PEM_INI.exec(t))) {
    out += t.slice(fim, m.index) + '[CHAVE PRIVADA REDIGIDA]';
    PEM_FIM.lastIndex = PEM_INI.lastIndex;
    if (!semFim && PEM_FIM.exec(t)) fim = PEM_FIM.lastIndex;
    else { semFim = true; PEM_CORPO.lastIndex = PEM_INI.lastIndex; PEM_CORPO.exec(t); fim = PEM_CORPO.lastIndex; }
    PEM_INI.lastIndex = fim;
  }
  return out + t.slice(fim);
}
// ConvertTo-SecureString -AsPlain* e NetworkCredential (regra descrita em SEGREDOS). Duas passadas: as
// variáveis citadas saem de todas as linhas lógicas antes de redigir as atribuições.
const CONVERTE = /ConvertTo-SecureString|NetworkCredential/i;
const LINHA_LOGICA = /(?:[^\n]*[\\`]\r?\n)*[^\n]*/g;
const marcado = (seg) => (/ConvertTo-SecureString/i.test(seg) && /-AsPlain/i.test(seg)) || /NetworkCredential/i.test(seg);
const aspas = (seg) => seg.replace(/"[^"\n]*"|'[^'\n]*'/g, (q) => q[0] + '[REDIGIDO]' + q[0]);
const encanado = (segs, i) => i + 1 < segs.length && marcado(segs[i + 1]) && /\|\s*$/.test(segs[i]);
// Variável do PowerShell: $p, ${p}, com escopo ($env:X, $script:p); o nome é o grupo 1.
const VAR_PS = String.raw`\$\{?(?:(?:env|script|global|local|private|using):)?(\w+)\}?`;
function segura(t) {
  if (!CONVERTE.test(t)) return t;
  const vars = new Set();
  for (const [linha] of t.matchAll(LINHA_LOGICA)) {
    if (!CONVERTE.test(linha)) continue;
    const segs = comandos(linha);
    segs.forEach((seg, i) => {
      if (!marcado(seg) && !encanado(segs, i)) return;
      for (const [, v] of seg.replace(new RegExp(String.raw`^\s*${VAR_PS}[^\S\n]*=`), '').matchAll(new RegExp(VAR_PS, 'g'))) vars.add(v.toLowerCase());
    });
  }
  const atribuicao = (seg) => (vars.size ? seg.replace(new RegExp(String.raw`(${VAR_PS}[^\S\n]*=[^\S\n]*)("[^"\n]*"|'[^'\n]*'|[^\s;|&\x60]+)`, 'g'), (m, p, n, v) =>
    (!vars.has(n.toLowerCase()) || (!/^["']/.test(v) && (/^[$(@[]/.test(v) || naoSegredo(v))) ? m
      : p + (/^["']/.test(v) ? v[0] + '[REDIGIDO]' + v[0] : '[REDIGIDO]'))) : seg);
  return t.replace(LINHA_LOGICA, (linha) => {
    if (!CONVERTE.test(linha)) return atribuicao(linha);
    const segs = comandos(linha);
    return segs.map((seg, i) => {
      if (marcado(seg)) {
        return aspas(seg).replace(/((?:ConvertTo-SecureString|-String|-AsPlain\w*|-Force)(?::\$\w+)?[^\S\n]+)(?![-($"'[])([^\s;|`)]+)/gi, '$1[REDIGIDO]')
          .replace(/(-ArgumentList[^\S\n]+)(?![($"'[])([^|;\n]*[^|;\s])/gi, (m, p, v) => (/NetworkCredential/i.test(seg) ? p + '[REDIGIDO]' : m));
      }
      return atribuicao(encanado(segs, i) ? aspas(seg) : seg);
    }).join('');
  });
}
// Quem lê senha do stdin: --password-stdin (docker, helm…), sudo -S/--stdin, passwd --stdin, chpasswd,
// gpg --passphrase-fd 0, htpasswd -i, smbpasswd -s, vault login -, openssl -pass/-passin/-password
// stdin|fd:0|file:/dev/stdin, cryptsetup, kinit, e passwd como o comando do pipeline (/etc/passwd como
// argumento não), também com caminho (/usr/bin/passwd) e depois de opções do sudo ou doas (sudo -u root
// passwd). CLIs de cofre que leem o valor do stdin: gcloud --data-file=-, secret(s) set/put/add (gh,
// wrangler, doppler), docker secret create … -, vercel env add, vault kv put k=-, e /dev/stdin (ou
// /dev/fd/0, /proc/self/fd/0; com file: ou @ antes) como valor de opção cujo nome tem palavra de
// segredo (--data-file, --from-file=k=, --secret-string, -pass) ou de chave de segredo (password=,
// value= do vault kv put).
// /dev/stdin de opção comum (wget -i, psql -f, jq --slurpfile data, aws --policy file://) não: o
// echo ali é URL, SQL, JSON ou caminho. openssl passwd -stdin e mkpasswd --stdin|-s leem a senha.
// Varreduras limitadas: sem limite, "sudo" repetido é quadrático. vault login e docker secret create
// andam por token (até 8), não por [^|\n]{0,100} duas vezes: linha continuada com vários "vault
// login" custava 1,4 s.
const DEV_STDIN = String.raw`\/(?:dev\/(?:stdin|fd\/0)|proc\/self\/fd\/0)(?![\w/])`;
const LE_STDIN = String.raw`(?:--password-stdin\b|\bsudo\b[^|\n]{0,100}\s(?:-[a-zA-Z]*S[a-zA-Z]*\b|--stdin\b)|\bpasswd\b[^|\n]{0,100}\s--stdin\b|\bchpasswd\b|--passphrase-fd[^\S\n]+0\b|\bhtpasswd\b[^|\n]{0,100}\s-[a-zA-Z]*i|\bsmbpasswd\b[^|\n]{0,100}\s-[a-zA-Z]*s|\bvault\b(?:[^\S\n]+-\S+){0,8}[^\S\n]+login(?:[^\S\n]+[^\s|]+){0,8}?[^\S\n]+-(?=\s|$)|\bopenssl\b[^|\n]{0,100}\s-pass(?:in|out|word)?[^\S\n]+(?:stdin|fd:0)\b|\bopenssl[^\S\n]+passwd\b[^|\n]{0,100}\s-stdin\b|\bmkpasswd\b[^|\n]{0,100}\s(?:--stdin|-s)\b|\bcryptsetup\b|\bkinit\b|\bpasswd\b(?<=(?:\|[^\S\n]{0,20}|\b(?:sudo|doas)(?:[^\S\n]+-\S+(?:[^\S\n]+[^\s-]\S*)?){0,4}[^\S\n]{1,20})(?:\/[\w.-]{1,40}){0,6}\/?passwd)(?![./\w-])|--data-file(?:=|[^\S\n]+)-(?!\S)|(?:\s-{1,2}[\w-]{0,40}(?:pass|secret|token|key|data|value|body|literal|from)[\w-]{0,30}(?:=|[^\S\n]+)(?:[\w.-]{1,40}=)?|\s[\w.-]{0,40}(?:pass|secret|token|key|value)[\w.-]{0,40}=)@?(?:file:(?:\/\/)?)?${DEV_STDIN}|\bsecrets?[^\S\n]+(?:set|put|add)\b|\bdocker\b(?:[^\S\n]+-\S+(?:[^\S\n]+(?!-)[^\s|;&]+)?){0,8}[^\S\n]+secret[^\S\n]+create(?:[^\S\n]+[^\s|]+){0,8}?[^\S\n]+-(?=\s|$)|\bvercel\b[^|\n]{0,100}\benv[^\S\n]+add\b|\baz\b[^|\n]{0,100}\bdevops[^\S\n]+login\b|\bvault\b[^|\n]{0,100}\s[\w.-]+=-(?=\s|$))`;
// Até o leitor: a linha, e a seguinte só depois de |, \ ou crase (pipeline partido: echo s |⏎ docker …).
const ATE_LEITOR = String.raw`(?:[^\n]|(?<=[|\\\x60][^\S\n]*)\n)`;
// Pipeline (pedaços de comandos() ligados por | ou |& simples) que contém a posição pos: ; && || &
// cortam; & de redirecionamento (2>&1, >&2, &>arq) não. aberto: termina em | (continua depois do corpo
// do here-doc: cat <<EOF |⏎corpo⏎EOF⏎docker login --password-stdin).
function pipeline(s, pos) {
  const ps = [];
  for (const p of comandos(s)) {
    const ant = ps[ps.length - 1];
    if (ant !== undefined && (/[<>]&$/.test(ant) || (ant.endsWith('&') && p.startsWith('>')) || (ant.endsWith('|') && p === '&'))) ps[ps.length - 1] += p; else ps.push(p);
  }
  const liga = (k) => /\|&?$/.test(ps[k]) && ps[k] !== '|' && ps[k + 1] !== '|';
  let k = 0, off = ps[0].length;
  while (k + 1 < ps.length && off <= pos) off += ps[++k].length;
  let a = k, b = k;
  while (a > 0 && liga(a - 1)) a--;
  while (b + 1 < ps.length && liga(b)) b++;
  const texto = ps.slice(a, b + 1).join('');
  return { texto, aberto: b === ps.length - 1 && /(?<!\|)\|&?\s*$/.test(texto) };
}
// bash: here-doc no pipeline de quem lê senha do stdin (docker login --password-stdin <<EOF, cat <<EOF |
// sudo -S …): as linhas do corpo até o delimitador, no máximo 20 (com <<-, o delimitador pode ter tabs;
// <<\EOF é como <<'EOF'). A linha lógica vai para trás e para a frente pelas continuações \ ou crase
// (até 20 linhas e 2000 caracteres: sem limite de tamanho, linhas longas continuadas custam ~20
// varreduras cada); as linhas se juntam com espaço no lugar da continuação (sudo \⏎ -S), e o corpo
// começa depois da última (cat <<EOF \⏎ | docker login …). Leitor em outro comando da linha (sudo -S
// true && cat <<EOF > app.conf) não conta. Pipeline que termina em | continua na linha depois do
// delimitador: o primeiro pipeline dela também conta (só os primeiros 2000 caracteres: vários here-docs
// caem no mesmo delimitador, e cada um varria a linha inteira).
const HEREDOC = /(?<!<)<<(?!<)(-?)[^\S\n]*\\?(["']?)(\w+)\2/;
const LE_STDIN_RE = new RegExp(LE_STDIN);
const CONTINUA = /[\\`]\r?$/;
function heredoc(t) {
  if (!t.includes('<<')) return t;
  const linhas = t.split('\n');
  for (let i = 0; i < linhas.length; i++) {
    const m = HEREDOC.exec(linhas[i]);
    if (!m) continue;
    let ini = i, ult = i, tam = linhas[i].length;
    while (ini > 0 && ult - ini < 20 && tam + linhas[ini - 1].length < 2000 && CONTINUA.test(linhas[ini - 1])) tam += linhas[--ini].length;
    while (ult + 1 < linhas.length && ult - ini < 20 && tam + linhas[ult + 1].length < 2000 && CONTINUA.test(linhas[ult])) tam += linhas[++ult].length;
    const partes = linhas.slice(ini, ult + 1).map((l) => l.replace(CONTINUA, ''));
    const pos = partes.slice(0, i - ini).reduce((n, l) => n + l.length + 1, 0) + m.index;
    const { texto, aberto } = pipeline(partes.join(' '), pos);
    const fim = new RegExp(String.raw`^${m[1] ? '\\t*' : ''}${m[3]}\r?$`);
    let le = LE_STDIN_RE.test(texto);
    if (!le && aberto) {
      let d = ult + 1;
      while (d < linhas.length && d <= ult + 20 && !fim.test(linhas[d])) d++;
      le = d + 1 < linhas.length && d <= ult + 20 && LE_STDIN_RE.test(pipeline(linhas[d + 1].slice(0, 2000), 0).texto);
    }
    if (!le) continue;
    i = ult;
    const limite = i + 20;
    while (i + 1 < linhas.length && i < limite && !fim.test(linhas[i + 1])) { i++; linhas[i] = '[REDIGIDO]' + (linhas[i].endsWith('\r') ? '\r' : ''); }
  }
  return linhas.join('\n');
}
// Nome de segredo na regra chave=valor (descrita em SEGREDOS).
const NOME_SEGREDO = String.raw`[\w.-]{0,40}(?:password|passwd|passphrase|sshpass|_pass\b|\bpass\b|(?:admin|root|db|user|sa)pass\b|senha|pwd|secret(?!ar(?:y|ies|iat))|segredo|token|_pat\b|\bpat\b|api[_-]?key|access[_-]?key|account[_-]?key|(?:private|encryption|signing|master|subscription|functions?|auth|storage|license)[_-]?key|client[_-]?secret)[\w.-]{0,40}`;
const NOME_SEGREDO_RE = new RegExp(NOME_SEGREDO, 'i');
// Caminho de arquivo de chave privada (~/.ssh/id_rsa, ./keys/deploy.pem, C:\keys\a.ppk, também a partir
// de variável: ${user.home}/.ssh/id_dsa do Maven, $HOME/.ssh/id_rsa): --private-key do ansible/terraform
// recebe o arquivo, não a chave.
const CAMINHO_CHAVE = /^(?:(?:~|\.{1,2}|\$\{[\w.:-]{1,60}\}|\$\w{1,60})?[\\/]|[A-Za-z]:[\\/])[\w.\\/-]*$|^[\w.\\/-]*(?:\.(?:pem|key|ppk)|\bid_(?:rsa|dsa|ecdsa|ed25519))$/;
// chave=valor: redige val (sem as aspas) do nome k que começa em off?
function redigeValor(k, val, off, s) {
  // secretName/existingSecret (k8s, Helm) nomeiam o objeto Secret, não guardam o valor.
  if (!val || /tokens|tokenizer|token_?(?:type|count|limit|usage)|passwordless|_?(?:ttl|expir\w*|lifetime|length|len)\b|\b(?:min|max)_|secret[_-]?names?\b|existing[_-]?secret\b/i.test(k)) return false;
  // Dentro de string de conexão $ não é variável nem valor é tipo: sempre redige.
  if (s[off - 1] === ';' || linhaDeConexao(s, off)) return true;
  if (naoSegredo(val)) return false;
  // Referência a arquivo: file://x, e nome terminado em _FILE/-path/_DIR com caminho, absoluto ou
  // relativo (POSTGRES_PASSWORD_FILE=/run/secrets/pg, --password-file=config/pw.txt, =pw.txt); par
  // de --from-file (kubectl: --from-file=password=./password.txt); caminho de chave privada.
  if (/^fileb?:\/\//i.test(val) || (/[_.-](?:file|path|dir)\\?["']?[^\S\n]*[:=][^\S\n]*$/i.test(k) && /^[~.$]|[\\/]|\.\w{1,5}$/.test(val))) return false;
  if (/--from-(?:env-)?file(?:=|[^\S\n]+)["']?$/.test(s.slice(Math.max(0, off - 24), off))) return false;
  if (/private[_-]?key/i.test(k) && CAMINHO_CHAVE.test(val)) return false;
  // Nome terminado em uri/url/endpoint com URL http(s) sem usuário, query nem fragmento é o endereço
  // (token-uri=https://…/v1/token, "token_uri": …, password_reset_url: …), não o segredo.
  if (/(?:ur[il]|endpoint)\\?["']?[^\S\n]*(?:[:=][^\S\n]*)?["']?$/i.test(k) && /^https?:\/\/[^\s@?#]+$/i.test(val)) return false;
  return !(/^(OLD)?PWD\s*=/.test(k) && /^(?:[/~.$]|[A-Za-z]:)/.test(val));
}
// Frase até o fim da linha (set NOME=…, YAML): o espaço final fica; só com espaço no valor.
const FRASE = String.raw`[^\s"'=(){};|<>[\]#&][^\n=(){};|<>[\]#&]*(?=[#&]|$)`;
const frase = (m, pre, k, val, off, s) => {
  const v = val.replace(/\s+$/, '');
  return /\s/.test(v) && redigeValor(k, v, off + pre.length, s) ? pre + k + '[REDIGIDO]' + val.slice(v.length) : m;
};
// Tabela de vault kv get/read ("Key  Value" e "---  -----"): nas linhas até a primeira vazia, o valor
// (resto da linha) da chave com nome de segredo; os filtros de redigeValor valem (token_ttl, no ficam).
function tabelaVault(t) {
  if (!/^-{3}[^\S\n]+-{5}\r?$/m.test(t)) return t;
  const linhas = t.split('\n');
  for (let i = 1, dentro = false; i < linhas.length; i++) {
    if (/^-{3}[^\S\n]+-{5}\r?$/.test(linhas[i]) && /^Key[^\S\n]+Value\r?$/.test(linhas[i - 1])) { dentro = true; continue; }
    if (!dentro) continue;
    if (!/\S/.test(linhas[i])) { dentro = false; continue; }
    const m = /^(\S+[^\S\n]+)(\S[^\r]*?)(\r?)$/.exec(linhas[i]);
    if (m && NOME_SEGREDO_RE.test(m[1]) && redigeValor(m[1].trim(), m[2].trim(), m[1].length, linhas[i])) linhas[i] = m[1] + '[REDIGIDO]' + m[3];
  }
  return linhas.join('\n');
}
const SEGREDOS = [
  pem,
  // PEM de chave privada em base64 (client-key-data do kubeconfig, tls.key de Secret): "-----BEGIN" em
  // base64 e, a até 40 caracteres, "PRIVATE K" num dos três alinhamentos. CERTIFICATE e PUBLIC KEY ficam.
  [/\bLS0tLS1CRUdJTi[A-Za-z0-9+/]{0,40}?(?:UFJJVkFURSBL|BSSVZBVEUgS0|QUklWQVRFIEt)[A-Za-z0-9+/]*={0,2}/g, '[CHAVE PRIVADA REDIGIDA]'],
  [/\b(sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,})/g, '[REDIGIDO]'],
  [/\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g, '[REDIGIDO]'],
  [/\b(AKIA[0-9A-Z]{16})\b/g, '[REDIGIDO]'],
  [/\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g, '[REDIGIDO]'],
  [/\bglpat-[A-Za-z0-9_-]{20,}/g, '[REDIGIDO]'],
  [/\b(?:AIza[0-9A-Za-z_-]{35}|npm_[A-Za-z0-9]{36}|hf_[A-Za-z0-9]{30,})/g, '[REDIGIDO]'],
  // Segredo de webhook do Stripe (stripe listen) e token de acesso OAuth do Google (gcloud auth print-access-token).
  [/\b(?:whsec_[A-Za-z0-9]{20,}|ya29\.[\w-]{20,})/g, '[REDIGIDO]'],
  // Assinatura de SAS do Azure (?sv=…&sig=…): parâmetro próprio, não substring ("design=" fica).
  [/([?&]sig=)[^&\s"'#]+/gi, '$1[REDIGIDO]'],
  // Chave de Azure Functions na URL (…azurewebsites.net/api/Fn?code=…, também /admin e /runtime/webhooks
  // do Durable Functions); ?code= de outros sites fica.
  [/(\.azurewebsites\.net\/[^\s"'#]{0,300}?[?&]code=)[^&\s"'#]+/gi, '$1[REDIGIDO]'],
  [/(\baws[^\S\n]+configure[^\S\n]+set[^\S\n]+(?:[\w.-]*\.)?aws_(?:secret_access_key|session_token)[^\S\n]+)("[^"\n]*"|'[^'\n]*'|\S+)/gi, '$1[REDIGIDO]'],
  [/\b(xox[abprs]-[A-Za-z0-9-]{10,})/g, '[REDIGIDO]'],
  // URL de webhook que é a credencial: Slack (services/triggers/workflows), Discord e token de bot do
  // Telegram (api.telegram.org/bot<id>:<token>); a documentação (api.slack.com, discord.com/developers) fica.
  [/(\bhooks\.slack\.com\/(?:services|triggers|workflows)\/)[^\s"'\x60<>]+/g, '$1[REDIGIDO]'],
  [/(\bdiscord(?:app)?\.com\/api\/(?:v\d{1,2}\/)?webhooks\/\d{1,30}\/)[\w-]+/g, '$1[REDIGIDO]'],
  [/(\bapi\.telegram\.org\/(?:file\/)?bot)\d{1,20}:[\w-]{30,}/g, '$1[REDIGIDO]'],
  // Token de API do PyPI (macaroon em base64url com prefixo fixo).
  [/\bpypi-AgE[A-Za-z0-9_-]{50,}/g, '[REDIGIDO]'],
  // JSON de cofre com o valor: az keyvault secret show (id …vault.azure.net/secrets/…), aws ssm
  // get-parameter --with-decryption ("Type": "SecureString"), az storage account keys list ("keyName":
  // "key1"): o "value" seguinte, na mesma linha ou até 12 linhas depois (linhas de até 300 caracteres).
  [/((?:\.vault\.azure\.net\/secrets\/|"Type"[^\S\n]*:[^\S\n]*"SecureString"|"keyName"[^\S\n]*:[^\S\n]*"(?:key|kerb)\d")(?:[^\n]{0,300}\n){0,12}?[^\n]{0,300}?"[Vv]alue"[^\S\n]*:[^\S\n]*")[^"\n]*/g, '$1[REDIGIDO]'],
  tabelaVault,
  // APP_KEY do Laravel (.env): só o valor base64:…; APP_KEY= vazio fica.
  [/(\bAPP_KEY[^\S\n]{0,20}[:=][^\S\n]{0,20}["']?)base64:[A-Za-z0-9+/]{16,}={0,2}/g, '$1[REDIGIDO]'],
  // Começa só no início de um trecho base64url: de dentro dele, cada "eyJ" revarreria o resto (quadrático).
  [/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[JWT REDIGIDO]'],
  // Authorization com qualquer esquema, em cabeçalho, JSON ou atribuição; nunca atravessa a linha.
  [/(\bAuthorization\\?["']?[^\S\n]*[:=][^\S\n]*\\?["']?(?:[A-Za-z-]{2,20}[^\S\n]+)?)[^\s"'`\\]{8,}/gi, '$1[REDIGIDO]'],
  // Fora de "Authorization:", só com maiúscula e token com dígito ou +/= ("basic implementation" fica).
  [/(\b(?:Bearer|Basic)[^\S\n]+)(?=[A-Za-z0-9._~-]*[0-9+/=])[A-Za-z0-9._~+/=-]{12,}/g, '$1[REDIGIDO]'],
  // usuario:senha@ até o @ que precede o host (a senha pode ter @ e /); porta numérica
  // (host:8080/x@y) não é senha. Até 200 caracteres: sem limite, "://a:b" repetido é quadrático.
  [/(:\/\/[^\s:/@]*:)(?!\d+(?:[/\s?#]|$))\S{0,200}?@(?=[^\s@/?#]*(?:[/\s?#]|$))/g, '$1[REDIGIDO]@'],
  // Token como usuário de URL http(s), sem ':' (PAT do Azure DevOps): 20+ caracteres; nome curto fica.
  [/(https?:\/\/)[^\s:/@]{20,}@/gi, '$1[REDIGIDO]@'],
  // Cabeçalho Cookie/Set-Cookie com par nome=valor, também como chave JSON ("Cookie": "sid=…").
  // O lookahead para em ':' (nome de cookie não tem): sem isso, "Cookie:" repetido é quadrático.
  // Hashtable do PowerShell (@{Cookie="sid=…"}) usa '=': só com aspa depois (?cookie=1&a=b de URL fica).
  [/(\b(?:Set-)?Cookie\\?["']?[^\S\n]*(?::[^\S\n]*\\?["']?|=[^\S\n]*\\?["']))(?=[^\s;"'`\\:=]*=)[^\n"'`\\]+/gi, '$1[REDIGIDO]'],
  // usuario:senha em base64: "auth": "…" do config.json do docker, _auth=… do .npmrc. Sem letra antes
  // do auth ("oauth": fica) e com 12+ caracteres de base64 (--auth=basic, http.auth=negotiate ficam),
  // em blocos de 4 e terminando ali: caminho ("auth": "src/features/auth/index.ts") fica. Base64 de
  // usuario:senha em ASCII não começa com / nem +: rota ("auth": "/api/v1/auth") fica.
  [/((?<![A-Za-z])_?auth\\?["']?[^\S\n]*[:=][^\S\n]*\\?["']?)(?![/+])(?:[A-Za-z0-9+/]{4}){3,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?(?![\w.+/=-])/g, '$1[REDIGIDO]'],
  // .netrc: machine host [login u] [account a] password SENHA na mesma linha; em várias linhas, o bloco
  // que abre numa linha "machine host [login u]", com até duas linhas de login/account, e a linha que
  // começa por password (não qualquer linha "password x" de um texto que cita "machine learning").
  // Host e usuário até 100 caracteres e inteiros (seguidos de espaço): sem isso, cada "machine"
  // revarria o token.
  [/(\bmachine[^\S\n]+\S{1,100}(?=\s)(?:[^\S\n]+(?:login|account|port)[^\S\n]+\S{1,100}(?=\s))*[^\S\n]+password[^\S\n]+)("[^"\n]*"|'[^'\n]*'|[^\s"'`]+)/g, '$1[REDIGIDO]'],
  [/(^[^\S\n]*machine[^\S\n]+\S+(?:[^\S\n]+(?:login|account)[^\S\n]+\S+)*[^\S\n]*\r?\n(?:[^\S\n]*(?:login|account)[^\S\n]+\S+[^\S\n]*\r?\n){0,2}[^\S\n]*password[^\S\n]+)("[^"\n]*"|'[^'\n]*'|[^\s"'`]+)/gm, '$1[REDIGIDO]'],
  // SQL: IDENTIFIED [WITH plugin] BY senha (BY VALUES 'hash' do Oracle: o hash também), PASSWORD 'senha', PASSWORD = N'senha' (T-SQL), PASSWORD('senha')
  // (MySQL), SET PASSWORD FOR 'u'@'h' = 'senha'. Só com aspa em seguida ("your password now" fica); com
  // = ou (, só aspa simples: "password": "x" de JSON é da regra chave=valor. ''senha'' é a aspa dobrada
  // de SQL dentro de string entre aspas simples (PowerShell, mysql -e '…').
  [/(\bIDENTIFIED[^\S\n]+(?:WITH[^\S\n]+(?:\w+|'[^'\n]*'|"[^"\n]*"|`[^`\n]*`)[^\S\n]+)?BY[^\S\n]+(?:(?:PASSWORD|VALUES)[^\S\n]+)?|\bPASSWORD(?:[^\S\n]+FOR[^\S\n]+(?:'[^'\n]*'|"[^"\n]*"|[^\s=@'"]+)(?:@(?:'[^'\n]*'|"[^"\n]*"|[^\s=]+))?[^\S\n]*=[^\S\n]*(?=N?['"])|[^\S\n]*[=(][^\S\n]*(?=N?')|[^\S\n]+(?=N?['"])))(''[^'\n]+''|N?"[^"\n]*"|N?'[^'\n]*'|[^\s;'"`]+)/gi, '$1[REDIGIDO]'],
  // MySQL: IDENTIFIED BY 'nova' REPLACE 'atual' (a senha atual também); o REPLACE pode abrir a linha seguinte.
  [/(\b(?:IDENTIFIED|PASSWORD)\b[^\n]{0,300}?(?:\b|\n[^\S\n]{0,20})REPLACE[^\S\n]+)(''[^'\n]+''|'[^'\n]*'|"[^"\n]*")/gi, '$1[REDIGIDO]'],
  // Oracle: IDENTIFIED BY nova REPLACE atual, sem aspas; só colado ao IDENTIFIED BY (texto comum com
  // "password … replace x" fica), na mesma linha ou com o REPLACE abrindo a seguinte.
  [/(\bIDENTIFIED[^\S\n]+BY[^\S\n]+(?:"[^"\n]*"|[^\s"]+)(?:[^\S\n]+|[^\S\n]*\r?\n[^\S\n]{0,20})REPLACE[^\S\n]+)([^\s;'"`]+)/gi, '$1[REDIGIDO]'],
  // echo/printf/Write-Output SENHA | <leitor de senha>: os argumentos do echo (até 8: sem limite,
  // cada echo varria todos os seguintes, tempo quadrático). Sem a flag i: sudo -s (shell) não é -S.
  // Argumento é trecho entre aspas ou caractere solto, colados: 'a'; e 'a') do grupo (echo a; echo b) | …
  // O | pode abrir a linha seguinte depois de \ ou crase (echo s \⏎ | docker …).
  [new RegExp(String.raw`(\b(?:[Ee]cho|ECHO|[Pp]rintf|[Ww]rite-[Oo]utput))((?:[^\S\n]+(?:"[^"\n]*"|'[^'\n]*'|[^\s|\x60"'])+){1,8})(?=[^\S\n]*(?:[\\\x60]\r?\n[^\S\n]*)?\|${ATE_LEITOR}{0,300}${LE_STDIN})`, 'g'), '$1 [REDIGIDO]'],
  // PowerShell: string literal no começo do pipeline ("senha" | docker login --password-stdin).
  [new RegExp(String.raw`((?:^|[;&(])[^\S\n]*)("[^"\n]*"|'[^'\n]*')(?=[^\S\n]*(?:[\\\x60]\r?\n[^\S\n]*)?\|${ATE_LEITOR}{0,300}${LE_STDIN})`, 'gm'), '$1[REDIGIDO]'],
  // bash: here-string (--password-stdin <<< "senha", sudo -S … <<< "senha"), também na linha continuada.
  [new RegExp(String.raw`(${LE_STDIN}${ATE_LEITOR}{0,300}?<<<[^\S\n]*)("[^"\n]*"|'[^'\n]*'|\S+)`, 'g'), '$1[REDIGIDO]'],
  // MongoDB: db.changeUserPassword("usuario", "senha") e db.auth("usuario", "senha"): o segundo argumento
  // literal (passwordPrompt() fica).
  [/((?:\bchangeUserPassword|\.auth)[^\S\n]{0,20}\([^\S\n]{0,20}(?:"[^"\n]*"|'[^'\n]*')[^\S\n]{0,20},[^\S\n]{0,20})("[^"\n]*"|'[^'\n]*')/g, (m, p, v) => p + v[0] + '[REDIGIDO]' + v[0]],
  heredoc,
  // PowerShell: na linha lógica (continuada por crase), o comando (pedaço entre | ; &) com
  // ConvertTo-SecureString … -AsPlain* ou NetworkCredential tem toda string literal redigida, e o
  // anterior também se termina em | (senha vinda pelo pipeline). Sem aspas: o argumento de
  // ConvertTo-SecureString/-String/-AsPlainText/-Force e os de -ArgumentList. Variável citada no comando
  // marcado ou no anterior que termina em | ($pw, fora a que recebe o resultado) tem a atribuição
  // literal redigida em qualquer linha do texto ($pw = 'senha' numa linha, ConvertTo-SecureString $pw
  // na seguinte). Os outros comandos ficam.
  segura,
  // Windows: cmdkey /pass:x; net use \\srv\share senha: depois do compartilhamento, todo argumento
  // que não é /opção nem * (a senha é posicional e pode vir entre aspas), até o fim do comando.
  // Varreduras limitadas a 300 caracteres: sem limite, cada "net use" revarre a linha (quadrático).
  [/(\/pass:)("[^"\n]*"|\S+)/gi, '$1[REDIGIDO]'],
  [/(\bnet[^\S\n]+use\b[^\n]{0,300}?(?:"\\\\[^"\n]*"|\\\\[^\s"]+))([^\n]*)/gi, (m, ini, resto) => {
    let fim = false;
    return ini + resto.replace(/\S+/g, (t) => ((fim ||= /^(?:[&|;<>]|\d>)/.test(t)) || /^[/*]/.test(t) ? t : '[REDIGIDO]'));
  }],
  // XML (settings.xml do Maven, NuGet.config, web.config, properties em XML): texto do elemento com nome
  // de segredo (<password>…</password>, <ns:clientSecret x="…">, também em <![CDATA[…]]>), value do par
  // <add key="…Password" value="…"/> ou <property name="…password" value="…"/> (Spring, persistence.xml,
  // Ant) e texto do elemento cujo key= ou name= é nome de segredo (<entry key="db.password">…</entry>,
  // <property name="hibernate.connection.password">…</property>). Na mesma linha, até 300 caracteres;
  // os filtros de redigeValor valem (<max_tokens>100</…> e name="maxTokens" value="100" ficam).
  // CDATA tem regras próprias: o valor vai até o ]]> e pode ter < e ] (p<s, ]s); vazio fica.
  [new RegExp(String.raw`(<(?:[\w.-]{1,40}:)?(${NOME_SEGREDO})(?:\s[^>\n]{0,200})?><!\[CDATA\[)((?:(?!\]\]>)[^\n]){1,300})(?=\]\]><\/)`, 'gi'),
    (m, tag, k, val, off, s) => (redigeValor(k, val, off + 1, s) ? tag + '[REDIGIDO]' : m)],
  [new RegExp(String.raw`(<[\w.:-]{1,40}\s[^>\n]{0,200}?\b(?:key|name)=(["'])(${NOME_SEGREDO})\2[^>\n]{0,200}><!\[CDATA\[)((?:(?!\]\]>)[^\n]){1,300})(?=\]\]><\/)`, 'gi'),
    (m, tag, q, k, val, off, s) => (redigeValor(k, val, off, s) ? tag + '[REDIGIDO]' : m)],
  [new RegExp(String.raw`(<(?:[\w.-]{1,40}:)?(${NOME_SEGREDO})(?:\s[^>\n]{0,200})?>)([^<\]\n][^<\n]{0,299}?)(?=<\/)`, 'gi'),
    (m, tag, k, val, off, s) => (redigeValor(k, val, off + 1, s) ? tag + '[REDIGIDO]' : m)],
  [new RegExp(String.raw`(\b(?:key|name)=(["'])(${NOME_SEGREDO})\2[^>\n]{0,100}?\bvalue=(["']))((?:(?!\4)[^\n]){1,300})(?=\4)`, 'gi'),
    (m, p, q, k, q2, val, off, s) => (redigeValor(k, val, off + p.indexOf(q) + 1, s) ? p + '[REDIGIDO]' : m)],
  [new RegExp(String.raw`(<[\w.:-]{1,40}\s[^>\n]{0,200}?\b(?:key|name)=(["'])(${NOME_SEGREDO})\2[^>\n]{0,200}>)([^<\n]{1,300})(?=<\/)`, 'gi'),
    (m, tag, q, k, val, off, s) => (redigeValor(k, val, off, s) ? tag + '[REDIGIDO]' : m)],
  // Windows: setx NOME VALOR e [Environment]::SetEnvironmentVariable('NOME', 'VALOR', …) com nome de
  // segredo; os filtros de redigeValor valem (setx MAX_TOKENS 4096, %VAR% e $var ficam). /M (máquina)
  // pode vir antes do nome.
  [new RegExp(String.raw`((?:^|[\s&|;(])setx(?:\.exe)?(?:[^\S\n]{1,20}[/-][mM])?[^\S\n]{1,20}(["']?)(${NOME_SEGREDO})\2[^\S\n]{1,20})("[^"\n]*"|'[^'\n]*'|[^\s\x60|;&<>]+)`, 'gi'),
    (m, p, q, k, v, off, s) => {
      const a = /^["']/.test(v) ? v[0] : '';
      return redigeValor(k, a ? v.slice(1, -1) : v, off + p.indexOf(k), s) ? p + a + '[REDIGIDO]' + a : m;
    }],
  [new RegExp(String.raw`(SetEnvironmentVariable\([^\S\n]{0,20}(["'])(${NOME_SEGREDO})\2[^\S\n]{0,20},[^\S\n]{0,20})("[^"\n]*"|'[^'\n]*')`, 'gi'),
    (m, p, q, k, v, off, s) => (redigeValor(k, v.slice(1, -1), off + p.indexOf(k), s) ? p + v[0] + '[REDIGIDO]' + v[0] : m)],
  // chave=valor / chave: valor com nome de segredo
  // PWD/OLDPWD maiúsculos com valor que é caminho são o diretório, não senha — salvo dentro de string
  // de conexão (depois de `;` ou com UID/Server/DSN/Driver na linha): Pwd= de ODBC é redigido.
  // Valor entre aspas (inclusive \" de JSON escapado) vai inteiro até a aspa que fecha, de qualquer
  // tamanho; entre chaves ({a;b}, ODBC) também; sem aspas, até o fim do token: para em ; & aspa, crase,
  // vírgula seguida de espaço e \ de escape JSON (\" \\ \n \r \t); vírgula ou \ no meio vão junto, salvo
// vírgula seguida de nome= (helm --set a.secretName=x,a.password=s: o par seguinte é reexaminado).
  // & separa comando (set X=s&npm run) e parâmetro de URL (?token=x&page=2).
  // Contagem de tokens (max_tokens, input_tokens, tokenizer, token_type), parâmetro de política
  // (token_ttl, password_min_length, max_token) e naoSegredo() ficam.
  // Nome limitado a 40 caracteres antes e depois da palavra: sem limite, texto longo de [\w.-] sem
  // nome de segredo custa tempo quadrático (medido: 120 mil caracteres, 12 s).
  // Frase-senha sem aspas até o fim da linha, só onde a linha inteira é o valor: set NOME=… do cmd e
  // YAML (NOME: …, - NOME: …, no começo da linha). Valor sem = ( ) { } ; | < > [ ] (password: str =
  // Field(…) e password: string | undefined são código), até #, & ou o fim; sem espaço no valor, a
  // regra chave=valor faz o mesmo. NOME=a b do bash não: ali b é o comando (DB_PASSWORD=x ./run.sh).
  [new RegExp(String.raw`((?:^|[&(])[^\S\n]*set[^\S\n]+)(${NOME_SEGREDO}=)(${FRASE})`, 'gim'), frase],
  [new RegExp(String.raw`(^[^\S\n]*(?:-[^\S\n]+)?)(${NOME_SEGREDO}:[^\S\n]+)(${FRASE})`, 'gim'), frase],
  // Par inteiro entre aspas ('DB_PASSWORD=frase com espaço', docker -e, --from-literal): o valor vai até
  // a aspa que fecha (até 300 caracteres); sem espaço no valor, a regra seguinte faz o mesmo.
  [new RegExp(String.raw`(^|[\s=(])(["'])(${NOME_SEGREDO}=)((?:(?!\2)[^\n]){1,300})(?=\2)`, 'gim'),
    (m, pre, q, k, val, off, s) => (/\s/.test(val) && redigeValor(k, val, off + pre.length + 1, s) ? pre + q + k + '[REDIGIDO]' : m)],
  // Usuário de URL com nome de segredo (https://x-access-token:…@host, __token__:) já redigido pela
  // regra de URL: o valor seria [REDIGIDO]@host/caminho e o host sumiria. Só nesse contexto (logo
  // depois de ://usuario: e seguido de [REDIGIDO]@) a regra não casa; o resto da URL segue varrido
  // (?token=… no caminho). password=[REDIGIDO]x fora de URL continua redigido.
  [new RegExp(String.raw`(${NOME_SEGREDO}\\?["']?[^\S\n]*[:=][^\S\n]*)(?!(?<=:\/\/[^\s:/@]{0,200}:)\[REDIGIDO\]@)(\\"[^"\n]*?\\"|"[^"\n]*"|N?'[^'\n]*'|\{[^{}\n]*\}|(?:[^\s"',;\\\x60&]|,(?![\w.[\]-]{1,80}=)(?=[^\s"',;\\\x60&])|\\(?![\\"nrt]))+)`, 'gi'),
    (m, k, v, off, s) => {
      const q = /^(?:\\"|"|')/.exec(v)?.[0] || '';
      return redigeValor(k, q ? v.slice(q.length, -q.length) : v, off, s) ? k + q + '[REDIGIDO]' + q : m;
    }],
  // Forma exec em array (CMD/ENTRYPOINT do Dockerfile, command:/args: do compose e do k8s):
  // "--requirepass", "senha": o elemento seguinte à flag com nome de segredo, até a aspa que fecha (até 300
  // caracteres). Mesmas exceções da regra de flags abaixo (outra flag, id=/src=, env:/file:, caminho de
  // --private-key); --password-file e --no-password ficam.
  [/((['"])-{1,2}(?!-|no-)[\w-]{0,40}(?:password|passwd|passphrase|secret|token|requirepass|masterauth|(?:api|auth|access|private)[_-]?key)\2[^\S\n]{0,20},[^\S\n]{0,20}(['"]))(?![-(]|(?:id|src|source|env|type|target)=|(?:env|file|fd):)((?:(?!\3)[^\n]){1,300})(?=\3)/gi,
    (m, p, q, q2, v) => (/private[_-]?key/i.test(p) && CAMINHO_CHAVE.test(v) ? m : p + '[REDIGIDO]')],
  // Diretiva do redis.conf (requirepass/masterauth senha): no começo da linha, logo depois de aspa (echo
  // "requirepass x" >> redis.conf) ou de CONFIG SET; "# requirepass foobared" e texto corrido ficam.
  [/((?:^[^\S\n]*|(?<=["'])|\bCONFIG[^\S\n]+SET[^\S\n]+)(?:requirepass|masterauth)[^\S\n]+)(?!-)("[^"\n]*"|'[^'\n]*'|[^\s"'\x60]+)/gim, '$1[REDIGIDO]'],
  // flags de linha de comando: --password senha, -Password "frase com espaço", --db-password x,
  // --client-secret x (o nome termina na palavra: --password-stdin, --token-file, --max-tokens ficam).
  // Nomes curtos (pass, passin, passout, pw, storepass, keypass: gpg, redis-cli, openssl, plink,
  // keytool) só como nome inteiro ou depois de - ou _: --bypass e --compass ficam; --no-pass também.
  // Valor que começa com ( é subexpressão (-Password (ConvertTo-SecureString …)): a regra dela cuida.
  // Referência não é o segredo: docker --secret id=x,src=arquivo; openssl -passin stdin|env:X|file:x|fd:3;
  // --private-key com caminho de arquivo (ansible).
  // --cookie fica com a regra do curl (--cookie cookies.txt é arquivo).
  [/((?:^|\s)-{1,2}(?!-|no-)(?:[\w-]{0,40}(?:password|passwd|passphrase|senha|pwd|token|secret|bearer|(?:api|account|access|secret|private|encryption|signing|master|subscription|functions?|auth)-?key)|(?:\w{0,40}[-_])?(?:(?:src|dest|require)?(?:store|key)?pass(?:in|out)?|pw|masterauth))[^\S\n]+)(?![-(]|(?:id|src|source|env|type|target)=|stdin(?![^\s`])|(?:env|file|fd):)("[^"\n]*"|'[^'\n]*'|[^\s`]+)/gi,
    (m, p, v) => (/private-?key[^\S\n]*$/i.test(p) && CAMINHO_CHAVE.test(v.replace(/^(["'])(.*)\1$/, '$2')) ? m : p + '[REDIGIDO]')],
  // net user nome senha [/add]: o segundo argumento, se não é /opção, * (que pede a senha) nem separador.
  [/(\bnet[^\S\n]+user[^\S\n]+(?:"[^"\n]*"|[^\s/"]\S*)[^\S\n]+)(?![/*|&;<>]|\d>)("[^"\n]*"|\S+)/gi, '$1[REDIGIDO]'],
  // Por comando (pedaço entre | ; & fora de aspas), só nos programas que levam senha assim.
  // Fora deles, -u e -p são de outros comandos (git push -u, docker -u 1000:1000, mkdir -p, ssh -p).
  // Linha lógica: a terminada em \ (bash) ou crase (PowerShell) continua na seguinte, onde pode
  // estar o -p do programa da linha de cima.
  [/(?:[^\n]*[\\`]\r?\n)*[^\n]*/g, (linha) => comandos(linha).map((seg) => POR_PROGRAMA.reduce((s, [prog, sub]) => (prog.test(s) ? sub(s) : s), seg)).join('')],
];
// Valor de flag: entre aspas inteiro, senão até o espaço; nunca outra flag (-p -v).
const VAL = String.raw`(?!-)("[^"\n]*"|'[^'\n]*'|[^\s\x60]+)`;
// Flag com valor junto ou separado (-pSEGREDO, -p SEGREDO); junto=false só aceita separado.
const flag = (f, junto = true) => (s) => s.replace(new RegExp(String.raw`((?:^|\s)${f})(${junto ? String.raw`[^\S\n]*` : String.raw`[^\S\n]+`})${VAL}`, 'g'), '$1$2[REDIGIDO]');
// Nome do programa depois de início, espaço, caminho, aspa ou abertura de subexpressão ($( ( ` { =).
const programa = (nomes) => new RegExp(String.raw`(?:^|[\s/\\"'(\x60{=])(?:${nomes})(?:\.exe)?(?=[\s"'\x60)}]|$)`, 'i');
const oracle = (s) => s.replace(/((?:^|\s)(?:userid=)?["']?[\w$#]+\/)(?![/\s])("[^"\n]*"|[^\s@"'/]+)/gi, '$1[REDIGIDO]');
// curl -u usuario:senha / --user=usuario:senha: o par inteiro (a chave pode ser o usuário); sem ':'
// não é par; -b (forma curta de --cookie) só com '=' (curl -b cookies.txt é arquivo).
// mysql/mariadb: -p (-P é porta); com espaço o mysql lê nome de banco, mas quem digita a
// senha ali a vaza, então vai também. Progress (pro*, _progres, proutil…): -P é senha, -p procedure.
// Oracle (sqlplus, expdp…): usuario/senha[@banco] no primeiro argumento ou em userid=; exp, imp e
// CONNECT só como o comando do pedaço (são palavras comuns). htpasswd -b: a senha é o último
// argumento antes de redirecionamento ou separador. smbclient //srv/share SENHA: posicional.
// Teste com várias regex: todas casam (cada uma linear; juntas numa só, [^\n]* entre elas é quadrático).
const todos = (...res) => ({ test: (s) => res.every((re) => re.test(s)) });
// smbclient //srv/share (ou '\\srv\share') [opções] SENHA: o primeiro argumento depois do serviço que
// não é opção nem valor de opção, até redirecionamento ou separador. -T<letras> (ou -T letras) leva o
// arquivo tar e depois a lista de arquivos: nada depois dele é senha. Opção terminada em '='
// (--option='a=b') leva o token colado a ela. Com -N, -k, -A ou -U u%senha não há senha posicional.
const SMB_COM_VALOR = /^(?:-[UWcpmnIOdlDAsRtMbSi]|--(?:user|workgroup|command|port|message|netbiosname|ip-address|debuglevel|log-basename|directory|authentication-file|configfile|max-protocol|socket-options|name-resolve|scope|timeout|option|send-buffer|signing|client-protection|realm)|-[^\s=]*=)$/;
const SMB_SEM_SENHA = /(?:^|\s)(?:-[NkA]\b|--(?:no-pass|kerberos|use-kerberos|authentication-file)\b|(?:-U|--user)(?:=|[^\S\n]*)["']?[^\s%"'`]*%)/;
function smbPosicional(s) {
  if (SMB_SEM_SENHA.test(s)) return s;
  return s.replace(/(\s["']?(?:\/\/|\\\\)[^\s"']+["']?)([^\n]*)/, (m, srv, resto) => {
    let fim = false, espera = 0, tar = false;
    return srv + resto.replace(/"[^"\n]*"|'[^'\n]*'|[^\s"']+/g, (t) => {
      if (fim || (fim = /^(?:[|;&<>]|\d>)/.test(t))) return t;
      if (espera) { fim = !--espera && tar; return t; }
      if (/^(?:-T|--tar)$/.test(t)) { espera = 2; tar = true; return t; }
      if (/^(?:-T[a-zA-Z]+|--tar=\S+)$/.test(t)) { espera = 1; tar = true; return t; }
      if (t.startsWith('-')) { espera = SMB_COM_VALOR.test(t) ? 1 : 0; return t; }
      fim = true;
      return '[REDIGIDO]';
    });
  });
}
// Início do comentário do shell: # fora de aspas depois de espaço (pa#ss é palavra); sem ele, o fim.
function comentario(s) {
  let aspa = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (aspa) { if (c === aspa) aspa = null; } else if (c === '"' || c === "'") aspa = c; else if (c === '#' && i && /\s/.test(s[i - 1])) return i;
  }
  return s.length;
}
// set NOME VALOR (doppler secrets set, dotnet user-secrets set): o segundo argumento que não é opção,
// separador nem redirecionamento. Até 8 opções antes, cada uma com valor opcional (-p proj, --id=x).
const OPCOES = String.raw`(?:[^\S\n]+-\S+(?:[^\S\n]+(?!-)[^\s|;&]+)?){0,8}`;
const posicional = (s) => s.replace(/(\bset(?:[^\S\n]+-[^\s=]*(?:=\S*|[^\S\n]+(?![-|;&<>])[^\s"'`]\S*)?){0,8}[^\S\n]+(?:"[^"\n]*"|'[^'\n]*'|(?![-|;&<>])[^\s"'=`]+)[^\S\n]+)(?![-|;&<>])("[^"\n]*"|'[^'\n]*'|[^\s`|;&<>]+)/, '$1[REDIGIDO]');
const POR_PROGRAMA = [
  // -u e -b também no fim de um grupo de flags curtas (-su, -sSb); -U/--proxy-user do proxy igual.
  // Grupo de flags e usuário limitados (sem limite, "-uuuu…" é quadrático); usuário vazio (-u :PAT) vale.
  [programa('curl'), (s) => s.replace(/((?:^|\s)(?:-[a-zA-Z]{0,15}[uU][^\S\n]*|--(?:proxy-)?user(?:=|[^\S\n]+)))("[^"\n]*"|'[^'\n]*'|[^\s"'`:]{0,300}:(?:"[^"\n]*"|'[^'\n]*'|[^\s"'`]*))/g,
    (m, p, v) => (v.includes(':') ? p + '[REDIGIDO]' : m))
    .replace(/((?:^|\s)(?:-[a-zA-Z]{0,15}b[^\S\n]*|--cookie(?:=|[^\S\n]+)))(?=["']?[^\s"'`=]{0,300}=)("[^"\n]*"|'[^'\n]*'|[^\s`]+)/g, '$1[REDIGIDO]')
    // -E/--cert certificado:senha; a letra de unidade (C:\certs\c.pem) não é o separador. -E também no
    // fim de um grupo de flags curtas sem argumento (-kE, -sE); -XDELETE não é grupo (-X leva argumento).
    // Só a senha entre aspas (cert.p12:'s') também; com o par entre aspas ('cert.p12:frase com espaço'),
    // até a aspa que fecha (até 300 caracteres).
    .replace(/((?:^|\s)(?:-[abfgGiIjJklLMnNOpqRsSvV]{0,15}E[^\S\n]*|--(?:proxy-)?cert(?:=|[^\S\n]+))(["'])(?:[A-Za-z]:[\\/]|(?![A-Za-z]:[\\/]))[^\s"'`:]{1,300}:)(?:(?!\2)[^\n]){1,300}(?=\2)/g, '$1[REDIGIDO]')
    .replace(/((?:^|\s)(?:-[abfgGiIjJklLMnNOpqRsSvV]{0,15}E[^\S\n]*|--(?:proxy-)?cert(?:=|[^\S\n]+))["']?(?:[A-Za-z]:[\\/]|(?![A-Za-z]:[\\/]))[^\s"'`:]{1,300}:)("[^"\n]*"|'[^'\n]*'|[^\s"'`]+)/g, '$1[REDIGIDO]')],
  [programa(String.raw`(?:mysql|mariadb)[\w-]*`), flag('-p')],
  [todos(programa('docker|podman|nerdctl|buildah|skopeo|helm|oras|az'), /\blogin\b/), flag('-p')],
  [programa('sshpass'), flag('-p')],
  [programa(String.raw`ldap\w+`), flag('-w')],
  [programa('ldappasswd'), flag('-[as]')],
  [programa('smbclient|rpcclient|smbcacls|smbget|smbmap'), (s) => s.replace(/((?:^|\s)(?:-U[^\S\n]*|--user(?:=|[^\S\n]+))["']?[^\s%"'`]*%)([^\s"'`]+)/g, '$1[REDIGIDO]')],
  [programa('smbclient'), smbPosicional],
  // Cauda com um só \s* livre: "\s*[|;&]*\s*" era quadrático em espaços seguidos. O comentário (# fora
  // de aspas, depois de espaço) sai antes: senão a última palavra dele passava por senha.
  [todos(programa('htpasswd'), /\s-[a-zA-Z]*b/), (s) => {
    const i = comentario(s);
    return s.slice(0, i).replace(/(\s)("[^"\n]*"|'[^'\n]*'|[^\s`|;&<>]+)((?:\s*\d?(?:>>?(?!>)|<)&?(?:\s*[^\s|;&<>]+)?){0,4}\s*(?:[|;&]+\s*)?)$/, '$1[REDIGIDO]$3') + s.slice(i);
  }],
  // CLIs de cofre: o valor do segredo vai na linha de comando.
  [todos(programa('gh'), /\bsecret[^\S\n]+set\b/), flag('(?:-b|--body=?)')],
  [todos(programa('az'), /\bkeyvault[^\S\n]+secret[^\S\n]+set\b/), flag('--value=?')],
  // file://x e fileb://x são o arquivo com o valor, não o valor.
  [todos(programa('aws'), /\b(?:secretsmanager|ssm)\b/), (s) => s.replace(/((?:^|\s)--(?:secret-string|value)=?)([^\S\n]*)(?![-=]|["']?fileb?:\/\/)("[^"\n]*"|'[^'\n]*'|[^\s`]+)/g, '$1$2[REDIGIDO]')],
  // --from-literal=K=v ou --from-literal K=v; com o par entre aspas ("K=v"), o valor vai até a aspa que
  // fecha (frase-senha com espaço) e ela fica.
  [todos(programa('kubectl|oc'), /\bcreate[^\S\n]+secret\b/), (s) => s.replace(/(--from-literal(?:=|[^\S\n]+)(["'])[^=\s"']+=)(?:(?!\2)[^\n])*(?=\2)/g, '$1[REDIGIDO]')
    .replace(/(--from-literal(?:=|[^\S\n]+)(["']?)[^=\s"']+=)("[^"\n]*"|'[^'\n]*'|[^\s`]+)/g,
      (m, p, q, v) => p + '[REDIGIDO]' + (q && v.length > 1 && v.endsWith(q) ? q : ''))],
  // vault kv put/patch e vault write: todo par k=v é valor do cofre (passcode=…, value=…), fora k=- (stdin)
  // e k=@arquivo. Em vault write, ttl=, common_name= etc. também saem: ruído aceito.
  [todos(programa('vault'), /\b(?:kv[^\S\n]+(?:put|patch)|write)\b/), (s) => s.replace(/(\s(?!-)[\w.-]+=)(?!-(?:\s|$)|@)("[^"\n]*"|'[^'\n]*'|[^\s`|;&<>]+)/g, '$1[REDIGIDO]')],
  // secret(s) set/add com o valor na linha (fly, supabase: K=v; doppler: NOME VALOR).
  [/\bsecrets?[^\S\n]+(?:set|add)\b/, (s) => s.replace(/\bsecrets?[^\S\n]+(?:set|add)\b[\s\S]*/, (m) => m.replace(/(\s(?!-)[\w.:-]+=)(?!-(?:\s|$))("[^"\n]*"|'[^'\n]*'|[^\s`|;&<>]+)/g, '$1[REDIGIDO]'))],
  // Opções (até 8, com valor opcional) também antes do set: doppler secrets -p proj set, dotnet
  // user-secrets -p x set. netlify env:set NOME VALOR igual.
  [todos(programa('doppler'), new RegExp(String.raw`\bsecrets${OPCOES}[^\S\n]+set\b`)), posicional],
  [todos(programa('dotnet'), new RegExp(String.raw`\buser-secrets${OPCOES}[^\S\n]+set\b`)), posicional],
  [todos(programa('netlify'), /\benv:set\b/), posicional],
  // npm/pnpm/yarn [config] set CHAVE VALOR, com nome de segredo ou _auth na chave (//registry/:_authToken,
  // npmAuthToken), que pode vir entre aspas; com = entre eles, a regra chave=valor já cuida.
  [todos(programa('npm|pnpm|yarn'), /\b(?:config[^\S\n]+)?set\b/), (s) => s.replace(/(\b(?:config[^\S\n]+)?set(?:[^\S\n]+-\S+){0,8}[^\S\n]+)("[^"\n]{1,300}"|'[^'\n]{1,300}'|[^\s"'`=|;&<>-][^\s"'`=|;&<>]{0,300})([^\S\n]+)(?![-|;&<>]|\d>)("[^"\n]*"|'[^'\n]*'|[^\s`|;&<>]+)/, (m, p, k, e, v, off, seg) => {
    const c = k.replace(/^(["'])(.*)\1$/, '$2');
    return (NOME_SEGREDO_RE.test(c) || /_auth$/i.test(c)) && redigeValor(c, v.replace(/^(["'])(.*)\1$/, '$2'), off + p.length, seg) ? p + k + e + '[REDIGIDO]' : m;
  })],
  // twine upload/register e poetry publish -p SENHA; poetry config pypi-token.<repo> TOKEN e
  // http-basic.<repo> USUARIO SENHA (até 8 opções antes: --local), também do composer (--global, --auth).
  [todos(programa('twine|poetry'), /\b(?:upload|register|publish)\b/), flag('-p', false)],
  // dotnet nuget add/update source … -p SENHA (-p separado; dotnet build -p:X=y fica).
  [todos(programa('dotnet|nuget'), /\b(?:add|update)[^\S\n]+source\b/), flag('-p', false)],
  [todos(programa('poetry|composer'), /\bconfig\b/), (s) => s.replace(/(\bconfig(?:[^\S\n]{1,20}-[^\s|;&<>]{1,100}){0,8}[^\S\n]{1,20}(?:pypi-token\.[\w.-]{1,100}|http-basic\.[\w.-]{1,100}[^\S\n]{1,20}(?![-|;&<>])[^\s|;&<>]{1,300})[^\S\n]{1,20})(?![-|;&<>]|\d>)("[^"\n]*"|'[^'\n]*'|[^\s\x60|;&<>]+)/g, '$1[REDIGIDO]')],
  // openssl passwd [-6|-1|-apr1|-salt x…] SENHA e mkpasswd [-m método|-S sal…] SENHA: o primeiro
  // argumento que não é opção nem valor dela (-in arq e -stdin leem de fora: não há posicional). O valor
  // da opção vem depois de espaço ou = (--salt=x), e pode vir entre aspas ou ser $(…) ou `…` com espaços
  // (-salt "$(openssl rand -hex 8)", -S `openssl rand -hex 8`).
  [todos(programa('openssl'), /\bpasswd\b/), (s) => s.replace(/(\bpasswd(?:[^\S\n]+-(?:salt|in)(?:=|[^\S\n]+)(?:"[^"\n]*"|'[^'\n]*'|\$\([^()\n]{0,200}\)|\x60[^\x60\n]{0,200}\x60|[^\s|;&<>]+)|[^\S\n]+-(?!(?:salt|in)(?:=|(?!\S)))\S+){0,8}[^\S\n]+)(?![-|;&<>]|\d>)("[^"\n]*"|'[^'\n]*'|[^\s`|;&<>]+)/, '$1[REDIGIDO]')],
  [programa('mkpasswd'), (s) => s.replace(/(\bmkpasswd(?:[^\S\n]+(?:-[mSRP]|--(?:method|salt|rounds|password-fd))(?:=|[^\S\n]+)(?:"[^"\n]*"|'[^'\n]*'|\$\([^()\n]{0,200}\)|\x60[^\x60\n]{0,200}\x60|[^\s|;&<>]+)|[^\S\n]+-(?![mSRP](?:=|(?!\S))|-(?:method|salt|rounds|password-fd)(?:=|(?!\S)))\S+){0,8}[^\S\n]+)(?![-|;&<>]|\d>)("[^"\n]*"|'[^'\n]*'|[^\s`|;&<>]+)/, '$1[REDIGIDO]')],
  // ssh-keygen -N nova / -P atual (passphrase da chave).
  [programa('ssh-keygen'), flag('-[NP]')],
  // mysqladmin … password NOVA: subcomando, palavra solta (não --password).
  [programa('mysqladmin'), (s) => s.replace(/(\s(?:old-)?password[^\S\n]+)(?![-|;&<>]|\d>)("[^"\n]*"|'[^'\n]*'|[^\s`|;&<>]+)/g, '$1[REDIGIDO]')],
  [todos(programa('security'), /-keychain(?:-password)?\b/), flag('-[po]', false)],
  [todos(programa('security'), /\bset-key-partition-list\b/), flag('-k', false)],
  [todos(programa('security'), /\bimport\b/), flag('-P', false)],
  [todos(programa('security'), /\badd-(?:generic|internet)-password\b/), flag('-w', false)],
  [todos(programa('vault'), /\blogin\b/), (s) => s.replace(/(\blogin(?:[^\S\n]+-\S+)*[^\S\n]+)(?!-)([^\s=`"']+|"[^"\n]*"|'[^'\n]*')(?=\s|$)/, '$1[REDIGIDO]')],
  [programa(String.raw`sqlcmd|bcp|osql|isql|mongo(?:sh|dump|restore|import|export)?`), flag('-[pP]')],
  [programa('redis-cli'), flag('-a')],
  [programa('psexec(?:64)?'), flag('-p', false)],
  [programa('7z[az]?'), (s) => s.replace(/((?:^|\s)-p)(?!-)("[^"\n]*"|'[^'\n]*'|[^\s`]+)/g, '$1[REDIGIDO]')],
  // rar/unrar: -pSENHA e -hpSENHA (cifra também os nomes); -p- é "não pergunte".
  [programa('unrar|rar'), (s) => s.replace(/((?:^|\s)-h?p)(?!-)("[^"\n]*"|'[^'\n]*'|[^\s`]+)/g, '$1[REDIGIDO]')],
  [programa('unzip|zip'), flag('-P', false)],
  [programa('openssl'), flag('-k', false)],
  [programa('schtasks'), flag('/[rR]?[pP]', false)],
  [programa('(?:x|wl|sdl-)freerdp'), (s) => s.replace(/(\/p:)("[^"\n]*"|\S+)/gi, '$1[REDIGIDO]')],
  [programa(String.raw`prowin(?:32)?|_progres|pro|mpro|bpro|mbpro|proutil|probkup|prorest|proserve|_mprosrv|_proapsv|prodb`), flag('-P', false)],
  [programa('sqlplus|expdp|impdp|sqlldr|rman|dgmgrl'), oracle],
  [/^\s*(?:["']?[^\s"']*[/\\])?(?:exp|imp)(?:\.exe)?["']?(?=\s|$)/i, oracle],
  [/^\s*conn(?:ect)?(?=\s)/i, oracle],
];
export function redigir(texto) {
  if (!texto) return texto;
  idxTexto = null;
  let t = String(texto);
  for (const r of SEGREDOS) t = typeof r === 'function' ? r(t) : t.replace(r[0], r[1]);
  return t;
}

// Corte que não parte um par substituto (emoji): fronteira no meio do par recua (fim) ou avança (início).
const ALTO = (c) => c >= 0xD800 && c <= 0xDBFF;
export function fatiar(s, ini, fim = s.length) {
  if (fim > 0 && fim < s.length && ALTO(s.charCodeAt(fim - 1))) fim--;
  if (ini > 0 && ini < s.length && ALTO(s.charCodeAt(ini - 1))) ini++;
  return s.slice(ini, fim);
}
export const encurtar = (s, n) => (s.length > n ? fatiar(s, 0, n - 1) + '…' : s);

// ---- Recorte com declaração -----------------------------------------------------------------
// Mantém início e fim; devolve a nota que declara o que foi cortado (verbatim com recorte declarado).
export function recortar(texto, maxLinhas, maxChars, linhaMax = 400) {
  const orig = String(texto ?? '').replace(/\r\n/g, '\n').replace(/\n+$/, '');
  if (!orig) return { texto: '', nota: '', total: 0 };
  let linhas = orig.split('\n');
  const total = linhas.length;
  let cortouLinha = false;
  linhas = linhas.map((l) => (l.length > linhaMax ? ((cortouLinha = true), fatiar(l, 0, linhaMax) + ' …[+' + (l.length - linhaMax) + ' car.]') : l));
  let nota = '';
  if (total > maxLinhas) {
    const ini = Math.ceil(maxLinhas / 2), fim = maxLinhas - ini;
    linhas = [...linhas.slice(0, ini), `… [${total - maxLinhas} linhas omitidas] …`, ...linhas.slice(total - fim)];
    nota = `recorte: linhas 1–${ini} e ${total - fim + 1}–${total} de ${total}`;
  }
  let out = linhas.join('\n');
  if (out.length > maxChars) {
    const meio = Math.floor(maxChars / 2);
    out = fatiar(out, 0, meio) + `\n… [${out.length - maxChars} caracteres omitidos] …\n` + fatiar(out, out.length - meio);
    nota = (nota ? nota + '; ' : 'recorte: ') + `limitado a ${maxChars} caracteres`;
  }
  if (cortouLinha) nota = (nota ? nota + '; ' : 'recorte: ') + `linhas longas cortadas em ${linhaMax} car.`;
  return { texto: out, nota, total };
}

// Cerca de código que não colide com crases do conteúdo.
export function cerca(conteudo, lang = '') {
  const maior = Math.max(2, ...(String(conteudo).match(/`+/g) || []).map((m) => m.length));
  const f = '`'.repeat(maior + 1);
  return `${f}${lang}\n${conteudo}\n${f}`;
}

export const citar = (texto) => String(texto).split('\n').map((l) => (l ? '> ' + l : '>')).join('\n');

// Código inline seguro (uma linha).
export function inline(t) {
  const s = String(t).replace(/\s*\n\s*/g, ' ⏎ ');
  const maior = Math.max(0, ...(s.match(/`+/g) || []).map((m) => m.length));
  const f = '`'.repeat(maior + 1);
  return maior ? `${f} ${s} ${f}` : `${f}${s}${f}`;
}

// ---- Comandos destrutivos -------------------------------------------------------------------
// Argumentos do mesmo comando (até | ; & ou quebra), limitados a 300 caracteres: sem limite, texto
// longo com o nome do comando e sem a opção custa tempo quadrático. Opção pode vir antes ou depois
// do operando (rm x -rf). GIT aceita opções globais antes do subcomando (git -C dir, -c k=v).
// git.exe, entre aspas ("C:\…\git.exe"), -C/-c com argumento entre aspas. Cada opção casa de um só
// jeito ('-' literal único; argumento sem aspas não começa por aspa): com '--?' ou '"a"' casando por
// dois ramos, o tempo era exponencial no número de opções. Até 8 opções e nunca dentro de um token
// (--git, x-git): sem isso, cada "git" percorria todas as opções seguintes (quadrático). Argumento de
// -c pode ter trecho entre aspas no meio (k="a b"); --git-dir, --work-tree, --namespace e --config-env
// levam o argumento separado ou com '='.
const ARG = '[^|;&\\n]{0,300}';
const GIT_COM_ARG = 'git-dir|work-tree|namespace|config-env';
const GIT = String.raw`(?<![\w-])git(?:\.exe)?["']?(?:\s+(?:-[Cc]\s+(?:"[^"\n]*"|'[^'\n]*'|[^\s"'])(?:[^\s"']|"[^"\n]*"|'[^'\n]*')*|--(?:${GIT_COM_ARG})\s+(?:"[^"\n]*"|'[^'\n]*'|[^\s"'-]\S*)|-(?![Cc]\s|-(?:${GIT_COM_ARG})\s)[\w-]+(?:=\S+)?)){0,8}\s+`;
// Operando de checkout: não é opção, separador, redirecionamento (2>, *>), fecha-bloco nem comentário.
const OPERANDO = String.raw`(?![-|;&<>})#]|\d>|\*>)[^\s|;&<>})#]`;
// Começo de comando: início, espaço, separador, abertura, crase, aspa (bash -c "rm …", cmd /c "rd …").
const INI = String.raw`(?:^|[\s;|&(\x60"'])`;
const re = (fonte, flags = '') => new RegExp(fonte, flags);
const DESTRUTIVOS = [
  // rm depois de começo de comando, de caminho (/bin/rm) ou de \ (\rm fura alias): o prefixo não varre
  // o token (com \S* varria a cada ;). Subcomando rm de git e de gerenciador de pacote não é o do
  // shell (pnpm rm -r lodash); git rm tem regra própria (--cached só tira do índice). rm de contêiner
  // (docker/podman/nerdctl [container|compose] rm -f) e cargo rm não apagam dados; docker rm -v tem regra
  // própria (volumes anônimos).
  re(String.raw`(?:${INI}|[/\\])(?<!(?<![\w-])(?:git(?:\.exe)?["']?(?:\s+-\S+){0,8}|npm|pnpm|yarn|bun|cargo|(?:docker|podman|nerdctl)(?:\s+(?:container|compose))?)\s+)rm(?=\s)${ARG}\s(?:-[a-zA-Z]*[rRf]|--(?:recursive|force)\b)`),
  re(String.raw`${GIT}rm(?=\s)(?!${ARG}\s--cached\b)${ARG}\s(?:-[a-zA-Z]*[rf]\b|--force\b)`),
  // Remove-Item e aliases (ri, del, erase, rd, rmdir) com -Recurse ou prefixo dele (-r, -rec); do cmd,
  // rd/rmdir /s e del/erase /s ou /q, em qualquer posição e agrupadas (/f/s/q).
  re(String.raw`${INI}(?:Remove-Item|ri|del|erase|rd|rmdir)(?=\s)${ARG}\s-r\w*\b`, 'i'),
  re(String.raw`${INI}(?:rd|rmdir)(?=\s)${ARG}\s\/(?:[a-z]\/)*s\b`, 'i'), re(String.raw`${INI}(?:del|erase)(?=\s)${ARG}\s\/(?:[a-z]\/)*[sq]\b`, 'i'),
  re(String.raw`\bfind(?=\s)${ARG}\s-(?:delete\b|exec(?:dir)?\s+(?:\S*\/)?rm\b)`), /\bxargs\s+(?:-\S+\s+)*(?:\S*\/)?rm\b/,
  re(String.raw`${GIT}reset(?=\s)${ARG}\s--hard\b`),
  // push que força ou apaga ref: --force*, -f, --delete, -d, +ref, :ref, --mirror, --prune.
  re(String.raw`${GIT}push(?=\s)${ARG}\s(?:--force(?:-with-lease|-if-includes)?\b|--delete\b|--mirror\b|--prune\b|-[a-zA-Z]*[fd]\b|[+:][\w./-])`),
  re(String.raw`${GIT}clean(?=\s)${ARG}\s(?:-[a-zA-Z]*f|--force\b)`),
  // checkout -- f, checkout ., e checkout <árvore> <caminho> (dois operandos na mesma linha; antes
  // deles, só -q/--quiet/--[no-]progress).
  re(String.raw`${GIT}checkout(?=\s)${ARG}\s(?:--(?=\s|$)|\.(?=\s|$))`), re(String.raw`${GIT}restore\b`),
  re(String.raw`${GIT}checkout(?:[^\S\r\n]+(?:-q|--quiet|--(?:no-)?progress)(?=\s))*[^\S\r\n]+${OPERANDO}+[^\S\r\n]+${OPERANDO}`),
  // branch -D, ou apagar (-d/--delete) e forçar (-f/--force) em qualquer ordem.
  re(String.raw`${GIT}branch(?=\s)(?:${ARG}\s-[a-zA-Z]*D\b|(?=${ARG}\s(?:--delete\b|-[a-zA-Z]*d))(?=${ARG}\s(?:--force\b|-[a-zA-Z]*f)))`),
  re(String.raw`${GIT}stash\s+(?:drop|clear)\b`),
  re(String.raw`${GIT}(?:checkout|switch)(?=\s)${ARG}\s(?:-[a-zA-Z]*f\b|--force\b|--discard-changes\b)`),
  // SQL: tabela com esquema e nome entre aspas, colchetes ou crases; TRUNCATE sem TABLE (Postgres) só
  // com lista de tabelas seguida de fim, ; ou CASCADE/RESTART/CONTINUE (truncate -s 0 arq fica). Fim
  // também é a aspa que fecha o SQL passado a um CLI (psql -c 'DELETE FROM users'). Nome delimitado até
  // 128 caracteres: sem limite, cada '[' sem ']' percorre o resto da linha (quadrático). ALTER TABLE t
  // DROP x (COLUMN é opcional no Postgres e no MySQL); DROP de restrição, índice ou default fica.
  /\bdrop\s+(?:table|database|schema|column)\b/i, /\btruncate\s+table\b/i,
  /\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?\S+\s+drop\s+(?!(?:constraint|index|key|primary|foreign|default|not|check|unique)\b)[\w"`[]/i,
  /\btruncate\s+(?:only\s+)?[\w."[\]`]+(?:\s*,\s*[\w."[\]`]+)*\s*(?:;|$|["'](?=\s|$|[|;&)])|\s(?:cascade|restart|continue)\b)/im,
  /\bdelete\s+from\s+(?:[\w$]+|"[^"\n]{1,128}"|\[[^\]\n]{1,128}\]|`[^`\n]{1,128}`)(?:\.(?:[\w$]+|"[^"\n]{1,128}"|\[[^\]\n]{1,128}\]|`[^`\n]{1,128}`)){0,2}\s*(?:;|$|["'](?=\s|$|[|;&)]))/im,
  // DELETE tabela sem FROM (T-SQL, Oracle): em maiúsculas, ou minúsculo terminado em ; ("delete it" no
  // fim de uma frase fica); --delete e .delete não.
  /(?<![\w.-])DELETE\s+(?!FROM\b)(?:[\w$]+|"[^"\n]{1,128}"|\[[^\]\n]{1,128}\]|`[^`\n]{1,128}`)(?:\.(?:[\w$]+|"[^"\n]{1,128}"|\[[^\]\n]{1,128}\]|`[^`\n]{1,128}`)){0,2}\s*(?:;|$|["'](?=\s|$|[|;&)]))/m,
  /(?<![\w.-])delete\s+(?!from\b)(?:[\w$]+|"[^"\n]{1,128}"|\[[^\]\n]{1,128}\]|`[^`\n]{1,128}`)(?:\.(?:[\w$]+|"[^"\n]{1,128}"|\[[^\]\n]{1,128}\]|`[^`\n]{1,128}`)){0,2}\s*;/i,
  // Minúsculo sem ; também como SQL inteiro passado a um CLI (sqlcmd -Q "delete dbo.Users", mysql -e,
  // psql -c, --command/--execute/--query): logo depois da aspa que abre, até a que fecha. git commit -m
  // "delete users" fica; node -e "delete obj.x" vira destrutivo (ruído aceito).
  /(?:\s-[Qqce]|\s--(?:command|execute|query))(?:=|[^\S\n]*)["']delete\s+(?!from\b)(?:[\w$]+|"[^"\n]{1,128}"|\[[^\]\n]{1,128}\]|`[^`\n]{1,128}`)(?:\.(?:[\w$]+|"[^"\n]{1,128}"|\[[^\]\n]{1,128}\]|`[^`\n]{1,128}`)){0,2}\s*(?:;|["'](?=\s|$|[|;&)]))/,
  // MongoDB: db.dropDatabase(), db.getSiblingDB('x').dropDatabase(), db.col.drop(), db.a.b.drop(),
  // db["c"].drop(), db.getCollection('c').drop(), com ou sem getSiblingDB; deleteMany({}) e remove({})
  // sem filtro. Argumentos limitados a 200 caracteres: sem limite, "getCollection(" repetido é quadrático.
  /\.dropDatabase\s*\(|\bdb(?:\.getSiblingDB\([^)\n]{0,200}\))?(?:\.getCollection\([^)\n]{0,200}\)|\[[^\]\n]{1,128}\]|(?:\.\w+){1,4})\.drop\s*\(/,
  /\.(?:deleteMany|remove)\s*\(\s*\{\s*\}\s*[,)]/,
  // Forma de comando: db.runCommand({ drop: "c" }), db.adminCommand({ dropDatabase: 1 }).
  /\b(?:runCommand|adminCommand)\s*\(\s*\{\s*["']?drop(?:Database)?["']?\s*:/,
  /\bdropdb\b/, /\bFLUSH(?:ALL|DB)\b/i,
  // dd com if= ou of= em qualquer posição (dd bs=4M of=/dev/sdb if=…).
  // Infraestrutura: terraform destroy (e apply -destroy), kubectl … delete, docker volume rm/prune,
  // system prune --volumes, compose down -v, rm -v; migração que apaga o banco (prisma migrate reset e db
  // push --force-reset|--accept-data-loss, flush|reset_db do Django por manage.py, django-admin ou
  // python -m django, rails/rake
  // db:drop|reset|schema:load|migrate:reset, artisan migrate:fresh|reset|refresh e db:wipe).
  re(String.raw`\bterraform(?:\.exe)?(?:\s{1,20}-chdir=\S{1,300})?\s{1,20}(?:destroy\b|apply\b${ARG}\s-destroy\b)`),
  // kubectl delete só do que leva dados ou tudo junto: namespace, PV/PVC, CRD (primeiro argumento depois
  // das opções, também em lista a,b ou tipo/nome) ou --all/--all-namespaces/-A. kubectl delete pod x fica
  // (o controlador recria). kubectl auth can-i delete … só pergunta pela permissão: fica.
  re(String.raw`\bkubectl(?:\.exe)?\s(?!(?:${ARG}\s)?auth\s{1,20}can-i\b)(?:${ARG}\s)?delete(?:\s{1,20}-[^\s|;&]{1,100}(?:\s{1,20}(?!-)[^\s|;&]{1,100})?){0,8}\s{1,20}(?:[\w.-]{1,60},){0,5}(?:namespaces?|ns|persistentvolumeclaims?|persistentvolumes?|pvc|pv|customresourcedefinitions?|crds?)(?=[\s,/.]|$)`),
  // delete como lookahead (uma varredura por kubectl): dois ARG aninhados custavam 360 ms em 200 mil car.
  re(String.raw`\bkubectl(?:\.exe)?\s(?!(?:${ARG}\s)?auth\s{1,20}can-i\b)(?=(?:${ARG}\s)?delete\s)${ARG}\s(?:--all(?:-namespaces)?|-A)(?![\w-])`),
  re(String.raw`\bdocker(?:\.exe)?\s{1,20}(?:volume\s{1,20}(?:rm|prune)\b|system\s{1,20}prune\b${ARG}\s--volumes\b|compose\s${ARG}\bdown\b${ARG}\s(?:-v\b|--volumes\b))|\bdocker-compose\s${ARG}\bdown\b${ARG}\s(?:-v\b|--volumes\b)`),
  re(String.raw`\b(?:docker|podman|nerdctl)(?:\.exe)?\s{1,20}(?:(?:container|compose)\s{1,20})?rm\b${ARG}\s(?:-[a-zA-Z]*v|--volumes\b)`),
  // Nuvem: grupo de recursos, conta de armazenamento, banco e servidor SQL, Cosmos DB (az), bucket com o
  // conteúdo (aws s3 rb --force), projeto (gcloud).
  re(String.raw`\baz(?:\.cmd)?\s{1,20}(?:group|storage\s{1,20}account|sql\s{1,20}(?:db|server)|cosmosdb)\s{1,20}delete\b|\baws\s{1,20}s3\s{1,20}rb\b${ARG}\s--force\b|\bgcloud\s{1,20}projects\s{1,20}delete\b`),
  re(String.raw`\bprisma\s{1,20}(?:migrate\s{1,20}reset\b|db\s{1,20}push\b${ARG}\s--(?:force-reset|accept-data-loss)\b)|(?:\bmanage\.py["']?|\bdjango-admin(?:\.exe)?|(?<!\S)-m\s{1,20}django)\s{1,20}(?:flush|reset_db)\b|\b(?:rails|rake)\s{1,20}db:(?:drop|reset|schema:load|migrate:reset)\b|\bartisan\s{1,20}(?:migrate:(?:fresh|reset|refresh)|db:wipe)\b`),
  /\bformat\s+[a-z]:/i, /\bmkfs\b/, re(String.raw`\bdd(?=\s)${ARG}\s(?:if|of)=`), /\bClear-Content\b/i, re(String.raw`\bStop-Process(?=\s)${ARG}\s-Force\b`, 'i'),
];
export const destrutivo = (cmd) => DESTRUTIVOS.some((re) => re.test(String(cmd || '')));
