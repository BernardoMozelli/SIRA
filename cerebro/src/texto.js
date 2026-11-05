// Busca da pergunta certa no catálogo: TF-IDF + similaridade de cosseno, sem modelo de IA.
const STOP = new Set(["a","o","as","os","de","da","do","das","dos","em","na","no","nas","nos","por","para","com","que","qual","quais","quantos","quantas","quanto","e","ou","um","uma","ha","tem","temos","estao","esta","sao","foi","foram","ser","meu","minha","nossa","nosso","me","mostre","mostra","diga","gostaria","saber","favor","pode","ver","numero","total","ter","tenho","existem","existe","ai","la","ao","aos","pelo","pela","dois","duas","tres","quatro","cinco","seis","sete","oito","nove","dez","onze","doze","quinze","vinte","trinta","quarenta","cinquenta","sessenta","noventa","mais","menos","ultimo","ultimos","ultima","ultimas"]);

const FRASES = [
  [/equipe\s*(?:n\s*)?\d+/g, " "], // "equipe 5" é filtro (parâmetro), não o tema da pergunta
  [/pre[\s-]?natal/g, "prenatal"],
  [/pressao alta/g, "hipertenso"],
  [/cartao (do )?sus/g, "cns"],
  [/\bsem acompanhamento\b/g, "sem prenatal sem consulta acompanhamento"],
];
const SIN = {
  gravida: "gestante", gravidas: "gestante", gravidez: "gestante", gestantes: "gestante",
  hipertensa: "hipertenso", hipertensas: "hipertenso", hipertensos: "hipertenso", hipertensao: "hipertenso",
  diabetes: "diabetico", diabetica: "diabetico", diabeticas: "diabetico", diabeticos: "diabetico",
  ubs: "unidade", ubss: "unidade", posto: "unidade", postos: "unidade", unidades: "unidade",
  meses: "mes", mes: "mes", consultas: "consulta", atendimentos: "atendimento",
  duplicados: "duplicado", duplicadas: "duplicado", duplicidade: "duplicado", repetidos: "duplicado",
  cadastrados: "cadastro", cadastradas: "cadastro", cadastros: "cadastro", populacao: "cadastro", pessoas: "pessoa",
  profissional: "categoria", profissionais: "categoria", ranking: "ranking", equipes: "equipe",
};

function normalizar(s) {
  return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9/]+/g, " ").trim();
}

function tokens(s) {
  let t = " " + normalizar(s) + " ";
  for (const [re, to] of FRASES) t = t.replace(re, to);
  const base = t.split(/\s+/).filter(Boolean).filter((w) => !STOP.has(w) && !/^\d+$/.test(w) && !w.includes("/"));
  const uni = base.map((w) => SIN[w] || (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
  const bi = []; for (let i = 0; i < uni.length - 1; i++) bi.push(uni[i] + "_" + uni[i + 1]);
  return uni.concat(bi);
}

function contar(arr) { const m = new Map(); for (const t of arr) m.set(t, (m.get(t) || 0) + 1); return m; }

function construirIndice(manifesto) {
  const docs = manifesto.map((q) => {
    const texto = [q.titulo, q.titulo, q.descricao, ...(q.exemplos || [])].join(" . ");
    return { id: q.id, gatilhos: q.gatilhos || null, tf: contar(tokens(texto)) };
  });
  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const N = docs.length;
  const idf = (t) => Math.log(1 + N / (1 + (df.get(t) || 0)));
  const vet = (tf) => { const v = new Map(); let n = 0; for (const [t, c] of tf) { const w = (1 + Math.log(c)) * idf(t); v.set(t, w); n += w * w; } return { v, norma: Math.sqrt(n) || 1 }; };
  return { docs: docs.map((d) => ({ id: d.id, gatilhos: d.gatilhos, ...vet(d.tf) })), vet, df };
}

function buscar(indice, pergunta, topo = 3) {
  const norm = normalizar(pergunta);
  const todos = tokens(pergunta);
  // Palavras que o catálogo desconhece não penalizam a busca (ex.: "bairro", "trimestre"), mas a pergunta precisa
  // ter maioria de palavras conhecidas; senão é assunto fora do catálogo.
  const uni = todos.filter((t) => !t.includes("_")), conhecidos = uni.filter((t) => indice.df.has(t));
  const cobertura = uni.length ? conhecidos.length / uni.length : 0;
  const q = indice.vet(contar(todos.filter((t) => indice.df.has(t))));
  const resultados = indice.docs.map((d) => {
    let dot = 0; for (const [t, w] of q.v) if (d.v.has(t)) dot += w * d.v.get(t);
    let score = (dot / (q.norma * d.norma)) * Math.sqrt(cobertura);
    if (cobertura < 0.6) score *= 0.3;
    // perguntas "agrupadas" só valem se o usuário pediu agrupamento/ranking
    if (d.gatilhos && !d.gatilhos.some((g) => norm.includes(g))) score *= 0.5;
    return { id: d.id, score };
  }).sort((a, b) => b.score - a.score);
  return resultados.slice(0, topo);
}

// Decide: aceitar a melhor, ou pedir esclarecimento.
function decidir(res) {
  const [a, b] = res;
  if (!a || a.score < 0.2) return { tipo: "nao_entendi", candidatos: res.filter((r) => r.score > 0.08) };
  if (b && b.score > 0 && a.score < 1.15 * b.score && a.score < 0.45) return { tipo: "ambigua", candidatos: res.filter((r) => r.score > 0.12) };
  return { tipo: "ok", id: a.id, score: a.score };
}

module.exports = { normalizar, tokens, construirIndice, buscar, decidir };
