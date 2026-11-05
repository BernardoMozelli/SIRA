// SIRA — MODO DIRETO. O cérebro roda DENTRO da rede da prefeitura e consulta o banco informando só
// servidor, porta, banco, usuário e senha (tela Configurações). Continua executando APENAS o catálogo de consultas
// (views mcp.*, transação somente leitura, timeout, supressão de grupos < 5). Desligado por padrão:
// só vale com SIRA_MODO_DIRETO=1, para que um cérebro hospedado na internet nunca aceite apontar para um banco.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const auth = require("./auth");
const hub = require("./hub");

const habilitado = () => process.env.SIRA_MODO_DIRETO === "1";
const ARQ = (slug) => path.join(auth.DATA, `conexao-${slug}.json`);
const ativos = new Map(); // slug -> { exec, timer, ultimoErro }

// ---- cifra da senha do banco (AES-256-GCM, chave derivada do SIRA_SEGREDO) ----
let chave = null;
function chaveAES() {
  if (!auth.SEGREDO_PERSISTENTE) throw new Error("Defina SIRA_SEGREDO antes de salvar a senha do banco; sem ele ela se perderia ao reiniciar.");
  return (chave ||= crypto.scryptSync(auth.SEGREDO, "sira-db-v1", 32));
}
function cifrar(t) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", chaveAES(), iv); const ct = Buffer.concat([c.update(t, "utf8"), c.final()]); return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":"); }
function decifrar(e) { const [v, iv, tag, ct] = String(e).split(":"); if (v !== "v1") throw new Error("formato desconhecido"); const d = crypto.createDecipheriv("aes-256-gcm", chaveAES(), Buffer.from(iv, "base64")); d.setAuthTag(Buffer.from(tag, "base64")); return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8"); }

const lerCfg = (slug) => { try { return JSON.parse(fs.readFileSync(ARQ(slug), "utf8")); } catch { return null; } };
function gravarCfg(slug, v) { const t = ARQ(slug) + ".tmp"; fs.writeFileSync(t, JSON.stringify(v, null, 2), { mode: 0o600 }); fs.renameSync(t, ARQ(slug)); }

// ---- validação dos 5 campos ----
function validar(d, atual) {
  const host = String(d.host || "").trim(), banco = String(d.banco || "").trim(), usuario = String(d.usuario || "").trim();
  const porta = Number(d.porta || 5432);
  if (!/^[A-Za-z0-9._:-]{1,253}$/.test(host)) throw new Error("Servidor inválido: informe o IP ou o nome (ex.: 10.0.0.15).");
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) throw new Error("Porta inválida (1 a 65535).");
  if (!/^[A-Za-z0-9_.$-]{1,63}$/.test(banco)) throw new Error("Nome do banco inválido.");
  if (!/^[A-Za-z0-9_.$@-]{1,63}$/.test(usuario)) throw new Error("Usuário inválido.");
  const sal = atual?.salEnc ? decifrar(atual.salEnc) : null;
  let senha = typeof d.senha === "string" ? d.senha : "";
  if (!senha && atual?.senhaEnc) senha = decifrar(atual.senhaEnc); // campo em branco = mantém a senha salva
  if (!senha) throw new Error("Informe a senha do banco.");
  if (senha.length > 200) throw new Error("Senha muito longa.");
  return { host, porta, banco, usuario, senha, sal: sal || gerarSal() };
}
const gerarSal = () => crypto.randomBytes(18).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 24).padEnd(24, "x");
const urlDe = (c) => `postgres://${encodeURIComponent(c.usuario)}:${encodeURIComponent(c.senha)}@${c.host.includes(":") ? `[${c.host}]` : c.host}:${c.porta}/${encodeURIComponent(c.banco)}`;

