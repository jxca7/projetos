// Adiciona contas como "Testador do Instagram" no app da Meta (developers.facebook.com).
// Lê os @usuários do testadores.txt e o link da tela "Funções do app" do app_url.txt.
// Fluxo: Adicionar pessoas > Testador do Instagram > digita as contas > Adicionar.
//
// É o Facebook (site difícil e que não gosta de automação): tira print de cada passo em erros/.
// Faça login no Facebook na janela do Edge na 1ª vez (o perfil fica salvo).

const {
  fs, path, PASTA, esperar, pausaHumana, cliqueHumano, digitarHumano, log, lerTexto, lerProxy, salvarPrint, cookiesNaPasta,
} = require('./comum');
const conectar = require('./conectar'); // reaproveita o abrirEdge (perfil navegador_site)

const ARQ_URL = path.join(PASTA, 'app_url.txt');
const ARQ_LISTA = path.join(PASTA, 'testadores.txt');
const ESPERA_LOGIN = 5 * 60 * 1000;

function lerUsuarios() {
  // 1) se o testadores.txt tiver nomes, usa eles
  const txt = lerTexto(ARQ_LISTA);
  if (txt) {
    const lista = txt
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/^@/, ''))
      .filter((l) => l && !l.startsWith('#'));
    if (lista.length) return lista;
  }
  // 2) senão, pega os @usuários dos nomes dos arquivos da pasta cookies/ (nome do arquivo = usuário)
  return cookiesNaPasta()
    .map((f) => f.replace(/\.[^.]+$/, '').replace(/^@/, '').trim())
    .filter(Boolean);
}

