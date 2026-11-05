// Histórico de pesquisas POR USUÁRIO. Cada pessoa só enxerga as próprias conversas: o arquivo é escolhido pelo login da SESSÃO
// (nunca por parâmetro enviado pelo navegador), e o nome do arquivo é um hash de cliente+login. Guarda só o texto da pergunta
// (com documentos e contatos mascarados) e a resposta agregada que o SIRA devolveu: nenhum dado de paciente.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const auth = require("./auth");
const { mascarar } = require("./provedores");

const DIR = () => { const d = path.join(auth.DATA, "historico"); fs.mkdirSync(d, { recursive: true, mode: 0o700 }); return d; };
const MAX_CONVERSAS = 300, MAX_MENSAGENS = 200;
const dias = () => { const n = Number(process.env.SIRA_HISTORICO_DIAS ?? 180); return Number.isFinite(n) && n >= 0 ? n : 180; }; // 0 = guarda sem limite de tempo
const arquivo = (u) => path.join(DIR(), crypto.createHash("sha256").update(`${u.tenant}\0${u.login}`).digest("hex").slice(0, 40) + ".json");
const ler = (u) => { try { const j = JSON.parse(fs.readFileSync(arquivo(u), "utf8")); return Array.isArray(j.conversas) ? j : { conversas: [] }; } catch { return { conversas: [] }; } };
function gravar(u, h) { const f = arquivo(u), t = f + ".tmp"; fs.writeFileSync(t, JSON.stringify(h), { mode: 0o600 }); fs.renameSync(t, f); }
function purgar(h) { const d = dias(); if (!d) return; const corte = Date.now() - d * 864e5; h.conversas = h.conversas.filter((c) => c.atualizada >= corte); }
const idNovo = () => crypto.randomBytes(9).toString("base64url");
const tituloDe = (t) => { const s = String(t).replace(/\s+/g, " ").trim(); return s.length > 60 ? s.slice(0, 57) + "…" : s; };
const resumo = (c) => ({ id: c.id, titulo: c.titulo, criada: c.criada, atualizada: c.atualizada, mensagens: c.mensagens.length });

function listar(u) { const h = ler(u); purgar(h); return h.conversas.sort((a, b) => b.atualizada - a.atualizada).map(resumo); }
function obter(u, id) { const c = ler(u).conversas.find((x) => x.id === String(id)); return c || null; }

// Guarda uma troca (pergunta + resposta). Sem id (ou com id que não é do usuário), abre uma conversa nova.
function adicionar(u, id, texto, resp) {
  const h = ler(u); purgar(h); const agora = Date.now();
  let c = id ? h.conversas.find((x) => x.id === String(id)) : null;
  if (!c) { c = { id: idNovo(), titulo: tituloDe(mascarar(texto)), criada: agora, atualizada: agora, mensagens: [] }; h.conversas.push(c); }
  c.mensagens.push({ r: "u", t: agora, texto: mascarar(texto).slice(0, 300) });
  c.mensagens.push({ r: "a", t: agora, resp: enxugar(resp) });
  if (c.mensagens.length > MAX_MENSAGENS) c.mensagens = c.mensagens.slice(-MAX_MENSAGENS);
  c.atualizada = agora;
  h.conversas.sort((a, b) => b.atualizada - a.atualizada); h.conversas = h.conversas.slice(0, MAX_CONVERSAS);
  gravar(u, h); return resumo(c);
}
// Só o que a tela precisa para redesenhar a resposta.
function enxugar(r) {
  if (!r) return { ok: false, mensagem: "" };
  const { ok, naoEntendi, foraDeEscopo, mensagem, sugestoes, pergunta, texto, tabela, premissas, avisoPrivacidade, criterio, ms, cacheSegundos, grafico, sqlUsado, fixar, livre, truncado } = r;
  // Lista com nomes (dado pessoal): NÃO guarda as linhas, só o fato de ter sido gerada.
  if (r.lista) return { ok: true, lista: true, semLinhas: true, pergunta, texto, total: tabela?.linhas?.length ?? null, premissas, avisoPrivacidade, criterio, ms };
  return { ok: !!ok, naoEntendi, foraDeEscopo, mensagem, sugestoes, pergunta, texto, tabela, premissas, avisoPrivacidade, criterio, ms, cacheSegundos, grafico, sqlUsado, fixar, livre, truncado };
}
function renomear(u, id, titulo) {
  const t = tituloDe(titulo || ""); if (t.length < 1) throw new Error("Informe um título.");
  const h = ler(u), c = h.conversas.find((x) => x.id === String(id)); if (!c) throw new Error("Pesquisa não encontrada.");
  c.titulo = t; gravar(u, h); return resumo(c);
}
function excluir(u, id) { const h = ler(u), n = h.conversas.length; h.conversas = h.conversas.filter((x) => x.id !== String(id)); if (h.conversas.length === n) throw new Error("Pesquisa não encontrada."); gravar(u, h); }
function limpar(u) { try { fs.unlinkSync(arquivo(u)); } catch {} }

module.exports = { listar, obter, adicionar, renomear, excluir, limpar };
