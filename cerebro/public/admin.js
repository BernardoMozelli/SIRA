// Painel administrativo do SIRA (padrão SIAG): menu, Usuários e permissões, Configurações, Minha senha e mostrar/ocultar senha.
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (url, metodo, corpo) => {
    const r = await fetch(url, { method: metodo || "GET", credentials: "same-origin", headers: corpo === undefined ? {} : { "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    let j = {}; try { j = await r.json(); } catch {}
    if (r.status === 401) location.reload();
    return { status: r.status, ...j };
  };
  const SW = { buttonsStyling: false, customClass: { popup: "swal-popup", title: "swal-title", htmlContainer: "swal-text", confirmButton: "swal-btn-confirm", cancelButton: "swal-btn-cancel" } };
  const aviso = (icon, title, text) => Swal.fire({ ...SW, icon, title, text, confirmButtonText: "Ok" });
  const ok = (title) => Swal.fire({ ...SW, icon: "success", title, timer: 1400, showConfirmButton: false });
  const confirmar = (title, text, botao = "Confirmar") => Swal.fire({ ...SW, icon: "warning", title, text, showCancelButton: true, confirmButtonText: botao, cancelButtonText: "Cancelar" }).then((r) => r.isConfirmed);
  let eu = null;

  // ---------- mostrar/ocultar senha (login e janelas) ----------
  const ICONE = $("tela-login").querySelector(".olho").innerHTML;
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".olho"); if (!b) return;
    const i = b.parentElement.querySelector("input"); const ver = i.type === "password";
    i.type = ver ? "text" : "password"; b.classList.toggle("on", ver); b.setAttribute("aria-label", ver ? "Ocultar senha" : "Mostrar senha"); b.title = ver ? "Ocultar senha" : "Mostrar senha"; i.focus();
  });
  const campoSenha = (id, rotulo, auto = "new-password", dica = "") => `<div><label for="${id}">${rotulo}</label><div class="campo-senha"><input id="${id}" type="password" autocomplete="${auto}" ${dica ? `placeholder="${esc(dica)}"` : ""}><button type="button" class="olho" aria-label="Mostrar senha" title="Mostrar senha">${ICONE}</button></div></div>`;

  // ---------- menus suspensos ----------
  const drops = [["m-admin", "d-admin"], ["m-usuario", "d-usuario"]];
  function fecharDrops() { drops.forEach(([b, d]) => { $(d).hidden = true; $(b).setAttribute("aria-expanded", "false"); }); }
  drops.forEach(([b, d]) => { $(b).onclick = (e) => { e.stopPropagation(); const abrir = $(d).hidden; fecharDrops(); $(d).hidden = !abrir; $(b).setAttribute("aria-expanded", String(abrir)); }; });
  document.addEventListener("click", fecharDrops);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharDrops(); });
  const PAINEIS = ["painel-inicio", "painel-paineis", "painel-auditoria", "painel-ia", "painel-usuarios", "painel-config"];
  const MENUS = ["m-inicio", "m-perguntar", "m-paineis", "m-admin"];
  function marcar(id) { MENUS.forEach((m) => $(m).classList.toggle("ativo", m === id)); }
  function esconderPaineis() { PAINEIS.forEach((p) => { $(p).hidden = true; }); }
  // "fecharPaineis" = ir para a conversa (Perguntar); "irInicio" = tela de cartões
  function fecharPaineis() { esconderPaineis(); marcar("m-perguntar"); }
  function irInicio() { esconderPaineis(); $("painel-inicio").hidden = false; marcar("m-inicio"); fecharDrops(); }
  function marcarAdmin() { marcar("m-admin"); }
  $("m-inicio").onclick = irInicio;
  $("m-logo").onclick = irInicio;
  $("m-perguntar").onclick = () => { fecharPaineis(); $("pergunta").focus(); };
  $("m-paineis").onclick = () => { esconderPaineis(); $("painel-paineis").hidden = false; marcar("m-paineis"); fecharDrops(); window.dispatchEvent(new Event("sira-paineis")); };
  // roda ANTES do clique de cada item do menu (captura): fecha os outros painéis e marca o menu
  $("d-admin").addEventListener("click", (e) => { if (e.target.closest("button")) { fecharPaineis(); marcarAdmin(); } }, true);
  $("d-usuario").addEventListener("click", (e) => { if (e.target.closest("button")) fecharDrops(); }, true);  // Minha senha / Sair não trocam a tela atual
  ["fechar-auditoria", "fechar-ia", "fechar-usuarios", "fechar-config"].forEach((id) => $(id).addEventListener("click", irInicio));

  // ---------- Início: um cartão por módulo a que o usuário tem acesso ----------
  const svg = (d) => `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONES = {
    perguntar: svg('<path d="M21 11.5a8.4 8.4 0 01-9 8.4 8.6 8.6 0 01-3.6-.8L3 21l1.9-5.4A8.4 8.4 0 1121 11.5z"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-.8.6-1.5 1-1.5 2M12 16.5h.01"/>'),
    usuarios: svg('<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8"/>'),
    config: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>'),
    auditoria: svg('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>'),
    ia: svg('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M19 15l.7 1.8L21.5 17.5l-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7L19 15z"/>'),
    senha: svg('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>'),
  };
  function desenharInicio(e) {
    const m = e.modulos || {}, h = new Date().getHours();
    $("inicio-saudacao").textContent = `${h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite"}, ${(e.nome || "").split(" ")[0]}!`;
    const abrirAdmin = (btn) => () => { fecharPaineis(); marcarAdmin(); $(btn).click(); };
    const lista = [
      m.perguntar && { ic: "perguntar", t: "Perguntar", d: "Pergunte em português e receba a resposta direto dos dados do e-SUS.", ir: () => { $("nova-pesquisa").click(); } },
      m.usuarios && { ic: "usuarios", t: "Usuários e permissões", d: "Crie usuários e escolha o que cada um pode acessar.", ir: abrirAdmin("btn-usuarios") },
      m.configuracoes && { ic: "config", t: "Configurações", d: "Dados do cliente, limites de uso e conexão com a prefeitura.", ir: abrirAdmin("btn-config") },
      m.auditoria && { ic: "auditoria", t: "Auditoria de perguntas", d: "Veja quem perguntou o quê, quando e o que o SIRA respondeu.", ir: abrirAdmin("btn-auditoria") },
      m.ia && { ic: "ia", t: "Inteligência artificial", d: "Escolha o provedor de IA e cadastre a chave de acesso.", ir: abrirAdmin("btn-ia") },
      { ic: "senha", t: "Minha senha", d: "Altere a senha de acesso da sua conta.", ir: () => minhaSenha(false) },
    ].filter(Boolean);
    const box = $("inicio-cartoes"); box.textContent = "";
    lista.forEach((c) => {
      const b = el("button", "cartao-mod"); b.type = "button";
      const ic = el("div", "ic"); ic.innerHTML = ICONES[c.ic]; b.appendChild(ic);
      b.appendChild(el("div", "t", c.t)); b.appendChild(el("div", "d", c.d));
      b.onclick = c.ir; box.appendChild(b);
    });
  }

  // o cabeçalho fica sempre acessível acima dos painéis
  const ajustaTopo = () => document.documentElement.style.setProperty("--topo-h", ($("tela-app").querySelector(".topo").offsetHeight) + "px");
  window.addEventListener("resize", ajustaTopo);

  // ---------- Minha senha ----------
  async function minhaSenha(obrigatoria) {
    for (;;) {
      const r = await Swal.fire({ ...SW, title: obrigatoria ? "Defina uma nova senha" : "Alterar minha senha",
        html: `<div class="swal-form">${obrigatoria ? '<p class="dica" style="margin:0;font-size:13px;color:#64748B">Sua senha foi definida por um administrador. Escolha uma senha só sua para continuar.</p>' : ""}${campoSenha("sn-atual", "Senha atual", "current-password")}${campoSenha("sn-nova", "Nova senha (mínimo 8 caracteres)")}${campoSenha("sn-conf", "Confirmar nova senha")}</div>`,
        showCancelButton: !obrigatoria, allowOutsideClick: !obrigatoria, allowEscapeKey: !obrigatoria, confirmButtonText: "Salvar senha", cancelButtonText: "Cancelar", focusConfirm: false,
        didOpen: () => $("sn-atual").focus(),
        preConfirm: async () => {
          const atual = $("sn-atual").value, nova = $("sn-nova").value, conf = $("sn-conf").value;
          if (!atual || !nova) return Swal.showValidationMessage("Preencha todos os campos."), false;
          if (nova.length < 8) return Swal.showValidationMessage("A nova senha precisa ter 8 ou mais caracteres."), false;
          if (nova !== conf) return Swal.showValidationMessage("A confirmação não confere com a nova senha."), false;
          const x = await api("/api/senha", "POST", { atual, nova });
          if (x.status !== 200) return Swal.showValidationMessage(x.erro || "Não foi possível alterar a senha."), false;
          return true;
        } });
      if (r.isConfirmed) { await ok("Senha alterada"); if (obrigatoria) location.reload(); return; }
      if (!obrigatoria) return;
    }
  }
  $("btn-senha").onclick = () => minhaSenha(false);

  // ---------- Usuários e permissões ----------
  let U = null;
  async function usuariosAbrir() {
    const r = await api("/api/usuarios"); if (r.status !== 200) return aviso("error", "Sem acesso", r.erro || "");
    U = r; usuariosDesenhar(); $("painel-usuarios").hidden = false;
  }
  function usuariosDesenhar() {
    const box = $("usuarios-corpo"); box.textContent = "";
    const topo = el("div", "barra"); topo.appendChild(el("p", "dica", `${U.usuarios.length} usuário(s). Perfis: Gestor (só pergunta), Administrador (gestão do cliente) e Administrador BeMo. Cada usuário pode ter exceções por módulo.`));
    const novo = el("button", "btn", "Novo usuário"); novo.type = "button"; novo.onclick = () => usuarioForm(null); topo.appendChild(novo); box.appendChild(topo);
    const t = el("table", "tabela-adm"), th = el("tr"); ["Usuário", "Perfil", "Módulos liberados", "Situação", ""].forEach((h) => th.appendChild(el("th", "", h)));
    const thead = el("thead"); thead.appendChild(th); t.appendChild(thead); const tb = el("tbody");
    U.usuarios.forEach((u) => {
      const tr = el("tr"), c1 = el("td"); c1.appendChild(el("b", "", u.nome)); c1.appendChild(el("br")); c1.appendChild(el("small", "", u.login + (u.login === eu.login ? " (você)" : ""))); tr.appendChild(c1);
      tr.appendChild(el("td", "", U.papeis[u.papel] || (u.papel === "super" ? "Administrador BeMo" : u.papel)));
      const c3 = el("td"), ch = el("div", "chips-mod"); Object.entries(u.modulos).filter(([, v]) => v).forEach(([m]) => ch.appendChild(el("span", "selo" + (m in u.excecoes ? " exc" : ""), m === "listas" && u.listas?.ate ? `Listas nominais (até ${new Date(u.listas.ate).toLocaleDateString("pt-BR")})` : U.modulos[m]))); if (!ch.children.length) ch.appendChild(el("small", "", "nenhum")); c3.appendChild(ch); tr.appendChild(c3);
      const c4 = el("td"); c4.appendChild(el("span", "selo " + (u.ativo ? "ok" : "off"), u.ativo ? "Ativo" : "Desativado")); if (u.trocarSenha) c4.appendChild(el("small", "", " · troca de senha pendente")); tr.appendChild(c4);
      const c5 = el("td"), ac = el("div", "acoes"); const b = (txt, cls, fn) => { const x = el("button", "btn peq " + cls, txt); x.type = "button"; x.onclick = fn; ac.appendChild(x); };
      b("Editar", "sec", () => usuarioForm(u)); if (["admin", "super"].includes(eu.papel)) b("Listas nominais", "sec", () => usuarioListas(u)); b("Nova senha", "sec", () => usuarioSenha(u)); if (u.login !== eu.login) { b("Encerrar sessões", "sec", () => usuarioSessoes(u)); b("Excluir", "perigo", () => usuarioExcluir(u)); }
      c5.appendChild(ac); tr.appendChild(c5); tb.appendChild(tr);
    });
    t.appendChild(tb); const w = el("div"); w.style.overflowX = "auto"; w.appendChild(t); box.appendChild(w);
  }
  async function usuariosRecarregar() { const r = await api("/api/usuarios"); if (r.status === 200) { U = r; usuariosDesenhar(); } }
  function usuarioForm(u) {
    const novo = !u, papeis = Object.entries(U.papeis);
    const mods = Object.entries(U.modulos).filter(([m]) => m !== "ia" && m !== "listas").map(([m, nome]) => `<label><span class="nome">${esc(nome)}</span><select data-mod="${m}"><option value="">Padrão do perfil</option><option value="1">Liberar</option><option value="0">Bloquear</option></select></label>`).join("");
    Swal.fire({ ...SW, title: novo ? "Novo usuário" : "Editar usuário", width: 560, showCancelButton: true, confirmButtonText: "Salvar", cancelButtonText: "Cancelar", focusConfirm: false,
      html: `<div class="swal-form">
        <div><label for="uf-nome">Nome completo</label><input id="uf-nome" value="${esc(u?.nome || "")}" autocomplete="off"></div>
        <div><label for="uf-login">Usuário (login)</label><input id="uf-login" value="${esc(u?.login || "")}" ${novo ? "" : "disabled"} autocomplete="off" placeholder="ex.: maria.silva"></div>
        <div><label for="uf-papel">Perfil</label><select id="uf-papel">${papeis.map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join("")}</select></div>
        ${novo ? campoSenha("uf-senha", "Senha inicial (mínimo 8 caracteres)") + '<p style="margin:-4px 0 0;font-size:12.5px;color:#64748B">A pessoa será obrigada a trocar essa senha no primeiro acesso.</p>' : ""}
        <div><label>Módulos (exceções ao perfil)</label><div class="mods" id="uf-mods">${mods}</div></div>
        ${novo ? "" : '<label style="display:flex;gap:8px;align-items:center;letter-spacing:0;text-transform:none;font-size:14px"><input type="checkbox" id="uf-ativo" style="width:auto"> Usuário ativo</label>'}
      </div>`,
      didOpen: () => { $("uf-papel").value = u?.papel || "gestor"; if (!novo) $("uf-ativo").checked = u.ativo; for (const s of document.querySelectorAll("#uf-mods select")) { const v = u?.excecoes?.[s.dataset.mod]; s.value = v === true ? "1" : v === false ? "0" : ""; } if (u?.login === eu.login) { $("uf-papel").disabled = true; $("uf-ativo").disabled = true; } (novo ? $("uf-nome") : $("uf-nome")).focus(); },
      preConfirm: async () => {
        const excecoes = {}; for (const s of document.querySelectorAll("#uf-mods select")) if (s.value) excecoes[s.dataset.mod] = s.value === "1";
        const corpo = { nome: $("uf-nome").value.trim(), papel: $("uf-papel").value, excecoes };
        if (novo) { corpo.login = $("uf-login").value.trim(); corpo.senha = $("uf-senha").value; } else corpo.ativo = $("uf-ativo").checked;
        if (corpo.nome.length < 3) return Swal.showValidationMessage("Informe o nome completo."), false;
        const x = novo ? await api("/api/usuarios", "POST", corpo) : await api("/api/usuarios/" + encodeURIComponent(u.login), "PUT", corpo);
        if (x.status !== 200) return Swal.showValidationMessage(x.erro || "Não foi possível salvar."), false; return true;
      } }).then(async (r) => { if (r.isConfirmed) { await usuariosRecarregar(); ok(novo ? "Usuário criado" : "Usuário atualizado"); } });
  }
  function usuarioListas(u) {
    const l = u.listas || {}, fmt = (t) => new Date(t).toLocaleDateString("pt-BR"), proprio = u.login === eu.login;
    const status = l.ativa ? `<b style="color:#047857">Autorizado até ${fmt(l.ate)}</b> (concedido por ${esc(l.por || "—")} em ${fmt(l.em)}). Termo de responsabilidade: ${l.termo ? "aceito" : "ainda não aceito"}.` : l.expirada ? `<b style="color:#B45309">Autorização expirada em ${fmt(l.ate)}.</b>` : "<b>Sem autorização.</b>";
    Swal.fire({ ...SW, title: "Listas nominais: " + u.nome, width: 520, showCancelButton: true, showDenyButton: !!l.ate, confirmButtonText: proprio ? "Fechar" : (l.ativa ? "Renovar autorização" : "Autorizar"), denyButtonText: "Revogar", cancelButtonText: "Cancelar", focusConfirm: false,
      customClass: { ...SW.customClass, denyButton: "swal-btn-cancel" },
      html: `<div class="swal-form"><p style="margin:0;font-size:14px;text-align:left">${status}</p>
        <p style="margin:0;font-size:13px;color:#64748B;text-align:left">Listas com nomes de cidadãos são dado pessoal sensível (LGPD). Além desta autorização, a pessoa precisa aceitar um termo de responsabilidade e, a cada lista, informar o motivo e confirmar a senha. Tudo fica na auditoria.</p>
        ${proprio ? '<p style="margin:0;font-size:13px;color:#B45309;text-align:left">Você não pode autorizar a si mesmo. Peça a outro administrador.</p>' : '<div><label for="ul-dias">Validade da autorização</label><select id="ul-dias"><option value="30">30 dias</option><option value="90" selected>90 dias</option><option value="180">180 dias</option></select></div>'}</div>`,
      preConfirm: async () => { if (proprio) return true; const x = await api(`/api/usuarios/${encodeURIComponent(u.login)}/listas`, "POST", { dias: Number($("ul-dias").value) }); if (x.status !== 200) return Swal.showValidationMessage(x.erro || "Não foi possível autorizar."), false; return true; },
      preDeny: async () => { const x = await api(`/api/usuarios/${encodeURIComponent(u.login)}/listas`, "DELETE"); if (x.status !== 200) return Swal.showValidationMessage(x.erro || "Não foi possível revogar."), false; return true; } })
      .then(async (r) => { if ((r.isConfirmed && !proprio) || r.isDenied) { await usuariosRecarregar(); ok(r.isDenied ? "Autorização revogada" : "Autorização concedida"); } });
  }
  function usuarioSenha(u) {
    Swal.fire({ ...SW, title: "Nova senha de " + u.nome, showCancelButton: true, confirmButtonText: "Redefinir", cancelButtonText: "Cancelar", focusConfirm: false,
      html: `<div class="swal-form">${campoSenha("us-nova", "Nova senha (mínimo 8 caracteres)")}<p style="margin:0;font-size:12.5px;color:#64748B">As sessões abertas dessa pessoa serão encerradas e ela precisará trocar a senha no próximo acesso.</p></div>`,
      preConfirm: async () => { const senha = $("us-nova").value; if (senha.length < 8) return Swal.showValidationMessage("A senha precisa ter 8 ou mais caracteres."), false;
        const x = await api(`/api/usuarios/${encodeURIComponent(u.login)}/senha`, "POST", { senha }); if (x.status !== 200) return Swal.showValidationMessage(x.erro || "Não foi possível redefinir."), false; return true; } })
      .then(async (r) => { if (r.isConfirmed) { await usuariosRecarregar(); ok("Senha redefinida"); } });
  }
  async function usuarioSessoes(u) { if (!(await confirmar("Encerrar as sessões?", `${u.nome} será desconectado(a) de todos os dispositivos.`, "Encerrar"))) return; const x = await api(`/api/usuarios/${encodeURIComponent(u.login)}/sessoes`, "POST", {}); x.status === 200 ? ok("Sessões encerradas") : aviso("error", "Não foi possível", x.erro); }
  async function usuarioExcluir(u) { if (!(await confirmar("Excluir usuário?", `${u.nome} (${u.login}) perderá o acesso. Para apenas bloquear, prefira desativar em Editar.`, "Excluir"))) return; const x = await api("/api/usuarios/" + encodeURIComponent(u.login), "DELETE"); if (x.status === 200) { await usuariosRecarregar(); ok("Usuário excluído"); } else aviso("error", "Não foi possível excluir", x.erro); }
  $("btn-usuarios").onclick = usuariosAbrir;

  // ---------- Configurações ----------
  let C = null;
  async function configAbrir() { const r = await api("/api/config"); if (r.status !== 200) return aviso("error", "Sem acesso", r.erro || ""); C = r; configDesenhar(); $("painel-config").hidden = false; }
  function configDesenhar() {
    const box = $("config-corpo"); box.textContent = ""; const c = C.config, L = C.limites;
    const f = el("form", "cartao"); f.appendChild(el("h3", "", "Dados do cliente e limites de uso"));
    const g = el("div", "campos");
    const campo = (id, rotulo, valor, extra = {}, dica) => { const d = el("div"); const l = el("label", "", rotulo); l.htmlFor = id; d.appendChild(l); const i = el("input"); i.id = id; i.value = valor; Object.assign(i, extra); d.appendChild(i); if (dica) d.appendChild(el("p", "dica", dica)); g.appendChild(d); return i; };
    campo("cf-cliente", "Nome do cliente", C.cliente || "", { maxLength: 120 }, "Aparece no topo do SIRA.");
    campo("cf-limite", "Perguntas por minuto", c.limite_perguntas_min, { type: "number", min: L.limite_perguntas_min[0], max: L.limite_perguntas_min[1] }, `Por usuário. Padrão ${C.padrao.limite_perguntas_min}; protege o conector.`);
    campo("cf-sessao", "Sessão (horas)", c.sessao_horas, { type: "number", min: L.sessao_horas[0], max: L.sessao_horas[1] }, `Padrão ${C.padrao.sessao_horas}; vale nos próximos logins.`);
    campo("cf-sug", "Sugestões iniciais", c.sugestoes_inicio, { type: "number", min: L.sugestoes_inicio[0], max: L.sugestoes_inicio[1] }, "Perguntas de exemplo na tela inicial (0 oculta).");
    f.appendChild(g);
    const bt = el("div", "ia-botoes"); const salvar = el("button", "btn", "Salvar configurações"); salvar.type = "submit"; const pad = el("button", "btn sec", "Restaurar padrões"); pad.type = "button"; bt.appendChild(salvar); bt.appendChild(pad); f.appendChild(bt);
    pad.onclick = () => { $("cf-limite").value = C.padrao.limite_perguntas_min; $("cf-sessao").value = C.padrao.sessao_horas; $("cf-sug").value = C.padrao.sugestoes_inicio; };
    f.onsubmit = async (e) => { e.preventDefault(); const x = await api("/api/config", "PUT", { cliente: $("cf-cliente").value, limite_perguntas_min: Number($("cf-limite").value), sessao_horas: Number($("cf-sessao").value), sugestoes_inicio: Number($("cf-sug").value) });
      if (x.status !== 200) return aviso("error", "Não foi possível salvar", x.erro || ""); C = x; configDesenhar(); $("cliente").textContent = x.cliente || ""; ok("Configurações salvas"); };
    box.appendChild(f);
    const s = el("div", "cartao"); s.appendChild(el("h3", "", "Situação da integração"));
    const lin = (a, b) => { const d = el("div", "somente"); d.appendChild(el("span", "", a)); d.appendChild(el("span", "", b)); s.appendChild(d); };
    lin("Conector da prefeitura", C.conectorOnline ? "Conectado" : "Offline"); lin("Versão do catálogo de perguntas", C.versaoCatalogo || "—");
    lin("Valores ocultados (privacidade)", `menores que ${C.minimoSupressao} (fixo, definido no conector)`); lin("Token do conector gerado em", C.tokenEm ? new Date(C.tokenEm).toLocaleString("pt-BR") : "—");
    box.appendChild(s);
    if (C.modoDireto) conexaoDesenhar(box);
    if (C.podeToken) {
      const t = el("div", "cartao"); t.appendChild(el("h3", "", "Token do conector (administrador BeMo)"));
      t.appendChild(el("p", "dica", "Gerar um novo token invalida o anterior: o conector da prefeitura precisa ser reiniciado com o novo valor (variável SIRA_TOKEN)."));
      const b = el("button", "btn perigo", "Gerar novo token"); b.type = "button"; b.style.alignSelf = "flex-start";
      b.onclick = async () => { if (!(await confirmar("Gerar novo token?", "O token atual deixará de valer e o conector ficará offline até ser reiniciado com o novo.", "Gerar novo token"))) return;
        const x = await api("/api/config/token", "POST", {}); if (x.status !== 200) return aviso("error", "Não foi possível", x.erro || "");
        Swal.fire({ ...SW, icon: "success", title: "Novo token gerado", html: `<p style="font-size:13px;color:#64748B;margin:0 0 10px">${esc(x.aviso)}</p><div class="token-caixa">${esc(x.token)}</div>`, confirmButtonText: "Copiei o token", allowOutsideClick: false }).then(() => configAbrir()); };
      t.appendChild(b); box.appendChild(t);
    }
  }
  // ---------- Conexão direta com o banco (modo direto) ----------
  async function conexaoDesenhar(box) {
    const r = await api("/api/conexao"); if (r.status !== 200) return;
    const k = el("form", "cartao"); k.appendChild(el("h3", "", "Conexão com o banco de dados do e-SUS"));
    k.appendChild(el("p", "dica", "Informe os dados do servidor PostgreSQL. Nada precisa ser instalado no banco: basta um usuário de leitura. Se a TI ainda não criou esse usuário, use \"Gerar script para a TI\". A senha fica cifrada neste servidor e nunca volta para a tela."));
    const g = el("div", "campos");
    const campo = (id, rotulo, valor, extra = {}, dica) => { const d = el("div"); const l = el("label", "", rotulo); l.htmlFor = id; d.appendChild(l); const i = el("input"); i.id = id; i.value = valor; Object.assign(i, extra); d.appendChild(i); if (dica) d.appendChild(el("p", "dica", dica)); g.appendChild(d); return i; };
    campo("db-host", "Servidor (IP ou nome)", r.host, { maxLength: 253, placeholder: "ex.: 10.0.0.15", autocomplete: "off" });
    campo("db-porta", "Porta", r.porta || 5432, { type: "number", min: 1, max: 65535 });
    campo("db-banco", "Nome do banco", r.banco, { maxLength: 63, placeholder: "ex.: esus", autocomplete: "off" });
    campo("db-usuario", "Usuário", r.usuario, { maxLength: 63, placeholder: "sira_ro", autocomplete: "off" });
    campo("db-senha", "Senha", "", { type: "password", maxLength: 200, autocomplete: "new-password", placeholder: r.temSenha ? "•••••••• (deixe em branco para manter)" : "" });
    k.appendChild(g);
    const modoTxt = r.modo === "embutido" ? " (modo somente leitura, sem instalação no banco)" : r.modo === "views" ? " (banco preparado com as views do SIRA)" : "";
    const sit = el("p", "dica", r.conectado ? "Situação: conectado ao banco" + modoTxt + "." + (r.desativadas?.length ? ` ${r.desativadas.length} pergunta(s) desativada(s) por falta de permissão.` : "") : r.configurado ? "Situação: salvo, mas sem conexão no momento." + (r.erro ? " " + r.erro : "") : "Situação: ainda não configurado."); k.appendChild(sit);
    const bt = el("div", "ia-botoes"); const testar = el("button", "btn sec", "Testar conexão"); testar.type = "button"; const salvar = el("button", "btn", "Salvar e conectar"); salvar.type = "submit"; const scr = el("button", "btn sec", "Gerar script para a TI"); scr.type = "button"; bt.appendChild(testar); bt.appendChild(salvar); bt.appendChild(scr);
    if (r.configurado) { const rem = el("button", "btn perigo", "Remover conexão"); rem.type = "button"; bt.appendChild(rem);
      rem.onclick = async () => { if (!(await confirmar("Remover a conexão?", "O SIRA deixa de consultar o banco até uma nova conexão ser salva.", "Remover"))) return; const x = await api("/api/conexao/remover", "POST", {}); if (x.status !== 200) return aviso("error", "Não foi possível remover", x.erro || ""); ok("Conexão removida"); configAbrir(); }; }
    k.appendChild(bt);
    const dados = () => ({ host: $("db-host").value, porta: Number($("db-porta").value), banco: $("db-banco").value, usuario: $("db-usuario").value, senha: $("db-senha").value });
    const senhaForte = () => { const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789", v = crypto.getRandomValues(new Uint32Array(22)); return Array.from(v, (x) => a[x % a.length]).join(""); };
    scr.onclick = async () => {
      const banco = $("db-banco").value.trim(); if (!banco) return aviso("warning", "Falta o nome do banco", "Preencha o campo Nome do banco antes de gerar o script.");
      const f = await Swal.fire({ ...SW, title: "Script de permissões para a TI", confirmButtonText: "Gerar e baixar", showCancelButton: true, cancelButtonText: "Cancelar", focusConfirm: false,
        html: `<div style="text-align:left;font-size:13px;color:#475569"><p style="margin:0 0 10px">A TI executa este arquivo <b>uma única vez</b> no banco <b>${esc(banco)}</b>, com um usuário administrador (pgAdmin, DBeaver ou psql). Ele cria um usuário de leitura e concede acesso apenas às colunas que o SIRA usa. Nome, CPF, endereço e telefone dos cidadãos ficam de fora. Nada é instalado e nenhum dado é alterado.</p>
        <label for="sc-u">Nome do usuário</label><input id="sc-u" class="swal2-input" style="margin:4px 0 10px;width:100%" value="sira_ro">
        <label for="sc-s">Senha do usuário (guarde: é a que vai no campo Senha desta tela)</label><input id="sc-s" class="swal2-input" style="margin:4px 0 10px;width:100%" value="${senhaForte()}">
        <label for="sc-i">IP do servidor do SIRA (opcional, entra como sugestão de liberação no pg_hba.conf)</label><input id="sc-i" class="swal2-input" style="margin:4px 0 10px;width:100%" placeholder="ex.: 10.0.0.20">
        <label style="display:flex;gap:8px;align-items:flex-start"><input id="sc-c" type="checkbox" style="margin-top:3px"><span>Liberar também CNS e CPF, só para a pergunta de qualidade do cadastro (sem CNS, sem CPF, duplicados). Sem esta opção essa pergunta fica desativada.</span></label>
        <label style="display:flex;gap:8px;align-items:flex-start;margin-top:10px"><input id="sc-n" type="checkbox" style="margin-top:3px"><span><b>Listas com nomes</b> (ex.: cadastros sem CPF para correção). Libera a leitura do <b>nome e da data de nascimento</b> do cidadão. Só marque com autorização do encarregado de dados (LGPD) da prefeitura. Cada lista gerada fica registrada na auditoria, com quem pediu e o motivo.</span></label></div>`,
        preConfirm: () => ({ usuario: $("sc-u").value.trim(), senha: $("sc-s").value, ip: $("sc-i").value.trim(), incluirCnsCpf: $("sc-c").checked, incluirNomes: $("sc-n").checked }) });
      if (!f.isConfirmed) return;
      const x = await api("/api/conexao/script", "POST", { ...f.value, banco }); if (x.status !== 200 || !x.sql) return aviso("error", "Não foi possível gerar o script", x.erro || "");
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([x.sql], { type: "text/plain;charset=utf-8" })); a.download = x.arquivo || "sira_permissoes.sql"; document.body.appendChild(a); a.click(); a.remove();
      $("db-usuario").value = f.value.usuario; $("db-senha").value = f.value.senha;
      Swal.fire({ ...SW, icon: "success", title: "Script gerado", html: `<p style="font-size:13px;color:#475569;margin:0">Envie o arquivo <b>${esc(x.arquivo)}</b> para a TI executar no banco. O usuário e a senha escolhidos já foram preenchidos nesta tela: depois que a TI executar, clique em <b>Testar conexão</b>.</p>`, confirmButtonText: "Fechar" }); };
    const resumo = (t) => `<ul style="text-align:left;font-size:13px;margin:8px 0 0 18px">${(t.passos || []).map((p) => `<li>${esc(p)}</li>`).join("")}${(t.avisos || []).map((p) => `<li style="color:#B45309">${esc(p)}</li>`).join("")}</ul>`;
    testar.onclick = async () => { testar.disabled = true; testar.textContent = "Testando…"; const x = await api("/api/conexao/testar", "POST", dados()); testar.disabled = false; testar.textContent = "Testar conexão";
      if (x.ok) Swal.fire({ ...SW, icon: x.avisos?.length ? "warning" : "success", title: "Conexão funcionando", html: resumo(x), confirmButtonText: "Fechar" }); else aviso("error", "Não foi possível conectar", x.erro || "Falha desconhecida."); };
    k.onsubmit = async (e) => { e.preventDefault(); salvar.disabled = true; salvar.textContent = "Conectando…"; const x = await api("/api/conexao/salvar", "POST", dados()); salvar.disabled = false; salvar.textContent = "Salvar e conectar";
      if (x.status !== 200) return aviso("error", "Não foi possível conectar", x.erro || ""); await Swal.fire({ ...SW, icon: x.teste?.avisos?.length ? "warning" : "success", title: "Banco conectado", html: resumo(x.teste || {}), confirmButtonText: "Fechar" }); configAbrir(); };
    box.insertBefore(k, box.children[1] || null);
  }
  $("btn-config").onclick = configAbrir;

  // ---------- chamado por app.js depois do login ----------
  window.SIRA_ADM = {
    verConversa: () => fecharPaineis(), // usado pela barra lateral: sai de qualquer painel e mostra a conversa
    iniciar(e) {
      eu = e; fecharDrops(); setTimeout(ajustaTopo, 0); const m = e.modulos || {};
      $("btn-usuarios").hidden = !m.usuarios; $("btn-config").hidden = !m.configuracoes; $("btn-auditoria").hidden = !m.auditoria; $("btn-ia").hidden = !m.ia;
      $("g-admin").hidden = !(m.usuarios || m.configuracoes || m.auditoria || m.ia);
      $("usuario-info").textContent = ""; const b = el("b", "", e.nome || ""); $("usuario-info").appendChild(b); $("usuario-info").appendChild(document.createTextNode(`${e.login || ""} · ${e.papelNome || e.papel || ""}`));
      $("form-pergunta").hidden = !m.perguntar; $("m-paineis").hidden = !m.perguntar; desenharInicio(e); if (m.perguntar) fecharPaineis(); else irInicio(); if (e.trocarSenha) minhaSenha(true);
    },
  };
})();
