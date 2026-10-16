// Para cada linha do contas.txt (usuario:senha), abre o site do site.txt no Edge,
// clica em "Conectar Instagram", entra na conta e passa pelas telas da Meta:
// Mudar > Criador de conteúdo > Avançar > Blog pessoal > Concluir > Continuar > Concluir > Permitir.
// As contas que deram certo saem do contas.txt e vão para feitos.txt.

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PASTA = __dirname;
const ARQ_CONTAS = path.join(PASTA, 'contas.txt');
const ARQ_FEITOS = path.join(PASTA, 'feitos.txt');
const ESPERA_MANUAL = 5 * 60 * 1000; // tempo para você fazer algo na mão (login no site, código de verificação)

const TXT_CONECTAR = ['Conectar Instagram', 'Connect Instagram'];
const TXT_ENTRAR = ['Entrar', 'Log in', 'Log In'];
const TXT_AGORA_NAO = ['Agora não', 'Not now', 'Not Now'];

// Telas depois do login, na ordem. "opcional" = pode não aparecer.
const PASSOS = [
  {
    nome: 'Mudar',
    textos: ['Mudar', 'Mudar para conta profissional', 'Switch', 'Change', 'Update', 'Switch now', 'Switch account',
      'Switch to professional account', 'Switch to Professional Account', 'Switch to professional', 'Change account type'],
  },
  { nome: 'Criador de conteúdo', textos: ['Criador de conteúdo', 'Criador', 'Creator', 'Content creator', 'Content Creator'], selecao: true },
  { nome: 'Avançar', textos: ['Avançar', 'Próximo', 'Next'] },
  { nome: 'Avançar (2ª vez)', textos: ['Avançar', 'Próximo', 'Next'], opcional: true },
  { nome: 'Blog pessoal', textos: ['Blog pessoal', 'Personal blog', 'Personal Blog'], categoria: true },
  { nome: 'Concluir', textos: ['Concluir', 'Concluído', 'Done', 'Finish', 'Complete'] },
  { nome: 'Continuar', textos: ['Continuar', 'Continue'] },
  { nome: 'Concluir (2ª vez)', textos: ['Concluir', 'Concluído', 'Done', 'Finish', 'Complete'], opcional: true },
  // Tela "fulano-IG está solicitando acesso a: conta. Ao selecionar Permitir, ..."
  { nome: 'Permitir', textos: ['Permitir', 'Allow', 'Allow access'] },
];

// ---------- utilidades ----------

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
// VELOCIDADE: multiplica todas as pausas. 1 = devagar (mais "humano"), 0.3 = rápido.
const VELOCIDADE = 0.6;
const pausaHumana = (min = 800, max = 2000) => esperar((min + Math.random() * (max - min)) * VELOCIDADE);

// ---------- jeito humano ----------

// Move o mouse até um ponto aleatório do elemento (em vários passos) e clica, como uma pessoa
async function cliqueHumano(page, el) {
  try {
    await el.evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const box = await el.boundingBox();
    if (!box) return await el.click();
    const x = box.x + box.width * (0.3 + Math.random() * 0.4);
    const y = box.y + box.height * (0.3 + Math.random() * 0.4);
    await page.mouse.move(x, y, { steps: 8 + Math.floor(Math.random() * 15) });
    await esperar(60 + Math.random() * 180);
    await page.mouse.down();
    await esperar(40 + Math.random() * 90);
    await page.mouse.up();
  } catch {
    await el.click().catch(() => {});
  }
}

// Digita letra por letra com ritmo variado e uma pausinha de vez em quando
async function digitarHumano(el, texto) {
  for (const letra of texto) {
    await el.type(letra);
    await esperar(Math.random() < 0.06 ? 250 + Math.random() * 350 : 40 + Math.random() * 110);
  }
}

function log(conta, msg) {
  const hora = new Date().toLocaleTimeString('pt-BR');
  console.log(`[${hora}] [${conta}] ${msg}`);
}

function lerTexto(arquivo) {
  return fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, '').trim() : null;
}

