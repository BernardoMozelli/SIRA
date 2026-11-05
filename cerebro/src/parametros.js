// Extração de parâmetros por regras (sem IA). Cada parâmetro registra a origem: "texto" ou "padrao".
const { normalizar } = require("./texto");

const NUM = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, quinze: 15, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, noventa: 90 };
const MESES = ["janeiro","fevereiro","marco","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];

const iso = (d) => d.toISOString().slice(0, 10);
const br = (s) => s.split("-").reverse().join("/");
function hojeBR(agora = Date.now()) { const d = new Date(agora - 3 * 3600e3); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
const somaDias = (d, n) => new Date(d.getTime() + n * 86400000);
const fimMes = (a, m) => new Date(Date.UTC(a, m + 1, 0));

function numerosPorExtenso(t) {
  t = t.replace(/quarenta e cinco/g, "45").replace(/vinte e quatro/g, "24");
  return t.replace(/\b(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|quinze|vinte|trinta|quarenta|cinquenta|sessenta|noventa)\b/g, (m) => NUM[m]);
}

function extrairDias(t) {
  let m;
  if ((m = t.match(/(\d+)\s*dias?/))) return +m[1];
  if ((m = t.match(/(\d+)\s*semanas?/))) return +m[1] * 7;
  if ((m = t.match(/(\d+)\s*mes(?:es)?/))) return +m[1] * 30;
  if ((m = t.match(/(\d+)\s*anos?/))) return +m[1] * 365;
  if (/semestre/.test(t)) return 180;
  if (/trimestre/.test(t)) return 90;
  if (/\bano\b/.test(t)) return 365;
  return null;
}
function extrairMeses(t) {
  let m;
  if ((m = t.match(/(\d+)\s*mes(?:es)?/))) return +m[1];
  if ((m = t.match(/(\d+)\s*anos?/))) return +m[1] * 12;
  if ((m = t.match(/(\d+)\s*dias?/))) return Math.max(1, Math.ceil(+m[1] / 30));
  if (/semestre/.test(t)) return 6;
  if (/trimestre/.test(t)) return 3;
  if (/\bano\b/.test(t)) return 12;
  return null;
}

function extrairPeriodo(t, agora) {
  const hoje = hojeBR(agora), A = hoje.getUTCFullYear(), M = hoje.getUTCMonth();
  let m;
  const datas = [...t.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g)].map((x) => new Date(Date.UTC(+x[3], +x[2] - 1, +x[1])));
  if (datas.length >= 2 && datas.every((d) => !Number.isNaN(d.getTime()))) {
    const [a, b] = datas.sort((x, y) => x - y); return { de: iso(a), ate: iso(b), rotulo: "datas informadas" };
  }
  if (/(mes passado|ultimo mes|mes anterior)/.test(t)) { const d = new Date(Date.UTC(A, M - 1, 1)); return { de: iso(d), ate: iso(fimMes(d.getUTCFullYear(), d.getUTCMonth())), rotulo: "mês passado" }; }
  if (/(este mes|neste mes|mes atual|mes corrente)/.test(t)) return { de: iso(new Date(Date.UTC(A, M, 1))), ate: iso(hoje), rotulo: "mês atual até hoje" };
  for (let i = 0; i < 12; i++) if (new RegExp(`\\b${MESES[i]}\\b(?: de (\\d{4}))?`).test(t)) {
    m = t.match(new RegExp(`\\b${MESES[i]}\\b(?: de (\\d{4}))?`)); let ano = m[1] ? +m[1] : (i > M ? A - 1 : A);
    return { de: iso(new Date(Date.UTC(ano, i, 1))), ate: iso(fimMes(ano, i)), rotulo: `${MESES[i]} de ${ano}` };
  }
  if ((m = t.match(/ultimos?\s*(\d+)\s*dias?/)) || (m = t.match(/(\d+)\s*dias?/))) { const n = Math.min(+m[1], 1000); return { de: iso(somaDias(hoje, -(n - 1))), ate: iso(hoje), rotulo: `últimos ${n} dias` }; }
  if ((m = t.match(/(\d+)\s*mes(?:es)?/))) { const n = +m[1]; const d = new Date(Date.UTC(A, M - n, hoje.getUTCDate() + 1)); return { de: iso(d), ate: iso(hoje), rotulo: `últimos ${n} meses` }; }
  if (/semana passada/.test(t)) { const dow = hoje.getUTCDay(); const seg = somaDias(hoje, -(dow === 0 ? 6 : dow - 1) - 7); return { de: iso(seg), ate: iso(somaDias(seg, 6)), rotulo: "semana passada" }; }
  if (/(esta semana|nesta semana)/.test(t)) { const dow = hoje.getUTCDay(); return { de: iso(somaDias(hoje, -(dow === 0 ? 6 : dow - 1))), ate: iso(hoje), rotulo: "semana atual" }; }
  if (/\bontem\b/.test(t)) return { de: iso(somaDias(hoje, -1)), ate: iso(somaDias(hoje, -1)), rotulo: "ontem" };
  if (/\bhoje\b/.test(t)) return { de: iso(hoje), ate: iso(hoje), rotulo: "hoje" };
  if (/ano passado/.test(t)) return { de: `${A - 1}-01-01`, ate: `${A - 1}-12-31`, rotulo: `ano de ${A - 1}` };
  if (/(este ano|neste ano|ano atual|ano corrente)/.test(t)) return { de: `${A}-01-01`, ate: iso(hoje), rotulo: "ano atual até hoje" };
  return null;
}

function acharEquipe(t, equipes) {
  const m = t.match(/equipe\s*(?:n[o°]?\s*)?(\d+)/);
  if (m) {
    const alvo = equipes.find((e) => (e.nome.match(/(\d+)\s*$/) || [])[1] === m[1]) || equipes.find((e) => String(e.id) === m[1]);
    return alvo ? { ok: true, e: alvo } : { ok: false, erro: `Não encontrei a equipe ${m[1]}.` };
  }
  const porNome = equipes.find((e) => new RegExp(`\\b${normalizar(e.nome)}\\b`).test(t));
  return porNome ? { ok: true, e: porNome } : null;
}
function acharUnidade(t, unidades) {
  let melhor = null;
  for (const u of unidades) {
    const n = normalizar(u.nome).replace(/^ubs\s+/, "");
    if (n.length >= 4 && new RegExp(`\\b${n}\\b`).test(t) && (!melhor || n.length > melhor.n)) melhor = { u, n: n.length };
  }
  return melhor ? melhor.u : null;
}

// "nomes que comecem com a letra B", "iniciados por M", "inicial A"
function extrairLetra(t) {
  const m = t.match(/(?:comec\w*|inici\w*|inicial|letra)\s+(?:com\s+|por\s+|pela\s+|pelo\s+|em\s+|e\s+)?(?:a\s+|o\s+)?(?:letra\s+)?([a-z])(?=\s|$)/);
  return m ? m[1].toUpperCase() : null;
}

function montarPremissas(q, params, origem, rotulos, ent) {
  const out = [];
  for (const def of q.params) {
    const por = origem[def.nome] === "padrao" ? " (padrão)" : origem[def.nome] === "llm" ? " (interpretado pela IA)" : "";
    if (def.tipo === "letra") out.push(`Inicial do nome: ${params.letra || "todas"}`);
    else if (def.tipo === "equipe") out.push(`Equipe: ${params.equipe ? (ent.equipes.find((e) => e.id === params.equipe) || {}).nome : "todas"}`);
    else if (def.tipo === "unidade") out.push(`Unidade: ${params.unidade ? (ent.unidades.find((u) => u.id === params.unidade) || {}).nome : "todas"}`);
    else if (def.tipo === "periodo") out.push(`Período: ${br(params.periodo.de)} a ${br(params.periodo.ate)}${rotulos.periodo && origem.periodo === "texto" ? ` (${rotulos.periodo})` : origem.periodo === "padrao" ? " (padrão: últimos 30 dias — informe outro se quiser)" : por}`);
    else out.push(`${def.rotulo}: ${params[def.nome]}${por}`);
  }
  return out;
}

// Retorna { params, origem, premissas, erro }
function extrair(texto, q, ent, agora = Date.now()) {
  const t = numerosPorExtenso(" " + normalizar(texto) + " ");
  const params = {}, origem = {}, premissas = [], rotulos = {};
  for (const def of q.params) {
    let v = null, achou = false;
    if (def.tipo === "int" && def.nome === "dias") v = extrairDias(t);
    else if (def.tipo === "int" && def.nome === "meses") v = extrairMeses(t);
    else if (def.tipo === "letra") { v = extrairLetra(t); if (v) rotulos.letra = v; }
    else if (def.tipo === "equipe") {
      const r = acharEquipe(t, ent.equipes); if (r && !r.ok) return { erro: r.erro };
      if (r) { v = r.e.id; rotulos.equipe = r.e.nome; }
    } else if (def.tipo === "unidade") { const u = acharUnidade(t, ent.unidades); if (u) { v = u.id; rotulos.unidade = u.nome; } }
    else if (def.tipo === "periodo") { const p = extrairPeriodo(t, agora); if (p) { v = { de: p.de, ate: p.ate }; rotulos.periodo = p.rotulo; } }
    achou = v !== null && v !== undefined;
    if (def.tipo === "int" && achou) {
      v = Math.min(Math.max(v, def.min), def.max);
    }
    if (achou) { params[def.nome] = v; origem[def.nome] = "texto"; }
    else if (def.tipo === "periodo") {
      const hoje = hojeBR(agora); params.periodo = { de: iso(somaDias(hoje, -29)), ate: iso(hoje) }; origem.periodo = "padrao"; rotulos.periodo = "últimos 30 dias";
    } else if (def.padrao !== undefined) { params[def.nome] = def.padrao; origem[def.nome] = "padrao"; }
    else origem[def.nome] = "padrao"; // filtro opcional não informado (= todos); o LLM opcional pode preencher
  }
  return { params, origem, rotulos, premissas: montarPremissas(q, params, origem, rotulos, ent) };
}

module.exports = { extrair, montarPremissas, hojeBR, extrairLetra };
