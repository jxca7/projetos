// Macro para convidar Testadores do Instagram no SEU painel da Meta.
//
// Repete, para cada @ da sua lista, a mesma sequência que você faria na mão:
//   1. clica em "Adicionar pessoas"
//   2. marca "Testador do Instagram"
//   3. digita o @ e seleciona a conta
//   4. clica em "Adicionar"
//
// Roda no seu navegador, com o seu login (você entra uma vez; a sessão fica
// salva numa pasta local). NÃO aceita o convite — isso é em cada conta.
//
// Observação honesta: automatizar a interface da Meta vai contra os termos de
// desenvolvedor deles; o risco é da sua conta de dev. Quando a Meta mudar o
// layout, os textos em TEXTOS (abaixo) precisam de ajuste.

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const APP_ID = process.env.APP_ID;              // obrigatório
const LISTA = process.env.LISTA || "contas.txt"; // um @ por linha
const PERFIL = process.env.PERFIL || ".sessao-meta"; // onde guarda o login
const MAX_POR_RUN = Number(process.env.MAX_POR_RUN || "0"); // 0 = todas
const PAUSA = Number(process.env.PAUSA || "1500"); // ms entre contas (interface respirar)
// Para usar o SEU Chrome em vez de um navegador próprio: abra o Chrome em modo
// de depuração e passe CDP=http://localhost:9222 (veja o README).
const CDP = process.env.CDP || "";

// Textos da interface. Se a tela mudar, ajuste AQUI.
const TEXTOS = {
  botaoAdicionarPessoas: "Adicionar pessoas",
  opcaoTesterInstagram: "Testador do Instagram",
  botaoAdicionarConfirmar: "Adicionar",
};

if (!APP_ID) {
  console.error("Faltou o APP_ID. Rode assim:\n  APP_ID=123456 node convidar.mjs");
  process.exit(1);
}

const ROLES_URL = `https://developers.facebook.com/apps/${APP_ID}/roles/roles/`;

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function lerContas() {
  const arq = path.resolve(LISTA);
  if (!fs.existsSync(arq)) {
    console.error(`Lista não encontrada: ${arq}`);
    console.error("Crie um arquivo com um @ por linha (só o nome de usuário).");
    process.exit(1);
  }
  return fs
    .readFileSync(arq, "utf8")
    .split("\n")
    .map((l) => l.trim().replace(/^@/, ""))
    .filter((l) => l && !l.startsWith("#"));
}

const feitasPath = () => path.resolve(PERFIL, "convidadas.txt");
function jaFeitas() {
  if (!fs.existsSync(feitasPath())) return new Set();
  return new Set(
    fs.readFileSync(feitasPath(), "utf8").split("\n").map((l) => l.trim()).filter(Boolean),
  );
}
const marcarFeita = (u) => fs.appendFileSync(feitasPath(), u + "\n");

function perguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(texto, (r) => { rl.close(); res(r); }));
}

async function main() {
  const todas = lerContas();
  const feitas = jaFeitas();
  const pendentes = todas.filter((u) => !feitas.has(u));
  const alvo = MAX_POR_RUN > 0 ? pendentes.slice(0, MAX_POR_RUN) : pendentes;

  console.log(`Lista: ${todas.length} · já convidadas: ${feitas.size} · a fazer agora: ${alvo.length}`);
  if (alvo.length === 0) {
    console.log("Nada pendente.");
    return;
  }

  fs.mkdirSync(path.resolve(PERFIL), { recursive: true });

  let browser = null;
  let ctx;
  let page;

  if (CDP) {
    // Conecta ao SEU Chrome, aberto em modo de depuração. Usa a janela e a
    // sessão que já estão lá — não fecha o seu navegador no fim.
    browser = await chromium.connectOverCDP(CDP);
    ctx = browser.contexts()[0] || (await browser.newContext());
    page =
      ctx.pages().find((p) => p.url().includes("developers.facebook.com")) ||
      ctx.pages()[0] ||
      (await ctx.newPage());
  } else {
    // Perfil de automação próprio: login salvo e reaproveitado.
    ctx = await chromium.launchPersistentContext(path.resolve(PERFIL), {
      headless: false,
      viewport: { width: 1280, height: 900 },
    });
    page = ctx.pages()[0] || (await ctx.newPage());
  }

  await page.goto(ROLES_URL, { waitUntil: "domcontentloaded" });

  if (!page.url().includes(`/apps/${APP_ID}/roles`)) {
    console.log("\n>> Faça login na Meta nesta janela (e passe o 2FA, se pedir).");
    console.log(">> Quando a página de Funções do app abrir, volte aqui e tecle Enter.");
    await perguntar("");
    await page.goto(ROLES_URL, { waitUntil: "domcontentloaded" });
  }

  const ok = [];
  const falhou = [];

  for (const [i, user] of alvo.entries()) {
    console.log(`\n[${i + 1}/${alvo.length}] @${user}`);
    try {
      await convidar(page, user);
      marcarFeita(user);
      ok.push(user);
      console.log("   convidado.");
    } catch (e) {
      falhou.push({ user, erro: e.message });
      const shot = path.resolve(PERFIL, `erro-${user}.png`);
      await page.screenshot({ path: shot }).catch(() => {});
      console.log(`   FALHOU: ${e.message} (print: ${shot})`);
      await page.keyboard.press("Escape").catch(() => {});
    }
    await espera(PAUSA);
  }

  console.log(`\n=== Fim ===\nConvidados: ${ok.length} · Falharam: ${falhou.length}`);
  for (const f of falhou) console.log(`  @${f.user}: ${f.erro}`);
  const restam = pendentes.length - ok.length;
  if (restam > 0) console.log(`\nFaltam ${restam}. Rode de novo para continuar de onde parou.`);

  // No modo CDP o navegador é seu: apenas desconecta, sem fechá-lo.
  if (CDP) await browser.close();
  else await ctx.close();
}

async function convidar(page, user) {
  // 1. Abrir o diálogo.
  await page.getByRole("button", { name: TEXTOS.botaoAdicionarPessoas }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 15000 });

  // 2. Marcar "Testador do Instagram".
  await dialog.getByText(TEXTOS.opcaoTesterInstagram, { exact: false }).first().click();

  // 3. Campo de busca do @ (surge depois de marcar a opção).
  const busca = dialog.getByRole("textbox").first();
  await busca.waitFor({ state: "visible", timeout: 10000 });
  await busca.click();
  await busca.fill(user);

  // Espera a sugestão carregar e seleciona a conta.
  const sugestao = page.getByText(new RegExp(`^${user}$`, "i")).last();
  try {
    await sugestao.waitFor({ state: "visible", timeout: 8000 });
    await sugestao.click();
  } catch {
    await busca.press("Enter"); // alguns layouts confirmam com Enter
  }

  // Confere que o @ entrou no campo antes de confirmar.
  if ((await dialog.getByText(user, { exact: false }).count()) === 0) {
    throw new Error("conta não encontrada na busca (confira o @ e se é profissional)");
  }

  // 4. Confirmar.
  const btn = dialog.getByRole("button", { name: TEXTOS.botaoAdicionarConfirmar, exact: true });
  await btn.waitFor({ state: "visible", timeout: 8000 });
  if (await btn.isDisabled()) throw new Error("botão Adicionar desabilitado (conta não selecionável)");
  await btn.click();

  // O diálogo fecha ao concluir.
  await dialog.waitFor({ state: "hidden", timeout: 15000 });
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
