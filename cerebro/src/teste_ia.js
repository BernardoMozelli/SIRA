// Testa as integrações de IA SEM chamar nenhum provedor real: usa servidores falsos que conferem
// URL, cabeçalhos e corpo exatamente como cada API exige. Uso: node src/teste_ia.js
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http"), assert = require("assert");
const { spawnSync } = require("child_process");
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sira-ia-"));
process.env.SIRA_DATA = DATA; process.env.SIRA_SEGREDO = "segredo-de-teste-ia";
const auth = require("./auth"), ia = require("./ia"), prov = require("./provedores"), llm = require("./llm_opcional");
const { server } = require("./index");
const { manifesto } = require("../../conector/src/catalogo");

let n = 0; const t = (nome, c) => { assert.ok(c, nome); n++; console.log("ok -", nome); };
const recebidos = [];
const CH = { anthropic: "sk-ant-teste-1234567890", openai: "sk-oa-teste-1234567890", gemini: "AIza-teste-1234567890", manus: "manus-teste-1234567890" };
let manusPolls = 0;

const fake = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const corpo = b ? JSON.parse(b) : null; recebidos.push({ m: req.method, u: req.url, h: req.headers, b: corpo });
    const ok = (o) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
    const erro = (st, msg) => { res.statusCode = st; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ error: { message: msg } })); };
    if (req.url.startsWith("/v1/messages")) {
      if (req.headers["x-api-key"] !== CH.anthropic) return erro(401, "invalid x-api-key " + req.headers["x-api-key"]);
      return ok({ content: [{ type: "text", text: 'Aqui está:\n```json\n{"ok": true, "mensagem": "SIRA conectado", "unidade": 3}\n```' }] });
    }
    if (req.url.startsWith("/v1/models")) return ok({ data: [{ id: "claude-haiku-5-5" }, { id: "claude-opus-5-5" }] });
    if (req.url === "/oa/chat/completions") {
      if (req.headers.authorization !== "Bearer " + CH.openai) return erro(401, "Incorrect API key provided: " + req.headers.authorization);
      return ok({ choices: [{ message: { content: JSON.stringify({ ok: true, mensagem: "SIRA conectado", unidade: 3, periodo: { de: "2026-07-01", ate: "2026-09-30" } }) } }] });
    }
    if (req.url === "/oa/models") return ok({ data: [{ id: "gpt-b" }, { id: "gpt-a" }] });
    if (req.url === "/compat/chat/completions") {
      if (corpo.response_format) return erro(400, "response_format is not supported by this server");
      return ok({ choices: [{ message: { content: '{"ok": true, "mensagem": "compat ok"}' } }] });
    }
    if (/^\/v1beta\/models\/gemini-teste:generateContent/.test(req.url)) {
      if (req.headers["x-goog-api-key"] !== CH.gemini) return erro(403, "API key not valid");
      return ok({ candidates: [{ content: { parts: [{ text: '{"ok": true, "mensagem": "SIRA conectado"}' }] } }] });
    }
    if (req.url.startsWith("/v1beta/models")) return ok({ models: [{ name: "models/gemini-teste", supportedGenerationMethods: ["generateContent"] }, { name: "models/embed-1", supportedGenerationMethods: ["embedContent"] }] });
    if (req.url === "/api/chat") return ok({ message: { content: '{"ok": true, "mensagem": "ollama ok"}' } });
    if (req.url === "/api/tags") return ok({ models: [{ name: "qwen2.5:3b" }] });
    if (req.url.startsWith("/manus/v2/task.create")) {
      if (req.headers["x-manus-api-key"] !== CH.manus) { res.statusCode = 401; return ok({ ok: false, error: { message: "invalid api key " + req.headers["x-manus-api-key"] } }); }
      manusPolls = 0; return ok({ ok: true, task_id: "T1", task_url: "x" });
    }
    if (req.url.startsWith("/manus/v2/task.listMessages")) {
      manusPolls++; const m = [{ type: "user_message" }, { type: "status_update", status_update: { agent_status: manusPolls < 2 ? "running" : "stopped" } }];
      if (manusPolls >= 2) m.push({ type: "assistant_message", assistant_message: { content: '```json\n{"ok": true, "mensagem": "SIRA conectado"}\n```' } });
      return ok({ ok: true, messages: m });
    }
    if (req.url.startsWith("/lento")) return setTimeout(() => ok({}), 3000);
    res.statusCode = 404; res.end("{}");
  });
});

