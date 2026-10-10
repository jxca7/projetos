// Baixa todos os Reels de uma conta do Instagram direto pelo navegador.
//
// Como usar:
//   1. No Chrome, logado, abra a aba de Reels do perfil:
//        https://www.instagram.com/NOME_DA_CONTA/reels/
//   2. Aperte F12 e va na aba "Console".
//   3. Cole este codigo inteiro e aperte Enter.
//      (Na primeira vez o Chrome pede para digitar "allow pasting" e Enter.)
//   4. Quando o Chrome perguntar sobre "baixar varios arquivos", clique em Permitir.
//
// A lista de reels vem da propria pagina (rolando ate o fim), sem consultas
// extras ao Instagram. Para cada reel escolhe o arquivo video+audio de maior resolucao.
(async () => {
  const CONTA = location.pathname.split("/").filter(Boolean)[0];
  if (!CONTA || !location.pathname.includes("/reels")) {
    return console.error("Abra primeiro a aba de Reels do perfil: instagram.com/NOME_DA_CONTA/reels/");
  }
  const LIMITE = parseInt(prompt(`Quantos reels de @${CONTA} baixar? (vazio = TODOS)`, "")) || Infinity;

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || "";
  const H = { "x-ig-app-id": "936619743392459", "x-csrftoken": csrf, "x-requested-with": "XMLHttpRequest" };
  const api = async (url) => {
    for (let tentativa = 1; ; tentativa++) {
      const r = await fetch(url, { credentials: "include", headers: H });
      const texto = await r.text();
      if (r.status === 429 && tentativa <= 3) {
        console.warn("Instagram pediu para ir mais devagar, esperando 60s...");
        await esperar(60000);
        continue;
      }
      try {
        return JSON.parse(texto);
      } catch {
        throw new Error(`HTTP ${r.status}, resposta nao e JSON: ${texto.slice(0, 120).replace(/\s+/g, " ")}`);
      }
    }
  };

  // shortcode do link -> ID numerico do post (e so uma conversao de base64)
  const ALFA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const paraId = (code) => [...code.slice(0, 11)].reduce((n, c) => n * 64n + BigInt(ALFA.indexOf(c)), 0n).toString();

  // 1) rola a pagina ate o fim juntando os links dos reels
  console.log(`%cListando reels de @${CONTA} (rolando a pagina)...`, "font-weight:bold");
  const codigos = new Set();
  let semNovos = 0;
  while (codigos.size < LIMITE && semNovos < 4) {
    const antes = codigos.size;
    document.querySelectorAll('a[href*="/reel/"]').forEach((a) => {
      const m = a.getAttribute("href").match(/\/reel\/([A-Za-z0-9_-]+)/);
      if (m) codigos.add(m[1]);
    });
    semNovos = codigos.size > antes ? 0 : semNovos + 1;
    console.log(`  ${codigos.size} reels encontrados...`);
    window.scrollTo(0, document.body.scrollHeight);
    await esperar(2500);
  }
  const lista = [...codigos].slice(0, LIMITE);
  if (!lista.length) return console.error("Nenhum reel encontrado na pagina. Confira se esta na aba /reels/ do perfil.");
  console.log(`%c${lista.length} reels. Baixando...`, "font-weight:bold");

  // 2) baixa cada um na maior resolucao disponivel
  const falhas = [];
  for (let i = 0; i < lista.length; i++) {
    const code = lista[i];
    try {
      const m = (await api(`/api/v1/media/${paraId(code)}/info/`)).items?.[0];
      if (!m?.video_versions?.length) throw new Error("sem video");
      const melhor = [...m.video_versions].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      const data = new Date((m.taken_at || 0) * 1000).toISOString().slice(0, 10).replace(/-/g, "");
      const nome = `${CONTA}_${data}_${code}.mp4`;
      console.log(`[${i + 1}/${lista.length}] ${nome}  (${melhor.width}x${melhor.height})`);
      const blob = await (await fetch(melhor.url)).blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    } catch (e) {
      console.warn(`[${i + 1}/${lista.length}] Falhou ${code}: ${e.message}`);
      falhas.push(`https://www.instagram.com/reel/${code}/`);
    }
    await esperar(2500);
  }

  console.log(`%cPronto! ${lista.length - falhas.length} de ${lista.length} baixados (pasta Downloads).`,
              "font-weight:bold;color:green");
  if (falhas.length) console.log("Falharam:\n" + falhas.join("\n"));
})();
