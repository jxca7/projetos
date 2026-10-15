// Para cada arquivo de cookies em cookies/, abre o perfil do Dolphin Anty
// (o mesmo para todas as contas), troca os cookies e muda a foto e a bio do Instagram.
// Os arquivos que deram certo vão para cookies/feitos/.

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PASTA = __dirname;
const PASTA_COOKIES = path.join(PASTA, 'cookies');
const PASTA_FEITOS = path.join(PASTA_COOKIES, 'feitos');
const PORTA = 3001;
const URL_EDITAR = 'https://www.instagram.com/accounts/edit/';
const EXT_FOTO = ['.jpg', '.jpeg', '.png'];

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

function lerTexto(arquivo) {
  return fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8').replace(/^﻿/, '').trim() : null;
}

// Procura <base>.jpg/.jpeg/.png
function acharFoto(base) {
  for (const ext of EXT_FOTO) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  return null;
}

// Foto e bio: primeiro a da conta (fotos/<nome>.jpg, bios/<nome>.txt), senão a padrão (foto.jpg, bio.txt)
function fotoDaConta(nome) {
  return acharFoto(path.join(PASTA, 'fotos', nome)) || acharFoto(path.join(PASTA, 'foto'));
}

function bioDaConta(nome) {
  const bio = lerTexto(path.join(PASTA, 'bios', `${nome}.txt`)) ?? lerTexto(path.join(PASTA, 'bio.txt'));
  return bio ? bio.replace(/\r\n/g, '\n') : null;
}

// Lê o arquivo de cookies em qualquer um destes formatos:
//   - JSON (Cookie-Editor / EditThisCookie / Dolphin): [{"name": ..., "value": ...}]
//   - Netscape (cookies.txt): linhas separadas por TAB
//   - Texto simples: sessionid=...; csrftoken=...; ds_user_id=...
function lerListaCookies(arquivo) {
  const texto = fs.readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!texto) throw new Error('O arquivo de cookies está vazio');

  if (texto.startsWith('[') || texto.startsWith('{')) {
    let bruto;
    try {
      bruto = JSON.parse(texto);
    } catch {
      throw new Error('O JSON de cookies está incompleto ou quebrado (copie de novo o conteúdo inteiro)');
    }
    const lista = Array.isArray(bruto) ? bruto : bruto.cookies;
    if (!Array.isArray(lista)) throw new Error('Formato de cookies não reconhecido (esperava uma lista JSON)');
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
    .map((par) => par.trim())
    .filter((par) => par.includes('='))
    .map((par) => {
      const i = par.indexOf('=');
      return { name: par.slice(0, i).trim(), value: par.slice(i + 1).trim(), domain: '.instagram.com' };
    });
}

// Converte para o formato do Puppeteer
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

  if (!cookies.some((c) => c.name === 'sessionid')) throw new Error('O arquivo não tem o cookie "sessionid"');
  return cookies;
}

// ---------- Dolphin Anty ----------

async function dolphinLogin(token) {
  const resp = await fetch(`http://localhost:${PORTA}/v1.0/auth/login-with-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  }).catch(() => null);
  if (!resp) throw new Error('Não consegui falar com o Dolphin. Ele está aberto?');
  if (!resp.ok) throw new Error(`O Dolphin recusou o token (HTTP ${resp.status}). Confira o token.txt`);
}

// Lista todos os perfis da conta do Dolphin
async function listarPerfis(token) {
  const perfis = [];
  for (let pagina = 1; ; pagina++) {
    const resp = await fetch(`https://dolphin-anty-api.com/browser_profiles?limit=100&page=${pagina}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error(`Não consegui listar os perfis do Dolphin (HTTP ${resp.status})`);
    const dados = await resp.json();
    for (const p of dados.data || []) perfis.push({ id: p.id, nome: String(p.name).trim() });
    if (!dados.data || dados.data.length < 100 || pagina >= (dados.last_page || pagina)) break;
  }
  return perfis;
}

// perfil.txt pode ter o nome ou o ID do perfil; vazio = usa o único perfil que existir
async function escolherPerfil(token) {
  const escolhido = lerTexto(path.join(PASTA, 'perfil.txt'));
  if (escolhido && /^\d+$/.test(escolhido)) return escolhido;

  const perfis = await listarPerfis(token);
  if (escolhido) {
    const achado = perfis.find((p) => p.nome.toLowerCase() === escolhido.toLowerCase());
    if (!achado) throw new Error(`Não existe perfil chamado "${escolhido}" no Dolphin. Perfis: ${perfis.map((p) => p.nome).join(', ')}`);
    return achado.id;
  }
  if (perfis.length === 1) return perfis[0].id;
  throw new Error(`Você tem ${perfis.length} perfis no Dolphin. Escreva no perfil.txt o nome do perfil que quer usar. Perfis: ${perfis.map((p) => p.nome).join(', ')}`);
}

