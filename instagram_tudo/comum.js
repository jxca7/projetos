// Coisas usadas pelas três tarefas (foto/bio, conectar, testar):
// pausas "humanas", clique e digitação humanos, leitura de cookies, achar o Edge e o proxy.

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PASTA = __dirname;
const PASTA_COOKIES = path.join(PASTA, 'cookies');
// Subpastas de cookies/ onde vão parar os cookies que não dá mais para usar
const SUB_MORTOS = 'mortos';
const SUB_2FA = 'precisa_2fa';

// ---------- pausas ----------
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
// VELOCIDADE: multiplica todas as pausas. 1 = devagar (mais "humano"), 0.3 = rápido.
const VELOCIDADE = 0.35;
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
    await page.mouse.move(x, y, { steps: 4 + Math.floor(Math.random() * 7) });
    await esperar(25 + Math.random() * 70);
    await page.mouse.down();
    await esperar(15 + Math.random() * 45);
    await page.mouse.up();
  } catch {
    await el.click().catch(() => {});
  }
}

// Digita letra por letra com ritmo variado e uma pausinha de vez em quando
async function digitarHumano(el, texto) {
  for (const letra of texto) {
    await el.type(letra);
    await esperar(Math.random() < 0.04 ? 120 + Math.random() * 180 : 12 + Math.random() * 45);
  }
}

// ---------- utilidades ----------

function log(conta, msg) {
  const hora = new Date().toLocaleTimeString('pt-BR');
  console.log(`[${hora}] [${conta}] ${msg}`);
}

function lerTexto(arquivo) {
  return fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, '').trim() : null;
}

// ---------- cookies ----------

// Lê o arquivo de cookies em qualquer um destes formatos:
//   - JSON (Cookie-Editor / EditThisCookie): [{"name": ..., "value": ...}]
//   - Netscape (cookies.txt): linhas separadas por TAB
//   - Texto simples: sessionid=...; csrftoken=...; ds_user_id=...
function lerListaCookies(arquivo) {
  const texto = fs.readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!texto) throw new Error('O arquivo de cookies está vazio');

  // Formato com rótulos (Usuário:/Senha:/Dispositivo:/Cookie: ...): usa só o que vem depois de "Cookie:"
  const mRotulo = texto.match(/^[ \t]*cookie[ \t]*:[ \t]*(.+)$/im);
  if (mRotulo) {
    return mRotulo[1]
      .split(/;\s*|\r?\n/)
      .map((p) => p.trim())
      .filter((p) => p.includes('='))
      .map((p) => {
        const i = p.indexOf('=');
        return { name: p.slice(0, i).trim(), value: p.slice(i + 1).trim(), domain: '.instagram.com' };
      });
  }

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

// Lê usuário e senha de um arquivo com rótulos (Usuário:/Senha:). Vazio se não achar.
function lerUsuarioSenha(arquivo) {
  let texto = '';
  try {
    texto = fs.readFileSync(arquivo, 'utf8').replace(/^﻿/, '');
  } catch {
    return { usuario: '', senha: '' };
  }
  const pega = (res) => {
    for (const re of res) {
      const m = texto.match(re);
      if (m && m[1].trim()) return m[1].trim();
    }
    return '';
  };
  const usuario = pega([/^[ \t]*usu[aá]rio[ \t]*:[ \t]*(.+)$/im, /^[ \t]*user(?:name)?[ \t]*:[ \t]*(.+)$/im]).replace(/^@/, '');
  const senha = pega([/^[ \t]*senha[ \t]*:[ \t]*(.+)$/im, /^[ \t]*pass(?:word)?[ \t]*:[ \t]*(.+)$/im]);
  return { usuario, senha };
}

// Quais cookies faltam para funcionar bem (além do sessionid)
function cookiesFaltando(cookies) {
  return ['ds_user_id', 'csrftoken'].filter((n) => !cookies.some((c) => c.name === n));
}

// Arquivos de cookies soltos na pasta cookies/ (ignora as subpastas mortos/, precisa_2fa/, etc.)
function cookiesNaPasta() {
  fs.mkdirSync(PASTA_COOKIES, { recursive: true });
  return fs
    .readdirSync(PASTA_COOKIES, { withFileTypes: true })
    .filter((d) => d.isFile() && /\.(json|txt)$/i.test(d.name) && !d.name.startsWith('.'))
    .map((d) => d.name);
}

// Move um cookie da pasta cookies/ para uma subpasta (mortos, precisa_2fa)
function moverCookie(arquivo, sub) {
  const dir = path.join(PASTA_COOKIES, sub);
  fs.mkdirSync(dir, { recursive: true });
  const de = path.join(PASTA_COOKIES, arquivo);
  const para = path.join(dir, arquivo);
  try {
    fs.renameSync(de, para);
  } catch {
    fs.copyFileSync(de, para);
    fs.unlinkSync(de);
  }
}

// ---------- "já fiz essa conta" por tarefa ----------
// Em vez de tirar o cookie da pasta quando dá certo (o que atrapalharia a outra tarefa),
// a gente anota o nome num arquivo feitos_<tarefa>.txt e pula na próxima vez.
// Para refazer todo mundo numa tarefa, é só apagar esse arquivo.

function arqFeitos(tarefa) {
  return path.join(PASTA, `feitos_${tarefa}.txt`);
}
function jaFeitas(tarefa) {
  const arq = arqFeitos(tarefa);
  if (!fs.existsSync(arq)) return new Set();
  return new Set(
    fs.readFileSync(arq, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
  );
}
function marcarFeita(tarefa, nome) {
  fs.appendFileSync(arqFeitos(tarefa), `${nome}\r\n`);
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

// Salva um print da tela na pasta erros/
async function salvarPrint(page, nome) {
  try {
    fs.mkdirSync(path.join(PASTA, 'erros'), { recursive: true });
    const print = path.join(PASTA, 'erros', `${nome}-${Date.now()}.png`);
    await page.screenshot({ path: print });
    log(nome, `Print salvo em ${print}`);
  } catch {}
}

module.exports = {
  fs,
  path,
  puppeteer,
  PASTA,
  PASTA_COOKIES,
  SUB_MORTOS,
  SUB_2FA,
  esperar,
  VELOCIDADE,
  pausaHumana,
  cliqueHumano,
  digitarHumano,
  log,
  lerTexto,
  lerListaCookies,
  lerCookies,
  lerUsuarioSenha,
  cookiesFaltando,
  cookiesNaPasta,
  moverCookie,
  jaFeitas,
  marcarFeita,
  acharEdge,
  lerProxy,
  salvarPrint,
};
