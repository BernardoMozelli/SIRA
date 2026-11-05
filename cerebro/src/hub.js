// Conexões dos conectores (um por cliente). O conector conecta; o cérebro nunca abre conexão para a prefeitura.
const { WebSocketServer } = require("ws");
const crypto = require("crypto");
const { tenantPorToken } = require("./auth");
const texto = require("./texto");

const conectores = new Map(); // slug -> { ws, manifesto, indice, entidades, pendentes }

function iniciar(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    if (!req.url.startsWith("/conector")) return socket.destroy();
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const slug = tenantPorToken(token);
    if (!slug) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); return socket.destroy(); }
    wss.handleUpgrade(req, socket, head, (ws) => aceitar(ws, slug));
  });
}

function aceitar(ws, slug) {
  const antigo = conectores.get(slug);
  if (antigo) try { antigo.ws.terminate(); } catch {}
  const c = { ws, slug, manifesto: [], indice: null, entidades: null, pendentes: new Map(), desde: Date.now() };
  conectores.set(slug, c);
  console.log(`[hub] conector de "${slug}" conectado`);

  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.tipo === "hello") {
      c.manifesto = Array.isArray(m.manifesto) ? m.manifesto : [];
      c.versaoCatalogo = String(m.versaoCatalogo || "");
      c.indice = texto.construirIndice(c.manifesto);
      chamar(slug, { tipo: "entidades" }).then((r) => { c.entidades = r.entidades; }).catch(() => {});
      return;
    }
    const p = c.pendentes.get(m.id);
    if (p) { clearTimeout(p.timer); c.pendentes.delete(m.id); p.resolve(m); }
  });
  ws.on("close", () => {
    if (conectores.get(slug) === c) conectores.delete(slug);
    for (const p of c.pendentes.values()) { clearTimeout(p.timer); p.reject(new Error("conector desconectou")); }
    console.log(`[hub] conector de "${slug}" desconectou`);
  });
  ws.on("error", () => {});
}

// Modo direto: o banco é consultado dentro do próprio processo (ver direto.js); aparece no hub como um conector.
function registrarDireto(slug, d) {
  const antigo = conectores.get(slug); if (antigo && !antigo.direto) try { antigo.ws.terminate(); } catch {}
  conectores.set(slug, { slug, direto: d, manifesto: d.manifesto, indice: d.indice, versaoCatalogo: d.versaoCatalogo, entidades: d.entidades, semListas: !!d.semListas, pendentes: new Map(), desde: Date.now(), ws: { readyState: 1 } });
}
function removerDireto(slug) { const c = conectores.get(slug); if (c && c.direto) conectores.delete(slug); }
async function chamarDireto(c, msg) {
  try {
    if (msg.tipo === "entidades") return { ok: true, entidades: await c.direto.listarEntidades() };
    if (msg.tipo === "executar") { const r = await c.direto.executar(msg.pergunta, msg.params); return { ok: true, params: r.params, resultado: r.resultado, entidades: r.entidades, cacheSegundos: r.cacheSegundos ?? null }; }
    if (msg.tipo === "livre") { if (!c.direto.executarLivre) return { ok: false, erro: "Perguntas livres exigem o SIRA em modo direto." }; return { ok: true, livre: await c.direto.executarLivre(msg.sql) }; }
    return { ok: false, erro: "tipo de mensagem desconhecido" };
  } catch (e) { return { ok: false, erro: e.message }; }
}

function chamar(slug, msg, ms = 20000) {
  const c = conectores.get(slug);
  if (c && c.direto) return Promise.race([chamarDireto(c, msg), new Promise((_, no) => setTimeout(() => no(new Error("tempo esgotado no conector")), ms).unref())]);
  if (!c || c.ws.readyState !== 1) return Promise.reject(Object.assign(new Error("conector offline"), { offline: true }));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { c.pendentes.delete(id); reject(new Error("tempo esgotado no conector")); }, ms);
    c.pendentes.set(id, { resolve, reject, timer });
    c.ws.send(JSON.stringify({ ...msg, id }));
  });
}

const obter = (slug) => conectores.get(slug) || null;
module.exports = { iniciar, chamar, obter, registrarDireto, removerDireto };