// Mensagens em português para os erros mais comuns de conexão.
function traduzir(e) {
  const m = String(e.message || e), c = e.code;
  if (c === "ECONNREFUSED") return "Conexão recusada: confira o IP e a porta, e se o PostgreSQL aceita conexões de rede (listen_addresses e pg_hba.conf).";
  if (c === "ENOTFOUND" || c === "EAI_AGAIN") return "Servidor não encontrado: confira o IP ou o nome.";
  if (c === "ETIMEDOUT" || /timeout/i.test(m)) return "Sem resposta do servidor: confira o IP/porta e se o firewall libera esta máquina.";
  if (c === "28P01") return "Usuário ou senha incorretos.";
  if (c === "3D000") return "Esse banco não existe neste servidor.";
  if (c === "28000" || /pg_hba/i.test(m)) return "O servidor recusou esta máquina (pg_hba.conf). Peça à TI para liberar o IP deste servidor para o usuário e o banco informados.";
  return "Falha ao conectar: " + m.replace(/password=\S+/gi, "password=***");
}

// ---- teste de conexão (não grava nada) ----
// Modo "views": o schema mcp existe no banco (instalado pela TI). Modo "embutido": só um usuário de leitura com SELECT por coluna, sem instalar nada.
async function testar(cfg) {
  const req = require("module").createRequire(path.join(conectorSrc(), "executor.js")), { Client } = req("pg");
  const { catalogo, exec, emb } = carregarConector();
  const cli = new Client({ connectionString: urlDe(cfg), connectionTimeoutMillis: 8000, statement_timeout: 15000, application_name: "sira-teste" });
  const r = { ok: false, passos: [], avisos: [], desativadas: [] };
  try { await cli.connect(); } catch (e) { r.erro = traduzir(e); return r; }
  let ex = null;
  try {
    const v = (await cli.query("SELECT current_setting('server_version_num')::int AS n, current_setting('server_version') AS v")).rows[0];
    r.passos.push(`Conectado ao PostgreSQL ${v.v}.`);
    if (v.n < 120000) { r.erro = `O SIRA precisa do PostgreSQL 12 ou mais novo (este é o ${v.v}). Fale com a BeMo: dá para adaptar as consultas para a versão mais antiga.`; return r; }
    r.modo = await detectarModo(cli);
    const tem = (await cli.query(`SELECT r.rolsuper AS su, r.rolcreatedb OR r.rolcreaterole AS adm FROM pg_roles r WHERE r.rolname = current_user`)).rows[0] || {};
    if (tem.su || tem.adm) r.avisos.push("Este usuário tem poderes administrativos. O SIRA só executa as consultas do catálogo, em transação somente leitura, mas o recomendado é um usuário de leitura (use o botão \"Gerar script para a TI\").");
    const sensiveis = []; for (const [t, cols] of Object.entries(emb.SENSIVEIS)) for (const c of cols) sensiveis.push([t, c]);
    const sv = (await cli.query(`SELECT t, c, has_column_privilege(current_user, format('public.%I', t), c, 'SELECT') AS ok FROM unnest($1::text[], $2::text[]) AS x(t, c) WHERE to_regclass(format('public.%I', t)) IS NOT NULL`, [sensiveis.map((x) => x[0]), sensiveis.map((x) => x[1])])).rows;
    // em modo views, quem lê as tabelas cruas é aviso; em modo embutido, só CNS/CPF são tolerados (opção da TI)
    const lidas = sv.filter((x) => x.ok).map((x) => `${x.t}.${x.c}`).filter((k) => !(r.modo === "embutido" && emb.OPCIONAIS_PII.has(k)));
    if (lidas.length) r.avisos.push("Este usuário consegue ler dados pessoais (" + lidas.slice(0, 4).join(", ") + (lidas.length > 4 ? "…" : "") + "). Funciona, mas o recomendado é um usuário sem essas colunas: use o botão \"Gerar script para a TI\".");
    if (r.modo === "views") {
      r.passos.push("Views do SIRA (schema mcp) encontradas: o banco já foi preparado.");
      ex = exec.criarExecutor(urlDe(cfg), { modo: "views" });
    } else {
      r.passos.push("Modo somente leitura: nada foi instalado no banco; o SIRA só lê as colunas que o usuário recebeu.");
      ex = exec.criarExecutor(urlDe(cfg), { modo: "embutido", sal: "TesteDeConexao01" });
    }
    const d = await ex.diagnostico();
    if (r.modo === "embutido" && d.desabilitadas.length === catalogo.perguntas.length) { r.erro = "Este usuário não tem permissão de leitura nas tabelas do e-SUS que o SIRA usa. Use o botão \"Gerar script para a TI\" e peça para executarem no banco uma única vez."; return r; }
    const n = (await ex.entidades()); r.passos.push(`${n.unidades.length} unidades e ${n.equipes.length} equipes ativas encontradas.`);
    try { const c = await cli.query(r.modo === "views" ? "SELECT count(*)::int AS n FROM mcp.v_cidadao WHERE ativo" : emb.montarSql("SELECT count(*)::int AS n FROM mcp.v_cidadao WHERE ativo", "TesteDeConexao01")); r.cidadaos = c.rows[0].n; r.passos.push(`${r.cidadaos.toLocaleString("pt-BR")} cidadãos ativos visíveis.`); }
    catch (e) { r.erro = "A conexão funciona, mas a consulta de teste falhou: " + traduzir(e); return r; }
    r.desativadas = d.desabilitadas.map((x) => ({ id: x.id, titulo: catalogo.perguntas.find((q) => q.id === x.id)?.titulo || x.id, motivo: x.motivo }));
    const comuns = r.desativadas.filter((x) => !x.id.startsWith("lista_")), listasOff = r.desativadas.filter((x) => x.id.startsWith("lista_"));
    if (comuns.length) r.avisos.push(`${comuns.length} pergunta(s) ficarão desativadas por falta de permissão: ${comuns.map((x) => x.titulo).join(", ")}. Para liberar, gere o script com a opção correspondente (CNS/CPF).`);
    r.passos.push(listasOff.length ? "Listas com nomes de pessoas: desativadas (é opcional; exige a opção \"Listas com nomes\" no script e a autorização do encarregado de dados)." : "Listas com nomes de pessoas: liberadas (usuários com o módulo \"Listas nominais\", com motivo e auditoria).");
    r.ok = true;
  } catch (e) { r.erro = traduzir(e); }
  finally { try { await cli.end(); } catch {} if (ex) ex.fechar().catch(() => {}); }
  return r;
}
async function detectarModo(cli) {
  // Só consulta o catálogo do PostgreSQL (não falha mesmo sem acesso ao schema mcp): views existem E o usuário pode lê-las?
  const x = (await cli.query(`SELECT count(*) FILTER (WHERE c.relname IN ('v_cidadao','v_equipe','v_unidade') AND has_table_privilege(current_user, c.oid, 'SELECT')) = 3 AS ok
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'mcp' AND c.relkind = 'v' AND has_schema_privilege(current_user, n.oid, 'USAGE')`)).rows[0];
  return x.ok ? "views" : "embutido";
}

