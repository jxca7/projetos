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

// Convites de testador (Permissões do site do app > Apps e sites > Convites do testador)
const URL_APPS_E_SITES = 'https://www.instagram.com/accounts/manage_access/';
const TXT_PERMISSOES = ['Permissões do site do app', 'Website permissions', 'App and website permissions'];
const TXT_APPS_E_SITES = ['Apps e sites', 'Apps and websites'];
const TXT_CONVITES = ['Convites do testador', 'Convites de testador', 'Tester invites', 'Tester Invites'];
const TXT_ACEITAR = ['Aceitar', 'Accept'];
const TXT_SEM_CONVITES = ['não tem convites', 'nenhum convite', 'no tester invites', "don't have any", 'não tem nenhum'];

// ---------- utilidades ----------

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
// VELOCIDADE: multiplica todas as pausas. 1 = devagar (mais "humano"), 0.3 = rápido.
const VELOCIDADE = 0.3;
const pausaHumana = (min = 800, max = 2000) => esperar((min + Math.random() * (max - min)) * VELOCIDADE);

const SELETOR_BIO = 'textarea#pepBio, textarea[name="biography"], textarea';

// Abre a página de editar perfil e espera só o campo da bio aparecer (sem esperar a página inteira)
async function abrirEditar(page) {
  await page.goto(URL_EDITAR, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector(SELETOR_BIO, { visible: true, timeout: 20000 }).catch(() => {});
}

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

// Clica no elemento visível mais "de dentro" cujo texto é exatamente um dos textos (sem diferenciar maiúsculas)
async function clicarTexto(page, textos, timeout = 10000) {
  const fim = Date.now() + timeout;
  while (Date.now() < fim) {
    const handle = await page.evaluateHandle((textos) => {
      const alvo = textos.map((t) => t.toLowerCase());
      const candidatos = [...document.querySelectorAll('body *')].filter((el) => {
        const t = (el.innerText || '').trim().toLowerCase();
        const r = el.getBoundingClientRect();
        return alvo.includes(t) && r.width > 0 && r.height > 0;
      });
      // o mais interno (sem filho que também bata)
      return candidatos.find((el) => !candidatos.some((o) => o !== el && el.contains(o))) || null;
    }, textos);
    const el = handle.asElement();
    if (el) {
      await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await pausaHumana(300, 700);
      await el.click();
      return true;
    }
    await esperar(500);
  }
  return false;
}

async function paginaContem(page, textos) {
  return page.evaluate((textos) => {
    const corpo = document.body.innerText.toLowerCase();
    return textos.some((t) => corpo.includes(t.toLowerCase()));
  }, textos);
}

async function aceitarConvitesTestador(page, nome) {
  log(nome, 'Abrindo Apps e sites...');
  await page.goto(URL_APPS_E_SITES, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page
    .waitForFunction(
      (textos) => textos.some((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase())),
      { timeout: 10000 },
      TXT_CONVITES,
    )
    .catch(() => {});

  // Se o link direto não abrir a tela, vai pelo menu: Permissões do site do app > Apps e sites
  if (!(await paginaContem(page, TXT_CONVITES))) {
    await abrirEditar(page);
    await pausaHumana(1500, 3000);
    if (!(await clicarTexto(page, TXT_PERMISSOES))) throw new Error('Não achei "Permissões do site do app"');
    await pausaHumana(1500, 3000);
    if (!(await clicarTexto(page, TXT_APPS_E_SITES))) throw new Error('Não achei "Apps e sites"');
    await pausaHumana(2000, 3500);
  }

  if (!(await clicarTexto(page, TXT_CONVITES))) throw new Error('Não achei "Convites do testador"');
  await pausaHumana(2000, 3500);

  let aceitos = 0;
  while (aceitos < 20 && (await clicarTexto(page, TXT_ACEITAR, aceitos ? 2000 : 6000))) {
    aceitos++;
    await pausaHumana(1000, 2000);
    await clicarTexto(page, TXT_ACEITAR, 800); // às vezes pede para confirmar
    await pausaHumana(800, 1500);
  }

  if (aceitos) log(nome, 'Convites do testador aceitos.');
  else if (await paginaContem(page, TXT_SEM_CONVITES)) log(nome, 'Nenhum convite do testador pendente.');
  else log(nome, 'AVISO: não achei nenhum botão "Aceitar" nos convites do testador.');
}

// Lê a bio que está salva no perfil agora (null se não conseguir ler)
async function lerBioAtual(page) {
  try {
    await abrirEditar(page);
    const campo = await page.waitForSelector('textarea#pepBio, textarea[name="biography"], textarea', { timeout: 15000 });
    return await campo.evaluate((t) => t.value);
  } catch {
    return null;
  }
}

function avisarSemBio(nome) {
  process.stdout.write('\x07'); // bipe
  log(nome, '⚠⚠⚠ ATENÇÃO: o perfil está SEM BIO ⚠⚠⚠');
}

async function trocarFoto(page, nome, arquivo) {
  // Espera a resposta do upload em vez de um tempo fixo
  const upload = page
    .waitForResponse((r) => /profile_pic|profile_picture/i.test(r.url()) && r.request().method() === 'POST', { timeout: 20000 })
    .catch(() => null);

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

  if (!(await upload)) await esperar(3000); // não vi a resposta: dá um tempinho para terminar
  await pausaHumana(500, 1000);
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
    await campo.type(linhas[i], { delay: 10 + Math.random() * 20 });
    if (i < linhas.length - 1) {
      await page.keyboard.down('Shift');
      await page.keyboard.press('Enter');
      await page.keyboard.up('Shift');
    }
  }
  await pausaHumana();

  const salvou = page
    .waitForResponse((r) => /accounts\/edit|edit_profile|web_edit/i.test(r.url()) && r.request().method() === 'POST', { timeout: 10000 })
    .catch(() => null);
  if (!(await clicarPorTexto(page, TXT_ENVIAR))) throw new Error('Botão "Enviar" não encontrado');
  const resposta = await salvou;
  await esperar(resposta ? 800 : 2000);

  // O Instagram às vezes mostra "There was a problem saving your profile": tenta mais uma vez
  if ((resposta && !resposta.ok()) || (await textoDoErro(page))) {
    log(nome, 'O Instagram deu erro ao salvar, tentando de novo em 10s...');
    await esperar(10000);
    if (!(await clicarPorTexto(page, TXT_TENTAR_DE_NOVO, 3000))) await clicarPorTexto(page, TXT_ENVIAR, 3000);
    if (await apareceuErro(page)) {
      const msg = await textoDoErro(page);
      throw new Error(`O Instagram recusou salvar o perfil: "${msg}"`);
    }
  }

  // Confere recarregando a página
  await abrirEditar(page);
  const salva = await page
    .$eval('textarea#pepBio, textarea[name="biography"], textarea', (t) => t.value)
    .catch(() => null);
  const normalizar = (t) => (t || '').replace(/\s+/g, ' ').trim();
  if (salva !== null && normalizar(salva) !== normalizar(bio)) {
    throw new Error('A bio não ficou salva (o Instagram não aceitou a mudança)');
  }
  log(nome, 'Bio trocada.');
  return true;
}

async function processarConta(nome, arquivoCookies, proxy) {
  const cookies = lerCookies(arquivoCookies);
  const foto = fotoDaConta(nome);
  const bio = bioDaConta(nome);
  if (!foto && !bio) throw new Error('Não achei foto nem bio para essa conta');

  log(nome, 'Abrindo o Edge...');
  const browser = await abrirEdge(nome, proxy);
  let page;

  try {
    page = (await browser.pages())[0] || (await browser.newPage());
    if (proxy?.usuario) await page.authenticate({ username: proxy.usuario, password: proxy.senha || '' });

    log(nome, 'Colocando cookies...');
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
    await page.setCookie(...cookies);
    await pausaHumana(500, 1000);

    await abrirEditar(page);
    await verificarLogado(page);
    await pausaHumana(500, 1000);

    if (!foto) log(nome, 'Nenhuma foto .jpg/.png na pasta, pulando a foto.');
    if (foto) {
      await trocarFoto(page, nome, foto);
      await abrirEditar(page);
      await pausaHumana(500, 1000);
    }

    let bioConfirmada = false;
    if (bio) bioConfirmada = await trocarBio(page, nome, bio);
    else log(nome, 'bio.txt vazio, pulando a bio.');

    await aceitarConvitesTestador(page, nome);

    // Se a bio já foi conferida ao salvar, não precisa recarregar de novo
    const bioAtual = bioConfirmada ? bio : await lerBioAtual(page);
    const semBio = bioAtual !== null && !bioAtual.trim();
    if (semBio) avisarSemBio(nome);
    return { semBio };
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
    if (page) {
      const bioAtual = await lerBioAtual(page);
      if (bioAtual !== null && !bioAtual.trim()) {
        err.semBio = true;
        avisarSemBio(nome);
      }
    }
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
  const semBioLista = [];
  for (const [i, arquivo] of arquivos.entries()) {
    const nome = path.parse(arquivo).name;
    try {
      const { semBio } = await processarConta(nome, path.join(PASTA_COOKIES, arquivo), proxy);
      if (semBio) {
        // Fica em cookies/ para tentar de novo na próxima vez
        semBioLista.push(nome);
        resultado.push(`⚠ ${nome}: terminou, mas o perfil está SEM BIO`);
      } else {
        fs.renameSync(path.join(PASTA_COOKIES, arquivo), path.join(PASTA_FEITOS, arquivo));
        log(nome, 'OK ✔');
        resultado.push(`✔ ${nome}`);
      }
    } catch (err) {
      if (!err.jaMostrado) log(nome, `ERRO: ${err.message}`);
      if (err.semBio) semBioLista.push(nome);
      resultado.push(`✘ ${nome}: ${err.message}${err.semBio ? ' (perfil SEM BIO)' : ''}`);
    }
    if (i < arquivos.length - 1) await esperar(1000 + Math.random() * 1000);
  }

  console.log('\n===== RESUMO =====');
  resultado.forEach((r) => console.log(r));
  if (semBioLista.length) {
    process.stdout.write('\x07');
    console.log(`\n⚠ PERFIS SEM BIO (${semBioLista.length}): ${semBioLista.join(', ')}`);
    console.log('  Os cookies deles continuam na pasta cookies/ para você rodar de novo.');
  }
}

main().catch((err) => {
  console.error('\nERRO:', err.message);
  process.exitCode = 1;
});
