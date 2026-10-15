// Seta os cookies do Instagram em perfis do Dolphin Anty, depois troca a bio
// e a foto de perfil de cada conta listada em config.json.
//
// Uso:
//   node instagram-setup.js            -> roda todas as contas
//   node instagram-setup.js conta2     -> roda só a conta com esse "nome"

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PASTA = __dirname;
const URL_EDITAR = 'https://www.instagram.com/accounts/edit/';

// Textos dos botões em português e inglês (o Instagram muda conforme o idioma da conta)
const TXT_ENVIAR = ['Enviar', 'Submit', 'Salvar', 'Save'];
const TXT_ALTERAR_FOTO = ['Alterar foto', 'Change photo', 'Alterar foto do perfil', 'Change profile photo'];
const TXT_CARREGAR_FOTO = ['Carregar foto', 'Upload photo', 'Upload Photo'];

// ---------- utilidades ----------

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const pausaHumana = (min = 800, max = 2000) => esperar(min + Math.random() * (max - min));

function log(conta, msg) {
  const hora = new Date().toLocaleTimeString('pt-BR');
  console.log(`[${hora}] [${conta}] ${msg}`);
}

function carregarConfig() {
  const arq = path.join(PASTA, 'config.json');
  if (!fs.existsSync(arq)) {
    console.error('config.json não encontrado. Copie config.exemplo.json para config.json e preencha.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(arq, 'utf8'));
}

// Converte o JSON exportado (Cookie-Editor / EditThisCookie / Dolphin) para o formato do Puppeteer
function lerCookies(arquivo) {
  const bruto = JSON.parse(fs.readFileSync(path.resolve(PASTA, arquivo), 'utf8'));
  const lista = Array.isArray(bruto) ? bruto : bruto.cookies;
  if (!Array.isArray(lista)) throw new Error(`Formato de cookies não reconhecido em ${arquivo}`);

  const mapaSameSite = { no_restriction: 'None', none: 'None', lax: 'Lax', strict: 'Strict' };

  return lista
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
}

// ---------- API local do Dolphin ----------

async function dolphinLogin(cfg) {
  const resp = await fetch(`http://localhost:${cfg.dolphinPorta || 3001}/v1.0/auth/login-with-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: cfg.dolphinToken }),
  });
  if (!resp.ok) throw new Error(`Falha ao autenticar no Dolphin (HTTP ${resp.status}). O Dolphin está aberto? O token está certo?`);
}

async function abrirPerfil(cfg, perfilId) {
  const url = `http://localhost:${cfg.dolphinPorta || 3001}/v1.0/browser_profiles/${perfilId}/start?automation=1`;
  const dados = await fetch(url).then((r) => r.json());
  if (!dados.success || !dados.automation) {
    throw new Error(`Não consegui abrir o perfil ${perfilId}: ${JSON.stringify(dados)}`);
  }
  const { port, wsEndpoint } = dados.automation;
  return puppeteer.connect({
    browserWSEndpoint: `ws://127.0.0.1:${port}${wsEndpoint}`,
    defaultViewport: null,
  });
}

async function fecharPerfil(cfg, perfilId) {
  await fetch(`http://localhost:${cfg.dolphinPorta || 3001}/v1.0/browser_profiles/${perfilId}/stop`).catch(() => {});
}

// ---------- Instagram ----------

// Acha um botão/link visível cujo texto bate com uma das opções
async function acharPorTexto(page, textos) {
  const handle = await page.evaluateHandle((textos) => {
    const els = document.querySelectorAll('button, [role="button"], a, div[tabindex]');
    for (const el of els) {
      const t = (el.innerText || '').trim();
      if (textos.includes(t) && el.offsetParent !== null) return el;
    }
    return null;
  }, textos);
  return handle.asElement();
}

async function clicarPorTexto(page, textos, timeout = 15000) {
  const fim = Date.now() + timeout;
  while (Date.now() < fim) {
    const el = await acharPorTexto(page, textos);
    if (el) {
      await el.click();
      return true;
    }
    await esperar(500);
  }
  return false;
}

async function verificarLogado(page) {
  const url = page.url();
  if (url.includes('/accounts/login') || url.includes('/challenge') || url.includes('/suspended')) {
    throw new Error(`Não está logado (cookie inválido/expirado ou conta com checkpoint). URL: ${url}`);
  }
}

async function trocarBio(page, nome, bio) {
  if ([...bio].length > 150) log(nome, `AVISO: a bio tem ${[...bio].length} caracteres, o limite do Instagram é 150.`);

  const campo = await page.waitForSelector('textarea#pepBio, textarea[name="biography"], textarea', { timeout: 20000 });
  await campo.click();
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await pausaHumana(400, 900);

  // Digita linha por linha para preservar quebras de linha
  const linhas = bio.split('\n');
  for (let i = 0; i < linhas.length; i++) {
    await campo.type(linhas[i], { delay: 40 + Math.random() * 60 });
    if (i < linhas.length - 1) {
      await page.keyboard.down('Shift');
      await page.keyboard.press('Enter');
      await page.keyboard.up('Shift');
    }
  }
  await pausaHumana();

  if (!(await clicarPorTexto(page, TXT_ENVIAR))) throw new Error('Botão "Enviar" não encontrado');
  await esperar(4000);
  log(nome, 'Bio salva.');
}

async function trocarFoto(page, nome, foto) {
  const arquivo = path.resolve(PASTA, foto);
  if (!fs.existsSync(arquivo)) throw new Error(`Foto não encontrada: ${arquivo}`);

  // 1ª tentativa: input de arquivo escondido na própria página de edição
  const input = await page.$('input[type="file"][accept*="image"]');
  if (input) {
    await input.uploadFile(arquivo);
  } else {
    // 2ª tentativa: clicar em "Alterar foto" (e "Carregar foto", se abrir o menu) e responder o seletor de arquivo
    const seletor = page.waitForFileChooser({ timeout: 20000 });
    if (!(await clicarPorTexto(page, TXT_ALTERAR_FOTO))) throw new Error('Botão "Alterar foto" não encontrado');
    await pausaHumana(800, 1500);
    await clicarPorTexto(page, TXT_CARREGAR_FOTO, 3000); // só existe se a conta já tem foto
    const chooser = await seletor;
    await chooser.accept([arquivo]);
  }

  await esperar(6000); // tempo para o upload terminar
  log(nome, 'Foto de perfil enviada.');
}

async function processarConta(cfg, conta) {
  const { nome, perfilId } = conta;
  log(nome, `Abrindo perfil ${perfilId} no Dolphin...`);
  const browser = await abrirPerfil(cfg, perfilId);

  try {
    const page = (await browser.pages())[0] || (await browser.newPage());

    log(nome, 'Setando cookies...');
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
    await page.setCookie(...lerCookies(conta.cookies));
    await pausaHumana(1500, 3000);

    log(nome, 'Abrindo página de edição de perfil...');
    await page.goto(URL_EDITAR, { waitUntil: 'networkidle2', timeout: 60000 });
    await verificarLogado(page);
    await pausaHumana(2000, 4000);

    if (conta.foto) {
      await trocarFoto(page, nome, conta.foto);
      await page.goto(URL_EDITAR, { waitUntil: 'networkidle2', timeout: 60000 });
      await pausaHumana(2000, 4000);
    }

    if (conta.bio !== undefined && conta.bio !== null) {
      await trocarBio(page, nome, conta.bio);
    }

    log(nome, 'OK ✔');
  } catch (err) {
    // Salva print da tela para ajudar a ver o que deu errado
    try {
      const pages = await browser.pages();
      const p = pages[pages.length - 1];
      fs.mkdirSync(path.join(PASTA, 'erros'), { recursive: true });
      const print = path.join(PASTA, 'erros', `${nome}-${Date.now()}.png`);
      await p.screenshot({ path: print });
      log(nome, `Print do erro salvo em ${print}`);
    } catch {}
    throw err;
  } finally {
    browser.disconnect();
    if (cfg.fecharPerfilNoFinal !== false) await fecharPerfil(cfg, perfilId);
  }
}

async function main() {
  const cfg = carregarConfig();
  const filtro = process.argv[2];
  const contas = filtro ? cfg.contas.filter((c) => c.nome === filtro) : cfg.contas;
  if (!contas.length) {
    console.error(filtro ? `Nenhuma conta com nome "${filtro}" no config.json` : 'Nenhuma conta no config.json');
    process.exit(1);
  }

  await dolphinLogin(cfg);

  const resultado = [];
  for (const conta of contas) {
    try {
      await processarConta(cfg, conta);
      resultado.push(`✔ ${conta.nome}`);
    } catch (err) {
      log(conta.nome, `ERRO: ${err.message}`);
      resultado.push(`✘ ${conta.nome}: ${err.message}`);
    }
    if (conta !== contas[contas.length - 1]) await pausaHumana(5000, 10000);
  }

  console.log('\n===== RESUMO =====');
  resultado.forEach((r) => console.log(r));
}

main().catch((err) => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