const conectorSrc = () => process.env.SIRA_CONECTOR_SRC || path.join(__dirname, "..", "..", "conector", "src");
function carregarConector() {
  try { return { catalogo: require(path.join(conectorSrc(), "catalogo")), exec: require(path.join(conectorSrc(), "executor")), emb: require(path.join(conectorSrc(), "embutido")), texto: require("./texto") }; }
  catch (e) { throw new Error("Modo direto indisponível nesta instalação: falta o conector junto do cérebro (" + e.message.split("\n")[0] + ")."); }
}

// ---- liga o banco ao hub como se fosse um conector ----
async function ligar(slug, cfg) {
  desligar(slug);
  const { catalogo, exec, texto } = carregarConector();
  const Cl = require("module").createRequire(path.join(conectorSrc(), "executor.js"))("pg").Client;
  const c0 = new Cl({ connectionString: urlDe(cfg), connectionTimeoutMillis: 8000 }); await c0.connect();
  let modo; try { modo = await detectarModo(c0); } finally { await c0.end().catch(() => {}); }
  const ex = exec.criarExecutor(urlDe(cfg), modo === "views" ? { modo } : { modo, sal: cfg.sal });
  const diag = await ex.diagnostico(); const ents = await ex.entidades(); // falha aqui = não liga
  const ativas = catalogo.manifesto().filter((m) => ex.habilitada(m.id));
  const reg = { exec: ex, modo, desativadas: diag.desabilitadas, ultimoErro: null, timer: null };
  const entrada = () => ({ manifesto: ativas, indice: texto.construirIndice(ativas), versaoCatalogo: catalogo.VERSAO_CATALOGO, entidades: ents, executar: (p, par) => ex.executar(p, par), executarLivre: (sql) => ex.executarLivre(sql), listarEntidades: () => ex.entidades(), semListas: diag.desabilitadas.some((d) => d.id.startsWith("lista_")) });
  hub.registrarDireto(slug, entrada());
  // vigia: se o banco cair, o SIRA mostra "offline" e volta sozinho quando ele voltar
  reg.timer = setInterval(async () => {
    try { await ex.entidades(); reg.ultimoErro = null; if (!hub.obter(slug)) hub.registrarDireto(slug, entrada()); }
    catch (e) { reg.ultimoErro = traduzir(e); hub.removerDireto(slug); }
  }, 30000); reg.timer.unref();
  ativos.set(slug, reg);
}
function desligar(slug) { const r = ativos.get(slug); if (r) { clearInterval(r.timer); r.exec.fechar().catch(() => {}); ativos.delete(slug); } hub.removerDireto(slug); }

