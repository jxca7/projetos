// Para cada arquivo de cookies em cookies/, abre o Microsoft Edge (um perfil
// separado por conta, na pasta navegador/), coloca os cookies e muda a foto e a bio do Instagram.
// Os arquivos que deram certo vão para cookies/feitos/.

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PASTA = __dirname;
const PASTA_COOKIES = path.join(PASTA, 'cookies');
const PASTA_FEITOS = path.join(PASTA_COOKIES, 'feitos');
const PASTA_NAVEGADOR = path.join(PASTA, 'navegador');
const URL_EDITAR = 'https://www.instagram.com/accounts/edit/';
const EXT_FOTO = ['.jpg', '.jpeg', '.png'];

// Textos dos botões em português e inglês (o Instagram muda conforme o idioma da conta)
const TXT_ENVIAR = ['Enviar', 'Submit', 'Salvar', 'Save'];
const TXT_ALTERAR_FOTO = ['Alterar foto', 'Change photo', 'Alterar foto do perfil', 'Change profile photo'];
const TXT_CARREGAR_FOTO = ['Carregar foto', 'Upload photo', 'Upload Photo'];
const TXT_TENTAR_DE_NOVO = ['Retry', 'Tentar novamente', 'Tentar de novo'];
const TXT_ERRO_SALVAR = ['problem saving', 'problema ao salvar', 'Try again later', 'Tente novamente mais tarde'];

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

// Qualquer imagem solta na pasta principal (o Windows às vezes esconde a extensão e vira foto.jpg.jpg)
function primeiraImagem(pasta) {
  const img = fs.readdirSync(pasta).find((f) => EXT_FOTO.includes(path.extname(f).toLowerCase()));
  return img ? path.join(pasta, img) : null;
}