// contas.txt: uma conta por linha, usuario:senha (a senha pode ter ":")
function lerContas() {
  if (!fs.existsSync(ARQ_CONTAS)) {
    fs.writeFileSync(ARQ_CONTAS, 'usuario1:senha1\r\nusuario2:senha2\r\n');
    throw new Error('Criei o contas.txt. Coloque uma conta por linha no formato usuario:senha e rode de novo.');
  }
  return lerTexto(ARQ_CONTAS)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes(':'))
    .map((linha) => {
      const i = linha.indexOf(':');
      return { linha, usuario: linha.slice(0, i).trim(), senha: linha.slice(i + 1).trim() };
    })
    .filter((c) => c.usuario && c.senha && c.usuario !== 'usuario1');
}

// Tira a conta do contas.txt e coloca no feitos.txt
function moverConta(conta, destino) {
  const linhas = fs.readFileSync(ARQ_CONTAS, 'utf8').split(/\r?\n/);
  const resto = linhas.filter((l) => l.trim() !== conta.linha);
  fs.writeFileSync(ARQ_CONTAS, resto.join('\r\n'));
  fs.appendFileSync(destino, `${conta.linha}\r\n`);
}

const marcarFeita = (conta) => moverConta(conta, ARQ_FEITOS);
// Conta com 2FA vai para 2fa.txt, para não ficar tentando de novo
const marcar2FA = (conta) => moverConta(conta, path.join(PASTA, '2fa.txt'));

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
  if (/^\w+:\/\//.test(linha)) {
    const url = new URL(linha);
    return {
      servidor: `${url.protocol}//${url.host}`,
      usuario: decodeURIComponent(url.username) || null,
      senha: decodeURIComponent(url.password) || null,
    };
  }
  const [host, porta, usuario, senha] = linha.split(':');
  return { servidor: `${host}:${porta}`, usuario: usuario || null, senha: senha || null };
}

async function abrirEdge(proxy) {
  // --lang: Edge e Instagram em português
  const args = ['--no-first-run', '--no-default-browser-check', '--start-maximized', '--lang=pt-BR', '--accept-lang=pt-BR,pt'];
  if (proxy) args.push(`--proxy-server=${proxy.servidor}`);
  // Um perfil só, guardado em navegador/: o login do site fica salvo nele
  return puppeteer.launch({
    executablePath: acharEdge(),
    headless: false,
    defaultViewport: null,
    userDataDir: path.join(PASTA, 'navegador'),
    args,
  });
}

// Desloga do Instagram (e do Facebook) para a próxima conta entrar limpa; o login do site continua
async function limparLoginInstagram(page) {
  const cdp = await page.createCDPSession();
  const { cookies } = await cdp.send('Network.getAllCookies');
  for (const c of cookies) {
    if (/(^|\.)(instagram|facebook)\.com$/.test(c.domain.replace(/^\./, ''))) {
      await cdp.send('Network.deleteCookies', { name: c.name, domain: c.domain, path: c.path });
    }
  }
  await cdp.detach();
}

// ---------- cliques ----------

// Acha o elemento visível, não coberto por outro, cujo texto é exatamente um dos textos.
// Prefere botões/links e, entre eles, o que está mais "na frente" (último na página, ex.: dentro de um modal).
async function acharTexto(page, textos) {
  const handle = await page.evaluateHandle((textos) => {
    // Ignora ícones/símbolos nas pontas ("+ Conectar Instagram", "📷 Conectar Instagram") e espaços extras
    const norm = (t) => (t || '').toLowerCase().replace(/\s+/g, ' ').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    const alvo = textos.map(norm);
    const visivel = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const topo = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return topo && (el.contains(topo) || topo.contains(el));
    };
    const candidatos = [...document.querySelectorAll('body *')].filter(
      (el) => alvo.includes(norm(el.innerText)) && visivel(el),
    );
    const internos = candidatos.filter((el) => !candidatos.some((o) => o !== el && el.contains(o)));
    const clicaveis = internos.filter((el) => el.closest('button, a, [role="button"], [role="radio"], label, [tabindex]'));
    const lista = clicaveis.length ? clicaveis : internos;
    return lista[lista.length - 1] || null;
  }, textos);
  return handle.asElement();
}

