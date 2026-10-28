// Tarefa "conectar": abre o site do site.txt no Edge, clica em "Conectar Instagram",
// entra na conta e passa pelas telas da Meta:
// Mudar > Criador de conteúdo > Avançar > Blog pessoal > Concluir > Continuar > Concluir > Permitir.
//
// Entra na conta de dois jeitos (ele escolhe sozinho):
//   1) COOKIE (recomendado): usa os cookies da pasta cookies/. Já entra logado, pula login e 2FA.
//   2) USUÁRIO E SENHA: se a pasta cookies/ estiver vazia, usa o contas.txt (usuario:senha).

const {
  fs, path, puppeteer, PASTA, PASTA_COOKIES, SUB_MORTOS, SUB_2FA,
  esperar, pausaHumana, cliqueHumano, digitarHumano, log, lerTexto,
  lerCookies, lerUsuarioSenha, cookiesFaltando, cookiesNaPasta, moverCookie, jaFeitas, marcarFeita,
  acharEdge, lerProxy, salvarPrint, argsJanela,
} = require('./comum');

const ARQ_CONTAS = path.join(PASTA, 'contas.txt');
const ARQ_FEITOS = path.join(PASTA, 'feitos.txt');
const ARQ_PASTA = path.join(PASTA, 'pasta.txt'); // (opcional) nome da pasta/grupo do site onde pôr as contas
const ESPERA_MANUAL = 5 * 60 * 1000; // tempo para você fazer algo na mão (login no site, código)

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
  { nome: 'Permitir', textos: ['Permitir', 'Allow', 'Allow access'] },
];

// ---------- contas ----------

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
      return { modo: 'senha', linha, usuario: linha.slice(0, i).trim(), senha: linha.slice(i + 1).trim() };
    })
    .filter((c) => c.usuario && c.senha && c.usuario !== 'usuario1');
}

// Mapa usuario->senha lido do contas.txt. Usado no modo cookie: a tela de "Conectar" pede
// a senha (não aproveita o cookie), então buscamos a senha da conta aqui pelo @usuário.
function lerMapaSenhas() {
  const mapa = new Map();
  if (!fs.existsSync(ARQ_CONTAS)) return mapa;
  for (const linha of (lerTexto(ARQ_CONTAS) || '').split(/\r?\n/)) {
    const l = linha.trim();
    if (!l || l.startsWith('#') || !l.includes(':')) continue;
    const i = l.indexOf(':');
    const usuario = l.slice(0, i).trim();
    const senha = l.slice(i + 1).trim();
    if (usuario && senha && usuario !== 'usuario1') mapa.set(usuario.toLowerCase().replace(/^@/, ''), senha);
  }
  return mapa;
}

// Cada arquivo da pasta cookies/ que ainda não foi conectado é uma conta
function lerContasCookie() {
  const feitos = jaFeitas('conectar');
  return cookiesNaPasta()
    .filter((f) => !feitos.has(f))
    .map((f) => ({ modo: 'cookie', arquivo: path.join(PASTA_COOKIES, f), base: f, usuario: f.replace(/\.[^.]+$/, '') }));
}

// Marca a conta conforme o modo
function marcarFeitaConta(conta) {
  if (conta.modo === 'cookie') marcarFeita('conectar', conta.base); // fica na pasta cookies/ para a outra tarefa
  else {
    const linhas = fs.readFileSync(ARQ_CONTAS, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== conta.linha);
    fs.writeFileSync(ARQ_CONTAS, linhas.join('\r\n'));
    fs.appendFileSync(ARQ_FEITOS, `${conta.linha}\r\n`);
  }
}
function marcar2FA(conta) {
  if (conta.modo === 'cookie') moverCookie(conta.base, SUB_2FA);
  else {
    const linhas = fs.readFileSync(ARQ_CONTAS, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== conta.linha);
    fs.writeFileSync(ARQ_CONTAS, linhas.join('\r\n'));
    fs.appendFileSync(path.join(PASTA, '2fa.txt'), `${conta.linha}\r\n`);
  }
}
function marcarMorta(conta) {
  if (conta.modo === 'cookie') moverCookie(conta.base, SUB_MORTOS);
  // no modo senha a conta continua no contas.txt para tentar de novo
}

// ---------- Edge (um perfil só, para manter o login do site) ----------

