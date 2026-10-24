// Baixa a versão mais nova dos scripts do GitHub antes de rodar.
// Só atualiza os arquivos do programa; cookies, fotos, bio.txt, contas.txt etc. nunca são tocados.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO = 'jxca7/projetos';
const RAMO = 'claude/great-fermat-rymemy';
const BASE = `https://raw.githubusercontent.com/${REPO}/${RAMO}/instagram_tudo/`;

// O endereço pelo nome do ramo fica 5 min em cache no GitHub (e ele ignora ?t=...).
// Por isso pergunto qual é o commit mais novo e baixo por ele: esse endereço nunca fica velho.
async function baseAtual() {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/commits/${RAMO}`, {
      headers: { Accept: 'application/vnd.github.sha', 'User-Agent': 'instagram-tudo-atualizar' },
      cache: 'no-store',
    });
    const sha = r.ok ? (await r.text()).trim() : '';
    if (/^[0-9a-f]{40}$/.test(sha)) return `https://raw.githubusercontent.com/${REPO}/${sha}/instagram_tudo/`;
  } catch {}
  return BASE;
}
const ARQUIVOS = ['comum.js', 'perfil.js', 'conectar.js', 'testar.js', 'tudo.js', 'menu.js', 'preparar.js', 'capturar_site.js', 'atualizar.js', 'package.json', 'LEIA-ME.md',
  'story/postar_story.py', 'story/requirements.txt', 'story/rodar_story.bat',
  // menu.bat antes do rodar.bat: o rodar.bat chama o menu.bat logo depois desta atualização
  'menu.bat', 'rodar.bat'];

async function main() {
  const mudou = [];
  const base = await baseAtual();

  for (const nome of ARQUIVOS) {
    const resp = await fetch(base + nome, { cache: 'no-store' });
    if (!resp.ok) {
      console.log(`Não consegui baixar ${nome} (HTTP ${resp.status}).`);
      continue;
    }
    const novo = await resp.text();

    const local = path.join(__dirname, nome);
    fs.mkdirSync(path.dirname(local), { recursive: true });
    const atual = fs.existsSync(local) ? fs.readFileSync(local, 'utf8') : null;
    if (novo === atual) continue;

    if (nome.endsWith('.js')) {
      const tmp = local.replace(/\.js$/, '.novo.js');
      fs.writeFileSync(tmp, novo);
      try {
        execSync(`node --check "${tmp}"`, { stdio: 'ignore' });
      } catch {
        fs.unlinkSync(tmp);
        console.log(`Atualização de ${nome} ignorada (arquivo baixado com erro).`);
        continue;
      }
      fs.renameSync(tmp, local);
    } else {
      fs.writeFileSync(local, novo);
    }
    mudou.push(nome);
  }

  if (mudou.includes('package.json')) {
    console.log('Instalando dependências novas...');
    execSync('npm install --no-audit --no-fund', { cwd: __dirname, stdio: 'inherit' });
  }

  // Se o próprio atualizador mudou, roda a versão nova uma vez (ela pode ter arquivos novos na lista)
  if (mudou.includes('atualizar.js') && !process.env.JA_REATUALIZOU) {
    console.log(`Atualizado: ${mudou.join(', ')}`);
    execSync(`node "${__filename}"`, { stdio: 'inherit', env: { ...process.env, JA_REATUALIZOU: '1' } });
    return;
  }

  console.log(mudou.length ? `Atualizado: ${mudou.join(', ')}` : 'Já está na versão mais nova.');
}

main().catch((err) => {
  console.log(`Não consegui verificar atualização (${err.message}). Usando a versão atual.`);
});
