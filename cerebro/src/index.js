// SIRA — Cérebro. Roda na VPS da BeMo. NÃO acessa banco de prefeitura e NÃO recebe dado de paciente:
// só o texto da pergunta e números agregados devolvidos pelo conector.
const http = require("http");
const fs = require("fs");
const path = require("path");
const auth = require("./auth");
const hub = require("./hub");
const direto = require("./direto");
const historico = require("./historico");
const paineis = require("./paineis");
const livre = require("./livre");
const texto = require("./texto");
const { extrair, montarPremissas } = require("./parametros");
const { montar, tabela, tabelaLista } = require("./respostas");
const llm = require("./llm_opcional");
const ia = require("./ia");
const { extrairJSON, listarModelos } = require("./provedores");

const PORT = Number(process.env.PORT || 3200);
const PUBLIC = path.join(__dirname, "..", "public");
const PROD = process.env.NODE_ENV === "production" && process.env.SIRA_HTTP_INTERNO !== "1"; // HTTP interno (modo direto sem HTTPS): cookie sem Secure
const TIPOS = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" };

// ---------- utilidades ----------
const janelas = new Map();
function limite(chave, max, ms) {
  const agora = Date.now(), l = (janelas.get(chave) || []).filter((t) => agora - t < ms);
  if (l.length >= max) { janelas.set(chave, l); return false; }
  l.push(agora); janelas.set(chave, l); return true;
}
setInterval(() => { const a = Date.now(); for (const [k, v] of janelas) if (!v.some((t) => a - t < 3600e3)) janelas.delete(k); }, 600e3).unref();

