// Tarefa "foto/bio": para cada cookie da pasta cookies/, abre o Edge (um perfil separado
// por conta, na pasta navegador/), coloca os cookies, aceita o convite do testador e troca
// a foto e a bio. As contas que deram certo ficam anotadas em feitos_perfil.txt.

const {
  fs, path, puppeteer, PASTA, PASTA_COOKIES, SUB_MORTOS,
  esperar, pausaHumana, cliqueHumano, digitarHumano, log, lerTexto,
  lerCookies, cookiesFaltando, cookiesNaPasta, moverCookie, jaFeitas, marcarFeita,
  acharEdge, lerProxy,
} = require('./comum');

const PASTA_NAVEGADOR = path.join(PASTA, 'navegador');
const URL_EDITAR = 'https://www.instagram.com/accounts/edit/';
const EXT_FOTO = ['.jpg', '.jpeg', '.png'];

// Textos dos botões em português e inglês (o Instagram muda conforme o idioma da conta)
const TXT_ENVIAR = ['Enviar', 'Submit', 'Salvar', 'Save'];
const TXT_ALTERAR_FOTO = ['Alterar foto', 'Change photo', 'Alterar foto do perfil', 'Change profile photo'];
const TXT_CARREGAR_FOTO = ['Carregar foto', 'Upload photo', 'Upload Photo'];
const TXT_ERRO_SALVAR = ['problem saving', 'problema ao salvar', 'Try again later', 'Tente novamente mais tarde'];

// Convites de testador (Permissões do site do app > Apps e sites > Convites do testador)
const URL_APPS_E_SITES = 'https://www.instagram.com/accounts/manage_access/';
const TXT_PERMISSOES = ['Permissões do site do app', 'Website permissions', 'App and website permissions'];
const TXT_APPS_E_SITES = ['Apps e sites', 'Apps and websites'];
const TXT_CONVITES = ['Convites do testador', 'Convites de testador', 'Tester invites', 'Tester Invites'];
const TXT_ACEITAR = ['Aceitar', 'Accept'];
const TXT_REMOVER = ['Remover', 'Remove'];
const TXT_SEM_CONVITES = ['não tem convites', 'nenhum convite', 'no tester invites', "don't have any", 'não tem nenhum'];

const SELETOR_BIO = 'textarea#pepBio, textarea[name="biography"], textarea';

// ---------- foto e bio da conta ----------

function acharFoto(base) {
  for (const ext of EXT_FOTO) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  return null;
}
function primeiraImagem(pasta) {
  const img = fs.readdirSync(pasta).find((f) => EXT_FOTO.includes(path.extname(f).toLowerCase()));
  return img ? path.join(pasta, img) : null;
}
function fotoDaConta(nome) {
  return acharFoto(path.join(PASTA, 'fotos', nome)) || acharFoto(path.join(PASTA, 'foto')) || primeiraImagem(PASTA);
}
function bioDaConta(nome) {
  const bio = lerTexto(path.join(PASTA, 'bios', `${nome}.txt`)) ?? lerTexto(path.join(PASTA, 'bio.txt'));
  return bio ? bio.replace(/\r\n/g, '\n') : null;
}

// ---------- Edge (um perfil por conta) ----------

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

async function abrirEditar(page) {
  await page.goto(URL_EDITAR, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector(SELETOR_BIO, { visible: true, timeout: 20000 }).catch(() => {});
}

// ---------- cliques ----------

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
      await cliqueHumano(page, el);
      return true;
    }
    await esperar(500);
  }
  return false;
}

async function verificarLogado(page) {
  const url = page.url();
  if (url.includes('/accounts/login') || url.includes('/challenge') || url.includes('/suspended')) {
    const motivo = url.includes('/challenge')
      ? 'conta caiu em verificação (checkpoint)'
      : url.includes('/suspended')
        ? 'conta suspensa'
        : 'cookie expirado ou inválido (foi parar na tela de login)';
    const err = new Error(`Não entrou na conta: ${motivo}`);
    err.pular = true;
    err.morto = true; // cookie não serve mais: vai para cookies/mortos/
    throw err;
  }
}

async function textoDoErro(page) {
  return page.evaluate((textos) => {
    const corpo = document.body.innerText;
    const linha = corpo.split('\n').find((l) => textos.some((t) => l.toLowerCase().includes(t.toLowerCase())));
    return linha ? linha.trim() : null;
  }, TXT_ERRO_SALVAR);
}

// Acha o elemento visível mais "de dentro" cujo texto é exatamente um dos textos
async function acharTexto(page, textos) {
  const handle = await page.evaluateHandle((textos) => {
    const alvo = textos.map((t) => t.toLowerCase());
    const candidatos = [...document.querySelectorAll('body *')].filter((el) => {
      const t = (el.innerText || '').trim().toLowerCase();
      const r = el.getBoundingClientRect();
      return alvo.includes(t) && r.width > 0 && r.height > 0;
    });
    return candidatos.find((el) => !candidatos.some((o) => o !== el && el.contains(o))) || null;
  }, textos);
  return handle.asElement();
}