async function abrirEdge(proxy) {
  const args = ['--no-first-run', '--no-default-browser-check', ...argsJanela(), '--lang=pt-BR', '--accept-lang=pt-BR,pt'];
  if (proxy) args.push(`--proxy-server=${proxy.servidor}`);
  return puppeteer.launch({
    executablePath: acharEdge(),
    headless: false,
    defaultViewport: null,
    userDataDir: path.join(PASTA, 'navegador_site'),
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

// Coloca os cookies da conta no Edge e confere no instagram.com se logou de verdade
async function injetarCookies(page, conta, nome) {
  const cookies = lerCookies(conta.arquivo);
  const faltando = cookiesFaltando(cookies);
  if (faltando.length) log(nome, `AVISO: faltam ${faltando.join(' e ')} no cookie. Reexporte o cookie completo (Export as JSON no Cookie-Editor).`);

  await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.setCookie(...cookies);
  await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await pausaHumana(1500, 2500);

  const precisaLogin = await page
    .evaluate(() => !!document.querySelector('input[name="username"]') || /\/accounts\/login/.test(location.pathname))
    .catch(() => false);
  if (precisaLogin) {
    const motivo = faltando.length
      ? `faltou ${faltando.join(' e ')} no cookie (reexporte completo)`
      : 'cookie morto/expirado OU de outro IP (use proxy do mesmo IP/país no proxy.txt)';
    const err = new Error(`O cookie não logou no Instagram: ${motivo}.`);
    err.cookieMorto = true;
    throw err;
  }
  // Descobre o @usuário logado (serve para pegar a senha no contas.txt na hora de conectar)
  const usuarioReal = await page
    .evaluate(async () => {
      try {
        const r = await fetch('/api/v1/accounts/current_user/?edit=true', {
          headers: { 'x-ig-app-id': '936619743392459' },
          credentials: 'include',
        });
        const j = await r.json();
        return (j && j.user && j.user.username) || null;
      } catch {
        return null;
      }
    })
    .catch(() => null);
  if (usuarioReal) {
    conta.usuarioReal = usuarioReal;
    log(nome, `Cookie OK — logado como @${usuarioReal}.`);
  } else {
    log(nome, 'Cookie OK — entrou logado no Instagram.');
  }
}

// ---------- cliques ----------

async function acharTexto(page, textos) {
  const handle = await page.evaluateHandle((textos) => {
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

// ---------- etapas ----------

// site_login.txt: email:senha do site (o mesmo para todas as contas)
function lerLoginSite() {
  const linha = lerTexto(path.join(PASTA, 'site_login.txt'));
  if (!linha || !linha.includes(':') || linha.startsWith('seu@email')) return null;
  const i = linha.indexOf(':');
  return { email: linha.slice(0, i).trim(), senha: linha.slice(i + 1).trim() };
}

async function fecharPopup(page, nome) {
  if (await clicarTexto(page, TXT_AGORA_NAO, 4000)) {
    log(nome, 'Fechei o pop-up do site ("Agora não").');
    await pausaHumana(800, 1500);
  }
}

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

// Espera ir para o Instagram — na MESMA aba OU numa aba NOVA (alguns sites abrem o OAuth em outra aba).
// Devolve a página onde o Instagram abriu (ou null se não foi).
async function esperarInstagram(browser, page, site, timeout) {
  const origemSite = new URL(site).origin;
  const ehInstagram = async (p) => {
    try {
      const u = p.url();
      if (/instagram\.com|facebook\.com/.test(u)) return true;
      if (!u.startsWith(origemSite) && !/^(about:|chrome:)/.test(u)) return true;
      return !!(await p.$('input[name="username"], input[name="pass"]').catch(() => null));
    } catch {
      return false;
    }
  };
  const fim = Date.now() + timeout;
  while (Date.now() < fim) {
    if (await ehInstagram(page)) return page;
    for (const p of await browser.pages()) {
      if (p !== page && (await ehInstagram(p))) return p;
    }
    await esperar(250);
  }
  return null;
}

// Descobre o @usuário de uma conta (para casar com a lista do site)
function usuarioDaConta(conta) {
  if (conta.modo === 'senha') return (conta.usuario || '').replace(/^@/, '');
  let u = conta.usuarioReal;
  if (!u && conta.arquivo) {
    try {
      u = lerUsuarioSenha(conta.arquivo).usuario;
    } catch {}
  }
  return (u || conta.usuario || '').replace(/^@/, '');
}

// Depois de conectar, abre o lápis da pasta, marca as contas (pelo @usuário) e salva.
async function organizarPasta(browser, site, nomePasta, usuarios) {
  const page = (await browser.pages())[0] || (await browser.newPage());
  await page.goto(site, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
  await fecharPopup(page, 'pasta');
  await pausaHumana(800, 1500);

  // abre o lápis ("Editar pasta") da pasta com esse nome
  const abriu = await page.evaluate((alvoBruto) => {
    const alvo = alvoBruto.toLowerCase().trim();
    const norm = (t) => (t || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const bate = (t) => t === alvo || t.startsWith(alvo + ' ') || t.startsWith(alvo + '·') || t.startsWith(alvo + ' ·');
    const chip = [...document.querySelectorAll('button')].find((b) => bate(norm(b.innerText)));
    if (!chip) return false;
    const cont = chip.parentElement || document;
    let lapis = [...cont.querySelectorAll('button[title="Editar pasta"]')][0];
    if (!lapis && chip.nextElementSibling && chip.nextElementSibling.tagName === 'BUTTON') lapis = chip.nextElementSibling;
    if (!lapis) return false;
    lapis.click();
    return true;
  }, nomePasta);
  if (!abriu) throw new Error(`não achei a pasta "${nomePasta}" ou o lápis dela`);
  await pausaHumana(1200, 2200); // o modal abrir

  // marca cada @usuário na lista do modal
  const alvos = usuarios.map((u) => u.toLowerCase().replace(/^@/, '')).filter(Boolean);
  const naoAchei = await page.evaluate((alvos) => {
    const faltando = [];
    const labels = [...document.querySelectorAll('label')];
    for (const alvo of alvos) {
      const lab = labels.find((l) => {
        const sp = l.querySelector('span');
        const t = ((sp ? sp.innerText : l.innerText) || '').toLowerCase().replace(/^@/, '').trim();
        return t === alvo;
      });
      if (!lab) {
        faltando.push(alvo);
        continue;
      }
      const cb = lab.querySelector('input[type="checkbox"]');
      if (cb && !cb.checked) cb.click();
    }
    return faltando;
  }, alvos);
  await pausaHumana(500, 1000);

  // clica em "Salvar pasta"
  const salvou = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /salvar pasta/i.test(x.innerText || ''));
    if (!b) return false;
    b.click();
    return true;
  });
  if (!salvou) throw new Error('não achei o botão "Salvar pasta"');
  await pausaHumana(1500, 2500);
  return naoAchei;
}

// Devolve a página onde o Instagram abriu (pode ser a mesma aba ou uma aba nova).
async function clicarConectar(page, site, nome, browser) {
  browser = browser || page.browser();
  await page.goto(site, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await entrarNoSite(page, site, nome);
  await fecharPopup(page, nome);

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

  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    if (await clicarSegundoConectar(page, 10000)) {
      log(nome, 'Cliquei em "Conectar Instagram" (na janelinha).');
      const alvo = await esperarInstagram(browser, page, site, 15000);
      if (alvo) {
        if (alvo !== page) log(nome, 'O Instagram abriu numa aba nova. Seguindo nela.');
        return alvo;
      }
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

// Clica no botão "Continuar como @fulano" / "Continue as fulano" (entra pela sessão do cookie, sem senha)
async function clicarContinuarComo(page) {
  const handle = await page
    .evaluateHandle(() => {
      const re = /^(continuar como|continue as)\b/i;
      const els = [...document.querySelectorAll('button, [role="button"], a, div[tabindex]')];
      const el = els.find((e) => re.test((e.innerText || '').trim()) && e.offsetParent !== null);
      return el || null;
    })
    .catch(() => null);
  const el = handle && handle.asElement();
  if (!el) return false;
  await pausaHumana(400, 900);
  await cliqueHumano(page, el);
  return true;
}

async function fazerLogin(page, conta, nome) {
  // A tela de "Conectar Instagram" desse site SEMPRE pede usuário e senha (não aproveita cookie).
  // Então aqui a gente trata:
  //  - já é uma tela do fluxo (Mudar/Permitir): segue direto (raro)
  //  - campo de login: digita usuário e senha (no modo cookie, pega a senha do arquivo/contas.txt)
  const prazo = Date.now() + 30000;
  while (Date.now() < prazo) {
    if (await clicarContinuarComo(page)) {
      log(nome, 'Cliquei em "Continuar como" (entrou pela sessão do cookie).');
      return;
    }
    if ((await existeTexto(page, PASSOS[0].textos)) || (await existeTexto(page, PASSOS[PASSOS.length - 1].textos))) {
      log(nome, 'Já está logado, seguindo para as telas.');
      return;
    }
    const campoUsuario = await page.$('input[name="username"], input[name="email"]').catch(() => null);
    if (campoUsuario) {
      if (conta.modo === 'cookie') {
        // Entra com usuário e senha: primeiro do próprio arquivo da conta (formato com rótulos
        // Usuário:/Senha:), senão do contas.txt pelo @usuário da conta.
        let user = (conta.usuarioReal || conta.usuario || '').replace(/^@/, '');
        let senha = '';
        if (conta.arquivo) {
          const us = lerUsuarioSenha(conta.arquivo);
          if (us.senha) {
            senha = us.senha;
            if (us.usuario) user = us.usuario;
          }
        }
        if (!senha) senha = lerMapaSenhas().get(user.toLowerCase());
        if (senha) {
          log(nome, `A tela de "Conectar" pediu login; entrando com @${user} e senha...`);
          await loginComSenha(page, { modo: 'senha', usuario: user, senha }, nome, campoUsuario);
          return;
        }
        const err = new Error(
          `A tela de "Conectar" pediu senha e eu não a tenho. Coloque "${user}:SUA_SENHA" no contas.txt (uma linha por conta).`,
        );
        err.semSenha = true;
        throw err;
      }
      await loginComSenha(page, conta, nome, campoUsuario);
      return;
    }
    await esperar(300);
  }
  log(nome, 'Não apareceu login nem "Continuar como"; seguindo...');
}

// Faz o login digitando usuário e senha (modo contas.txt)
async function loginComSenha(page, conta, nome, campoUsuario) {
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
    const primeiro = PASSOS[0].textos;
    const permitir = PASSOS[PASSOS.length - 1].textos;
    if ((await existeTexto(page, primeiro)) || (await existeTexto(page, permitir))) break;
    await esperar(300);
  }
  log(nome, 'Login feito.');
}

async function esperarSumir(el, timeout = 6000) {
  const fim = Date.now() + timeout;
  while (Date.now() < fim) {
    const sumiu = await el.evaluate((e) => !e.isConnected || e.getBoundingClientRect().width === 0).catch(() => true);
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

    while (Date.now() - inicio < 30000) {
      el = await acharTexto(page, passo.textos).catch(() => null);
      if (el) {
        alvo = i;
        break;
      }
      // Tela extra "Conectar ao Facebook" (ou outro aviso): clica em "Agora não" e segue
      const agoraNao = await acharTexto(page, TXT_AGORA_NAO).catch(() => null);
      if (agoraNao) {
        await cliqueHumano(page, agoraNao);
        log(nome, 'Cliquei em "Agora não".');
        await esperar(700);
        continue;
      }
      if (passo.categoria && !buscou && Date.now() - inicio > 1500) {
        const busca = await page.$('input[type="search"], input[placeholder*="esquis"], input[placeholder*="earch"], input[placeholder*="usca"]');
        if (busca) {
          buscou = true;
          await busca.click({ clickCount: 3 });
          await digitarHumano(busca, passo.textos[0]);
          continue;
        }
      }
      const permitir = PASSOS[PASSOS.length - 1];
      if (passo !== permitir) {
        el = await acharTexto(page, permitir.textos).catch(() => null);
        if (el && !(await acharTexto(page, passo.textos).catch(() => null))) {
          alvo = PASSOS.length - 1;
          break;
        }
        el = null;
      }
      if (Date.now() - inicio > 2500) {
        for (let j = i + 1; j < PASSOS.length; j++) {
          el = await acharTexto(page, PASSOS[j].textos).catch(() => null);
          if (el) {
            alvo = j;
            break;
          }
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
    if (PASSOS[alvo].selecao || PASSOS[alvo].categoria) await pausaHumana(300, 600);
    else await esperarSumir(el);
    i = alvo + 1;
  }

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
    // Não coloca o cookie aqui (antes): ele é colocado na tela do Instagram do OAuth, dentro do fazerLogin.
    const alvo = (await clicarConectar(page, site, nome, browser)) || page;
    await fazerLogin(alvo, conta, nome);
    await passarTelas(alvo, nome);
    log(nome, 'Conectada ✔');
  } catch (err) {
    await salvarPrint(page, nome);
    throw err;
  }
}

async function rodar() {
  const site = lerTexto(path.join(PASTA, 'site.txt'));
  if (!site || !/^https?:\/\//.test(site)) throw new Error('Coloque o link do site no site.txt (começando com https://)');

  const arqLoginSite = path.join(PASTA, 'site_login.txt');
  if (!fs.existsSync(arqLoginSite)) fs.writeFileSync(arqLoginSite, 'seu@email.com:suasenha\r\n');
  if (!lerLoginSite()) console.log('AVISO: site_login.txt não preenchido; se o site pedir login, entre na mão.');

  // Se tiver cookies na pasta cookies/, usa cookie. Senão, usa usuario:senha do contas.txt.
  const contasCookie = lerContasCookie();
  let contas;
  if (contasCookie.length) {
    contas = contasCookie;
    console.log(`Conectar — modo COOKIE: ${contas.length} conta(s) a fazer.`);
  } else if (cookiesNaPasta().length) {
    console.log('Conectar: todas as contas da pasta cookies/ já foram conectadas (veja feitos_conectar.txt).');
    console.log('Para refazer, apague o feitos_conectar.txt.');
    return;
  } else {
    contas = lerContas();
    if (!contas.length) {
      console.log('Nada a fazer. Jogue cookies na pasta cookies/, OU preencha o contas.txt (usuario:senha).');
      return;
    }
    console.log(`Conectar — modo USUÁRIO E SENHA: ${contas.length} conta(s). (Dica: cookie na pasta cookies/ evita o 2FA.)`);
  }

  const proxy = lerProxy();
  if (proxy) console.log(`Usando proxy ${proxy.servidor}`);

  const browser = await abrirEdge(proxy);
  if (proxy?.usuario) {
    const page = (await browser.pages())[0];
    await page.authenticate({ username: proxy.usuario, password: proxy.senha || '' });
  }

  const resultado = [];
  const conectados = [];
  try {
    for (const [i, conta] of contas.entries()) {
      try {
        await conectarConta(browser, site, conta);
        marcarFeitaConta(conta);
        const u = usuarioDaConta(conta);
        if (u) conectados.push(u);
        resultado.push(`✔ ${conta.usuario}`);
      } catch (err) {
        log(conta.usuario, `ERRO: ${err.message}`);
        if (err.pediu2FA) {
          marcar2FA(conta);
          resultado.push(`⏭ ${conta.usuario}: pediu 2FA (${conta.modo === 'cookie' ? 'cookies/precisa_2fa/' : '2fa.txt'})`);
        } else if (err.cookieMorto) {
          marcarMorta(conta);
          resultado.push(`✘ ${conta.usuario}: cookie morto (cookies/mortos/)`);
        } else {
          resultado.push(`✘ ${conta.usuario}: ${err.message}`);
        }
        if (!browser.connected) throw new Error('O Edge foi fechado');
        try {
          const pages = await browser.pages();
          for (const p of pages.slice(1)) await p.close().catch(() => {});
          const page = (await browser.pages())[0];
          if (page) {
            await limparLoginInstagram(page).catch(() => {});
            await page.goto('about:blank', { timeout: 15000 }).catch(() => {});
          }
        } catch {}
      }
      if (i < contas.length - 1) await esperar(1200 + Math.random() * 1500);
    }

    // Organiza as contas conectadas numa pasta do site (se pasta.txt estiver preenchido)
    const nomePasta = lerTexto(ARQ_PASTA);
    if (nomePasta && conectados.length) {
      try {
        console.log(`\nColocando ${conectados.length} conta(s) na pasta "${nomePasta}"...`);
        const faltando = await organizarPasta(browser, site, nomePasta, conectados);
        if (faltando.length) console.log(`  (não achei na lista: ${faltando.map((f) => '@' + f).join(', ')})`);
        console.log('  Pasta salva.');
      } catch (e) {
        console.log(`  AVISO: não consegui organizar a pasta (${e.message}).`);
      }
    }
  } finally {
    console.log('\n===== RESUMO (conectar) =====');
    resultado.forEach((r) => console.log(r));
    await browser.close().catch(() => {});
  }
}

// Além do rodar(), exporto os passos para o fluxo "tudo de uma vez" (tudo.js) reaproveitar
module.exports = {
  rodar,
  abrirEdge,
  limparLoginInstagram,
  injetarCookies,
  clicarConectar,
  fazerLogin,
  passarTelas,
  organizarPasta,
  usuarioDaConta,
  lerLoginSite,
};