const cookieDe = (req) => (req.headers.cookie || "").split(/;\s*/).map((c) => c.split("=")).find(([k]) => k === "sira_sessao")?.[1] || null;
const json = (res, status, obj, extra = {}) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra }); res.end(JSON.stringify(obj)); };
function corpo(req, max = 8192) {
  return new Promise((ok, no) => {
    let n = 0; const partes = [];
    req.on("data", (c) => { n += c.length; if (n > max) { no(new Error("corpo grande")); req.destroy(); } else partes.push(c); });
    req.on("end", () => { try { ok(JSON.parse(Buffer.concat(partes).toString() || "{}")); } catch { no(new Error("json inválido")); } });
  });
}
const cookieSessao = (u, req) => {
  const horas = auth.configDe(u.tenant).sessao_horas, seguro = PROD || req.headers["x-forwarded-proto"] === "https";
  return `sira_sessao=${auth.emitirSessao(u, horas)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${horas * 3600}${seguro ? "; Secure" : ""}`;
};
function auditar(slug, obj) {
  try { fs.appendFileSync(path.join(auth.DATA, `auditoria-${slug}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), ...obj }) + "\n"); } catch {}
}

// ---------- fluxo da pergunta ----------
const fmtN = (n) => new Intl.NumberFormat("pt-BR").format(n);
const MSG_LISTA_OFF = "Esta pergunta pede uma lista com nomes de pessoas, e a leitura de nomes não está liberada neste banco. Peça à TI para gerar o script de permissões com a opção \"Listas com nomes\" (com autorização do encarregado de dados da prefeitura).";
async function entidadesDe(c, slug) { if (!c.entidades) c.entidades = (await hub.chamar(slug, { tipo: "entidades" })).entidades; return c.entidades; }
// Gráfico padrão para respostas de tabela do catálogo: barras por categoria.
function graficoCatalogo(q, tab) {
  if (q.resultado !== "tabela" || !tab || tab.linhas.length < 2) return null;
  const cols = tab.colunas; const ix = cols.findIndex((c) => !c.numerica), iy = cols.findIndex((c) => c.numerica);
  return ix >= 0 && iy >= 0 ? { tipo: "barras", x: cols[ix].chave, y: cols[iy].chave, ix, iy } : null;
}
function dadosGrafico(tab, linhasBrutas, q) { // números de verdade (sem suprimidos) para o gráfico
  return linhasBrutas.filter((l) => !l.suprimido).map((l) => q.colunas.map((c) => (c.chave === "total" ? l.total : l[c.chave])));
}

const listasDia = new Map();
async function perguntar(usuario, textoBruto, extra = {}) {
  const slug = usuario.tenant, t0 = Date.now();
  const c = hub.obter(slug);
  if (!c || !c.indice) return { status: 503, corpo: { ok: false, erro: "O conector da prefeitura está offline no momento. Avise a TI para verificar o serviço do SIRA." } };

  const decisao = texto.decidir(texto.buscar(c.indice, textoBruto));
  const sugerir = (lista) => lista.map((r) => c.manifesto.find((m) => m.id === r.id)).filter(Boolean).slice(0, 3).map((m) => ({ titulo: m.titulo, exemplo: m.exemplos[0] }));
  if (decisao.tipo !== "ok") {
    // Fora do catálogo: a IA tenta montar uma consulta segura; se a pergunta não for sobre o e-SUS, o SIRA recusa.
    let ent; try { ent = await entidadesDe(c, slug); } catch { return { status: 502, corpo: { ok: false, erro: "Não consegui falar com o conector." } }; }
    const lv = await livre.responder({ tenant: slug, texto: textoBruto, ent, chamar: (m) => hub.chamar(slug, m) });
    const log = (resultado, x = {}) => auditar(slug, { usuario: usuario.login, pergunta_texto: textoBruto, resultado, ...x });
    if (lv.tipo === "fora") { log("fora_de_escopo"); return { status: 200, corpo: { ok: false, foraDeEscopo: true, mensagem: livre.RECUSA } }; }
    if (lv.tipo === "lista_nominal") {
      log("lista_nao_disponivel");
      const listas = c.manifesto.filter((m) => m.sensivel);
      return { status: 200, corpo: { ok: false, mensagem: c.semListas || !listas.length ? MSG_LISTA_OFF : "Listas com nomes só saem pelas consultas prontas abaixo (com permissão e motivo registrado). Reformule usando uma delas:", sugestoes: c.semListas ? [] : listas.slice(0, 6).map((m) => ({ titulo: m.titulo, exemplo: m.exemplos[0] })) } };
    }
    if (lv.tipo === "inviavel") { log("inviavel"); return { status: 200, corpo: { ok: false, mensagem: "Os dados que o SIRA lê do e-SUS não permitem responder isso." + (lv.motivo ? " " + lv.motivo : ""), sugestoes: sugerir(c.manifesto.filter((m) => !m.sensivel).slice(0, 3).map((m) => ({ id: m.id }))) } }; }
    if (lv.tipo === "erro") return { status: 503, corpo: { ok: false, erro: lv.erro } };
    if (lv.tipo === "falha") { log("livre_falhou", { erro: lv.erro, sql: lv.sql }); return { status: 200, corpo: { ok: false, mensagem: "Não consegui montar uma consulta segura para essa pergunta. Tente reformular com mais detalhes (o que contar, de qual grupo e em qual período)." } }; }
    if (lv.tipo === "ok") {
      const ms = Date.now() - t0;
      log("ok_livre", { sql: lv.sql, linhas: lv.tabela.linhas.length, suprimidas: lv.suprimidas, ia: lv.ia, ms });
      const aviso = [lv.suprimidas ? "Valores menores que 5 são ocultados para proteger a identidade dos pacientes." : null, lv.truncado ? `Mostrando as primeiras ${lv.maximo} linhas.` : null].filter(Boolean).join(" ") || null;
      return { status: 200, corpo: { ok: true, livre: true, pergunta: { id: "livre", titulo: lv.titulo }, texto: lv.valorUnico ? `${lv.titulo}: ${lv.valorUnico}` : lv.titulo, tabela: lv.valorUnico ? null : lv.tabela, grafico: lv.grafico,
        premissas: ["Consulta montada pela IA a partir da sua pergunta, sobre as visões anonimizadas do SIRA. Confira o critério abaixo."], avisoPrivacidade: aviso, criterio: lv.criterio || null, sqlUsado: lv.sql, ms,
        fixar: { tipo: "livre", sql: lv.sql, selo: lv.selo, titulo: lv.titulo, grafico: lv.grafico ? { tipo: lv.grafico.tipo, x: lv.grafico.x, y: lv.grafico.y } : { tipo: "nenhum" } } } };
    }
    // sem IA configurada (ou IA fora do ar): comportamento do catálogo
    auditar(slug, { usuario: usuario.login, pergunta_texto: textoBruto, resultado: decisao.tipo });
    const sem = lv.tipo === "erro_ia" ? " A IA não respondeu agora; tente de novo em instantes." : "";
    return { status: 200, corpo: { ok: false, naoEntendi: true, mensagem: (decisao.tipo === "ambigua" ? "Sua pergunta pode ser de mais de um tipo. Qual destas você quis dizer?" : "Não consegui associar sua pergunta a nenhuma consulta disponível. Veja algumas que eu sei responder:") + sem, sugestoes: sugerir(decisao.candidatos.length ? decisao.candidatos : c.manifesto.filter((m) => !m.sensivel).slice(0, 3).map((m) => ({ id: m.id }))) } };
  }

  const q = c.manifesto.find((m) => m.id === decisao.id);
  if (q.sensivel) { // lista com nomes: módulo próprio + motivo obrigatório
    const li = usuario.listas || {};
    if (!auth.pode(usuario, "listas")) { auditar(slug, { usuario: usuario.login, pergunta_texto: textoBruto, pergunta: q.id, resultado: li.expirada ? "lista_autorizacao_expirada" : "lista_sem_autorizacao" }); return { status: 200, corpo: { ok: false, mensagem: li.expirada ? "Sua autorização para listas nominais expirou. Peça a um administrador do SIRA para renová-la." : "Listas com nomes de cidadãos exigem uma autorização específica, concedida por um administrador do SIRA da sua prefeitura. Solicite a liberação ao administrador." } }; }
    const pend = { id: q.id, titulo: q.titulo };
    if (!li.termo) return { status: 200, corpo: { ok: false, precisaTermo: true, termo: auth.TERMO_TEXTO, pergunta: pend, mensagem: "Antes da primeira lista, é preciso aceitar o termo de responsabilidade." } };
    const motivo = String(extra.motivo || "").replace(/\s+/g, " ").trim();
    const pedir = (mensagem) => ({ status: 200, corpo: { ok: false, precisaMotivo: true, precisaSenha: true, pergunta: pend, mensagem } });
    if (motivo.length < 10) return pedir("Esta consulta mostra nomes de pessoas (dado pessoal sensível). Informe o motivo do uso e confirme sua senha para continuar.");
    const conf = auth.confirmarSenha(usuario.login, extra.senha);
    if (conf !== "ok") { auditar(slug, { usuario: usuario.login, pergunta_texto: textoBruto, pergunta: q.id, resultado: conf === "bloqueada" ? "lista_senha_bloqueada" : "lista_senha_incorreta" }); return conf === "bloqueada" ? { status: 200, corpo: { ok: false, mensagem: "Muitas tentativas de senha incorreta. Aguarde 10 minutos para tentar novamente." } } : pedir("Senha incorreta. Informe o motivo e confirme sua senha."); }
    const limiteDia = Number(process.env.SIRA_LISTAS_DIA || 20), chaveDia = usuario.login + "|" + new Date().toISOString().slice(0, 10);
    if ((listasDia.get(chaveDia) || 0) >= limiteDia) { auditar(slug, { usuario: usuario.login, pergunta_texto: textoBruto, pergunta: q.id, resultado: "lista_limite_diario" }); return { status: 200, corpo: { ok: false, mensagem: `Limite diário de ${limiteDia} listas nominais atingido. Tente novamente amanhã ou fale com o administrador.` } }; }
    listasDia.set(chaveDia, (listasDia.get(chaveDia) || 0) + 1);
    extra.motivo = motivo.slice(0, 200);
  }
  if (!c.entidades) { try { c.entidades = (await hub.chamar(slug, { tipo: "entidades" })).entidades; } catch { return { status: 502, corpo: { ok: false, erro: "Não consegui falar com o conector." } }; } }
  let ex = extrair(textoBruto, q, c.entidades);
  if (ex.erro) return { status: 200, corpo: { ok: false, mensagem: ex.erro } };
  ex = await llm.refinar(textoBruto, q, c.entidades, ex);

  let r;
  try { r = await hub.chamar(slug, { tipo: "executar", pergunta: q.id, params: ex.params }, q.sensivel ? 100000 : 20000); }
  catch (e) { return { status: e.offline ? 503 : 504, corpo: { ok: false, erro: e.offline ? "O conector da prefeitura está offline." : "A consulta demorou demais." } }; }
  if (!r.ok) {
    auditar(slug, { usuario: usuario.login, pergunta_texto: textoBruto, pergunta: q.id, params: ex.params, resultado: "erro", erro: r.erro });
    return { status: 200, corpo: { ok: false, mensagem: "Não foi possível executar a consulta: " + r.erro } };
  }
  if (r.entidades) c.entidades = r.entidades;
  const params = r.params, premissas = montarPremissas(q, params, ex.origem, ex.rotulos || {}, c.entidades);
  if (r.cacheSegundos != null) premissas.push(`Números calculados há ${r.cacheSegundos < 60 ? r.cacheSegundos + " s" : Math.round(r.cacheSegundos / 60) + " min"} (a consulta é refeita a cada 2 minutos).`);
  if (r.resultado.tipo === "lista") {
    const n = r.resultado.linhas.length;
    auditar(slug, { usuario: usuario.login, evento: "lista_nominal", pergunta_texto: textoBruto, pergunta: q.id, params, motivo: extra.motivo, linhas: n, truncado: r.resultado.truncado, ms: Date.now() - t0 });
    if (r.resultado.truncado) premissas.push(`A lista foi limitada às primeiras ${fmtN(r.resultado.maximo)} linhas. Use um filtro (letra ou equipe) para ver o restante.`);
    premissas.push(`Motivo registrado: ${extra.motivo}`);
    return { status: 200, corpo: { ok: true, lista: true, pergunta: { id: q.id, titulo: q.titulo }, texto: `${montar(q, params, r.resultado, c.entidades)} ${n ? fmtN(n) + (n === 1 ? " cadastro encontrado." : " cadastros encontrados.") : "Nenhum cadastro encontrado."}`,
      tabela: tabelaLista(q, r.resultado), truncado: !!r.resultado.truncado, premissas, avisoPrivacidade: "Contém dados pessoais sensíveis (LGPD). Use apenas para a finalidade informada; este acesso ficou registrado na auditoria. Os nomes não ficam salvos no histórico.", ms: Date.now() - t0, criterio: q.criterio || null } };
  }
  const tab = r.resultado.tipo === "tabela" ? tabela(q, r.resultado) : null;
  let grafico = graficoCatalogo(q, tab && { colunas: q.colunas, linhas: tab.linhas });
  if (tab) tab.dados = dadosGrafico(tab, r.resultado.linhas, q);
  const resposta = {
    ok: true, pergunta: { id: q.id, titulo: q.titulo }, texto: montar(q, params, r.resultado, c.entidades),
    tabela: tab, grafico, premissas,
    avisoPrivacidade: JSON.stringify(r.resultado).includes('"suprimido":true') ? "Valores menores que 5 são ocultados para proteger a identidade dos pacientes." : null,
    ms: Date.now() - t0, criterio: q.criterio || null,
    fixar: { tipo: "catalogo", pergunta: q.id, params, titulo: q.titulo, grafico: grafico ? { tipo: grafico.tipo, x: grafico.x, y: grafico.y } : { tipo: "nenhum" } },
  };
  auditar(slug, { usuario: usuario.login, pergunta_texto: textoBruto, pergunta: q.id, params, resultado: "ok", suprimido: !!resposta.avisoPrivacidade, ia: ex.ia || null, ms: resposta.ms });
  return { status: 200, corpo: resposta };
}

// Recalcula cada item do painel do usuário (sempre com o banco atual). Consulta livre é revalidada pelo conector a cada execução.
async function dadosDosPaineis(usuario) {
  const slug = usuario.tenant, c = hub.obter(slug), itens = paineis.listar(usuario);
  if (!c) return itens.map((i) => ({ id: i.id, titulo: i.titulo, grafico: i.grafico, erro: "O conector da prefeitura está offline." }));
  const um = async (i) => {
    const base = { id: i.id, titulo: i.titulo, grafico: i.grafico, fonte: i.fonte.tipo };
    try {
      if (i.fonte.tipo === "livre") {
        if (!livre.seloOk(slug, i.fonte.sql, i.fonte.selo)) return { ...base, erro: "Consulta com selo inválido (o segredo do servidor mudou?). Fixe de novo." };
        const r = await hub.chamar(slug, { tipo: "livre", sql: i.fonte.sql }); if (!r.ok) return { ...base, erro: r.erro };
        const { tabela: tab, grafico } = livre.montarTabela(r.livre, { grafico: i.grafico.tipo, x: i.grafico.x, y: i.grafico.y });
        const unico = r.livre.linhas.length === 1 && r.livre.colunas.length === 1;
        return { ...base, valorUnico: unico ? (r.livre.linhas[0].__suprimido ? "menos de 5" : fmtN(r.livre.linhas[0].total)) : null, tabela: unico ? null : tab, grafico: grafico ? { ...i.grafico, ix: grafico.ix, iy: grafico.iy } : { tipo: "nenhum" }, em: Date.now() };
      }
      const q = c.manifesto.find((x) => x.id === i.fonte.pergunta && !x.sensivel); if (!q) return { ...base, erro: "Esta consulta não está mais disponível." };
      const ent = await entidadesDe(c, slug);
      const r = await hub.chamar(slug, { tipo: "executar", pergunta: q.id, params: i.fonte.params }); if (!r.ok) return { ...base, erro: r.erro };
      if (r.resultado.tipo === "valor") return { ...base, valorUnico: r.resultado.suprimido ? "menos de 5" : fmtN(r.resultado.total), texto: montar(q, r.params, r.resultado, ent), em: Date.now() };
      const tab = tabela(q, r.resultado); tab.dados = dadosGrafico(tab, r.resultado.linhas, q);
      const g = graficoCatalogo(q, { colunas: q.colunas, linhas: tab.linhas });
      return { ...base, tabela: tab, grafico: g ? { ...i.grafico, ix: g.ix, iy: g.iy } : { tipo: "nenhum" }, em: Date.now() };
    } catch (e) { return { ...base, erro: e.offline ? "O conector da prefeitura está offline." : "Não foi possível atualizar agora." }; }
  };
  const out = []; for (let k = 0; k < itens.length; k += 3) out.push(...(await Promise.all(itens.slice(k, k + 3).map(um))));
  return out;
}

// ---------- servidor HTTP ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const seguranca = { "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'" };
  for (const [k, v] of Object.entries(seguranca)) res.setHeader(k, v);
  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress;
  try {
    if (url.pathname.startsWith("/api/")) {
      if (req.method === "POST" && !(req.headers["content-type"] || "").startsWith("application/json")) return json(res, 415, { erro: "use application/json" });

      if (url.pathname === "/api/login" && req.method === "POST") {
        if (!limite("login:" + ip, 10, 10 * 60e3)) return json(res, 429, { erro: "Muitas tentativas. Aguarde alguns minutos." });
        const b = await corpo(req); const u = auth.autenticar(String(b.login || ""), String(b.senha || ""));
        if (!u) return json(res, 401, { erro: "Usuário ou senha inválidos." });
        auditar(u.tenant, { usuario: u.login, evento: "login" });
        return json(res, 200, { ok: true }, { "set-cookie": cookieSessao(u, req) });
      }
      if (url.pathname === "/api/logout" && req.method === "POST") return json(res, 200, { ok: true }, { "set-cookie": "sira_sessao=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });

      const usuario = auth.lerSessao(cookieDe(req));
      if (!usuario) return json(res, 401, { erro: "Sessão expirada. Entre novamente." });

      if (url.pathname === "/api/eu") {
        const c = hub.obter(usuario.tenant);
        return json(res, 200, { login: usuario.login, nome: usuario.nome, papel: usuario.papel, papelNome: auth.PAPEIS[usuario.papel], modulos: usuario.modulos, trocarSenha: usuario.trocarSenha, sugestoes: auth.configDe(usuario.tenant).sugestoes_inicio, cliente: auth.tenants()[usuario.tenant]?.nome, conectorOnline: !!c, versaoCatalogo: c?.versaoCatalogo || null });
      }
      // ---- Minha senha (qualquer usuário autenticado) ----
      if (url.pathname === "/api/senha" && req.method === "POST") {
        if (!limite("senha:" + usuario.login, 10, 10 * 60e3)) return json(res, 429, { erro: "Muitas tentativas. Aguarde alguns minutos." });
        const b = await corpo(req);
        try { auth.trocarSenha(usuario.login, b.atual, b.nova); } catch (e) { return json(res, 400, { erro: e.message }); }
        auditar(usuario.tenant, { usuario: usuario.login, evento: "senha_alterada" });
        return json(res, 200, { ok: true }, { "set-cookie": cookieSessao(usuario, req) });
      }
      if (usuario.trocarSenha && !["/api/eu", "/api/logout"].includes(url.pathname)) return json(res, 403, { erro: "Troque a sua senha para continuar.", trocarSenha: true });

      // ---- Usuários e permissões ----
      if (url.pathname === "/api/usuarios" || url.pathname.startsWith("/api/usuarios/")) {
        if (!auth.pode(usuario, "usuarios")) return json(res, 403, { erro: "Sem permissão para gerir usuários." });
        const reg = (acao, alvo, extra = {}) => auditar(usuario.tenant, { usuario: usuario.login, evento: "usuarios", acao, alvo, ...extra });
        try {
          if (url.pathname === "/api/usuarios" && req.method === "GET") return json(res, 200, { usuarios: auth.listarUsuarios(usuario), modulos: auth.MODULOS, papeis: Object.fromEntries(Object.entries(auth.PAPEIS).filter(([k]) => usuario.papel === "super" || k !== "super")), padroes: Object.fromEntries(Object.keys(auth.PAPEIS).map((k) => [k, auth.modulosDe({ papel: k })])) });
          if (url.pathname === "/api/usuarios" && req.method === "POST") { const b = await corpo(req); const l = auth.novoUsuario(usuario, b); reg("criar", l, { papel: b.papel }); return json(res, 200, { ok: true }); }
          const m = url.pathname.match(/^\/api\/usuarios\/([^/]+)(\/senha|\/sessoes|\/listas)?$/); const login = m && decodeURIComponent(m[1]);
          if (m && !m[2] && req.method === "PUT") { const b = await corpo(req); auth.editarUsuario(usuario, login, b); reg("editar", login); return json(res, 200, { ok: true }); }
          if (m && !m[2] && req.method === "DELETE") { const alvo = auth.listarUsuarios(usuario).find((x) => x.login === login); auth.excluirUsuario(usuario, login); if (alvo) { historico.limpar({ tenant: usuario.tenant, login }); paineis.limpar({ tenant: usuario.tenant, login }); } reg("excluir", login); return json(res, 200, { ok: true }); }
          if (m && m[2] === "/senha" && req.method === "POST") { const b = await corpo(req); auth.redefinirSenha(usuario, login, b.senha); reg("redefinir_senha", login); return json(res, 200, { ok: true }); }
          if (m && m[2] === "/listas" && req.method === "POST") { const b = await corpo(req); const ate = auth.autorizarListas(usuario, login, b.dias); reg("autorizar_listas", login, { ate: new Date(ate).toISOString() }); return json(res, 200, { ok: true, ate }); }
          if (m && m[2] === "/listas" && req.method === "DELETE") { auth.revogarListas(usuario, login); reg("revogar_listas", login); return json(res, 200, { ok: true }); }
          if (m && m[2] === "/sessoes" && req.method === "POST") { auth.encerrarSessoes(usuario, login); reg("encerrar_sessoes", login); return json(res, 200, { ok: true }); }
        } catch (e) { if (["json inválido", "corpo grande"].includes(e.message)) throw e; return json(res, 400, { erro: e.message }); }
        return json(res, 404, { erro: "não encontrado" });
      }

      // ---- Configurações do cliente ----
      if (url.pathname === "/api/config" || url.pathname === "/api/config/token") {
        if (!auth.pode(usuario, "configuracoes")) return json(res, 403, { erro: "Sem permissão para alterar as configurações." });
        const reg = (acao, extra = {}) => auditar(usuario.tenant, { usuario: usuario.login, evento: "configuracoes", acao, ...extra });
        try {
          const c = hub.obter(usuario.tenant), t = auth.tenants()[usuario.tenant] || {};
          const estado = () => ({ cliente: auth.tenants()[usuario.tenant]?.nome, config: auth.configDe(usuario.tenant), padrao: auth.CONFIG_PADRAO, limites: auth.LIMITES, conectorOnline: !!c, versaoCatalogo: c?.versaoCatalogo || null, tokenEm: auth.tenants()[usuario.tenant]?.tokenEm || auth.tenants()[usuario.tenant]?.criadoEm || null, podeToken: usuario.papel === "super", minimoSupressao: 5, modoDireto: direto.habilitado() });
          if (url.pathname === "/api/config" && req.method === "GET") return json(res, 200, estado());
          if (url.pathname === "/api/config" && req.method === "PUT") {
            const b = await corpo(req); if (b.cliente !== undefined) auth.renomearCliente(usuario.tenant, b.cliente); auth.salvarConfig(usuario.tenant, b);
            reg("salvar", { campos: Object.keys(b) }); return json(res, 200, estado());
          }
          if (url.pathname === "/api/config/token" && req.method === "POST") {
            if (usuario.papel !== "super") return json(res, 403, { erro: "Apenas o administrador BeMo gera um novo token do conector." });
            const token = auth.novoToken(usuario.tenant); reg("novo_token"); return json(res, 200, { ok: true, token, aviso: "Copie agora: o token não será exibido de novo. O conector da prefeitura precisa ser reiniciado com ele (variável SIRA_TOKEN)." });
          }
        } catch (e) { if (["json inválido", "corpo grande"].includes(e.message)) throw e; return json(res, 400, { erro: e.message }); }
        return json(res, 405, { erro: "método não permitido" });
      }

      // ---- Conexão direta com o banco (modo direto) ----
      if (url.pathname.startsWith("/api/conexao")) {
        if (!direto.habilitado()) return json(res, 404, { erro: "O modo direto não está habilitado neste servidor." });
        if (!auth.pode(usuario, "configuracoes")) return json(res, 403, { erro: "Sem permissão para alterar as configurações." });
        const reg = (acao, extra = {}) => auditar(usuario.tenant, { usuario: usuario.login, evento: "conexao_banco", acao, ...extra });
        const sub = url.pathname.slice(12);
        try {
          if (sub === "" && req.method === "GET") return json(res, 200, direto.publico(usuario.tenant));
          if (req.method !== "POST") return json(res, 405, { erro: "método não permitido" });
          if (!limite("conexao:" + usuario.login, 20, 10 * 60e3)) return json(res, 429, { erro: "Muitas tentativas. Aguarde alguns minutos." });
          const b = await corpo(req, 4096);
          if (sub === "/testar") {
            let cfg; try { cfg = direto.validar(b, direto.lerCfg(usuario.tenant) && { senhaEnc: direto.lerCfg(usuario.tenant).senhaEnc }); } catch (e) { return json(res, 200, { ok: false, erro: e.message }); }
            const t = await direto.testar(cfg); reg("testar", { host: cfg.host, porta: cfg.porta, banco: cfg.banco, usuario: cfg.usuario, ok: t.ok }); return json(res, 200, t);
          }
          if (sub === "/script") { const sql = direto.gerarScript(b); reg("gerar_script", { usuario: b.usuario || "sira_ro", incluirCnsCpf: !!b.incluirCnsCpf }); return json(res, 200, { ok: true, sql, arquivo: `sira_permissoes_${String(b.banco).replace(/[^A-Za-z0-9_]/g, "")}.sql` }); }
          if (sub === "/salvar") { const t = await direto.salvar(usuario.tenant, b, usuario.login); reg("salvar", { host: b.host, porta: b.porta, banco: b.banco, usuario: b.usuario }); return json(res, 200, { ...direto.publico(usuario.tenant), teste: t }); }
          if (sub === "/remover") { direto.remover(usuario.tenant); reg("remover"); return json(res, 200, direto.publico(usuario.tenant)); }
        } catch (e) { if (["json inválido", "corpo grande"].includes(e.message)) throw e; return json(res, 400, { erro: e.message }); }
        return json(res, 404, { erro: "não encontrado" });
      }

      // ---- Histórico de pesquisas (privado de cada usuário: o dono vem da sessão, nunca do pedido) ----
      if (url.pathname === "/api/historico" || url.pathname.startsWith("/api/historico/")) {
        if (!auth.pode(usuario, "perguntar")) return json(res, 403, { erro: "Seu perfil não tem permissão para fazer perguntas." });
        const m = url.pathname.match(/^\/api\/historico(?:\/([A-Za-z0-9_-]{6,20}))?$/); if (!m) return json(res, 404, { erro: "não encontrado" });
        try {
          if (!m[1] && req.method === "GET") return json(res, 200, { conversas: historico.listar(usuario) });
          if (!m[1] && req.method === "DELETE") { historico.limpar(usuario); return json(res, 200, { ok: true }); }
          if (m[1] && req.method === "GET") { const c = historico.obter(usuario, m[1]); return c ? json(res, 200, { conversa: c }) : json(res, 404, { erro: "Pesquisa não encontrada." }); }
          if (m[1] && req.method === "PUT") { const b = await corpo(req, 2048); return json(res, 200, { conversa: historico.renomear(usuario, m[1], b.titulo) }); }
          if (m[1] && req.method === "DELETE") { historico.excluir(usuario, m[1]); return json(res, 200, { ok: true }); }
        } catch (e) { if (["json inválido", "corpo grande"].includes(e.message)) throw e; return json(res, 400, { erro: e.message }); }
        return json(res, 405, { erro: "método não permitido" });
      }

      // ---- Meus painéis (privados de cada usuário) ----
      if (url.pathname === "/api/paineis" || url.pathname.startsWith("/api/paineis/")) {
        if (!auth.pode(usuario, "perguntar")) return json(res, 403, { erro: "Seu perfil não tem permissão para fazer perguntas." });
        const m = url.pathname.match(/^\/api\/paineis(?:\/(dados|[A-Za-z0-9_-]{6,20}))?$/); if (!m) return json(res, 404, { erro: "não encontrado" });
        try {
          const c = hub.obter(usuario.tenant);
          const catalogoOk = (id) => !!c?.manifesto?.some((x) => x.id === id && !x.sensivel);
          if (!m[1] && req.method === "GET") return json(res, 200, { itens: paineis.listar(usuario) });
          if (!m[1] && req.method === "POST") { const b = await corpo(req, 16384); return json(res, 200, { item: paineis.adicionar(usuario, b, catalogoOk) }); }
          if (m[1] === "dados" && req.method === "GET") return json(res, 200, { itens: await dadosDosPaineis(usuario) });
          if (m[1] && m[1] !== "dados" && req.method === "PUT") { const b = await corpo(req, 2048); return json(res, 200, { item: b.grafico ? paineis.trocarGrafico(usuario, m[1], String(b.grafico)) : paineis.renomear(usuario, m[1], b.titulo) }); }
          if (m[1] && m[1] !== "dados" && req.method === "DELETE") { paineis.remover(usuario, m[1]); return json(res, 200, { ok: true }); }
        } catch (e) { if (["json inválido", "corpo grande"].includes(e.message)) throw e; return json(res, 400, { erro: e.message }); }
        return json(res, 405, { erro: "método não permitido" });
      }

      if (url.pathname === "/api/catalogo") {
        const c = hub.obter(usuario.tenant);
        return json(res, 200, { perguntas: (c?.manifesto || []).filter((m) => !m.sensivel || auth.pode(usuario, "listas")).map((m) => ({ id: m.id, titulo: m.titulo, exemplo: m.exemplos[0] })) });
      }
      if (url.pathname === "/api/listas/termo" && req.method === "POST") {
        try { auth.aceitarTermoListas(usuario.login); auditar(usuario.tenant, { usuario: usuario.login, evento: "termo_listas", versao: auth.TERMO_VERSAO }); return json(res, 200, { ok: true }); } catch (e) { return json(res, 400, { erro: e.message }); }
      }
      if (url.pathname === "/api/perguntar" && req.method === "POST") {
        if (!auth.pode(usuario, "perguntar")) return json(res, 403, { erro: "Seu perfil não tem permissão para fazer perguntas." });
        if (!limite("q:" + usuario.login, auth.configDe(usuario.tenant).limite_perguntas_min, 60e3)) return json(res, 429, { erro: "Muitas perguntas seguidas. Aguarde um instante." });
        const b = await corpo(req); const t = String(b.texto || "").trim();
        if (t.length < 3 || t.length > 300) return json(res, 400, { erro: "Escreva uma pergunta entre 3 e 300 caracteres." });
        const r = await perguntar(usuario, t, { motivo: b.motivo, senha: b.senha });
        if (r.status === 200 && !r.corpo.precisaMotivo && !r.corpo.precisaTermo) { try { const c = historico.adicionar(usuario, b.conversa, t, r.corpo); r.corpo = { ...r.corpo, conversa: { id: c.id, titulo: c.titulo } }; } catch (e) { console.error("[historico]", e.message); } }
        return json(res, r.status, r.corpo);
      }
      if (url.pathname.startsWith("/api/ia")) {
        if (!auth.pode(usuario, "ia")) return json(res, 403, { erro: "Apenas o administrador da BeMo (papel super) configura a IA." });
        const sub = url.pathname.slice(7);
        if (sub === "" && req.method === "GET") return json(res, 200, ia.publico());
        if (req.method !== "POST") return json(res, 405, { erro: "método não permitido" });
        const b = await corpo(req, 4096); const log = (acao, extra = {}) => auditar(usuario.tenant, { usuario: usuario.login, evento: "ia_config", acao, ...extra });
        try {
          if (sub === "/script") { const sql = direto.gerarScript(b); reg("gerar_script", { usuario: b.usuario || "sira_ro", incluirCnsCpf: !!b.incluirCnsCpf }); return json(res, 200, { ok: true, sql, arquivo: `sira_permissoes_${String(b.banco).replace(/[^A-Za-z0-9_]/g, "")}.sql` }); }
          if (sub === "/salvar") { ia.salvar(b, usuario.login); if (b.ativar) ia.ativar(b.provedor, usuario.login); log("salvar", { provedor: b.provedor, trocouChave: !!(b.chave && String(b.chave).trim()), ativar: !!b.ativar }); return json(res, 200, ia.publico()); }
          if (sub === "/ativar") { ia.ativar(b.provedor || null, usuario.login); log("ativar", { provedor: b.provedor || null }); return json(res, 200, ia.publico()); }
          if (sub === "/remover-chave") { ia.removerChave(String(b.provedor), usuario.login); log("remover_chave", { provedor: b.provedor }); return json(res, 200, ia.publico()); }
          if (sub === "/modelos") { const cfg = ia.completa(String(b.provedor)); return json(res, 200, { modelos: await listarModelos(cfg) }); }
          if (sub === "/testar") {
            const cfg = ia.completa(String(b.provedor)); const t0 = Date.now();
            const r = await extrairJSON({ ...cfg, prompt: 'Responda somente com o JSON {"ok": true, "mensagem": "SIRA conectado"}' });
            const ok = r && r.ok === true; ia.registrarUso(ok, Date.now() - t0, ok ? null : "resposta inesperada no teste");
            log("testar", { provedor: b.provedor, ok });
            return json(res, 200, { ok, ms: Date.now() - t0, modelo: cfg.modelo, resposta: ok ? r.mensagem || "ok" : "A IA respondeu, mas fora do formato esperado." });
          }
        } catch (e) { if (sub === "/testar") log("testar", { provedor: b.provedor, ok: false }); return json(res, 200, { ok: false, erro: e.message }); }
        return json(res, 404, { erro: "não encontrado" });
      }
      if (url.pathname === "/api/auditoria" && auth.pode(usuario, "auditoria")) {
        let linhas = []; try { linhas = fs.readFileSync(path.join(auth.DATA, `auditoria-${usuario.tenant}.jsonl`), "utf8").trim().split("\n").slice(-200).map((l) => JSON.parse(l)).reverse(); } catch {}
        return json(res, 200, { registros: linhas });
      }
      return json(res, 404, { erro: "não encontrado" });
    }

    // estáticos
    let arq = url.pathname === "/" ? "/index.html" : url.pathname;
    const completo = path.normalize(path.join(PUBLIC, arq));
    if (!completo.startsWith(PUBLIC) || !fs.existsSync(completo) || fs.statSync(completo).isDirectory()) { res.writeHead(404); return res.end("não encontrado"); }
    res.writeHead(200, { "content-type": TIPOS[path.extname(completo)] || "application/octet-stream", "cache-control": "no-cache" });
    fs.createReadStream(completo).pipe(res);
  } catch (e) {
    if (!res.headersSent) json(res, e.message === "json inválido" || e.message === "corpo grande" ? 400 : 500, { erro: e.message === "json inválido" ? "JSON inválido" : "Erro interno" });
    if (!["json inválido", "corpo grande"].includes(e.message)) console.error("[erro]", e);
  }
});

hub.iniciar(server);
if (require.main === module) direto.iniciar().catch((e) => console.error("[direto]", e.message));
if (require.main === module) server.listen(PORT, () => console.log(`[sira] cérebro em http://localhost:${PORT}`));
module.exports = { server, perguntar };
