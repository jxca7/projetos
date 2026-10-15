// Baixa a versão mais nova do script do GitHub antes de rodar.
// Só atualiza os arquivos do programa; token.txt, perfil.txt, bio.txt, cookies e fotos nunca são tocados.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE = 'https://raw.githubusercontent.com/jxca7/projetos/claude/great-fermat-rymemy/instagram_conectar/';
const ARQUIVOS = ['conectar.js', 'atualizar.js', 'package.json', 'LEIA-ME.md'];

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
    const atual = fs.existsSync(local) ? fs.readFileSync(local, 'utf8') : null;
    if (novo === atual) continue;

    // Não troca um .js por uma versão quebrada
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
  // Sem internet ou GitHub fora do ar: segue com a versão que já tem
  console.log(`Não consegui verificar atualização (${err.message}). Usando a versão atual.`);
});