(async () => {
  await new Promise((r) => fake.listen(0, "127.0.0.1", r)); const P = fake.address().port, B = `http://127.0.0.1:${P}`;
  process.env.SIRA_BASE_ANTHROPIC = B; process.env.SIRA_BASE_OPENAI = B + "/oa"; process.env.SIRA_BASE_GEMINI = B; process.env.SIRA_BASE_MANUS = B + "/manus";
  const ultimo = () => recebidos[recebidos.length - 1];

  // ---- adaptadores ----
  let r = await prov.extrairJSON({ provedor: "anthropic", modelo: "claude-haiku-5-5", chave: CH.anthropic, prompt: "oi" });
  t("Claude: lê JSON mesmo cercado de texto e ```", r.ok === true && r.unidade === 3);
  let q = ultimo(); t("Claude: POST /v1/messages com x-api-key, anthropic-version e max_tokens", q.u === "/v1/messages" && q.h["x-api-key"] === CH.anthropic && q.h["anthropic-version"] === "2023-06-01" && q.b.max_tokens > 0 && q.b.messages[0].role === "user" && !!q.b.system);
  r = await prov.extrairJSON({ provedor: "openai", modelo: "gpt-x", chave: CH.openai, prompt: "oi" });
  q = ultimo(); t("ChatGPT: /chat/completions com Bearer, response_format json_object e system", q.h.authorization === "Bearer " + CH.openai && q.b.response_format.type === "json_object" && q.b.messages[0].role === "system" && r.unidade === 3);
  r = await prov.extrairJSON({ provedor: "gemini", modelo: "models/gemini-teste", chave: CH.gemini, prompt: "oi" });
  q = ultimo(); t("Gemini: :generateContent com x-goog-api-key (não na URL) e responseMimeType JSON", q.u === "/v1beta/models/gemini-teste:generateContent" && q.h["x-goog-api-key"] === CH.gemini && !q.u.includes("key=") && q.b.generationConfig.responseMimeType === "application/json" && r.ok === true);
  r = await prov.extrairJSON({ provedor: "ollama", modelo: "qwen2.5:3b", baseUrl: B, prompt: "oi" });
  q = ultimo(); t("Ollama: /api/chat com format json, sem chave", q.u === "/api/chat" && q.b.format === "json" && q.b.stream === false && r.mensagem === "ollama ok");
  const antes = recebidos.length;
  r = await prov.extrairJSON({ provedor: "compativel", modelo: "m", baseUrl: B + "/compat", prompt: "oi" });
  t("Compatível: se o servidor recusa response_format, tenta de novo sem ele", r.mensagem === "compat ok" && recebidos.length === antes + 2 && !ultimo().b.response_format);

  // ---- erros e segurança ----
  let msg = ""; try { await prov.extrairJSON({ provedor: "openai", modelo: "x", chave: CH.openai + "ERRADA", prompt: "oi" }); } catch (e) { msg = e.message; }
  t("erro de chave volta como mensagem clara (HTTP 401)", /HTTP 401/.test(msg));
  // servidor que devolve a chave no texto do erro: deve sair mascarada
  const eco = http.createServer((q2, s) => { s.statusCode = 401; s.setHeader("content-type", "application/json"); s.end(JSON.stringify({ error: { message: "Incorrect API key provided: sk-SEGREDO-COMPLETO-9999" } })); });
  await new Promise((rr) => eco.listen(0, "127.0.0.1", rr));
  msg = ""; try { await prov.extrairJSON({ provedor: "compativel", modelo: "m", chave: "sk-SEGREDO-COMPLETO-9999", baseUrl: `http://127.0.0.1:${eco.address().port}`, prompt: "oi" }); } catch (e) { msg = e.message; }
  t("a chave nunca aparece em mensagens de erro", msg.includes("HTTP 401") && !msg.includes("SEGREDO-COMPLETO") && msg.includes("***")); eco.close();
  msg = ""; try { await prov.extrairJSON({ provedor: "compativel", modelo: "m", baseUrl: B + "/lento", prompt: "oi", timeoutMs: 400 }); } catch (e) { msg = e.message; }
  t("tempo limite respeitado", /Tempo esgotado/.test(msg));
  msg = ""; try { await prov.extrairJSON({ provedor: "anthropic", modelo: "m", prompt: "oi" }); } catch (e) { msg = e.message; }
  t("sem chave: pede para cadastrar", /Cadastre a chave/.test(msg));
  msg = ""; try { await prov.extrairJSON({ provedor: "compativel", modelo: "m", baseUrl: "ftp://x", prompt: "oi" }); } catch (e) { msg = e.message; }
  t("URL base inválida é recusada", /http/.test(msg));
  const mk = prov.mascarar("paciente cpf 123.456.789-09 cns 700000000000001 tel (31) 98888-7777 a@b.com equipe 3 há 60 dias em 01/08/2026");
  t("máscara tira CPF, CNS, telefone e e-mail, mas preserva equipe/dias/datas", !/\d{3}\.\d{3}|700000|98888|a@b/.test(mk) && /equipe 3/.test(mk) && /60 dias/.test(mk) && /01\/08\/2026/.test(mk));

  // ---- listar modelos ----
  t("listar modelos Claude", (await prov.listarModelos({ provedor: "anthropic", chave: CH.anthropic })).join() === "claude-haiku-5-5,claude-opus-5-5");
  t("listar modelos OpenAI (ordenado)", (await prov.listarModelos({ provedor: "openai", chave: CH.openai })).join() === "gpt-a,gpt-b");
  t("listar modelos Gemini (só os que geram texto, sem 'models/')", (await prov.listarModelos({ provedor: "gemini", chave: CH.gemini })).join() === "gemini-teste");
  t("listar modelos Ollama", (await prov.listarModelos({ provedor: "ollama", baseUrl: B })).join() === "qwen2.5:3b");

  // ---- armazenamento cifrado ----
  ia.salvar({ provedor: "anthropic", modelo: "claude-haiku-5-5", chave: CH.anthropic }, "teste");
  const bruto = fs.readFileSync(path.join(DATA, "ia.json"), "utf8");
  t("chave NÃO fica em texto puro no disco", !bruto.includes(CH.anthropic) && /"chaveEnc": "v1:/.test(bruto));
  t("arquivo ia.json com permissão 0600", (fs.statSync(path.join(DATA, "ia.json")).mode & 0o777) === 0o600);
  t("API pública só mostra os 4 últimos caracteres", JSON.stringify(ia.publico()).includes("7890") && !JSON.stringify(ia.publico()).includes(CH.anthropic));
  t("decifra de volta corretamente", ia.completa("anthropic").chave === CH.anthropic);
  const adulterado = JSON.parse(bruto); adulterado.provedores.anthropic.chaveEnc = adulterado.provedores.anthropic.chaveEnc.slice(0, -4) + "AAAA";
  fs.writeFileSync(path.join(DATA, "ia.json"), JSON.stringify(adulterado));
  msg = ""; try { ia.completa("anthropic"); } catch (e) { msg = e.message; }
  t("dado adulterado/segredo trocado: erro claro, sem quebrar", /ilegível/.test(msg));
  ia.salvar({ provedor: "anthropic", chave: CH.anthropic }, "teste");
  const filho = spawnSync("node", ["-e", `process.env.SIRA_DATA=${JSON.stringify(DATA)};const ia=require('./src/ia');try{ia.salvar({provedor:'openai',chave:'sk-12345678'},'x');console.log('SALVOU')}catch(e){console.log(e.message)}`], { cwd: path.join(__dirname, ".."), env: { ...process.env, SIRA_SEGREDO: "" }, encoding: "utf8" });
  t("sem SIRA_SEGREDO persistente: recusa guardar chave", /Defina SIRA_SEGREDO/.test(filho.stdout));

  // ---- integração com a extração de parâmetros ----
  ia.salvar({ provedor: "openai", modelo: "gpt-x", chave: CH.openai }, "teste"); ia.ativar("openai", "teste");
  const ent = { equipes: [{ id: 1, nome: "Equipe 1" }], unidades: [{ id: 3, nome: "UBS São Benedito" }] };
  const M = Object.fromEntries(manifesto().map((x) => [x.id, x]));
  const { extrair } = require("./parametros");
  const texto = "atendimentos do trimestre passado na unidade do bairro Benedito do paciente cpf 123.456.789-09";
  let ex = extrair(texto, M.atendimentos_periodo, ent); ex = await llm.refinar(texto, M.atendimentos_periodo, ent, ex);
  t("IA preenche período e unidade que as regras não acharam (há sinal na frase)", ex.params.unidade === 3 && ex.params.periodo.de === "2026-07-01" && ex.origem.periodo === "llm" && ex.ia === "openai");
  const enviado = JSON.stringify(ultimo().b);
  t("o CPF digitado NÃO foi enviado ao provedor", !/123\.456|12345678909/.test(enviado) && /\[nº\]/.test(enviado));
  t("o prompt não contém nenhum dado de paciente (só texto, equipes e unidades)", /Equipe 1/.test(enviado) && /São Benedito/.test(enviado));
  const ant = recebidos.length; let ex2 = extrair("atendimentos em março na UBS São Benedito", M.atendimentos_periodo, ent); await llm.refinar("atendimentos em março na UBS São Benedito", M.atendimentos_periodo, ent, ex2);
  t("se as regras acharam tudo, a IA nem é chamada (economiza custo e privacidade)", recebidos.length === ant);
  ia.ativar(null, "teste"); const ant2 = recebidos.length; let ex3 = extrair(texto, M.atendimentos_periodo, ent); await llm.refinar(texto, M.atendimentos_periodo, ent, ex3);
  t("IA desativada: nada é enviado", recebidos.length === ant2 && ex3.origem.periodo === "padrao");
  ia.ativar("openai", "teste"); process.env.SIRA_BASE_OPENAI = "http://127.0.0.1:1";
  let ex4 = extrair(texto, M.atendimentos_periodo, ent); ex4 = await llm.refinar(texto, M.atendimentos_periodo, ent, ex4);
  t("provedor fora do ar: o SIRA segue com as regras", ex4.origem.periodo === "padrao" && ia.publico().uso.falhas >= 1); process.env.SIRA_BASE_OPENAI = B + "/oa";

  // ---- API HTTP: permissões e fluxo da tela ----
  auth.criarCliente("demo", "Prefeitura Demonstração");
  auth.criarUsuario("demo", "g", "Gestor", "senha-forte-1"); auth.criarUsuario("demo", "a", "Admin", "senha-forte-1", "admin"); auth.criarUsuario("demo", "s", "Super", "senha-forte-1", "super");
  await new Promise((rr) => server.listen(0, "127.0.0.1", rr)); const S = `http://127.0.0.1:${server.address().port}`;
  const sessao = async (login) => { const x = await fetch(S + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login, senha: "senha-forte-1" }) }); return x.headers.get("set-cookie").split(";")[0]; };
  const [cg, ca, cs] = [await sessao("g"), await sessao("a"), await sessao("s")];
  const chama = async (ck, caminho, corpo) => { const x = await fetch(S + caminho, corpo === undefined ? { headers: { cookie: ck } } : { method: "POST", headers: { cookie: ck, "content-type": "application/json" }, body: JSON.stringify(corpo) }); return { st: x.status, j: await x.json() }; };
  t("gestor e admin da prefeitura NÃO acessam a configuração de IA (403)", (await chama(cg, "/api/ia")).st === 403 && (await chama(ca, "/api/ia")).st === 403 && (await chama(ca, "/api/ia/salvar", { provedor: "openai", chave: "xxxxxxxxxx" })).st === 403);
  t("sem login: 401", (await fetch(S + "/api/ia")).status === 401);
  let o = await chama(cs, "/api/ia"); t("super vê a configuração; 7 provedores prontos", o.st === 200 && Object.keys(o.j.provedores).join() === "ollama,anthropic,openai,gemini,openrouter,manus,compativel");
  o = await chama(cs, "/api/ia/salvar", { provedor: "gemini", modelo: "gemini-teste", chave: CH.gemini, ativar: true });
  t("salvar+ativar Gemini; resposta não traz a chave", o.st === 200 && o.j.ativo === "gemini" && !JSON.stringify(o.j).includes(CH.gemini) && o.j.provedores.gemini.chaveFim === "7890");
  o = await chama(cs, "/api/ia/testar", { provedor: "gemini" }); t("botão Testar conexão (Gemini) ok", o.j.ok === true && o.j.modelo === "gemini-teste");
  o = await chama(cs, "/api/ia/modelos", { provedor: "gemini" }); t("botão Buscar modelos (Gemini)", o.j.modelos.join() === "gemini-teste");
  o = await chama(cs, "/api/ia/salvar", { provedor: "manus", chave: CH.manus }); o = await chama(cs, "/api/ia/testar", { provedor: "manus" });
  t("Manus: testar conexão (cria a tarefa, consulta até terminar, lê o JSON)", o.j.ok === true && o.j.modelo === "standard");
  const cm = recebidos.find((x) => x.u.startsWith("/manus/v2/task.create"));
  t("Manus: tarefa oculta, perfil standard, instrução de só JSON", cm.b.hide_in_task_list === true && cm.b.agent_profile === "standard" && /SOMENTE o objeto JSON/.test(cm.b.message.content));
  o = await chama(cs, "/api/ia/modelos", { provedor: "manus" }); t("Manus: perfis standard, lite e max", o.j.modelos.join() === "standard,lite,max");
  o = await chama(cs, "/api/ia/salvar", { provedor: "manus", chave: "manus-ERRADA-1234567" }); o = await chama(cs, "/api/ia/testar", { provedor: "manus" });
  t("Manus: chave errada mostra o erro, com a chave mascarada", o.j.ok === false && /401/.test(o.j.erro) && !o.j.erro.includes("ERRADA-1234567")); await chama(cs, "/api/ia/salvar", { provedor: "manus", chave: CH.manus });
  o = await chama(cs, "/api/ia/salvar", { provedor: "openai", chave: "sk-oa-ERRADA-1234567" }); o = await chama(cs, "/api/ia/testar", { provedor: "openai", modelo: "gpt-x" });
  t("teste com chave errada mostra o erro do provedor, com a chave mascarada", o.j.ok === false && /401/.test(o.j.erro) && !JSON.stringify(o.j).includes("ERRADA-1234567") && /\*\*\*/.test(o.j.erro));
  await chama(cs, "/api/ia/salvar", { provedor: "compativel", modelo: "m" }); o = await chama(cs, "/api/ia/ativar", { provedor: "compativel" }); t("ativar 'compatível' sem URL base é recusado", o.j.ok === false && /URL base/.test(o.j.erro));
  o = await chama(cs, "/api/ia/salvar", { provedor: "gemini", chave: "tem espaço" }); t("chave com espaço é recusada", o.j.ok === false && /inválida/.test(o.j.erro));
  o = await chama(cs, "/api/ia/remover-chave", { provedor: "gemini" }); t("remover chave desativa o provedor que a usava", o.j.ativo === null && o.j.provedores.gemini.temChave === false);
  o = await chama(cs, "/api/ia/ativar", { provedor: "gemini" }); t("ativar provedor sem chave é recusado com mensagem", o.j.ok === false && /Cadastre a chave/.test(o.j.erro));
  const aud = fs.readFileSync(path.join(DATA, "auditoria-demo.jsonl"), "utf8");
  t("auditoria registra as mudanças de IA e nunca a chave", /ia_config/.test(aud) && !aud.includes(CH.gemini) && !aud.includes(CH.openai));

  console.log(`\n${n} verificações OK`); server.close(); fake.close(); process.exit(0);
})().catch((e) => { console.error("FALHOU:", e.message); process.exit(1); });
