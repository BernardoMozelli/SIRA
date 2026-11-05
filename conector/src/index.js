// SIRA — Conector local. Roda na prefeitura. Sem IA. Conexão SOMENTE de saída para o cérebro.
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const { criarExecutor } = require("./executor");
const { manifesto, VERSAO_CATALOGO } = require("./catalogo");

const CFG = {
  dbUrl: process.env.SIRA_DB_URL,
  cerebro: process.env.SIRA_CEREBRO_URL,   // ex.: wss://sira.bemosistemas.com.br/conector
  token: process.env.SIRA_TOKEN,
  log: process.env.SIRA_LOG || path.join(process.cwd(), "conector-execucoes.log"),
};
for (const [k, v] of Object.entries({ SIRA_DB_URL: CFG.dbUrl, SIRA_CEREBRO_URL: CFG.cerebro, SIRA_TOKEN: CFG.token })) {
  if (!v) { console.error(`Falta a variável ${k}`); process.exit(1); }
}

const exec = criarExecutor(CFG.dbUrl);

// Registro local: a prefeitura vê exatamente o que foi executado no banco dela.
function registrar(obj) {
  try { fs.appendFileSync(CFG.log, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + "\n"); } catch {}
}

let tentativa = 0;
function conectar() {
  const ws = new WebSocket(CFG.cerebro, { headers: { Authorization: `Bearer ${CFG.token}` } });
  let vivo = true, ping;

  ws.on("open", async () => {
    tentativa = 0;
    console.log("[conector] conectado ao cérebro");
    ws.send(JSON.stringify({ tipo: "hello", versaoCatalogo: VERSAO_CATALOGO, manifesto: manifesto() }));
    ping = setInterval(() => { if (!vivo) return ws.terminate(); vivo = false; try { ws.ping(); } catch {} }, 25000);
  });
  ws.on("pong", () => { vivo = true; });

  ws.on("message", async (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    const t0 = Date.now();
    try {
      if (msg.tipo === "entidades") {
        return ws.send(JSON.stringify({ id: msg.id, ok: true, entidades: await exec.entidades() }));
      }
      if (msg.tipo === "executar") {
        const r = await exec.executar(msg.pergunta, msg.params);
        registrar({ pergunta: msg.pergunta, params: r.params, ok: true, ms: Date.now() - t0 });
        return ws.send(JSON.stringify({ id: msg.id, ok: true, params: r.params, resultado: r.resultado, entidades: r.entidades }));
      }
      ws.send(JSON.stringify({ id: msg.id, ok: false, erro: "tipo de mensagem desconhecido" }));
    } catch (e) {
      registrar({ pergunta: msg.pergunta, params: msg.params, ok: false, erro: e.message, ms: Date.now() - t0 });
      ws.send(JSON.stringify({ id: msg.id, ok: false, erro: e.message }));
    }
  });

  ws.on("close", (c) => {
    clearInterval(ping);
    const espera = Math.min(30000, 1000 * 2 ** Math.min(tentativa++, 5));
    console.log(`[conector] desconectado (${c}); nova tentativa em ${espera / 1000}s`);
    setTimeout(conectar, espera);
  });
  ws.on("error", (e) => console.error("[conector] erro:", e.message));
}
conectar();
process.on("SIGTERM", async () => { await exec.fechar(); process.exit(0); });
