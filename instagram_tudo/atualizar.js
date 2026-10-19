// Baixa a versão mais nova dos scripts do GitHub antes de rodar.
// Só atualiza os arquivos do programa; cookies, fotos, bio.txt, contas.txt etc. nunca são tocados.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE = 'https://raw.githubusercontent.com/jxca7/projetos/claude/great-fermat-rymemy/instagram_tudo/';
const ARQUIVOS = ['comum.js', 'perfil.js', 'conectar.js', 'testar.js', 'tudo.js', 'menu.js', 'preparar.js', 'atualizar.js', 'package.json', 'LEIA-ME.md',
  'story/postar_story.py', 'story/requirements.txt', 'story/rodar_story.bat'];

async function main() {
  const mudou = [];

  for (const nome of ARQUIVOS) {
    const resp = await fetch(BASE + nome, { cache: 'no-store' });
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

  console.log(mudou.length ? `Atualizado: ${mudou.join(', ')}` : 'Já está na versão mais nova.');
}

main().catch((err) => {
  console.log(`Não consegui verificar atualização (${err.message}). Usando a versão atual.`);
});
