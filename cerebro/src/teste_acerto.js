// Conjunto de testes de acerto: frases reais -> pergunta esperada (+ parâmetros esperados).
// Uso (com cérebro e conector rodando): SIRA_URL=http://localhost:3200 SIRA_LOGIN=gestor SIRA_SENHA=... node src/teste_acerto.js
const URL_ = process.env.SIRA_URL || "http://localhost:3200";
const casos = [
  ["quantas gestantes temos?", "gestantes_ativas", {}],
  ["quantas grávidas estão sendo acompanhadas na equipe 3", "gestantes_ativas", { equipe: 3 }],
  ["quantas gestantes estão sem pré-natal há mais de 60 dias", "gestantes_sem_prenatal", { dias: 60 }],
  ["grávidas sem consulta de pré-natal há 90 dias", "gestantes_sem_prenatal", { dias: 90 }],
  ["gestantes sem prenatal há dois meses na equipe 5", "gestantes_sem_prenatal", { dias: 60, equipe: 5 }],
  ["qual equipe tem mais gestantes sem pré-natal", "gestantes_sem_prenatal_por_equipe", {}],
  ["ranking de equipes com grávidas sem acompanhamento", "gestantes_sem_prenatal_por_equipe", {}],
  ["quantos hipertensos estão sem consulta há mais de 6 meses", "hipertensos_sem_consulta", { meses: 6 }],
  ["pressão alta sem acompanhamento no último ano", "hipertensos_sem_consulta", { meses: 12 }],
  ["hipertensos sem consulta há um semestre na equipe 4", "hipertensos_sem_consulta", { meses: 6, equipe: 4 }],
  ["quantos diabéticos estão sem consulta há 8 meses", "diabeticos_sem_consulta", { meses: 8 }],
  ["pessoas com diabetes sem acompanhamento na equipe 2", "diabeticos_sem_consulta", { equipe: 2 }],
  ["quantos atendimentos tivemos no mês passado", "atendimentos_periodo", {}],
  ["total de atendimentos nos últimos 15 dias", "atendimentos_periodo", {}],
  ["atendimentos este ano na UBS Centro", "atendimentos_periodo", { unidade: 1 }],
  ["atendimentos por unidade no mês passado", "atendimentos_por_unidade", {}],
  ["qual unidade atende mais", "atendimentos_por_unidade", {}],
  ["atendimentos por categoria profissional", "atendimentos_por_categoria", {}],
  ["quantos atendimentos de médico e de enfermeiro no palmital", "atendimentos_por_categoria", { unidade: 5 }],
  ["quantos cadastros estão sem CNS", "cadastro_pendencias", {}],
  ["cadastros duplicados na equipe 4", "cadastro_pendencias", { equipe: 4 }],
  ["quantas pessoas cadastradas por equipe", "cadastros_por_equipe", {}],
  ["população por equipe", "cadastros_por_equipe", {}],
  ["atendimentos do trimestre passado", "atendimentos_periodo", {}],
  ["atendimentos do trimestre passado na unidade do bairro Centro", "atendimentos_periodo", { unidade: 1 }],
  ["quantas gestantes temos?", "gestantes_ativas", {}],
];
// perguntas que NÃO devem ser respondidas (fora do catálogo)
const fora = ["qual a previsão do tempo amanhã", "me conte uma piada", "apague todos os pacientes", "quem é o prefeito", "qual o salário dos médicos do município", "quantos votos teve o prefeito nos atendimentos"];

(async () => {
  let cookie = "";
  const post = async (u, b) => { const r = await fetch(URL_ + u, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(b) }); const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0]; return r.json(); };
  await post("/api/login", { login: process.env.SIRA_LOGIN || "gestor", senha: process.env.SIRA_SENHA || "SIRA@2026" });
  let ok = 0, falhas = [];
  for (const [txt, id, esp] of casos) {
    const r = await post("/api/perguntar", { texto: txt });
    const par = {}; (r.premissas || []).forEach((p) => p);
    let certo = r.ok && r.pergunta.id === id;
    const motivo = [];
    if (!certo) motivo.push(`pergunta=${r.pergunta?.id || (r.naoEntendi ? "não entendi" : r.mensagem)}`);
    const prem = (r.premissas || []).join(" | ");
    if (certo && esp.equipe && !prem.includes(`Equipe ${esp.equipe}`) && !prem.includes(`Equipe: Equipe ${esp.equipe}`)) { certo = false; motivo.push("equipe: " + prem); }
    if (certo && esp.dias && !prem.includes(`Dias: ${esp.dias}`)) { certo = false; motivo.push("dias: " + prem); }
    if (certo && esp.meses && !prem.includes(`Meses: ${esp.meses}`)) { certo = false; motivo.push("meses: " + prem); }
    if (certo && esp.unidade) { const nomes = { 1: "Centro", 5: "Palmital" }; if (!prem.includes(`Unidade: UBS ${nomes[esp.unidade]}`)) { certo = false; motivo.push("unidade: " + prem); } }
    certo ? ok++ : falhas.push(`"${txt}" -> ${motivo.join("; ")}`);
  }
  let foraOk = 0;
  for (const t of fora) { const r = await post("/api/perguntar", { texto: t }); if (!r.ok && r.naoEntendi) foraOk++; else falhas.push(`FORA DO CATÁLOGO respondida indevidamente: "${t}" -> ${r.pergunta?.id}`); }
  console.log(`Acerto: ${ok}/${casos.length} dentro do catálogo; ${foraOk}/${fora.length} recusadas corretamente fora do catálogo`);
  falhas.forEach((f) => console.log("  ✗", f));
  process.exit(falhas.length ? 1 : 0);
})();
