// Cria as pastas e os arquivos-modelo que você precisa preencher, para não ter que criar na mão.
// Roda sozinho toda vez (pelo menu). Nunca apaga nem sobrescreve nada que já exista.

const fs = require('fs');
const path = require('path');

const PASTA = __dirname;

// pastas que o programa usa
const PASTAS = ['cookies', 'bios', 'fotos', 'testar', 'story/cookies'];

// arquivos-modelo: nome -> conteúdo inicial (só criado se ainda não existir).
// ATENÇÃO: bio.txt e site.txt ficam VAZIOS de propósito (o conteúdo deles é usado de verdade;
// não dá para botar instrução dentro). As instruções ficam no COMECE-AQUI.txt.
const ARQUIVOS = {
  'bio.txt': '',
  'site.txt': '',
  'pasta.txt': '',
  'app_url.txt': '',
  'testadores.txt':
    '# Um @usuario do Instagram por linha para adicionar como Testador do Instagram\r\n' +
    '# exemplo:\r\n' +
    '# fulano\r\n',
  'site_login.txt': 'seu@email.com:suasenha\r\n',
  'contas.txt':
    '# Senha de cada conta do Instagram: uma por linha, no formato  usuario:senha\r\n' +
    '# (a tela de "Conectar Instagram" pede a senha mesmo usando cookie, entao coloque aqui)\r\n' +
    '# exemplo:\r\n' +
    '# fulano:minhasenha123\r\n',
  'COMECE-AQUI.txt':
    'COMO USAR (resumo) — veja o LEIA-ME.md para os detalhes\r\n' +
    '\r\n' +
    '1) Coloque os arquivos de cookies na pasta  cookies\\\r\n' +
    '2) Escreva a bio no arquivo  bio.txt\r\n' +
    '3) Coloque a foto de perfil como  foto.jpg  (nesta pasta)\r\n' +
    '4) Para conectar no site: escreva o link em  site.txt  e o login do site em  site_login.txt\r\n' +
    '   A tela "Conectar Instagram" pede a senha da conta (mesmo com cookie): coloque  usuario:senha  no contas.txt\r\n' +
    '5) (Opcional) proxy: crie um arquivo  proxy.txt  com  host:porta  ou  host:porta:usuario:senha\r\n' +
    '   Use proxy do MESMO pais/IP de onde voce pegou os cookies.\r\n' +
    '6) Rode o rodar.bat e escolha a opcao no menu.\r\n' +
    '\r\n' +
    'Pastas:\r\n' +
    '  cookies\\   -> os cookies das contas (um arquivo por conta; nome qualquer)\r\n' +
    '  bios\\      -> bio diferente por conta (ex.: maria.txt para o cookie maria.json)\r\n' +
    '  fotos\\     -> foto diferente por conta (ex.: maria.jpg)\r\n' +
    '  testar\\    -> cookies so para TESTAR, sem alterar nada\r\n',
};

function preparar() {
  const criados = [];

  for (const nome of PASTAS) {
    const dir = path.join(PASTA, nome);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      criados.push(nome + '\\');
    }
  }

  for (const [nome, conteudo] of Object.entries(ARQUIVOS)) {
    const arq = path.join(PASTA, nome);
    if (!fs.existsSync(arq)) {
      fs.writeFileSync(arq, conteudo);
      criados.push(nome);
    }
  }

  if (criados.length) {
    console.log(`Preparei: ${criados.join(', ')}`);
    console.log('Leia o COMECE-AQUI.txt e preencha o que faltar antes de escolher no menu.\n');
  }
}

module.exports = { preparar };

// Se rodar direto (node preparar.js), executa
if (require.main === module) preparar();