// Foto e bio: primeiro a da conta (fotos/<nome>.jpg, bios/<nome>.txt), senão a padrão (foto.jpg, bio.txt)
function fotoDaConta(nome) {
  return acharFoto(path.join(PASTA, 'fotos', nome)) || acharFoto(path.join(PASTA, 'foto')) || primeiraImagem(PASTA);
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

// ---------- Microsoft Edge ----------

function acharEdge() {
  const candidatos = [
    process.env.NAVEGADOR,
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft\\Edge\\Application\\msedge.exe'),
  ].filter(Boolean);
  const achado = candidatos.find((c) => fs.existsSync(c));
  if (!achado) throw new Error('Não achei o Microsoft Edge instalado neste PC');
  return achado;
}

// proxy.txt (opcional): host:porta, host:porta:usuario:senha ou http://usuario:senha@host:porta
function lerProxy() {
  const linha = lerTexto(path.join(PASTA, 'proxy.txt'));
  if (!linha) return null;
  const url = /^\w+:\/\//.test(linha) ? new URL(linha) : null;
  if (url) {
    return {
      servidor: `${url.protocol}//${url.host}`,
      usuario: decodeURIComponent(url.username) || null,
      senha: decodeURIComponent(url.password) || null,
    };
  }
  const [host, porta, usuario, senha] = linha.split(':');
  return { servidor: `${host}:${porta}`, usuario: usuario || null, senha: senha || null };
}

async function abrirEdge(nome, proxy) {
  const args = ['--no-first-run', '--no-default-browser-check', '--start-maximized'];
  if (proxy) args.push(`--proxy-server=${proxy.servidor}`);
  return puppeteer.launch({
    executablePath: acharEdge(),
    headless: false,
    defaultViewport: null,
    userDataDir: path.join(PASTA_NAVEGADOR, nome),
    args,
  });
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

// Espera até 8s por uma mensagem de erro do Instagram na tela
async function apareceuErro(page) {
  const fim = Date.now() + 8000;
  while (Date.now() < fim) {
    if (await textoDoErro(page)) return true;
    await esperar(500);
  }
  return false;
}

async function textoDoErro(page) {
  return page.evaluate((textos) => {
    const corpo = document.body.innerText;
    const linha = corpo.split('\n').find((l) => textos.some((t) => l.toLowerCase().includes(t.toLowerCase())));
    return linha ? linha.trim() : null;
  }, TXT_ERRO_SALVAR);
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

  // O Instagram às vezes mostra "There was a problem saving your profile": tenta mais uma vez
  if (await apareceuErro(page)) {
    log(nome, 'O Instagram deu erro ao salvar, tentando de novo em 10s...');
    await esperar(10000);
    if (!(await clicarPorTexto(page, TXT_TENTAR_DE_NOVO, 3000))) await clicarPorTexto(page, TXT_ENVIAR, 3000);
    if (await apareceuErro(page)) {
      const msg = await textoDoErro(page);
      throw new Error(`O Instagram recusou salvar o perfil: "${msg}"`);
    }
  }

  // Confere recarregando a página
  await page.goto(URL_EDITAR, { waitUntil: 'networkidle2', timeout: 60000 });
  const salva = await page
    .$eval('textarea#pepBio, textarea[name="biography"], textarea', (t) => t.value)
    .catch(() => null);
  const normalizar = (t) => (t || '').replace(/\s+/g, ' ').trim();
  if (salva !== null && normalizar(salva) !== normalizar(bio)) {
    throw new Error('A bio não ficou salva (o Instagram não aceitou a mudança)');
  }
  log(nome, 'Bio trocada.');
}

async function processarConta(nome, arquivoCookies, proxy) {
  const cookies = lerCookies(arquivoCookies);
  const foto = fotoDaConta(nome);
  const bio = bioDaConta(nome);
  if (!foto && !bio) throw new Error('Não achei foto nem bio para essa conta');

  log(nome, 'Abrindo o Edge...');
  const browser = await abrirEdge(nome, proxy);

  try {
    const page = (await browser.pages())[0] || (await browser.newPage());
    if (proxy?.usuario) await page.authenticate({ username: proxy.usuario, password: proxy.senha || '' });

    log(nome, 'Colocando cookies...');
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
    await page.setCookie(...cookies);
    await pausaHumana(1500, 3000);

    await page.goto(URL_EDITAR, { waitUntil: 'networkidle2', timeout: 60000 });
    await verificarLogado(page);
    await pausaHumana(2000, 4000);

    if (!foto) log(nome, 'Nenhuma foto .jpg/.png na pasta, pulando a foto.');
    if (foto) {
      await trocarFoto(page, nome, foto);
      await page.goto(URL_EDITAR, { waitUntil: 'networkidle2', timeout: 60000 });
      await pausaHumana(2000, 4000);
    }

    if (bio) await trocarBio(page, nome, bio);
    else log(nome, 'bio.txt vazio, pulando a bio.');
  } catch (err) {
    // Salva print da tela para ajudar a ver o que deu errado
    try {
      const pages = await browser.pages();
      fs.mkdirSync(path.join(PASTA, 'erros'), { recursive: true });
      const print = path.join(PASTA, 'erros', `${nome}-${Date.now()}.png`);
      await pages[pages.length - 1].screenshot({ path: print });
      log(nome, `Print do erro salvo em ${print}`);
    } catch {}
    log(nome, `ERRO: ${err.message}`);
    err.jaMostrado = true;
    log(nome, 'O Edge ficou aberto para você ver/testar na mão. Feche o Edge para continuar.');
    await new Promise((r) => browser.once('disconnected', r));
    throw err;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  const arquivos = fs.readdirSync(PASTA_COOKIES).filter((f) => /\.(json|txt)$/i.test(f));
  if (!arquivos.length) {
    console.log('Nenhum arquivo de cookies na pasta cookies/. Nada a fazer.');
    return;
  }

  acharEdge();
  const proxy = lerProxy();
  if (proxy) console.log(`Usando proxy ${proxy.servidor}`);
  fs.mkdirSync(PASTA_FEITOS, { recursive: true });

  const resultado = [];
  for (const [i, arquivo] of arquivos.entries()) {
    const nome = path.parse(arquivo).name;
    try {
      await processarConta(nome, path.join(PASTA_COOKIES, arquivo), proxy);
      fs.renameSync(path.join(PASTA_COOKIES, arquivo), path.join(PASTA_FEITOS, arquivo));
      log(nome, 'OK ✔');
      resultado.push(`✔ ${nome}`);
    } catch (err) {
      if (!err.jaMostrado) log(nome, `ERRO: ${err.message}`);
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