async function clicarTexto(page, textos, timeout = 15000) {
  const fim = Date.now() + timeout;
  while (Date.now() < fim) {
    const el = await acharTexto(page, textos).catch(() => null);
    if (el) {
      await pausaHumana(400, 900);
      await cliqueHumano(page, el);
      return true;
    }
    await esperar(250);
  }
  return false;
}

async function existeTexto(page, textos) {
  return !!(await acharTexto(page, textos).catch(() => null));
}

async function salvarPrint(page, nome) {
  try {
    fs.mkdirSync(path.join(PASTA, 'erros'), { recursive: true });
    const print = path.join(PASTA, 'erros', `${nome}-${Date.now()}.png`);
    await page.screenshot({ path: print });
    log(nome, `Print salvo em ${print}`);
  } catch {}
}

// ---------- etapas ----------

// site_login.txt: email:senha do site (o mesmo para todas as contas)
function lerLoginSite() {
  const linha = lerTexto(path.join(PASTA, 'site_login.txt'));
  if (!linha || !linha.includes(':') || linha.startsWith('seu@email')) return null;
  const i = linha.indexOf(':');
  return { email: linha.slice(0, i).trim(), senha: linha.slice(i + 1).trim() };
}

// Fecha o pop-up que o site mostra depois do login (propaganda da extensão): clica em "Agora não"
async function fecharPopup(page, nome) {
  if (await clicarTexto(page, TXT_AGORA_NAO, 4000)) {
    log(nome, 'Fechei o pop-up do site ("Agora não").');
    await pausaHumana(800, 1500);
  }
}

// Tela de login do site (EMAIL / SENHA / Entrar): preenche com o site_login.txt
async function entrarNoSite(page, site, nome) {
  const naoInstagram = !/instagram\.com|facebook\.com/.test(page.url());
  const campoEmail = naoInstagram && (await page.$('input[type="email"], input[name="email"], input[placeholder*="email" i]'));
  const campoSenha = naoInstagram && (await page.$('input[type="password"]'));
  if (!campoEmail || !campoSenha) return false;

  const login = lerLoginSite();
  if (!login) {
    log(nome, '>>> O site pediu login, mas o site_login.txt está vazio. Entre na mão nessa janela do Edge. Estou esperando...');
    return false;
  }

  log(nome, 'Entrando no site...');
  await campoEmail.click({ clickCount: 3 });
  await digitarHumano(campoEmail, login.email);
  await campoSenha.click({ clickCount: 3 });
  await digitarHumano(campoSenha, login.senha);
  await pausaHumana(500, 1000);
  const botao = await page.$('button[type="submit"]');
  if (botao) await cliqueHumano(page, botao);
  else if (!(await clicarTexto(page, TXT_ENTRAR, 5000))) await page.keyboard.press('Enter');

  // Espera o login do site terminar e volta para a página do site.txt
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
  await pausaHumana(1500, 2500);
  if (await page.$('input[type="password"]')) throw new Error('O site não aceitou o login do site_login.txt');
  await fecharPopup(page, nome);
  if (!(await existeTexto(page, TXT_CONECTAR))) {
    await page.goto(site, { waitUntil: 'networkidle2', timeout: 60000 });
    await fecharPopup(page, nome);
  }
  log(nome, 'Logado no site.');
  return true;
}

// Clica no primeiro "Conectar Instagram" (o de cima) e marca ele, para o segundo clique não acertar o mesmo
async function clicarPrimeiroConectar(page, timeout) {
  const fim = Date.now() + timeout;
  while (Date.now() < fim) {
    const el = await acharTexto(page, TXT_CONECTAR).catch(() => null);
    if (el) {
      await el.evaluate((e) => (e.closest('button, a, [role="button"]') || e).setAttribute('data-conectar-1', '1'));
      await pausaHumana(400, 900);
      await cliqueHumano(page, el);
      return true;
    }
    await esperar(250);
  }
  return false;
}

