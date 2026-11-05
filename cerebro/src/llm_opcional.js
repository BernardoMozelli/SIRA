// Extrator opcional por IA (qualquer provedor cadastrado em Configurações → IA).
// Só é consultado para parâmetros que as regras NÃO encontraram. Recebe apenas o texto da pergunta
// (com números de documento/contato mascarados) e as listas de unidades e equipes. Nunca dado de paciente.
const ia = require("./ia");
const { extrairJSON, mascarar } = require("./provedores");
const { normalizar } = require("./texto");

// A IA só vale a pena (e só recebe o texto) quando a pergunta dá sinal de um parâmetro que as regras não decifraram.
// Sem esse sinal, o padrão é o que o usuário quis (ex.: "quantos atendimentos tivemos" = período padrão).
const SINAL = {
  periodo: /\b(mes|meses|ano|anos|semana|semanas|dia|dias|trimestre|semestre|ontem|hoje|desde|entre|passad[oa]s?|anterior|ultim[oa]s?|recente|inicio|fim|quinzena|bimestre)\b/,
  int: /\b(mes|meses|ano|anos|semana|semanas|dia|dias|trimestre|semestre|bimestre|quinzena)\b/,
  unidade: /\b(ubs|unidade|posto|esf|bairro|distrito|centro de saude)\b/,
  equipe: /\b(equipe|esf|ine)\b/,
};

async function refinar(texto, q, ent, extraido) {
  let cfg; try { cfg = ia.ativa(); } catch (e) { ia.registrarUso(false, 0, e.message); return extraido; }
  if (!cfg) return extraido;
  const norm = normalizar(texto);
  const faltando = q.params.filter((p) => extraido.origem[p.nome] === "padrao" && SINAL[p.tipo]?.test(norm));
  if (!faltando.length) return extraido;

  const esquema = faltando.map((p) => `- ${p.nome}: ${p.tipo === "periodo" ? '{"de":"AAAA-MM-DD","ate":"AAAA-MM-DD"}' : p.tipo === "int" ? `inteiro entre ${p.min} e ${p.max}` : "id inteiro da lista"}`).join("\n");
  const prompt = `Hoje é ${new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)}. Extraia da pergunta apenas os parâmetros pedidos; use null quando a pergunta não disser.
Equipes: ${JSON.stringify(ent.equipes)}
Unidades: ${JSON.stringify(ent.unidades)}
Parâmetros pedidos:
${esquema}
Pergunta: "${mascarar(texto)}"`;

  const t0 = Date.now();
  try {
    const j = await extrairJSON({ ...cfg, prompt });
    for (const p of faltando) {
      const v = j[p.nome]; if (v === null || v === undefined) continue;
      if (p.tipo === "int" && Number.isInteger(v) && v >= p.min && v <= p.max) { extraido.params[p.nome] = v; extraido.origem[p.nome] = "llm"; }
      else if ((p.tipo === "equipe" || p.tipo === "unidade") && Number.isInteger(v) && (p.tipo === "equipe" ? ent.equipes : ent.unidades).some((x) => x.id === v)) { extraido.params[p.nome] = v; extraido.origem[p.nome] = "llm"; }
      else if (p.tipo === "periodo" && /^\d{4}-\d{2}-\d{2}$/.test(v?.de) && /^\d{4}-\d{2}-\d{2}$/.test(v?.ate) && v.de <= v.ate) { extraido.params[p.nome] = { de: v.de, ate: v.ate }; extraido.origem[p.nome] = "llm"; }
    }
    extraido.ia = cfg.provedor; ia.registrarUso(true, Date.now() - t0);
  } catch (e) { ia.registrarUso(false, Date.now() - t0, e.message); /* falha: mantém os valores por regras */ }
  return extraido;
}
module.exports = { refinar };
