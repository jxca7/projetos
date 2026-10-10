// Baixa todos os Reels de uma conta do Instagram direto pelo navegador.
//
// Como usar:
//   1. Abra https://www.instagram.com (logado) no Chrome.
//   2. Aperte F12 e va na aba "Console".
//   3. Cole este codigo inteiro e aperte Enter.
//      (Na primeira vez o Chrome pede para digitar "allow pasting" e Enter.)
//   4. Quando o Chrome perguntar sobre "baixar varios arquivos", clique em Permitir.
//
// Roda com o seu login e a sua internet: o Instagram ve como navegacao normal.
// Para cada reel escolhe o arquivo com video+audio de maior resolucao.
(async () => {
  const CONTA = prompt("Nome da conta (sem @):", "")?.trim().replace(/^@/, "").replace(/\/$/, "");
  if (!CONTA) return;
  const lim = prompt("Quantos reels baixar? (deixe vazio para TODOS)", "");
  const LIMITE = parseInt(lim) || Infinity;

  const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || "";
  const H = { "x-ig-app-id": "936619743392459", "x-csrftoken": csrf, "x-requested-with": "XMLHttpRequest" };
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const api = async (url, opts = {}) => {
    for (let tentativa = 1; ; tentativa++) {
      const r = await fetch(url, { credentials: "include", ...opts, headers: { ...H, ...(opts.headers || {}) } });
      if (r.status === 429 && tentativa <= 3) {
        console.warn("Instagram pediu para ir mais devagar, esperando 60s...");
        await esperar(60000);
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
      return r.json();
    }
  };

  console.log(`%cProcurando @${CONTA}...`, "font-weight:bold");
  const perfil = await api(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(CONTA)}`);
  const user = perfil?.data?.user;
  if (!user) return console.error(`Conta @${CONTA} nao encontrada.`);

  // 1) lista os reels
  const reels = [];
  let maxId = "";
  while (reels.length < LIMITE) {
    const corpo = new URLSearchParams({ target_user_id: user.id, page_size: "12", include_feed_video: "true" });
    if (maxId) corpo.set("max_id", maxId);
    const d = await api("/api/v1/clips/user/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: corpo,
    });
    for (const it of d.items || []) if (it.media) reels.push(it.media);
    console.log(`  ${reels.length} reels listados...`);
    maxId = d.paging_info?.max_id;
    if (!d.paging_info?.more_available || !maxId) break;
    await esperar(1500);
  }
  reels.splice(LIMITE);
  console.log(`%c${reels.length} reels encontrados. Baixando...`, "font-weight:bold");

  // 2) baixa cada um na maior resolucao disponivel
  const falhas = [];
  for (let i = 0; i < reels.length; i++) {
    let m = reels[i];
    try {
      if (!m.video_versions?.length) {
        m = (await api(`/api/v1/media/${m.pk}/info/`)).items[0];
      }
      const melhor = [...m.video_versions].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      const data = new Date((m.taken_at || 0) * 1000).toISOString().slice(0, 10).replace(/-/g, "");
      const nome = `${CONTA}_${data}_${m.code}.mp4`;
      console.log(`[${i + 1}/${reels.length}] ${nome}  (${melhor.width}x${melhor.height})`);
      const blob = await (await fetch(melhor.url)).blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    } catch (e) {
      console.warn(`Falhou ${m.code}: ${e.message}`);
      falhas.push(`https://www.instagram.com/reel/${m.code}/`);
    }
    await esperar(2000);
  }

  console.log(`%cPronto! ${reels.length - falhas.length} de ${reels.length} baixados (pasta Downloads).`,
              "font-weight:bold;color:green");
  if (falhas.length) console.log("Falharam:\n" + falhas.join("\n"));
})();