// Segundo "Conectar Instagram": o BOTÃO da janelinha (não o título dela, nem o botão de cima)
async function clicarSegundoConectar(page, timeout) {
  const fim = Date.now() + timeout;
  while (Date.now() < fim) {
    const handle = await page
      .evaluateHandle((textos) => {
        const norm = (t) => (t || '').toLowerCase().replace(/\s+/g, ' ').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
        const alvo = textos.map(norm);
        const visivel = (el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          const topo = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return topo && (el.contains(topo) || topo.contains(el));
        };
        const botoes = [...document.querySelectorAll('button, a, [role="button"]')].filter(
          (b) => !b.hasAttribute('data-conectar-1') && !b.closest('[data-conectar-1]') && alvo.includes(norm(b.innerText)) && visivel(b),
        );
        return botoes[botoes.length - 1] || null;
      }, TXT_CONECTAR)
      .catch(() => null);
    const el = handle && handle.asElement();
    if (el) {
      await pausaHumana(400, 900);
      await cliqueHumano(page, el);
      return true;
    }
    await esperar(250);
  }
  return false;
}

// Espera sair do site (ir para o Instagram) ou aparecer a tela de login do Instagram
async function esperouIrParaInstagram(page, site, timeout) {
  const origemSite = new URL(site).origin;
  const fim = Date.now() + timeout;
  while (Date.now() < fim) {
    if (!page.url().startsWith(origemSite)) return true;
    if (await page.$('input[name="username"]').catch(() => null)) return true;
    await esperar(250);
  }
  return false;
}

async function clicarConectar(page, site, nome) {
  await page.goto(site, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await entrarNoSite(page, site, nome);
  await fecharPopup(page, nome); // o pop-up da extensão aparece toda vez que abre o site

  if (!(await clicarPrimeiroConectar(page, 15000))) {
    if (await entrarNoSite(page, site, nome)) {
      await fecharPopup(page, nome);
      if (!(await clicarPrimeiroConectar(page, 15000))) throw new Error('Não achei o botão "Conectar Instagram"');
    } else {
      log(nome, '>>> Não achei "Conectar Instagram". Se o site pediu login, entre na mão nessa janela do Edge. Estou esperando...');
      if (!(await clicarPrimeiroConectar(page, ESPERA_MANUAL))) throw new Error('Não achei o botão "Conectar Instagram"');
    }
  }
  log(nome, 'Cliquei em "Conectar Instagram" (em cima).');
  await pausaHumana(1500, 2500);

  // Botão da janelinha; se não for para o Instagram, fecha pop-up que tenha aparecido e tenta de novo
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    if (await clicarSegundoConectar(page, 10000)) {
      log(nome, 'Cliquei em "Conectar Instagram" (na janelinha).');
      if (await esperouIrParaInstagram(page, site, 15000)) return;
    }
    log(nome, `Não foi para o Instagram, tentando de novo (${tentativa}/3)...`);
    await fecharPopup(page, nome);
    if (!(await existeTexto(page, ['OAuth do app Meta']))) await clicarPrimeiroConectar(page, 5000);
    await pausaHumana(1500, 2500);
  }
  throw new Error('Cliquei em "Conectar Instagram" mas não abriu o login do Instagram');
}

async function pediu2FA(page) {
  if (/two_factor|challenge|checkpoint|codeentry|auth_platform/i.test(page.url())) return true;
  return page
    .evaluate(() =>
      /duas etapas|dois fatores|two-factor|2fa|código de segurança|código de confirmação|security code|confirmation code|insira o código|enter the code|digite o código|check your (email|phone|text)/i.test(
        document.body.innerText,
      ),
    )
    .catch(() => false);
}

