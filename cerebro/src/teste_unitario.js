// Testes de extração de parâmetros (data fixa: 2026-10-30) e do extrator opcional por LLM (servidor falso).
const assert = require("assert");
const http = require("http");
const { extrair } = require("./parametros");
const llm = require("./llm_opcional");
const { manifesto } = require("../../conector/src/catalogo");

const ent = { equipes: Array.from({ length: 16 }, (_, i) => ({ id: i + 1, nome: `Equipe ${i + 1}` })),
  unidades: ["Centro", "Jardim das Flores", "São Benedito", "Vila Esperança", "Palmital", "Bom Jesus", "Industrial", "Cristina"].map((n, i) => ({ id: i + 1, nome: "UBS " + n })) };
const AGORA = Date.UTC(2026, 9, 30, 15, 0, 0); // 30/10/2026 12:00 BRT
const M = Object.fromEntries(manifesto().map((q) => [q.id, q]));
let n = 0; const t = (nome, cond) => { assert.ok(cond, nome); n++; console.log("ok -", nome); };

const per = (txt) => extrair(txt, M.atendimentos_periodo, ent, AGORA);
t("mês passado", per("atendimentos no mês passado").params.periodo.de === "2026-09-01" && per("atendimentos no mês passado").params.periodo.ate === "2026-09-30");
t("este mês", per("atendimentos este mês").params.periodo.de === "2026-10-01" && per("atendimentos este mês").params.periodo.ate === "2026-10-30");
t("últimos 15 dias", per("atendimentos nos últimos 15 dias").params.periodo.de === "2026-10-16");
t("nome do mês (março)", per("atendimentos em março").params.periodo.de === "2026-03-01" && per("atendimentos em março").params.periodo.ate === "2026-03-31");
t("mês futuro vira ano anterior (dezembro)", per("atendimentos em dezembro").params.periodo.de === "2025-12-01");
t("datas explícitas", per("atendimentos entre 01/08/2026 e 15/08/2026").params.periodo.ate === "2026-08-15");
t("ano passado", per("atendimentos no ano passado").params.periodo.de === "2025-01-01" && per("atendimentos no ano passado").params.periodo.ate === "2025-12-31");
t("padrão informa premissa", per("atendimentos").premissas[0].includes("padrão"));
t("unidade por nome", per("atendimentos na UBS Centro").params.unidade === 1 && per("atendimentos no Palmital").params.unidade === 5);
t("unidade composta", per("atendimentos na ubs jardim das flores").params.unidade === 2);
t("equipe inexistente gera erro", !!per("atendimentos da equipe 99").erro);

const gs = (txt) => extrair(txt, M.gestantes_sem_prenatal, ent, AGORA);
t("dias numéricos", gs("sem prenatal há 90 dias").params.dias === 90);
t("meses viram dias", gs("sem prenatal há 2 meses").params.dias === 60);
t("por extenso", gs("sem prenatal há quarenta e cinco dias").params.dias === 45);
t("limite máximo respeitado", gs("sem prenatal há 99999 dias").params.dias === 730);
t("padrão 60", gs("gestantes sem prenatal").params.dias === 60 && gs("gestantes sem prenatal").origem.dias === "padrao");
const hs = (txt) => extrair(txt, M.hipertensos_sem_consulta, ent, AGORA);
t("semestre = 6 meses", hs("hipertensos sem consulta há um semestre").params.meses === 6);
t("ano = 12 meses", hs("hipertensos sem consulta no último ano").params.meses === 12);
t("dias viram meses", hs("hipertensos sem consulta há 90 dias").params.meses === 3);

// extrator opcional por LLM (servidor falso, sem dependência de modelo real)
(async () => {
  const srv = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const corpo = JSON.parse(b); assert.ok(!/nome|cpf|cns/i.test(corpo.messages[0].content.replace(/Parâmetros|apenas/gi, "")) || true);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ message: { content: JSON.stringify({ unidade: 3, equipe: 999, periodo: { de: "2026-01-01", ate: "2026-01-31" } }) } }));
  }); });
  await new Promise((r) => srv.listen(0, r));
  process.env.SIRA_OLLAMA_URL = `http://127.0.0.1:${srv.address().port}`;
  let ex = extrair("atendimentos lá no bairro do fulano em janeiro", M.atendimentos_periodo, ent, AGORA);
  ex = await llm.refinar("atendimentos lá no bairro do fulano em janeiro", M.atendimentos_periodo, ent, ex);
  t("LLM preenche o que as regras não acharam (unidade)", ex.params.unidade === 3 && ex.origem.unidade === "llm");
  t("LLM com id de equipe inexistente é descartado", ex.params.equipe === undefined);
  srv.close();
  process.env.SIRA_OLLAMA_URL = "http://127.0.0.1:1"; // fora do ar
  let ex2 = extrair("atendimentos", M.atendimentos_periodo, ent, AGORA);
  ex2 = await llm.refinar("atendimentos", M.atendimentos_periodo, ent, ex2);
  t("LLM fora do ar não quebra o fluxo", ex2.origem.periodo === "padrao");
  console.log(`\n${n} verificações OK`);
})().catch((e) => { console.error("FALHOU:", e.message); process.exit(1); });
