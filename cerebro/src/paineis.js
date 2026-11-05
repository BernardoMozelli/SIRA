// "Meus painéis": gráficos e números que o usuário fixa para ver de novo, sempre com dados atualizados.
// Guarda só COMO calcular (id da pergunta + parâmetros, ou o SELECT já validado com selo de integridade), nunca o resultado.
// Privado por usuário (mesmo modelo do histórico: o dono vem da sessão). Listas com nomes não podem ser fixadas.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const auth = require("./auth");
const livre = require("./livre");

const DIR = () => { const d = path.join(auth.DATA, "paineis"); fs.mkdirSync(d, { recursive: true, mode: 0o700 }); return d; };
const MAX = 24;
const arquivo = (u) => path.join(DIR(), crypto.createHash("sha256").update(`${u.tenant}\0${u.login}`).digest("hex").slice(0, 40) + ".json");
const ler = (u) => { try { const j = JSON.parse(fs.readFileSync(arquivo(u), "utf8")); return Array.isArray(j.itens) ? j : { itens: [] }; } catch { return { itens: [] }; } };
function gravar(u, p) { const f = arquivo(u), t = f + ".tmp"; fs.writeFileSync(t, JSON.stringify(p), { mode: 0o600 }); fs.renameSync(t, f); }
const idNovo = () => crypto.randomBytes(9).toString("base64url");
const titulo = (t) => String(t || "").replace(/\s+/g, " ").trim().slice(0, 80);
const GR = new Set(["barras", "linhas", "pizza", "nenhum"]);

function listar(u) { return ler(u).itens; }
// fonte: { tipo: "livre", sql, selo } | { tipo: "catalogo", pergunta, params }. catalogoOk(id) diz se a pergunta existe e não é lista nominal.
function adicionar(u, { titulo: t, fonte, grafico }, catalogoOk) {
  const p = ler(u); if (p.itens.length >= MAX) throw new Error(`Limite de ${MAX} itens no painel. Remova algum para fixar outro.`);
  const nome = titulo(t); if (!nome) throw new Error("Informe um título.");
  let f;
  if (fonte?.tipo === "livre") {
    if (!livre.seloOk(u.tenant, fonte.sql, fonte.selo)) throw new Error("Esta consulta não pode ser fixada (selo inválido). Refaça a pergunta e fixe de novo.");
    f = { tipo: "livre", sql: String(fonte.sql), selo: String(fonte.selo) };
  } else if (fonte?.tipo === "catalogo") {
    if (!catalogoOk(String(fonte.pergunta))) throw new Error("Esta consulta não pode ser fixada no painel (listas com nomes não são fixadas).");
    f = { tipo: "catalogo", pergunta: String(fonte.pergunta), params: fonte.params && typeof fonte.params === "object" ? JSON.parse(JSON.stringify(fonte.params)) : {} };
  } else throw new Error("Origem inválida.");
  const g = grafico && GR.has(grafico.tipo) ? { tipo: grafico.tipo, x: String(grafico.x || "").slice(0, 60), y: String(grafico.y || "").slice(0, 60) } : { tipo: "nenhum" };
  const item = { id: idNovo(), titulo: nome, fonte: f, grafico: g, criada: Date.now() };
  p.itens.push(item); gravar(u, p); return item;
}
function renomear(u, id, t) { const p = ler(u), i = p.itens.find((x) => x.id === String(id)); if (!i) throw new Error("Item não encontrado."); const n = titulo(t); if (!n) throw new Error("Informe um título."); i.titulo = n; gravar(u, p); return i; }
function trocarGrafico(u, id, tipo) { const p = ler(u), i = p.itens.find((x) => x.id === String(id)); if (!i) throw new Error("Item não encontrado."); if (!GR.has(tipo)) throw new Error("Tipo de gráfico inválido."); i.grafico = { ...i.grafico, tipo }; gravar(u, p); return i; }
function remover(u, id) { const p = ler(u), n = p.itens.length; p.itens = p.itens.filter((x) => x.id !== String(id)); if (p.itens.length === n) throw new Error("Item não encontrado."); gravar(u, p); }
function limpar(u) { try { fs.unlinkSync(arquivo(u)); } catch {} }
module.exports = { listar, adicionar, renomear, trocarGrafico, remover, limpar };