// Clica num elemento cujo texto é exatamente 'texto'. Se dentroModal, procura só no role="dialog".
async function clicarTexto(page, texto, timeout = 12000, dentroModal = false) {
  const fim = Date.now() + timeout;
  while (Date.now() < fim) {
    const h = await page
      .evaluateHandle(
        (texto, dentroModal) => {
          const raiz = dentroModal ? document.querySelector('[role="dialog"]') || document : document;
          const norm = (t) => (t || '').toLowerCase().replace(/\s+/g, ' ').trim();
          const alvo = norm(texto);
          const vis = (e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const els = [...raiz.querySelectorAll('[role="button"], [role="radio"], a, button, div, span, label')];
          const cands = els.filter((e) => norm(e.innerText) === alvo && vis(e));
          const internos = cands.filter((e) => !cands.some((o) => o !== e && e.contains(o)));
          const clic = internos.filter((e) => e.closest('[role="button"], [role="radio"], a, button, label, [tabindex]'));
          const lista = clic.length ? clic : internos;
          return lista[lista.length - 1] || null;
        },
        texto,
        dentroModal,
      )
      .catch(() => null);
    const el = h && h.asElement();
    if (el) {
      await pausaHumana(300, 700);
      await cliqueHumano(page, el);
      return true;
    }
    await esperar(300);
  }
  return false;
}

async function limparCampo(page, campo) {
  await campo.click().catch(() => {});
  await page.keyboard.down('Control').catch(() => {});
  await page.keyboard.press('KeyA').catch(() => {});
  await page.keyboard.up('Control').catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
}

async function digitarConta(page, usuario) {
  const campo =
    (await page.$('[role="dialog"] input[role="combobox"]')) ||
    (await page.$('input[role="combobox"]')) ||
    (await page.$('[role="dialog"] input'));
  if (!campo) throw new Error('não achei a caixa de busca das contas');
  await cliqueHumano(page, campo);
  await digitarHumano(campo, usuario);

  // Espera aparecer um RESULTADO COM FOTO (avatar) no dropdown — só esses são contas válidas.
  // Conta sem caricatura não existe e, se virar chip, quebra o "Adicionar" inteiro.
  const fim = Date.now() + 7000;
  let clicou = false;
  while (Date.now() < fim && !clicou) {
    clicou = await page
      .evaluate((usuario) => {
        const u = usuario.toLowerCase();
        const ops = [...document.querySelectorAll('[role="option"]')];
        const alvo = ops.find((o) => (o.innerText || '').toLowerCase().includes(u) && o.querySelector('img'));
        if (alvo) {
          alvo.click();
          return true;
        }
        return false;
      }, usuario)
      .catch(() => false);
    if (!clicou) await esperar(400);
  }

  if (!clicou) {
    // não achou a conta (sem caricatura): limpa o que foi digitado para NÃO virar chip inválido
    await limparCampo(page, campo);
    await pausaHumana(400, 800);
    return false;
  }
  await pausaHumana(700, 1300);
  return true;
}

async function rodar() {
  const url = lerTexto(ARQ_URL);
  if (!url || !/^https?:\/\//.test(url)) {
    throw new Error('Coloque o link da tela "Funções do app" (developers.facebook.com) no app_url.txt');
  }
  const usuarios = lerUsuarios();
  if (!usuarios.length) {
    throw new Error('Nenhum @usuário. Coloque os cookies na pasta cookies/ (nome do arquivo = usuário) ou liste no testadores.txt');
  }
  console.log(`${usuarios.length} conta(s) para adicionar como Testador do Instagram.`);

  const proxy = lerProxy();
  if (proxy) console.log(`Usando proxy ${proxy.servidor}`);
  const browser = await conectar.abrirEdge(proxy);
  const page = (await browser.pages())[0];
  if (proxy?.usuario) await page.authenticate({ username: proxy.usuario, password: proxy.senha || '' });

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});

    // Login do Facebook, se pedir (faça na mão na 1ª vez)
    if (await page.$('input[name="email"], input#email')) {
      console.log('>>> Faça login no Facebook nessa janela do Edge. Estou esperando...');
      await page.waitForFunction(() => !document.querySelector('input[name="email"]'), { timeout: ESPERA_LOGIN }).catch(() => {});
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
    }
    await pausaHumana(1500, 2500);
    await salvarPrint(page, 'testador_01_pagina');

    if (!(await clicarTexto(page, 'Adicionar pessoas', 15000))) {
      await salvarPrint(page, 'testador_erro_adicionar_pessoas');
      throw new Error('não achei o botão "Adicionar pessoas" (veja o print)');
    }
    await pausaHumana(1200, 2000);
    await salvarPrint(page, 'testador_02_modal');

    if (!(await clicarTexto(page, 'Testador do Instagram', 10000, true))) {
      await salvarPrint(page, 'testador_erro_papel');
      throw new Error('não achei a opção "Testador do Instagram" (veja o print)');
    }
    await pausaHumana(800, 1500);

    const ok = [];
    const falhou = [];
    for (const u of usuarios) {
      try {
        console.log(`  + @${u}`);
        if (await digitarConta(page, u)) ok.push(u);
        else falhou.push(u);
      } catch (e) {
        log(u, `erro ao digitar: ${e.message}`);
        falhou.push(u);
      }
    }
    await salvarPrint(page, 'testador_03_antes_adicionar');

    if (!ok.length) {
      console.log('Nenhuma conta válida (com caricatura) foi encontrada — não vou clicar em Adicionar.');
    } else if (!(await clicarTexto(page, 'Adicionar', 10000, true))) {
      await salvarPrint(page, 'testador_erro_botao_adicionar');
      throw new Error('não achei o botão "Adicionar" do modal (veja o print)');
    } else {
      await pausaHumana(2000, 3500);
      await salvarPrint(page, 'testador_04_fim');
    }

    console.log('\n===== RESUMO (testadores) =====');
    console.log(`Adicionados (chip apareceu): ${ok.length} — ${ok.map((u) => '@' + u).join(', ')}`);
    if (falhou.length) console.log(`Não entraram: ${falhou.length} — ${falhou.map((u) => '@' + u).join(', ')}`);
    console.log('\nConfira os prints na pasta erros/ (testador_*.png) para ver se deu certo.');
  } finally {
    await pausaHumana(1000, 2000);
    await browser.close().catch(() => {});
  }
}

module.exports = { rodar };