function publico(slug) {
  const c = lerCfg(slug), r = ativos.get(slug);
  return { habilitado: habilitado(), configurado: !!c, host: c?.host || "", porta: c?.porta || 5432, banco: c?.banco || "", usuario: c?.usuario || "", temSenha: !!c?.senhaEnc,
    conectado: !!r && !!hub.obter(slug), erro: r?.ultimoErro || null, salvoEm: c?.salvoEm || null,
    modo: r?.modo || null, desativadas: (r?.desativadas || []).map((x) => ({ id: x.id, motivo: x.motivo })) };
}
async function salvar(slug, d, por) {
  if (!habilitado()) throw new Error("O modo direto não está habilitado neste servidor (SIRA_MODO_DIRETO=1).");
  const cfg = validar(d, lerCfg(slug));
  const t = await testar(cfg); if (!t.ok) throw new Error(t.erro);
  await ligar(slug, cfg).catch((e) => { throw new Error(traduzir(e)); });
  gravarCfg(slug, { host: cfg.host, porta: cfg.porta, banco: cfg.banco, usuario: cfg.usuario, senhaEnc: cifrar(cfg.senha), salEnc: cifrar(cfg.sal), salvoEm: new Date().toISOString(), salvoPor: por });
  return t;
}
// Script de permissões para a TI (nada é gravado: a senha escolhida só vive neste texto).
function gerarScript(d) {
  const { emb } = carregarConector();
  const banco = String(d.banco || "").trim(); if (!/^[A-Za-z0-9_.$-]{1,63}$/.test(banco)) throw new Error("Informe o nome do banco antes de gerar o script.");
  return emb.scriptPermissoes({ usuario: String(d.usuario || "sira_ro").trim(), senha: String(d.senha || ""), banco, incluirCnsCpf: !!d.incluirCnsCpf, incluirNomes: !!d.incluirNomes, ip: d.ip ? String(d.ip).trim().slice(0, 64) : null });
}
function remover(slug) { desligar(slug); try { fs.unlinkSync(ARQ(slug)); } catch {} }
async function iniciar() {
  if (!habilitado()) return;
  for (const slug of Object.keys(auth.tenants())) {
    const c = lerCfg(slug); if (!c) continue;
    try { await ligar(slug, { ...c, senha: decifrar(c.senhaEnc), sal: c.salEnc ? decifrar(c.salEnc) : gerarSal() }); console.log(`[direto] "${slug}" ligado a ${c.host}:${c.porta}/${c.banco}`); }
    catch (e) { console.error(`[direto] "${slug}" não ligou: ${traduzir(e)} — nova tentativa em 30s`); setTimeout(() => iniciar().catch(() => {}), 30000).unref(); }
  }
}
module.exports = { gerarScript, habilitado, validar, testar, salvar, remover, publico, iniciar, lerCfg, traduzir };
