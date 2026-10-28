// Tarefa "tudo de uma vez": para cada cookie da pasta cookies/, numa passada só:
//   1) coloca a conta logada (cookie),
//   2) aceita o convite do testador e troca a foto e a bio,
//   3) conecta a conta no site (vai direto para o "Permitir", porque já está logada).
// Só funciona por COOKIE (precisa do cookie para entrar e para conectar sem login/2FA).

const {
  path, PASTA, PASTA_COOKIES, SUB_MORTOS, SUB_2FA,
  esperar, log, lerTexto, cookiesNaPasta, moverCookie, jaFeitas, marcarFeita, lerProxy, salvarPrint, fs,
} = require('./comum');

const perfil = require('./perfil');
const conectar = require('./conectar');

async function fazerConta(browser, site, conta) {
  const nome = conta.usuario;
  const page = (await browser.pages())[0] || (await browser.newPage());
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

  try {
    // 1) entra logado pelo cookie (já confere se o cookie vale)
    await conectar.limparLoginInstagram(page);
    await conectar.injetarCookies(page, conta, nome);

    const avisos = [];

    // 2) convite do testador + foto/bio
    try {
      await perfil.aceitarConvitesTestador(page, nome);
    } catch (e) {
      avisos.push(`convite: ${e.message}`);
      log(nome, `AVISO: convite do testador falhou: ${e.message}`);
    }

    const foto = perfil.fotoDaConta(nome);
    const bio = perfil.bioDaConta(nome);
    try {
      await perfil.abrirEditar(page);
      if (foto) await perfil.trocarFoto(page, nome, foto);
      else log(nome, 'Sem foto na pasta, pulando a foto.');
      if (bio) await perfil.trocarBio(page, nome, bio);
      else log(nome, 'bio.txt vazio, pulando a bio.');
    } catch (e) {
      avisos.push(`foto/bio: ${e.message}`);
      log(nome, `AVISO: foto/bio falhou: ${e.message}`);
    }

    // 3) conectar no site (a conta já está logada: vai direto para o "Permitir")
    const alvo = (await conectar.clicarConectar(page, site, nome, browser)) || page;
    await conectar.fazerLogin(alvo, conta, nome);
    await conectar.passarTelas(alvo, nome);

    log(nome, 'Foto/bio + conexão OK ✔');
    return { avisos };
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
  if (!conectar.lerLoginSite()) console.log('AVISO: site_login.txt não preenchido; se o site pedir login, entre na mão.');

  const feitos = jaFeitas('tudo');
  const todos = cookiesNaPasta();
  const arquivos = todos.filter((f) => !feitos.has(f));
  if (!todos.length) {
    console.log('Nenhum cookie na pasta cookies/. Esse modo só funciona com cookie.');
    return;
  }
  if (!arquivos.length) {
    console.log(`Todas as ${todos.length} conta(s) já foram feitas (veja feitos_tudo.txt). Para refazer, apague o feitos_tudo.txt.`);
    return;
  }

  const contas = arquivos.map((f) => ({
    modo: 'cookie',
    arquivo: path.join(PASTA_COOKIES, f),
    base: f,
    usuario: f.replace(/\.[^.]+$/, ''),
  }));

  const proxy = lerProxy();
  if (proxy) console.log(`Usando proxy ${proxy.servidor}`);
  console.log(`Tudo de uma vez (foto/bio + conectar): ${contas.length} conta(s).\n`);

  const browser = await conectar.abrirEdge(proxy);
  if (proxy?.usuario) {
    const page = (await browser.pages())[0];
    await page.authenticate({ username: proxy.usuario, password: proxy.senha || '' });
  }

  const resultado = [];
  const conectados = [];
  try {
    for (const [i, conta] of contas.entries()) {
      try {
        const { avisos } = await fazerConta(browser, site, conta);
        // marca como feita nas três listas, para não repetir se rodar as opções separadas depois
        marcarFeita('tudo', conta.base);
        marcarFeita('perfil', conta.base);
        marcarFeita('conectar', conta.base);
        const u = conectar.usuarioDaConta(conta);
        if (u) conectados.push(u);
        resultado.push(`✔ ${conta.usuario}${avisos.length ? ` (avisos: ${avisos.join('; ')})` : ''}`);
      } catch (err) {
        log(conta.usuario, `ERRO: ${err.message}`);
        if (err.pediu2FA) {
          moverCookie(conta.base, SUB_2FA);
          resultado.push(`⏭ ${conta.usuario}: pediu 2FA (cookies/precisa_2fa/)`);
        } else if (err.cookieMorto) {
          moverCookie(conta.base, SUB_MORTOS);
          resultado.push(`✘ ${conta.usuario}: cookie morto (cookies/mortos/)`);
        } else {
          resultado.push(`✘ ${conta.usuario}: ${err.message} (fica para tentar de novo)`);
        }
        if (!browser.connected) throw new Error('O Edge foi fechado');
        try {
          const pages = await browser.pages();
          for (const p of pages.slice(1)) await p.close().catch(() => {});
          const page = (await browser.pages())[0];
          if (page) {
            await conectar.limparLoginInstagram(page).catch(() => {});
            await page.goto('about:blank', { timeout: 15000 }).catch(() => {});
          }
        } catch {}
      }
      if (i < contas.length - 1) await esperar(1200 + Math.random() * 1500);
    }

    // Organiza as contas conectadas numa pasta do site (se pasta.txt estiver preenchido)
    const nomePasta = lerTexto(path.join(PASTA, 'pasta.txt'));
    if (nomePasta && conectados.length) {
      try {
        console.log(`\nColocando ${conectados.length} conta(s) na pasta "${nomePasta}"...`);
        const faltando = await conectar.organizarPasta(browser, site, nomePasta, conectados);
        if (faltando.length) console.log(`  (não achei na lista: ${faltando.map((f) => '@' + f).join(', ')})`);
        console.log('  Pasta salva.');
      } catch (e) {
        console.log(`  AVISO: não consegui organizar a pasta (${e.message}).`);
      }
    }
  } finally {
    console.log('\n===== RESUMO (tudo de uma vez) =====');
    resultado.forEach((r) => console.log(r));
    await browser.close().catch(() => {});
  }
}

module.exports = { rodar };
