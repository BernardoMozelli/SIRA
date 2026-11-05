// Teste do modo direto contra um PostgreSQL real com as views do SIRA. Uso:
//   SIRA_TESTE_DB="host=127.0.0.1 porta=5432 banco=esusd ro_usuario=sira_ro ro_senha=... adm_usuario=postgres adm_senha=..." node src/teste_direto.js
const assert = require("assert"), os = require("os"), fs = require("fs"), path = require("path");
const cfg = Object.fromEntries((process.env.SIRA_TESTE_DB || "").split(/\s+/).filter(Boolean).map((p) => p.split("=")));
if (!cfg.host) { console.log("pulado: defina SIRA_TESTE_DB"); process.exit(0); }
process.env.SIRA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sira-dir-")); process.env.SIRA_SEGREDO = "teste-segredo"; process.env.SIRA_MODO_DIRETO = "1";
const auth = require("./auth"); auth.criarCliente("demo", "Prefeitura Demo"); auth.criarUsuario("demo", "adm", "Administrador Demo", "SIRA@2026", "admin");
auth.criarUsuario("demo", "ges", "Gestora Demo", "SIRA@2026", "gestor");
const { server } = require("./index"); let B;
const login = async (u) => (await fetch(B + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: u, senha: "SIRA@2026" }) })).headers.get("set-cookie").split(";")[0];
const call = async (c, m, p, b) => { const r = await fetch(B + p, { method: m, headers: { cookie: c, "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { s: r.status, ...j }; };
(async () => {
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok)); B = "http://127.0.0.1:" + server.address().port;
  const adm = await login("adm"), ges = await login("ges");
  const base = { host: cfg.host, porta: Number(cfg.porta), banco: cfg.banco };
  let r = await call(ges, "GET", "/api/conexao"); assert.equal(r.s, 403, "gestor não vê conexão");
  r = await call(adm, "GET", "/api/conexao"); assert.equal(r.s, 200); assert.equal(r.configurado, false);
  r = await call(adm, "POST", "/api/conexao/testar", { ...base, usuario: cfg.ro_usuario, senha: "errada" }); assert(!r.ok && /senha/.test(r.erro), r.erro);
  r = await call(adm, "POST", "/api/conexao/testar", { ...base, porta: 1, usuario: cfg.ro_usuario, senha: "x" }); assert(!r.ok && /recusada|Sem resposta/.test(r.erro), r.erro);
  r = await call(adm, "POST", "/api/conexao/testar", { ...base, banco: "naoexiste", usuario: cfg.ro_usuario, senha: cfg.ro_senha }); assert(!r.ok, "banco inexistente");
  r = await call(adm, "POST", "/api/conexao/testar", { ...base, host: "bad host;", usuario: "u", senha: "x" }); assert(!r.ok && /Servidor inválido/.test(r.erro));
  r = await call(adm, "POST", "/api/conexao/testar", { ...base, usuario: cfg.adm_usuario, senha: cfg.adm_senha }); assert(r.ok && r.avisos.length, "admin gera aviso");
  r = await call(adm, "POST", "/api/conexao/testar", { ...base, usuario: cfg.ro_usuario, senha: cfg.ro_senha }); assert(r.ok && !r.avisos.length && r.cidadaos > 0, JSON.stringify(r));
  r = await call(adm, "POST", "/api/perguntar", { texto: "quantos hipertensos ativos?" }); assert.equal(r.s, 503, "offline antes de conectar");
  r = await call(adm, "POST", "/api/conexao/salvar", { ...base, usuario: cfg.ro_usuario, senha: "errada" }); assert.equal(r.s, 400);
  r = await call(adm, "POST", "/api/conexao/salvar", { ...base, usuario: cfg.ro_usuario, senha: cfg.ro_senha }); assert.equal(r.s, 200); assert(r.conectado && r.temSenha && !JSON.stringify(r).includes(cfg.ro_senha));
  assert(!fs.readFileSync(path.join(auth.DATA, "conexao-demo.json"), "utf8").includes(cfg.ro_senha), "senha cifrada em disco");
  r = await call(ges, "GET", "/api/eu"); assert.equal(r.conectorOnline, true);
  r = await call(ges, "POST", "/api/perguntar", { texto: "quantos hipertensos ativos?" }); assert.equal(r.s, 200, JSON.stringify(r)); assert(r.ok, JSON.stringify(r)); console.log("resposta:", r.texto);
  assert(/274/.test(r.texto), "bate com o gabarito");
  r = await call(adm, "POST", "/api/conexao/testar", { ...base, usuario: cfg.ro_usuario, senha: "" }); assert(r.ok, "senha em branco reaproveita a salva");
  // reinício: religa sozinho a partir do arquivo cifrado
  r = await call(ges, "POST", "/api/perguntar", { texto: "quantos hipertensos ativos?" }); assert(r.premissas.some((x) => /Números calculados há/.test(x)), "2ª resposta indica cache");
  r = await call(adm, "GET", "/api/conexao"); assert.equal(r.modo, "views");
  // ── modo SOMENTE LEITURA: nada instalado, usuário só com permissão por coluna ──
  require("./direto").remover("demo");
  r = await call(ges, "POST", "/api/perguntar", { texto: "quantos hipertensos ativos?" }); assert.equal(r.s, 503);
  r = await call(adm, "POST", "/api/conexao/script", { ...base, usuario: "sira_col", senha: "curta" }); assert.equal(r.s, 400);
  r = await call(adm, "POST", "/api/conexao/script", { ...base, usuario: "sira_col", senha: "Senha-Forte-Teste-123", ip: "10.0.0.20" }); assert.equal(r.s, 200); assert(/GRANT SELECT \(/.test(r.sql) && !/no_cidadao/.test(r.sql) && /10\.0\.0\.20/.test(r.sql));
  const { Pool } = require("module").createRequire(path.join(__dirname, "..", "..", "conector", "src", "executor.js"))("pg");
  const adm2 = new Pool({ connectionString: `postgres://${cfg.adm_usuario}:${cfg.adm_senha}@${cfg.host}:${cfg.porta}/${cfg.banco}` });
  await adm2.query("DROP OWNED BY sira_col").catch(() => {}); await adm2.query("DROP ROLE IF EXISTS sira_col"); await adm2.query(r.sql);
  r = await call(adm, "POST", "/api/conexao/testar", { ...base, usuario: "sira_col", senha: "Senha-Forte-Teste-123" }); assert(r.ok && r.modo === "embutido", JSON.stringify(r));
  console.log("modo detectado com sira_col:", r.modo, "| desativadas:", r.desativadas.map((x) => x.id).join(","));
  assert.deepEqual(r.desativadas.map((x) => x.id), ["cadastro_pendencias", "lista_cadastros_sem_cpf", "lista_cadastros_sem_cns", "lista_gestantes", "lista_gestantes_sem_prenatal", "lista_hipertensos_sem_consulta", "lista_diabeticos_sem_consulta"]);
  r = await call(adm, "POST", "/api/conexao/salvar", { ...base, usuario: "sira_col", senha: "Senha-Forte-Teste-123" }); assert.equal(r.s, 200, JSON.stringify(r)); assert.equal(r.modo, "embutido");
  r = await call(ges, "POST", "/api/perguntar", { texto: "quantos hipertensos ativos?" }); assert(r.ok && /274/.test(r.texto), JSON.stringify(r)); console.log("resposta (embutido):", r.texto);
  r = await call(ges, "GET", "/api/catalogo"); assert(!r.perguntas.some((x) => x.id === "cadastro_pendencias"), "pergunta sem permissão some do catálogo");
  await adm2.query("DROP OWNED BY sira_col"); await adm2.query("DROP ROLE sira_col"); await adm2.end();
  require("./direto").remover("demo"); r = await call(ges, "POST", "/api/perguntar", { texto: "quantos hipertensos ativos?" }); assert.equal(r.s, 503);
  console.log("OK — modo direto"); server.close(); process.exit(0);
})().catch((e) => { console.error("FALHOU:", e.message); process.exit(1); });