// Apaga só os cookies do Instagram, para a conta anterior não ficar logada
async function limparCookiesInstagram(page) {
  const cdp = await page.createCDPSession();
  const { cookies } = await cdp.send('Network.getAllCookies');
  for (const c of cookies) {
    if (c.domain.includes('instagram.com')) {
      await cdp.send('Network.deleteCookies', { name: c.name, domain: c.domain, path: c.path });
    }
  }
  await cdp.detach();
}

async function abrirPerfil(perfilId) {
  const url = `http://localhost:${PORTA}/v1.0/browser_profiles/${perfilId}/start?automation=1`;
  const dados = await fetch(url).then((r) => r.json());
  if (!dados.success || !dados.automation) {
    throw new Error(`Não consegui abrir o perfil (ele já está aberto?): ${JSON.stringify(dados)}`);
  }
  const { port, wsEndpoint } = dados.automation;
  return puppeteer.connect({
    browserWSEndpoint: `ws://127.0.0.1:${port}${wsEndpoint}`,
    defaultViewport: null,
  });
}

async function fecharPerfil(perfilId) {
  await fetch(`http://localhost:${PORTA}/v1.0/browser_profiles/${perfilId}/stop`).catch(() => {});
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
    throw new Error(`Não entrou na conta (cookie expirado ou conta com checkpoint). URL: ${url}`);
  }
}

async function trocarFoto(page, nome, arquivo) {
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
  log(nome, 'Foto trocada.');
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
  log(nome, 'Bio trocada.');
}

async function processarConta(nome, perfilId, arquivoCookies) {
  const cookies = lerCookies(arquivoCookies);
  const foto = fotoDaConta(nome);
  const bio = bioDaConta(nome);
  if (!foto && !bio) throw new Error('Não achei foto nem bio para essa conta');

  log(nome, 'Abrindo perfil no Dolphin...');
  const browser = await abrirPerfil(perfilId);

  try {
    const page = (await browser.pages())[0] || (await browser.newPage());

    log(nome, 'Trocando cookies...');
    await limparCookiesInstagram(page);
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
    await page.setCookie(...cookies);
    await pausaHumana(1500, 3000);

    await page.goto(URL_EDITAR, { waitUntil: 'networkidle2', timeout: 60000 });
    await verificarLogado(page);
    await pausaHumana(2000, 4000);

    if (foto) {
      await trocarFoto(page, nome, foto);
      await page.goto(URL_EDITAR, { waitUntil: 'networkidle2', timeout: 60000 });
      await pausaHumana(2000, 4000);
    }

    if (bio) await trocarBio(page, nome, bio);
  } catch (err) {
    // Salva print da tela para ajudar a ver o que deu errado
    try {
      const pages = await browser.pages();
      fs.mkdirSync(path.join(PASTA, 'erros'), { recursive: true });
      const print = path.join(PASTA, 'erros', `${nome}-${Date.now()}.png`);
      await pages[pages.length - 1].screenshot({ path: print });
      log(nome, `Print do erro salvo em ${print}`);
    } catch {}
    throw err;
  } finally {
    browser.disconnect();
    await fecharPerfil(perfilId);
  }
}

async function main() {
  const token = lerTexto(path.join(PASTA, 'token.txt'));
  if (!token || token.includes('COLE')) {
    throw new Error('Cole o token da API do Dolphin no arquivo token.txt');
  }

  const arquivos = fs.readdirSync(PASTA_COOKIES).filter((f) => /\.(json|txt)$/i.test(f));
  if (!arquivos.length) {
    console.log('Nenhum arquivo de cookies na pasta cookies/. Nada a fazer.');
    return;
  }

  await dolphinLogin(token);
  const perfilId = await escolherPerfil(token);
  fs.mkdirSync(PASTA_FEITOS, { recursive: true });

  const resultado = [];
  for (const [i, arquivo] of arquivos.entries()) {
    const nome = path.parse(arquivo).name;
    try {
      await processarConta(nome, perfilId, path.join(PASTA_COOKIES, arquivo));
      fs.renameSync(path.join(PASTA_COOKIES, arquivo), path.join(PASTA_FEITOS, arquivo));
      log(nome, 'OK ✔');
      resultado.push(`✔ ${nome}`);
    } catch (err) {
      log(nome, `ERRO: ${err.message}`);
      resultado.push(`✘ ${nome}: ${err.message}`);
    }
    if (i < arquivos.length - 1) await pausaHumana(5000, 10000);
  }

  console.log('\n===== RESUMO =====');
  resultado.forEach((r) => console.log(r));
}

main().catch((err) => {
  console.error('\nERRO:', err.message);
  process.exitCode = 1;
});
