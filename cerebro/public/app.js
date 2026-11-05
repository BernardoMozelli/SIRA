(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const api = async (url, corpo, metodo) => {
    const r = await fetch(url, corpo === undefined && !metodo ? { credentials: "same-origin" } : { method: metodo || "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    let j = {}; try { j = await r.json(); } catch {}
    return { status: r.status, ...j };
  };

  let conversaId = null, historico = [];
  async function iniciar() {
    const eu = await api("/api/eu");
    if (eu.status === 401) return mostrarLogin();
    mostrarApp(eu);
  }
  function mostrarLogin() { $("tela-app").hidden = true; $("tela-login").hidden = false; $("login").focus(); }
  async function mostrarApp(eu) {
    $("tela-login").hidden = true; $("tela-app").hidden = false;
    $("cliente").textContent = eu.cliente || ""; $("usuario").textContent = eu.nome || ""; quem = { usuario: eu.nome || eu.login, cliente: eu.cliente || "", modulos: eu.modulos || {} };
    const ini = (eu.nome || eu.login || "?").trim().split(/\s+/); $("avatar").textContent = ((ini[0] || "")[0] + (ini.length > 1 ? ini[ini.length - 1][0] : "")).toUpperCase();
    const podePerguntar = !!(eu.modulos && eu.modulos.perguntar);
    ["nova-pesquisa"].forEach((id) => { $(id).hidden = !podePerguntar; }); document.querySelector(".busca-hist").hidden = !podePerguntar; $("historico").hidden = !podePerguntar; $("btn-limpar-hist").hidden = !podePerguntar;
    conversaId = null; historico = []; if (podePerguntar) carregarHistorico();
    window.SIRA_ADM.iniciar(eu); // menu, permissões por módulo e troca obrigatória de senha
    pintarStatus(eu.conectorOnline);
    const cat = await api("/api/catalogo"); const chips = $("chips"); chips.textContent = "";
    for (const p of (cat.perguntas || []).slice(0, eu.sugestoes ?? 8)) { const b = el("button", "chip", p.exemplo); b.type = "button"; b.onclick = () => enviar(p.exemplo); chips.appendChild(b); }
    clearInterval(window.__st); window.__st = setInterval(async () => { const e = await api("/api/eu"); if (e.status === 200) pintarStatus(e.conectorOnline); }, 20000);
  }
  function pintarStatus(on) { $("status").classList.toggle("on", !!on); $("status-txt").textContent = on ? "Prefeitura conectada" : "Prefeitura offline"; }

  $("form-login").onsubmit = async (e) => {
    e.preventDefault(); $("erro-login").hidden = true;
    const r = await api("/api/login", { login: $("login").value.trim(), senha: $("senha").value });
    if (r.status !== 200) { $("erro-login").textContent = r.erro || "Falha ao entrar."; $("erro-login").hidden = false; return; }
    $("senha").value = ""; iniciar();
  };
  $("btn-sair").onclick = async () => { await api("/api/logout", {}); location.reload(); };

  function rolar() { const c = $("conversa"); c.scrollTop = c.scrollHeight; }
  function bolhaUsuario(t) { $("conversa").appendChild(el("div", "bolha-user", t)); }

  let quem = {};
  const toast = (icon, title) => Swal.fire({ toast: true, position: "bottom-end", icon, title, showConfirmButton: false, timer: 3200, timerProgressBar: true });

  // Tabela (no máximo 200 linhas na tela; Excel e PDF levam todas)
  function desenharTabela(tab, limite) {
    const t = el("table", "tabela"), h = el("tr");
    tab.colunas.forEach((col) => h.appendChild(el("th", col.numerica ? "num" : "", col.rotulo)));
    const thead = el("thead"); thead.appendChild(h); t.appendChild(thead);
    const tb = el("tbody"); tab.linhas.slice(0, limite || 200).forEach((l) => { const tr = el("tr"); l.forEach((v, i) => tr.appendChild(el("td", tab.colunas[i].numerica ? "num" : "", String(v)))); tb.appendChild(tr); });
    t.appendChild(tb); const w = el("div", "tabela-rolagem"); w.appendChild(t); return w;
  }
  function infoExtra(r) { const x = []; if (r.criterio) x.push(["Como foi calculado", r.criterio]); (r.premissas || []).forEach((p, i) => x.push([i ? "" : "Interpretação", p])); if (r.avisoPrivacidade) x.push(["Aviso", r.avisoPrivacidade]); if (quem.usuario) x.push(["Gerado por", quem.usuario]); return x; }

  async function fixarNoPainel(r) {
    const x = await Swal.fire({ ...SW, title: "Fixar no meu painel", text: "Dê um nome para este item. Ele será recalculado com os dados atuais toda vez que você abrir Meus painéis.", input: "text", inputValue: (r.fixar.titulo || r.pergunta.titulo || "").slice(0, 80), inputAttributes: { maxlength: 80, autocomplete: "off" }, showCancelButton: true, confirmButtonText: "Fixar", cancelButtonText: "Cancelar", inputValidator: (v) => (!String(v).trim() ? "Informe um nome." : undefined) });
    if (!x.isConfirmed) return;
    const g = await api("/api/paineis", { titulo: x.value, fonte: r.fixar, grafico: r.fixar.grafico });
    if (g.status !== 200) return aviso("error", "Não foi possível fixar", g.erro || "");
    toast("success", "Fixado em Meus painéis");
  }

  function cartaoResposta(r, perguntaTexto) {
    const c = el("article", "resp" + (r.ok ? "" : r.naoEntendi || r.precisaMotivo || r.precisaTermo ? "" : r.foraDeEscopo ? " fora" : " falha"));
    if (!r.ok) {
      c.appendChild(el("p", "texto", r.mensagem || r.erro || "Algo deu errado."));
      if (r.precisaTermo) {
        const b = el("button", "btn-sm", "Ler e aceitar o termo"); b.type = "button"; b.onclick = async () => {
          const m = await Swal.fire({ ...SW, icon: "warning", title: "Termo de responsabilidade", text: r.termo, input: "checkbox", inputPlaceholder: "Li e aceito o termo", showCancelButton: true, confirmButtonText: "Aceitar e continuar", cancelButtonText: "Cancelar", inputValidator: (v) => (v ? undefined : "Marque a caixa para aceitar.") });
          if (!m.isConfirmed) return; const x = await api("/api/listas/termo", {}); if (x.status !== 200) { Swal.fire({ ...SW, icon: "error", title: "Não foi possível registrar", text: x.erro || "" }); return; }
          enviar(perguntaTexto, { repetir: true });
        }; c.appendChild(el("div", "acoes-resp")).appendChild(b);
      }
      if (r.precisaMotivo) {
        const b = el("button", "btn-sm", "Informar o motivo e gerar a lista"); b.type = "button"; b.onclick = async () => {
          const m = await Swal.fire({ ...SW, icon: "info", title: "Lista com nomes de pessoas", showCancelButton: true, confirmButtonText: "Gerar lista", cancelButtonText: "Cancelar", focusConfirm: false,
            html: '<div class="swal-form"><p style="margin:0;font-size:14px;text-align:left">Esta lista mostra <b>nomes de pessoas</b> (dado pessoal sensível). O motivo e a confirmação de senha ficam registrados na auditoria.</p><div><label for="lm-motivo">Motivo do uso</label><textarea id="lm-motivo" maxlength="200" rows="3" placeholder="Ex.: busca ativa para atualização cadastral da equipe 3"></textarea></div><div><label for="lm-senha">Sua senha</label><input id="lm-senha" type="password" autocomplete="current-password"></div></div>',
            preConfirm: () => { const motivo = document.getElementById("lm-motivo").value.trim(), senha = document.getElementById("lm-senha").value; if (motivo.length < 10) return Swal.showValidationMessage("Descreva o motivo com pelo menos 10 caracteres."), false; if (!senha) return Swal.showValidationMessage("Confirme sua senha."), false; return { motivo, senha }; } });
          if (m.isConfirmed) enviar(perguntaTexto, { motivo: m.value.motivo, senha: m.value.senha, repetir: true });
        }; c.appendChild(el("div", "acoes-resp")).appendChild(b);
      }
      if (r.sugestoes && r.sugestoes.length) {
        const w = el("div", "chips"); w.style.marginTop = "12px";
        r.sugestoes.forEach((sg) => { const b = el("button", "chip", sg.exemplo); b.type = "button"; b.onclick = () => enviar(sg.exemplo); w.appendChild(b); });
        c.appendChild(w);
      }
      return c;
    }
    c.appendChild(el("p", "titulo", r.pergunta.titulo));
    c.appendChild(el("p", "texto", r.texto));
    let canvas = null, instancia = null;
    const tab = r.tabela;
    if (r.semLinhas) c.appendChild(el("p", "nota", `Esta lista tinha ${r.total ?? "vários"} cadastros. Por conter dados pessoais, as linhas não ficam salvas no histórico: pergunte novamente para gerar de novo.`));
    if (tab) {
      const corpoTab = el("div", "bloco-dados");
      if (r.grafico && tab.dados && tab.dados.length) {
        const barra = el("div", "alternar"); const area = el("div", "grafico-area"); canvas = el("canvas"); canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", "Gráfico: " + r.pergunta.titulo); area.appendChild(canvas);
        const g = { ...r.grafico }; const vista = { atual: "grafico" };
        const desenhar = () => { if (instancia) instancia.destroy(); area.style.height = window.SIRA_SAIDAS.altura(g, tab.dados.length) + "px"; instancia = window.SIRA_SAIDAS.grafico(canvas, g, tab.dados, tab.colunas); };
        const botoes = [["grafico", "Gráfico"], ["tabela", "Tabela"]].map(([id, t]) => { const b = el("button", "seg" + (id === "grafico" ? " ativo" : ""), t); b.type = "button"; b.onclick = () => { vista.atual = id; botoes.forEach((x) => x.classList.toggle("ativo", x === b)); area.hidden = id !== "grafico"; tabelaEl.hidden = id !== "tabela"; tipos.hidden = id !== "grafico"; if (id === "grafico") desenhar(); }; return b; });
        botoes.forEach((b) => barra.appendChild(b));
        const tipos = el("div", "alternar tipos"); [["barras", "Barras"], ["linhas", "Linhas"], ["pizza", "Pizza"]].forEach(([id, t]) => { const b = el("button", "seg" + (id === g.tipo ? " ativo" : ""), t); b.type = "button"; b.onclick = () => { g.tipo = id; [...tipos.children].forEach((x) => x.classList.toggle("ativo", x === b)); desenhar(); }; tipos.appendChild(b); });
        const tabelaEl = desenharTabela(tab); tabelaEl.hidden = true;
        const topo = el("div", "barra-dados"); topo.appendChild(barra); topo.appendChild(tipos); corpoTab.appendChild(topo); corpoTab.appendChild(area); corpoTab.appendChild(tabelaEl);
        setTimeout(desenhar, 0);
      } else {
        corpoTab.appendChild(desenharTabela(tab));
        if (tab.linhas.length > 200) corpoTab.appendChild(el("p", "nota", `Mostrando as primeiras 200 de ${tab.linhas.length.toLocaleString("pt-BR")} linhas. O Excel e o PDF trazem todas.`));
      }
      c.appendChild(corpoTab);
    }
    // ações: Excel, PDF, fixar
    if (tab || r.texto) {
      const ac = el("div", "acoes-resp");
      const mk = (rot, fn, cls) => { const b = el("button", "btn-sm" + (cls ? " " + cls : ""), rot); b.type = "button"; b.onclick = async () => { b.disabled = true; try { await fn(); } catch (e) { aviso("error", "Não foi possível gerar o arquivo", e.message); } b.disabled = false; }; ac.appendChild(b); };
      if (tab && !r.semLinhas) mk("Baixar Excel", async () => { const n = await window.SIRA_SAIDAS.excel({ titulo: r.pergunta.titulo, colunas: tab.colunas, linhas: tab.linhas, info: infoExtra(r) }); toast("success", "Arquivo gerado: " + n); });
      if (!r.semLinhas) mk("Baixar PDF", async () => { const n = window.SIRA_SAIDAS.pdf({ titulo: r.pergunta.titulo, texto: r.texto, colunas: tab && tab.colunas, linhas: tab && tab.linhas, canvas: canvas && instancia ? canvas : null, criterio: r.criterio, premissas: r.premissas, aviso: r.avisoPrivacidade, quem }); toast("success", "Arquivo gerado: " + n); });
      if (r.fixar && !r.lista && !r.semLinhas) mk("Fixar no painel", () => fixarNoPainel(r), "claro");
      if (ac.children.length) c.appendChild(ac);
    }
    const meta = el("div", "meta");
    if (r.avisoPrivacidade) meta.appendChild(el("div", "priv", r.avisoPrivacidade));
    if (r.premissas && r.premissas.length) {
      const d = el("details"); d.appendChild(el("summary", "", "Como interpretei sua pergunta"));
      const ul = el("ul"); r.premissas.forEach((p) => ul.appendChild(el("li", "", p))); d.appendChild(ul); meta.appendChild(d);
    }
    if (r.criterio) { const d = el("details"); d.appendChild(el("summary", "", "Como foi calculado")); d.appendChild(el("p", "criterio", r.criterio)); meta.appendChild(d); }
    if (r.sqlUsado) { const d = el("details"); d.appendChild(el("summary", "", "Ver a consulta usada")); const pre = el("pre", "sql", r.sqlUsado); d.appendChild(pre); d.appendChild(el("p", "criterio", "Montada pela IA e validada pelo SIRA antes de rodar: só lê as visões anonimizadas, em modo somente leitura.")); meta.appendChild(d); }
    if (r.ms != null) meta.appendChild(el("span", "", `Respondido em ${(r.ms / 1000).toFixed(1)} s`));
    c.appendChild(meta);
    return c;
  }

  let ocupado = false;
  async function enviar(texto, opc = {}) {
    texto = (texto || "").trim(); if (!texto || ocupado) return;
    ocupado = true; $("btn-enviar").disabled = true; $("boas-vindas").hidden = true; window.SIRA_ADM.verConversa();
    if (!opc.repetir) bolhaUsuario(texto); $("pergunta").value = "";
    const p = el("div", "pensando", "Consultando os dados"); $("conversa").appendChild(p); rolar();
    const r = await api("/api/perguntar", { texto, conversa: conversaId, motivo: opc.motivo, senha: opc.senha });
    p.remove();
    if (r.status === 401) { mostrarLogin(); }
    else {
      $("conversa").appendChild(cartaoResposta(r.status === 200 ? r : { ok: false, mensagem: r.erro || "Não foi possível responder agora." }, texto));
      if (r.status === 200 && r.conversa) { conversaId = r.conversa.id; $("titulo-conversa").textContent = r.conversa.titulo; carregarHistorico(); }
    }
    ocupado = false; $("btn-enviar").disabled = false; rolar(); $("pergunta").focus();
  }
  $("form-pergunta").onsubmit = (e) => { e.preventDefault(); enviar($("pergunta").value); };

  $("btn-auditoria").onclick = async () => {
    const r = await api("/api/auditoria"); const lista = $("auditoria-lista"); lista.textContent = "";
    (r.registros || []).forEach((x) => {
      const d = el("div", "audit-item");
      d.appendChild(el("div", "", x.pergunta_texto || x.evento || "—"));
      d.appendChild(el("small", "", `${new Date(x.ts).toLocaleString("pt-BR")} · ${x.usuario || ""} · ${x.pergunta || x.resultado || ""}`));
      lista.appendChild(d);
    });
    if (!lista.children.length) lista.appendChild(el("p", "", "Nenhum registro ainda."));
    $("painel-auditoria").hidden = false;
  };
  $("fechar-auditoria").onclick = () => { $("painel-auditoria").hidden = true; };

  // ---------- Histórico de pesquisas (barra lateral; privado de cada usuário) ----------
  const norm = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const ICO_EDIT = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
  const ICO_LIXO = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>';
  function grupoDe(ts) {
    const h = new Date(); h.setHours(0, 0, 0, 0); const dia = (Date.now() - ts) < 0 ? 0 : Math.floor((h.getTime() - new Date(ts).setHours(0, 0, 0, 0)) / 864e5);
    return dia <= 0 ? "Hoje" : dia === 1 ? "Ontem" : dia <= 7 ? "Últimos 7 dias" : dia <= 30 ? "Últimos 30 dias" : "Mais antigas";
  }
  async function carregarHistorico() { const r = await api("/api/historico"); if (r.status === 200) { historico = r.conversas || []; desenharHistorico(); } }
  function desenharHistorico() {
    const box = $("historico"); box.textContent = ""; const q = norm($("busca-hist").value);
    const lista = historico.filter((c) => !q || norm(c.titulo).includes(q));
    if (!lista.length) { box.appendChild(el("p", "vazio", historico.length ? "Nenhuma pesquisa encontrada." : "Suas pesquisas aparecem aqui. Só você as vê.")); return; }
    let atual = null;
    for (const c of lista) {
      const g = grupoDe(c.atualizada); if (g !== atual) { box.appendChild(el("h4", "", g)); atual = g; }
      const item = el("div", "hist-item" + (c.id === conversaId ? " ativo" : ""));
      const b = el("button", "hist-btn", c.titulo); b.type = "button"; b.title = c.titulo; b.onclick = () => abrirConversa(c.id); item.appendChild(b);
      const ac = el("div", "hist-acoes");
      const mk = (cls, ico, rot, fn) => { const x = el("button", "icone-btn " + cls); x.type = "button"; x.innerHTML = ico; x.title = rot; x.setAttribute("aria-label", rot + ": " + c.titulo); x.onclick = (e) => { e.stopPropagation(); fn(); }; ac.appendChild(x); };
      mk("", ICO_EDIT, "Renomear", () => renomearConversa(c)); mk("perigo", ICO_LIXO, "Excluir", () => excluirConversa(c));
      item.appendChild(ac); box.appendChild(item);
    }
  }
  function limparTela() { const c = $("conversa"); [...c.children].forEach((n) => { if (n.id !== "boas-vindas") n.remove(); }); }
  function fecharGaveta() { $("lateral").classList.remove("aberta"); $("lat-sombra").hidden = true; }
  async function abrirConversa(id) {
    const r = await api("/api/historico/" + encodeURIComponent(id)); fecharGaveta();
    if (r.status !== 200 || !r.conversa) { await carregarHistorico(); return aviso("error", "Não foi possível abrir", r.erro || "Essa pesquisa não existe mais."); }
    window.SIRA_ADM.verConversa(); limparTela(); $("boas-vindas").hidden = true; conversaId = r.conversa.id; $("titulo-conversa").textContent = r.conversa.titulo;
    for (const m of r.conversa.mensagens) $("conversa").appendChild(m.r === "u" ? el("div", "bolha-user", m.texto) : cartaoResposta(m.resp || { ok: false, mensagem: "" }, ""));
    desenharHistorico(); $("conversa").scrollTop = $("conversa").scrollHeight;
  }
  function novaPesquisa() { fecharGaveta(); window.SIRA_ADM.verConversa(); conversaId = null; limparTela(); $("boas-vindas").hidden = false; $("titulo-conversa").textContent = "Nova pesquisa"; desenharHistorico(); $("pergunta").focus(); }
  async function renomearConversa(c) {
    const r = await Swal.fire({ ...SW, title: "Renomear pesquisa", input: "text", inputValue: c.titulo, inputAttributes: { maxlength: 60, autocomplete: "off" }, showCancelButton: true, confirmButtonText: "Salvar", cancelButtonText: "Cancelar", inputValidator: (v) => (!String(v).trim() ? "Informe um título." : undefined) });
    if (!r.isConfirmed) return;
    const x = await api("/api/historico/" + encodeURIComponent(c.id), { titulo: r.value }, "PUT"); if (x.status !== 200) return aviso("error", "Não foi possível renomear", x.erro || "");
    if (c.id === conversaId) $("titulo-conversa").textContent = x.conversa.titulo; await carregarHistorico();
  }
  async function excluirConversa(c) {
    const r = await Swal.fire({ ...SW, icon: "warning", title: "Excluir esta pesquisa?", text: `"${c.titulo}" será apagada do seu histórico. Isso não pode ser desfeito.`, showCancelButton: true, confirmButtonText: "Excluir", cancelButtonText: "Cancelar" });
    if (!r.isConfirmed) return; const x = await api("/api/historico/" + encodeURIComponent(c.id), undefined, "DELETE"); if (x.status !== 200) return aviso("error", "Não foi possível excluir", x.erro || "");
    if (c.id === conversaId) novaPesquisa(); await carregarHistorico();
  }
  $("nova-pesquisa").onclick = novaPesquisa;
  $("busca-hist").oninput = desenharHistorico;
  $("btn-limpar-hist").onclick = async () => {
    const r = await Swal.fire({ ...SW, icon: "warning", title: "Apagar todo o seu histórico?", text: "Todas as suas pesquisas salvas serão apagadas. Isso não pode ser desfeito e não afeta o histórico de mais ninguém.", showCancelButton: true, confirmButtonText: "Apagar tudo", cancelButtonText: "Cancelar" });
    if (!r.isConfirmed) return; const x = await api("/api/historico", undefined, "DELETE"); if (x.status !== 200) return aviso("error", "Não foi possível apagar", x.erro || "");
    novaPesquisa(); await carregarHistorico();
  };
  $("lat-abrir").onclick = () => { $("lateral").classList.add("aberta"); $("lat-sombra").hidden = false; };
  $("lat-fechar").onclick = fecharGaveta; $("lat-sombra").onclick = fecharGaveta;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharGaveta(); });
  ["m-inicio", "btn-usuarios", "btn-config", "btn-auditoria", "btn-ia"].forEach((id) => $(id).addEventListener("click", fecharGaveta));

  // ---------- Meus painéis (itens fixados; recalculados a cada abertura) ----------
  let instPaineis = [];
  function limparPaineis() { instPaineis.forEach((i) => { try { i.destroy(); } catch {} }); instPaineis = []; }
  let dadosPaineis = [];
  async function carregarPaineis() {
    const grade = $("paineis-grade"); limparPaineis(); grade.textContent = ""; grade.appendChild(el("p", "vazio", "Calculando com os dados atuais…"));
    const r = await api("/api/paineis/dados");
    grade.textContent = ""; dadosPaineis = [];
    if (r.status !== 200) { grade.appendChild(el("p", "vazio", r.erro || "Não foi possível carregar o painel.")); return; }
    if (!r.itens.length) { const v = el("div", "paineis-vazio"); v.appendChild(el("p", "texto", "Você ainda não fixou nada.")); v.appendChild(el("p", "nota", "Faça uma pergunta e use o botão \"Fixar no painel\" na resposta. Gráficos e números fixados aparecem aqui, sempre atualizados.")); grade.appendChild(v); return; }
    for (const it of r.itens) grade.appendChild(cartaoPainel(it));
  }
  function cartaoPainel(it) {
    const c = el("article", "item-painel" + (it.tabela && it.grafico && it.grafico.tipo !== "nenhum" ? " largo" : ""));
    const topo = el("div", "item-topo"); topo.appendChild(el("h3", "", it.titulo));
    const ac = el("div", "hist-acoes mostrar");
    const mk = (ico, rot, fn, cls) => { const x = el("button", "icone-btn " + (cls || "")); x.type = "button"; x.innerHTML = ico; x.title = rot; x.setAttribute("aria-label", rot + ": " + it.titulo); x.onclick = fn; ac.appendChild(x); };
    mk(ICO_EDIT, "Renomear", async () => {
      const q = await Swal.fire({ ...SW, title: "Renomear item", input: "text", inputValue: it.titulo, inputAttributes: { maxlength: 80, autocomplete: "off" }, showCancelButton: true, confirmButtonText: "Salvar", cancelButtonText: "Cancelar", inputValidator: (v) => (!String(v).trim() ? "Informe um nome." : undefined) });
      if (!q.isConfirmed) return; const x = await api("/api/paineis/" + encodeURIComponent(it.id), { titulo: q.value }, "PUT"); if (x.status !== 200) return aviso("error", "Não foi possível renomear", x.erro || ""); carregarPaineis();
    });
    mk(ICO_LIXO, "Remover do painel", async () => {
      const q = await Swal.fire({ ...SW, icon: "warning", title: "Remover do painel?", text: `"${it.titulo}" deixará de aparecer em Meus painéis. A pergunta original continua no seu histórico.`, showCancelButton: true, confirmButtonText: "Remover", cancelButtonText: "Cancelar" });
      if (!q.isConfirmed) return; const x = await api("/api/paineis/" + encodeURIComponent(it.id), undefined, "DELETE"); if (x.status !== 200) return aviso("error", "Não foi possível remover", x.erro || ""); carregarPaineis();
    }, "perigo");
    topo.appendChild(ac); c.appendChild(topo);
    const reg = { titulo: it.titulo, erro: it.erro || null, valorUnico: it.valorUnico || null, colunas: it.tabela && it.tabela.colunas, linhas: it.tabela && it.tabela.linhas, canvas: null };
    dadosPaineis.push(reg);
    if (it.erro) { c.appendChild(el("p", "erro-item", it.erro)); return c; }
    if (it.valorUnico) { c.appendChild(el("p", "numero-grande", it.valorUnico)); if (it.texto) c.appendChild(el("p", "nota", it.texto)); return c; }
    if (it.tabela && it.grafico && it.grafico.tipo !== "nenhum" && it.tabela.dados && it.tabela.dados.length) {
      const g = { ...it.grafico }; const area = el("div", "grafico-area"); area.style.height = window.SIRA_SAIDAS.altura(g, it.tabela.dados.length) + "px"; const cv = el("canvas"); area.appendChild(cv); c.appendChild(area);
      const tipos = el("div", "alternar tipos"); const desenhar = () => { if (reg.inst) reg.inst.destroy(); reg.inst = window.SIRA_SAIDAS.grafico(cv, g, it.tabela.dados, it.tabela.colunas); if (reg.inst) instPaineis.push(reg.inst); };
      [["barras", "Barras"], ["linhas", "Linhas"], ["pizza", "Pizza"]].forEach(([id, t]) => { const b = el("button", "seg" + (id === g.tipo ? " ativo" : ""), t); b.type = "button"; b.onclick = async () => { g.tipo = id; [...tipos.children].forEach((x) => x.classList.toggle("ativo", x === b)); desenhar(); api("/api/paineis/" + encodeURIComponent(it.id), { grafico: id }, "PUT"); }; tipos.appendChild(b); });
      c.appendChild(tipos); reg.canvas = cv; setTimeout(desenhar, 0);
    } else if (it.tabela) c.appendChild(desenharTabela(it.tabela, 30));
    return c;
  }
  window.addEventListener("sira-paineis", carregarPaineis);
  $("paineis-atualizar").onclick = carregarPaineis;
  $("paineis-pdf").onclick = () => { if (!dadosPaineis.length) return aviso("info", "Nada para baixar", "Fixe pelo menos um item no painel primeiro."); try { const n = window.SIRA_SAIDAS.pdfPainel(dadosPaineis, quem); toast("success", "Arquivo gerado: " + n); } catch (e) { aviso("error", "Não foi possível gerar o PDF", e.message); } };

  // ---------- Configuração de IA (somente papel "super") ----------
  const SW = { buttonsStyling: false, customClass: { popup: "swal-popup", title: "swal-title", htmlContainer: "swal-text", confirmButton: "swal-btn-confirm", cancelButton: "swal-btn-cancel" } };
  const aviso = (icon, title, text) => Swal.fire({ ...SW, icon, title, text, confirmButtonText: "Ok" });
  let iaEstado = null, iaSel = "anthropic", iaModelos = [];

  async function iaCarregar() { const r = await api("/api/ia"); if (r.status === 200) iaEstado = r; return r; }
  function iaChamar(sub, corpo) { return api("/api/ia" + sub, corpo); }

  function iaDesenhar() {
    const box = $("ia-corpo"); box.textContent = ""; const e = iaEstado; const ativo = e.ativo && e.provedores[e.ativo];
    const st = el("div", "ia-status" + (ativo || e.ativoPorAmbiente ? " on" : ""));
    st.textContent = ativo ? `IA ativa: ${ativo.nome} — modelo ${ativo.modelo || ativo.modeloPadrao}.`
      : e.ativoPorAmbiente ? "IA local ativa pela configuração do servidor (variável SIRA_OLLAMA_URL)."
      : "Nenhuma IA ativa. O SIRA funciona normalmente só com as regras; a IA ajuda a entender períodos e filtros que as regras não reconhecem.";
    box.appendChild(st);
    box.appendChild(el("div", "ia-aviso", "A IA só é consultada quando a pergunta tem um período, unidade ou equipe que as regras não entenderam. Ela recebe apenas o texto da pergunta (números de documento, telefone e e-mail são mascarados) e as listas de unidades e equipes. Nunca recebe dado de paciente nem resultado de consulta."));

    const lista = el("div", "ia-lista");
    Object.values(e.provedores).forEach((p) => {
      const b = el("button", "ia-item" + (p.id === iaSel ? " sel" : "")); b.type = "button";
      b.appendChild(el("b", "", p.nome));
      const selo = el("span", "selo" + (e.ativo === p.id ? " ativa" : p.temChave || !p.precisaChave ? " ok" : ""), e.ativo === p.id ? "Ativa" : !p.precisaChave ? "Sem chave necessária" : p.temChave ? `Chave cadastrada (…${p.chaveFim})` : "Sem chave");
      b.appendChild(selo);
      if (p.externo) b.appendChild(el("span", "selo ext", "Serviço externo (nuvem)"));
      b.onclick = () => { iaSel = p.id; iaModelos = []; iaDesenhar(); };
      lista.appendChild(b);
    });
    box.appendChild(lista);

    const p = e.provedores[iaSel], f = el("div", "ia-form");
    f.appendChild(el("h3", "", p.nome));
    const l1 = el("div", "ia-linha");
    const dm = el("div"); dm.appendChild(el("label", "", "Modelo")); const im = el("input"); im.id = "ia-modelo"; im.value = p.modelo || ""; im.placeholder = p.modeloPadrao || "nome do modelo"; im.setAttribute("list", "ia-modelos"); im.autocomplete = "off"; dm.appendChild(im);
    const dl = el("datalist"); dl.id = "ia-modelos"; iaModelos.forEach((m) => { const o = el("option"); o.value = m; dl.appendChild(o); }); dm.appendChild(dl);
    l1.appendChild(dm);
    const bm = el("button", "btn sec", "Buscar modelos"); bm.type = "button"; bm.onclick = iaBuscarModelos; l1.appendChild(bm); f.appendChild(l1);
    if (p.baseEditavel) { const d = el("div"); d.appendChild(el("label", "", p.obrigaBase ? "URL base (obrigatória)" : "URL base")); const ib = el("input"); ib.id = "ia-base"; ib.value = p.baseUrl || ""; ib.placeholder = p.baseUrlPadrao || "https://servidor/v1"; ib.autocomplete = "off"; d.appendChild(ib); f.appendChild(d); }
    if (p.precisaChave || p.id === "compativel") {
      const d = el("div"); d.appendChild(el("label", "", p.precisaChave ? "Chave de API" : "Chave de API (opcional)"));
      const ic = el("input"); ic.id = "ia-chave"; ic.type = "password"; ic.autocomplete = "new-password"; ic.placeholder = p.temChave ? `•••••••• (cadastrada, termina em ${p.chaveFim}) — deixe em branco para manter` : "cole a chave aqui"; d.appendChild(ic);
      d.appendChild(el("p", "ia-dica", "A chave é guardada cifrada no servidor e nunca volta para o navegador.")); f.appendChild(d);
    }
    const bt = el("div", "ia-botoes");
    const mk = (txt, cls, fn) => { const b = el("button", "btn " + cls, txt); b.type = "button"; b.onclick = fn; bt.appendChild(b); return b; };
    mk("Salvar e ativar", "", () => iaSalvar(true)); mk("Salvar", "sec", () => iaSalvar(false)); mk("Testar conexão", "sec", iaTestar);
    if (p.temChave) mk("Remover chave", "perigo", iaRemoverChave);
    if (e.ativo) mk("Desativar IA", "perigo", iaDesativar);
    f.appendChild(bt); box.appendChild(f);
    const u = e.uso; box.appendChild(el("div", "ia-uso", `Desde que o servidor iniciou: ${u.chamadas} chamada(s), ${u.falhas} falha(s)${u.ultimoErro ? ` — último erro: ${u.ultimoErro}` : ""}.`));
  }

  const iaCampos = () => ({ provedor: iaSel, modelo: ($("ia-modelo") || {}).value || "", baseUrl: $("ia-base") ? $("ia-base").value : undefined, chave: $("ia-chave") ? $("ia-chave").value : undefined });
  async function iaSalvar(ativar) {
    const r = await iaChamar("/salvar", { ...iaCampos(), ativar });
    if (r.status !== 200 || r.ok === false) return aviso("error", "Não foi possível salvar", r.erro || "Tente novamente.");
    iaEstado = r; iaDesenhar(); Swal.fire({ ...SW, icon: "success", title: ativar ? "Salvo e ativado" : "Salvo", timer: 1500, showConfirmButton: false });
  }
  async function iaTestar() {
    const c = iaCampos(); const s = await iaChamar("/salvar", c); if (s.status !== 200 || s.ok === false) return aviso("error", "Antes de testar", s.erro || "Verifique os campos.");
    iaEstado = s; Swal.fire({ ...SW, title: "Testando…", text: "Consultando o provedor.", allowOutsideClick: false, didOpen: () => Swal.showLoading(), showConfirmButton: false });
    const r = await iaChamar("/testar", { provedor: iaSel });
    if (r.ok) aviso("success", "Conexão funcionando", `Modelo ${r.modelo} respondeu em ${(r.ms / 1000).toFixed(1)} s.`); else aviso("error", "A conexão falhou", r.erro || "Sem detalhes.");
    await iaCarregar(); iaDesenhar();
  }
  async function iaBuscarModelos() {
    const c = iaCampos(); const s = await iaChamar("/salvar", { ...c, modelo: undefined }); if (s.status !== 200 || s.ok === false) return aviso("error", "Antes de buscar", s.erro || "Verifique os campos.");
    iaEstado = s; const r = await iaChamar("/modelos", { provedor: iaSel });
    if (!r.modelos) return aviso("error", "Não consegui listar os modelos", r.erro || "Sem detalhes.");
    iaModelos = r.modelos; const atual = ($("ia-modelo") || {}).value; iaDesenhar(); if (atual) $("ia-modelo").value = atual;
    aviso("success", `${r.modelos.length} modelo(s) encontrado(s)`, "Clique no campo Modelo para escolher na lista.");
  }
  async function iaRemoverChave() {
    const c = await Swal.fire({ ...SW, icon: "warning", title: "Remover a chave?", text: "A IA deste provedor será desativada e a chave apagada do servidor.", showCancelButton: true, confirmButtonText: "Remover", cancelButtonText: "Cancelar" });
    if (!c.isConfirmed) return; const r = await iaChamar("/remover-chave", { provedor: iaSel }); if (r.status === 200) { iaEstado = r; iaDesenhar(); }
  }
  async function iaDesativar() { const r = await iaChamar("/ativar", { provedor: null }); if (r.status === 200) { iaEstado = r; iaDesenhar(); } }
  $("btn-ia").onclick = async () => { const r = await iaCarregar(); if (r.status !== 200) return aviso("error", "Sem acesso", r.erro || ""); if (iaEstado.ativo) iaSel = iaEstado.ativo; iaDesenhar(); $("painel-ia").hidden = false; };
  $("fechar-ia").onclick = () => { $("painel-ia").hidden = true; };
  iniciar();
})();