async function fazerLogin(page, conta, nome) {
  const campoUsuario = await page
    .waitForSelector('input[name="username"], input[name="email"]', { visible: true, timeout: 30000 })
    .catch(() => null);
  if (!campoUsuario) {
    log(nome, 'Não apareceu a tela de login (talvez já esteja logado). Seguindo...');
    return;
  }
  const campoSenha = await page.waitForSelector('input[name="password"], input[name="pass"], input[type="password"]', {
    visible: true,
    timeout: 10000,
  });

  log(nome, 'Preenchendo login e senha...');
  await campoUsuario.click({ clickCount: 3 });
  await digitarHumano(campoUsuario, conta.usuario);
  await pausaHumana(500, 1200);
  await campoSenha.click({ clickCount: 3 });
  await digitarHumano(campoSenha, conta.senha);
  await pausaHumana(600, 1300);

  const botao = await page.$('button[type="submit"]');
  if (botao) await cliqueHumano(page, botao);
  else if (!(await clicarTexto(page, TXT_ENTRAR, 5000))) await page.keyboard.press('Enter');

  // Espera sair da tela de login
  const fim = Date.now() + 30000;
  while (Date.now() < fim) {
    await esperar(300);
    const aindaNoLogin = await page.$('input[name="password"], input[name="pass"]').catch(() => null);
    if (!aindaNoLogin) break;
    const erro = await page
      .evaluate(() => {
        const t = document.body.innerText;
        return /senha.*incorreta|incorrect password|não pertence|doesn't belong|tente novamente|try again/i.test(t)
          ? t.match(/[^\n]*(senha.*incorreta|incorrect password|não pertence|doesn't belong|tente novamente|try again)[^\n]*/i)[0]
          : null;
      })
      .catch(() => null);
    if (erro) throw new Error(`Login recusado: "${erro.trim()}"`);
  }

  // Espera a próxima tela: 2FA (pula a conta), "Agora não" (clica) ou a tela do "Mudar"
  const ate = Date.now() + 20000;
  while (Date.now() < ate) {
    if (await pediu2FA(page)) {
      const err = new Error('Pediu verificação em duas etapas (2FA), pulei a conta');
      err.pediu2FA = true;
      throw err;
    }
    const agoraNao = await acharTexto(page, TXT_AGORA_NAO).catch(() => null);
    if (agoraNao) {
      await cliqueHumano(page, agoraNao);
      log(nome, 'Cliquei em "Agora não".');
      await esperar(500);
      continue;
    }
    // Para assim que aparecer a 1ª tela (Mudar) OU o Permitir (conta já conectada)
    const primeiro = PASSOS[0].textos;
    const permitir = PASSOS[PASSOS.length - 1].textos;
    if ((await existeTexto(page, primeiro)) || (await existeTexto(page, permitir))) break;
    await esperar(300);
  }
  log(nome, 'Login feito.');
}

// Espera o elemento clicado sumir (a tela mudou), para não clicar duas vezes no mesmo botão
async function esperarSumir(el, timeout = 6000) {
  const fim = Date.now() + timeout;
  while (Date.now() < fim) {
    const sumiu = await el
      .evaluate((e) => !e.isConnected || e.getBoundingClientRect().width === 0)
      .catch(() => true);
    if (sumiu) return;
    await esperar(150);
  }
}

async function passarTelas(page, nome) {
  let i = 0;
  while (i < PASSOS.length) {
    const passo = PASSOS[i];
    const inicio = Date.now();
    let alvo = -1;
    let el = null;
    let buscou = false;

    while (Date.now() - inicio < 20000) {
      el = await acharTexto(page, passo.textos).catch(() => null);
      if (el) {
        alvo = i;
        break;
      }
      // Lista de categorias com busca: digita para "Blog pessoal" aparecer
      if (passo.categoria && !buscou && Date.now() - inicio > 1500) {
        const busca = await page.$('input[type="search"], input[placeholder*="esquis"], input[placeholder*="earch"], input[placeholder*="usca"]');
        if (busca) {
          buscou = true;
          await busca.click({ clickCount: 3 });
          await digitarHumano(busca, passo.textos[0]);
          continue;
        }
      }
      // "Permitir" já na tela a qualquer momento (conta já configurada / reconexão): clica logo
      const permitir = PASSOS[PASSOS.length - 1];
      if (passo !== permitir) {
        el = await acharTexto(page, permitir.textos).catch(() => null);
        if (el && !(await acharTexto(page, passo.textos).catch(() => null))) {
          alvo = PASSOS.length - 1;
          break;
        }
        el = null;
      }

      // Passo não apareceu em 2,5s: se uma tela mais à frente já está aparecendo, pula para ela
      if (Date.now() - inicio > 2500) {
        for (let j = i + 1; j < PASSOS.length; j++) {
          el = await acharTexto(page, PASSOS[j].textos).catch(() => null);
          if (el) {
            alvo = j;
            break;
          }
          // pula passos do meio quando a conta já está configurada (vai até achar um que apareça)
        }
        if (alvo >= 0) break;
      }
      await esperar(250);
    }

    if (alvo < 0) {
      if (passo.opcional) {
        i++;
        continue;
      }
      throw new Error(`Não achei o botão "${passo.nome}"`);
    }
    if (alvo > i) log(nome, `"${passo.nome}" não apareceu, seguindo para "${PASSOS[alvo].nome}".`);

    await pausaHumana(300, 700);
    await cliqueHumano(page, el);
    log(nome, `Cliquei em "${PASSOS[alvo].nome}".`);
    // Opções (Criador, Blog pessoal) continuam na tela; botões de avançar somem quando a tela muda
    if (PASSOS[alvo].selecao || PASSOS[alvo].categoria) await pausaHumana(300, 600);
    else await esperarSumir(el);
    i = alvo + 1;
  }

  // Depois de "Permitir", espera voltar para o site
  const fim = Date.now() + 60000;
  while (Date.now() < fim && /instagram\.com|facebook\.com/.test(page.url())) await esperar(300);
  if (/instagram\.com|facebook\.com/.test(page.url())) throw new Error('Cliquei em "Permitir", mas não voltou para o site');
}

async function conectarConta(browser, site, conta) {
  const nome = conta.usuario;
  const page = (await browser.pages())[0] || (await browser.newPage());
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  try {
    await limparLoginInstagram(page);
    await clicarConectar(page, site, nome);
    await fazerLogin(page, conta, nome);
    await passarTelas(page, nome);
    log(nome, 'Conectada ✔');
  } catch (err) {
    await salvarPrint(page, nome);
    throw err;
  }
}

async function main() {
  const site = lerTexto(path.join(PASTA, 'site.txt'));
  if (!site || !/^https?:\/\//.test(site)) throw new Error('Coloque o link do site no site.txt (começando com https://)');

  const arqLoginSite = path.join(PASTA, 'site_login.txt');
  if (!fs.existsSync(arqLoginSite)) fs.writeFileSync(arqLoginSite, 'seu@email.com:suasenha\r\n');
  if (!lerLoginSite()) console.log('AVISO: site_login.txt não preenchido; se o site pedir login, entre na mão.');

  const contas = lerContas();
  if (!contas.length) {
    console.log('Nenhuma conta no contas.txt (formato: usuario:senha, uma por linha). Nada a fazer.');
    return;
  }

  const proxy = lerProxy();
  if (proxy) console.log(`Usando proxy ${proxy.servidor}`);

  const browser = await abrirEdge(proxy);
  if (proxy?.usuario) {
    const page = (await browser.pages())[0];
    await page.authenticate({ username: proxy.usuario, password: proxy.senha || '' });
  }

  const resultado = [];
  try {
    for (const [i, conta] of contas.entries()) {
      try {
        await conectarConta(browser, site, conta);
        marcarFeita(conta);
        resultado.push(`✔ ${conta.usuario}`);
      } catch (err) {
        log(conta.usuario, `ERRO: ${err.message}`);
        if (err.pediu2FA) {
          marcar2FA(conta);
          resultado.push(`⏭ ${conta.usuario}: pediu 2FA (foi para o 2fa.txt)`);
        } else {
          resultado.push(`✘ ${conta.usuario}: ${err.message}`);
        }
        if (!browser.connected) throw new Error('O Edge foi fechado');
      }
      if (i < contas.length - 1) await esperar(3000 + Math.random() * 3000);
    }
  } finally {
    console.log('\n===== RESUMO =====');
    resultado.forEach((r) => console.log(r));
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error('\nERRO:', err.message);
  process.exitCode = 1;
});
