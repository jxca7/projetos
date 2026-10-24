// Abre o site no Edge, espera você navegar até a tela que quiser (ex.: clicar no lápis da pasta),
// e salva o HTML + um print de cada aba aberta na pasta captura/. Serve para eu calibrar os cliques.

const readline = require('readline');
const { fs, path, puppeteer, PASTA, acharEdge, lerProxy, lerTexto } = require('./comum');

async function abrir(proxy) {
  const args = ['--no-first-run', '--no-default-browser-check', '--start-maximized', '--lang=pt-BR', '--accept-lang=pt-BR,pt'];
  if (proxy) args.push(`--proxy-server=${proxy.servidor}`);
  return puppeteer.launch({
    executablePath: acharEdge(),
    headless: false,
    defaultViewport: null,
    userDataDir: path.join(PASTA, 'navegador_site'),
    args,
  });
}

function esperarEnter() {
  return new Promise((r) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('', () => {
      rl.close();
      r();
    });
  });
}

async function rodar() {
  const site = lerTexto(path.join(PASTA, 'site.txt'));
  if (!site || !/^https?:\/\//.test(site)) throw new Error('Coloque o link do site no site.txt (começando com https://)');

  const proxy = lerProxy();
  if (proxy) console.log(`Usando proxy ${proxy.servidor}`);

  const browser = await abrir(proxy);
  const page = (await browser.pages())[0] || (await browser.newPage());
  if (proxy?.usuario) await page.authenticate({ username: proxy.usuario, password: proxy.senha || '' });
  await page.goto(site, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

  console.log('\n======================================================================');
  console.log(' Navegue no Edge até a tela que você quer que eu veja.');
  console.log(' Ex.: faça login, clique no LÁPIS da pasta (a tela de marcar as contas).');
  console.log(' Quando a tela estiver ABERTA, volte AQUI e tecle ENTER.');
  console.log('======================================================================\n');
  await esperarEnter();

  const dir = path.join(PASTA, 'captura');
  fs.mkdirSync(dir, { recursive: true });
  const pages = await browser.pages();
  let i = 0;
  for (const p of pages) {
    try {
      const u = p.url();
      if (!u || u === 'about:blank') continue;
      i++;
      fs.writeFileSync(path.join(dir, `aba${i}.html`), await p.content());
      await p.screenshot({ path: path.join(dir, `aba${i}.png`), fullPage: true }).catch(() => {});
      console.log(`Salvei aba${i}  (${u})`);
    } catch {}
  }
  console.log(`\nPronto! Me mande os arquivos da pasta:\n  ${dir}`);
  await browser.close().catch(() => {});
}

module.exports = { rodar };
