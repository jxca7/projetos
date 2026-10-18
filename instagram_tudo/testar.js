// Tarefa "testar": testa cada cookie da pasta testar/ SEM alterar nada. Abre o Instagram com o
// proxy e diz se a conta logou. Os que logaram vão para cookies_ok/ (é só copiar para cookies/),
// os que falharam vão para testar/falharam/. Serve para separar cookie morto de problema de IP.

const {
  fs, path, puppeteer, PASTA,
  lerCookies, cookiesFaltando, acharEdge, lerProxy,
} = require('./comum');

const PASTA_ENTRADA = path.join(PASTA, 'testar');
const PASTA_OK = path.join(PASTA, 'cookies_ok');
const PASTA_FALHOU = path.join(PASTA_ENTRADA, 'falharam');
const URL_EDITAR = 'https://www.instagram.com/accounts/edit/';
const ESCONDER = !process.argv.includes('--ver'); // por padrão janela escondida

async function testarUm(browser, proxy, cookies) {
  const ctx = await browser.createBrowserContext();
  try {
    const page = await ctx.newPage();
    if (proxy?.usuario) await page.authenticate({ username: proxy.usuario, password: proxy.senha || '' });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
    await page.setCookie(...cookies);
    await page.goto(URL_EDITAR, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 1500));
    const url = page.url();
    if (/\/accounts\/login/.test(url)) return { ok: false, motivo: 'caiu no login (cookie morto ou IP)' };
    if (/\/challenge/.test(url)) return { ok: false, motivo: 'checkpoint (verificação)' };
    if (/\/suspended/.test(url)) return { ok: false, motivo: 'conta suspensa' };
    const temBio = await page.$('textarea#pepBio, textarea[name="biography"], textarea');
    const usuario = await page
      .evaluate(() => {
        const m = document.body.innerHTML.match(/"username":"([^"]{1,40})"/);
        return m ? m[1] : null;
      })
      .catch(() => null);
    if (!temBio) return { ok: false, motivo: 'logou mas não abriu a edição de perfil' };
    return { ok: true, usuario };
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function rodar() {
  fs.mkdirSync(PASTA_ENTRADA, { recursive: true });
  const arquivos = fs
    .readdirSync(PASTA_ENTRADA)
    .filter((f) => /\.(json|txt)$/i.test(f) && fs.statSync(path.join(PASTA_ENTRADA, f)).isFile());
  if (!arquivos.length) {
    console.log('Coloque os cookies para testar na pasta testar/ e rode de novo.');
    return;
  }

  const proxy = lerProxy();
  console.log(proxy ? `Usando proxy ${proxy.servidor}` : 'SEM proxy (recomendo configurar o proxy.txt).');
  console.log(`Testando ${arquivos.length} cookie(s)...\n`);

  const browser = await puppeteer.launch({
    executablePath: acharEdge(),
    headless: ESCONDER ? 'new' : false,
    args: ['--no-first-run', '--no-default-browser-check', '--lang=pt-BR', ...(proxy ? [`--proxy-server=${proxy.servidor}`] : [])],
  });

  const bons = [];
  const ruins = [];
  try {
    for (const arquivo of arquivos) {
      const nome = path.parse(arquivo).name;
      try {
        const cookies = lerCookies(path.join(PASTA_ENTRADA, arquivo));
        const faltando = cookiesFaltando(cookies);
        const r = await testarUm(browser, proxy, cookies);
        if (r.ok) {
          console.log(`✔ ${nome}${r.usuario ? ` (@${r.usuario})` : ''} — LOGOU`);
          bons.push(nome);
          fs.mkdirSync(PASTA_OK, { recursive: true });
          fs.renameSync(path.join(PASTA_ENTRADA, arquivo), path.join(PASTA_OK, arquivo));
        } else {
          const extra = faltando.length ? ` [faltam: ${faltando.join(', ')}]` : '';
          console.log(`✘ ${nome} — ${r.motivo}${extra}`);
          ruins.push(`${nome}: ${r.motivo}${extra}`);
          fs.mkdirSync(PASTA_FALHOU, { recursive: true });
          fs.renameSync(path.join(PASTA_ENTRADA, arquivo), path.join(PASTA_FALHOU, arquivo));
        }
      } catch (err) {
        console.log(`✘ ${nome} — ${err.message}`);
        ruins.push(`${nome}: ${err.message}`);
        try {
          fs.mkdirSync(PASTA_FALHOU, { recursive: true });
          fs.renameSync(path.join(PASTA_ENTRADA, arquivo), path.join(PASTA_FALHOU, arquivo));
        } catch {}
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  console.log(`\n===== RESULTADO (testar) =====`);
  console.log(`Logaram: ${bons.length} (em cookies_ok/)   |   Falharam: ${ruins.length} (em testar/falharam/)`);
  const relatorio = [`Logaram (${bons.length}): ${bons.join(', ')}`, '', `Falharam (${ruins.length}):`, ...ruins.map((r) => '  ' + r)].join('\n');
  fs.writeFileSync(path.join(PASTA, 'resultado_cookies.txt'), relatorio);
  console.log('Detalhes salvos em resultado_cookies.txt');
}

module.exports = { rodar };