async function clicarTexto(page, textos, timeout = 10000) {
  const fim = Date.now() + timeout;
  while (Date.now() < fim) {
    const el = await acharTexto(page, textos).catch(() => null);
    if (el) {
      await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await pausaHumana(300, 700);
      await cliqueHumano(page, el);
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

// ---------- convite do testador ----------

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

  const ate = Date.now() + 6000;
  let temAceitar = false;
  let temRemover = false;
  while (Date.now() < ate && !temAceitar && !temRemover) {
    temAceitar = !!(await acharTexto(page, TXT_ACEITAR).catch(() => null));
    temRemover = !!(await acharTexto(page, TXT_REMOVER).catch(() => null));
    if (!temAceitar && !temRemover) await esperar(250);
  }
  if (temRemover && !temAceitar) {
    log(nome, 'Convite do testador já tinha sido aceito ("Remover"), indo para foto e bio.');
    return;
  }

  let aceitos = 0;
  while (aceitos < 20 && (await clicarTexto(page, TXT_ACEITAR, aceitos ? 2000 : 1000))) {
    aceitos++;
    await pausaHumana(1000, 2000);
    await clicarTexto(page, TXT_ACEITAR, 800);
    await pausaHumana(800, 1500);
  }

  if (aceitos) log(nome, 'Convites do testador aceitos.');
  else if (await paginaContem(page, TXT_SEM_CONVITES)) log(nome, 'Nenhum convite do testador pendente.');
  else log(nome, 'AVISO: não achei nenhum botão "Aceitar" nos convites do testador.');
}

// ---------- foto e bio ----------

async function lerBioAtual(page) {
  try {
    await abrirEditar(page);
    const campo = await page.waitForSelector(SELETOR_BIO, { timeout: 15000 });
    return await campo.evaluate((t) => t.value);
  } catch {
    return null;
  }
}

function avisarSemBio(nome) {
  process.stdout.write('\x07');
  log(nome, '⚠⚠⚠ ATENÇÃO: o perfil está SEM BIO ⚠⚠⚠');
}

async function trocarFoto(page, nome, arquivo) {
  const upload = page
    .waitForResponse((r) => /profile_pic|profile_picture|upload/i.test(r.url()) && r.request().method() === 'POST', { timeout: 6000 })
    .catch(() => null);

  const input = await page.$('input[type="file"][accept*="image"]');
  if (input) {
    await input.uploadFile(arquivo);
  } else {
    const seletor = page.waitForFileChooser({ timeout: 15000 });
    if (!(await clicarPorTexto(page, TXT_ALTERAR_FOTO))) throw new Error('Botão "Alterar foto" não encontrado');
    await pausaHumana(500, 1000);
    await clicarPorTexto(page, TXT_CARREGAR_FOTO, 2000);
    const chooser = await seletor;
    await chooser.accept([arquivo]);
  }

  const t0 = Date.now();
  await upload;
  const faltou = 2500 - (Date.now() - t0);
  if (faltou > 0) await esperar(faltou);
  log(nome, 'Foto trocada.');
}

async function trocarBio(page, nome, bio) {
  if ([...bio].length > 150) log(nome, `AVISO: a bio tem ${[...bio].length} caracteres, o limite do Instagram é 150.`);

  const campo = await page.waitForSelector(SELETOR_BIO, { timeout: 20000 });
  await cliqueHumano(page, campo);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await pausaHumana(400, 900);

  const linhas = bio.split('\n');
  for (let i = 0; i < linhas.length; i++) {
    if (linhas[i]) await page.keyboard.sendCharacter(linhas[i]);
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

  let msgErro = null;
  const ateErro = Date.now() + (resposta ? 1500 : 4000);
  while (!msgErro && Date.now() < ateErro) {
    msgErro = await textoDoErro(page).catch(() => null);
    if (!msgErro) await esperar(250);
  }
  if (msgErro || (resposta && !resposta.ok())) {
    const err = new Error(`O Instagram recusou salvar o perfil${msgErro ? `: "${msgErro}"` : ''}`);
    err.pular = true; // erro conhecido: anota e segue, mas o cookie continua vivo (não vai para mortos/)
    throw err;
  }

  if (resposta && resposta.ok()) {
    log(nome, 'Bio trocada.');
    return true;
  }

  await abrirEditar(page);
  const salva = await page.$eval(SELETOR_BIO, (t) => t.value).catch(() => null);
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

    const faltando = cookiesFaltando(cookies);
    if (faltando.length) {
      log(nome, `AVISO: faltam os cookies ${faltando.join(' e ')}. Com só o sessionid o Instagram costuma desconectar ao salvar.`);
    }

    log(nome, 'Colocando cookies...');
    await page.setCookie(...cookies);
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
    await page.setCookie(...cookies);
    await pausaHumana(500, 1000);

    await abrirEditar(page);
    await verificarLogado(page);
    await pausaHumana(500, 1000);

    let conviteErro = null;
    try {
      await aceitarConvitesTestador(page, nome);
    } catch (e) {
      conviteErro = e.message;
      log(nome, `AVISO: não consegui aceitar o convite: ${e.message}`);
    }
    await abrirEditar(page);

    if (!foto) log(nome, 'Nenhuma foto .jpg/.png na pasta, pulando a foto.');
    if (foto) await trocarFoto(page, nome, foto);

    let bioConfirmada = false;
    if (bio) bioConfirmada = await trocarBio(page, nome, bio);
    else log(nome, 'bio.txt vazio, pulando a bio.');

    const bioAtual = bioConfirmada ? bio : await lerBioAtual(page);
    const semBio = bioAtual !== null && !bioAtual.trim();
    if (semBio) avisarSemBio(nome);
    return { semBio, conviteErro };
  } catch (err) {
    const pages = await browser.pages().catch(() => []);
    if (pages.length) {
      fs.mkdirSync(path.join(PASTA, 'erros'), { recursive: true });
      await pages[pages.length - 1]
        .screenshot({ path: path.join(PASTA, 'erros', `${nome}-${Date.now()}.png`) })
        .catch(() => {});
    }
    log(nome, `ERRO: ${err.message}`);
    err.jaMostrado = true;
    if (err.pular) throw err;
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

async function rodar() {
  const todos = cookiesNaPasta();
  if (!todos.length) {
    console.log('Nenhum arquivo de cookies na pasta cookies/. Nada a fazer.');
    return;
  }
  const feitos = jaFeitas('perfil');
  const arquivos = todos.filter((f) => !feitos.has(f));
  if (!arquivos.length) {
    console.log(`Todas as ${todos.length} conta(s) já foram feitas (veja feitos_perfil.txt).`);
    console.log('Para refazer, apague o feitos_perfil.txt.');
    return;
  }

  acharEdge();
  const proxy = lerProxy();
  if (proxy) console.log(`Usando proxy ${proxy.servidor}`);
  console.log(`Foto/bio: ${arquivos.length} conta(s) a fazer.\n`);

  const resultado = [];
  const semBioLista = [];
  for (const [i, arquivo] of arquivos.entries()) {
    const nome = path.parse(arquivo).name;
    try {
      const { semBio, conviteErro } = await processarConta(nome, path.join(PASTA_COOKIES, arquivo), proxy);
      if (conviteErro) {
        resultado.push(`⚠ ${nome}: foto/bio OK, mas o convite do testador falhou: ${conviteErro}`);
      } else if (semBio) {
        semBioLista.push(nome);
        resultado.push(`⚠ ${nome}: terminou, mas o perfil está SEM BIO`);
      } else {
        marcarFeita('perfil', arquivo);
        log(nome, 'OK ✔');
        resultado.push(`✔ ${nome}`);
      }
    } catch (err) {
      if (!err.jaMostrado) log(nome, `ERRO: ${err.message}`);
      if (err.semBio) semBioLista.push(nome);
      if (err.morto) {
        moverCookie(arquivo, SUB_MORTOS);
        log(nome, 'Cookie foi para cookies/mortos/.');
      } else if (err.pular) {
        // erro conhecido (ex.: recusou salvar), mas o cookie ainda serve para a outra tarefa:
        // anota como feito aqui para não repetir, mas deixa na pasta cookies/.
        marcarFeita('perfil', arquivo);
      }
      resultado.push(`✘ ${nome}: ${err.message}${err.semBio ? ' (perfil SEM BIO)' : ''}`);
    }
    if (i < arquivos.length - 1) await esperar(3000 + Math.random() * 3000);
  }

  console.log('\n===== RESUMO (foto/bio) =====');
  resultado.forEach((r) => console.log(r));
  if (semBioLista.length) {
    process.stdout.write('\x07');
    console.log(`\n⚠ PERFIS SEM BIO (${semBioLista.length}): ${semBioLista.join(', ')}`);
    console.log('  Eles não foram marcados como feitos, então rodam de novo na próxima vez.');
  }
}

// Além do rodar(), exporto os passos para o fluxo "tudo de uma vez" (tudo.js) reaproveitar
module.exports = {
  rodar,
  aceitarConvitesTestador,
  trocarFoto,
  trocarBio,
  abrirEditar,
  lerBioAtual,
  avisarSemBio,
  fotoDaConta,
  bioDaConta,
};
