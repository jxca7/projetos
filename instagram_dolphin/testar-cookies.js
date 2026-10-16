// Testa cada cookie da pasta cookies/ SEM alterar nada: abre o Instagram com o proxy
// e diz se a conta logou. É rápido (janela escondida) e serve para separar cookie morto
// de problema de IP. Nada é movido nem salvo nas contas.

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PASTA = __dirname;
const PASTA_COOKIES = path.join(PASTA, 'cookies');
const URL_EDITAR = 'https://www.instagram.com/accounts/edit/';
const ESCONDER = process.argv.includes('--ver') ? false : true; // por padrão janela escondida

function lerTexto(arquivo) {
  return fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, '').trim() : null;
}

// ---- cookies (JSON / cookies.txt / texto sessionid=...) ----
function lerListaCookies(arquivo) {
  const texto = fs.readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!texto) throw new Error('arquivo vazio');
  if (texto.startsWith('[') || texto.startsWith('{')) {
    let bruto;
    try {
      bruto = JSON.parse(texto);
    } catch {
      throw new Error('JSON incompleto/quebrado');
    }
    const lista = Array.isArray(bruto) ? bruto : bruto.cookies;
    if (!Array.isArray(lista)) throw new Error('formato não reconhecido');
    return lista;
  }
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  if (linhas.some((l) => l.split('\t').length >= 7)) {
    return linhas
      .map((l) => l.split('\t'))
      .filter((p) => p.length >= 7)
      .map(([domain, , cpath, secure, expira, name, value]) => ({
        domain, path: cpath, secure: secure.toUpperCase() === 'TRUE', expirationDate: Number(expira), name, value,
      }));
  }
  return texto
    .split(/;\s*|\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p.includes('='))
    .map((p) => {
      const i = p.indexOf('=');
      return { name: p.slice(0, i).trim(), value: p.slice(i + 1).trim(), domain: '.instagram.com' };
    });
}

function lerCookies(arquivo) {
  const lista = lerListaCookies(arquivo);
  const mapaSameSite = { no_restriction: 'None', none: 'None', lax: 'Lax', strict: 'Strict' };
  const cookies = lista
    .filter((c) => c.name && c.value !== undefined)
    .map((c) => {
      const cookie = {
        name: c.name,
        value: String(c.value),
        domain: c.domain || '.instagram.com',
        path: c.path || '/',
        httpOnly: !!c.httpOnly,
        secure: c.secure !== false,
      };
      const expira = c.expirationDate ?? c.expires;
      if (expira && expira > 0 && !c.session) cookie.expires = Math.floor(expira);
      const ss = mapaSameSite[String(c.sameSite || '').toLowerCase()];
      if (ss) cookie.sameSite = ss;
      return cookie;
    });
  if (!cookies.some((c) => c.name === 'sessionid')) throw new Error('sem sessionid');
  return cookies;
}

// ---- Edge e proxy ----
function acharEdge() {
  const cand = [
    process.env.NAVEGADOR,
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft\\Edge\\Application\\msedge.exe'),
  ].filter(Boolean);
  const achado = cand.find((c) => fs.existsSync(c));
  if (!achado) throw new Error('Não achei o Microsoft Edge instalado');
  return achado;
}

function lerProxy() {
  const linha = lerTexto(path.join(PASTA, 'proxy.txt'));
  if (!linha) return null;
  if (/^\w+:\/\//.test(linha)) {
    const url = new URL(linha);
    return { servidor: `${url.protocol}//${url.host}`, usuario: decodeURIComponent(url.username) || null, senha: decodeURIComponent(url.password) || null };
  }
  const [host, porta, usuario, senha] = linha.split(':');
  return { servidor: `${host}:${porta}`, usuario: usuario || null, senha: senha || null };
}

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
    // Confirma que a página de edição carregou (tem o campo da bio)
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

async function main() {
  const arquivos = fs
    .readdirSync(PASTA_COOKIES)
    .filter((f) => /\.(json|txt)$/i.test(f) && fs.statSync(path.join(PASTA_COOKIES, f)).isFile());
  if (!arquivos.length) {
    console.log('Nenhum cookie na pasta cookies/.');
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
        const cookies = lerCookies(path.join(PASTA_COOKIES, arquivo));
        const faltando = ['ds_user_id', 'csrftoken'].filter((n) => !cookies.some((c) => c.name === n));
        const r = await testarUm(browser, proxy, cookies);
        if (r.ok) {
          console.log(`✔ ${nome}${r.usuario ? ` (@${r.usuario})` : ''} — LOGOU`);
          bons.push(nome);
        } else {
          const extra = faltando.length ? ` [faltam: ${faltando.join(', ')}]` : '';
          console.log(`✘ ${nome} — ${r.motivo}${extra}`);
          ruins.push(`${nome}: ${r.motivo}${extra}`);
        }
      } catch (err) {
        console.log(`✘ ${nome} — ${err.message}`);
        ruins.push(`${nome}: ${err.message}`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  console.log(`\n===== RESULTADO =====`);
  console.log(`Logaram: ${bons.length}   |   Falharam: ${ruins.length}`);
  const relatorio = [`Logaram (${bons.length}): ${bons.join(', ')}`, '', `Falharam (${ruins.length}):`, ...ruins.map((r) => '  ' + r)].join('\n');
  fs.writeFileSync(path.join(PASTA, 'resultado_cookies.txt'), relatorio);
  console.log('Detalhes salvos em resultado_cookies.txt');
}

main().catch((err) => {
  console.error('\nERRO:', err.message);
  process.exitCode = 1;
});
