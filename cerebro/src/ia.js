// Configuração da IA: provedor ativo, modelos e chaves de API. Chaves ficam CIFRADAS em disco (AES-256-GCM)
// e nunca são devolvidas ao navegador (só os 4 últimos caracteres).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const auth = require("./auth");
const { PROVEDORES } = require("./provedores");

const ARQ = () => path.join(auth.DATA, "ia.json");
let chaveCripto = null;
function chaveAES() {
  if (!auth.SEGREDO_PERSISTENTE) throw new Error("Defina SIRA_SEGREDO (variável de ambiente) antes de cadastrar chaves de API; sem ele a chave se perderia ao reiniciar.");
  return (chaveCripto ||= crypto.scryptSync(auth.SEGREDO, "sira-ia-v1", 32));
}
function cifrar(txt) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", chaveAES(), iv);
  const ct = Buffer.concat([c.update(txt, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}
function decifrar(enc) {
  const [v, iv, tag, ct] = String(enc).split(":");
  if (v !== "v1") throw new Error("formato desconhecido");
  const d = crypto.createDecipheriv("aes-256-gcm", chaveAES(), Buffer.from(iv, "base64")); d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

const ler = () => { try { return JSON.parse(fs.readFileSync(ARQ(), "utf8")); } catch { return { ativo: null, provedores: {} }; } };
function gravar(cfg) { const t = ARQ() + ".tmp"; fs.writeFileSync(t, JSON.stringify(cfg, null, 2), { mode: 0o600 }); fs.renameSync(t, ARQ()); }

const estat = { chamadas: 0, falhas: 0, ultimoErro: null, ultimoMs: null, ultimoEm: null };
function registrarUso(ok, ms, erro) { estat.chamadas++; if (!ok) { estat.falhas++; estat.ultimoErro = erro; } estat.ultimoMs = ms; estat.ultimoEm = new Date().toISOString(); }

function publico() {
  const cfg = ler(); const provedores = {};
  for (const [id, p] of Object.entries(PROVEDORES)) {
    const c = cfg.provedores[id] || {};
    provedores[id] = { id, nome: p.nome, externo: p.externo, precisaChave: p.chave, baseEditavel: p.baseEditavel, obrigaBase: !!p.obrigaBase,
      modeloPadrao: p.modeloPadrao, baseUrlPadrao: p.baseUrl, modelo: c.modelo || "", baseUrl: c.baseUrl || "", temChave: !!c.chaveEnc, chaveFim: c.chaveFim || null };
  }
  const envOllama = !cfg.ativo && !!process.env.SIRA_OLLAMA_URL;
  return { ativo: cfg.ativo, ativoPorAmbiente: envOllama, provedores, uso: { ...estat }, atualizadoEm: cfg.atualizadoEm || null };
}

function salvar({ provedor, modelo, baseUrl, chave, timeoutMs }, por) {
  const p = PROVEDORES[provedor]; if (!p) throw new Error("Provedor desconhecido");
  const cfg = ler(); const c = (cfg.provedores[provedor] ||= {});
  if (typeof modelo === "string") c.modelo = modelo.trim().slice(0, 120);
  if (p.baseEditavel && typeof baseUrl === "string") {
    const b = baseUrl.trim(); if (b && !/^https?:\/\/\S+$/i.test(b)) throw new Error("URL base inválida");
    c.baseUrl = b;
  }
  if (timeoutMs !== undefined && timeoutMs !== "") { const n = Number(timeoutMs); if (!Number.isInteger(n) || n < 3000 || n > 180000) throw new Error("Tempo limite deve ficar entre 3000 e 180000 ms"); c.timeoutMs = n; }
  if (typeof chave === "string" && chave.trim()) {
    const k = chave.trim(); if (/\s/.test(k) || k.length < 8 || k.length > 400) throw new Error("Chave inválida (sem espaços, 8 a 400 caracteres).");
    c.chaveEnc = cifrar(k); c.chaveFim = k.slice(-4);
  }
  cfg.atualizadoEm = new Date().toISOString(); cfg.atualizadoPor = por; gravar(cfg);
}
function removerChave(provedor, por) {
  const cfg = ler(); const c = cfg.provedores[provedor]; if (!c) return;
  delete c.chaveEnc; delete c.chaveFim; if (cfg.ativo === provedor && PROVEDORES[provedor].chave) cfg.ativo = null;
  cfg.atualizadoEm = new Date().toISOString(); cfg.atualizadoPor = por; gravar(cfg);
}
function ativar(provedor, por) {
  const cfg = ler();
  if (provedor) {
    const p = PROVEDORES[provedor]; if (!p) throw new Error("Provedor desconhecido");
    const c = cfg.provedores[provedor] || {};
    if (p.chave && !c.chaveEnc) throw new Error("Cadastre a chave de API antes de ativar.");
    if (!(c.modelo || p.modeloPadrao)) throw new Error("Informe o modelo antes de ativar.");
    if (p.obrigaBase && !c.baseUrl) throw new Error("Informe a URL base antes de ativar.");
  }
  cfg.ativo = provedor || null; cfg.atualizadoEm = new Date().toISOString(); cfg.atualizadoPor = por; gravar(cfg);
}

// Configuração completa (com chave decifrada) de um provedor, para uso interno.
function completa(provedor) {
  const p = PROVEDORES[provedor]; const c = ler().provedores[provedor] || {};
  let chave = null; if (c.chaveEnc) { try { chave = decifrar(c.chaveEnc); } catch { throw new Error("Chave ilegível (o SIRA_SEGREDO mudou?). Cadastre a chave de novo."); } }
  return { provedor, modelo: c.modelo || p.modeloPadrao, chave, baseUrl: c.baseUrl || "", timeoutMs: c.timeoutMs || p.timeoutMs };
}
function ativa() {
  const cfg = ler();
  if (cfg.ativo) return completa(cfg.ativo);
  if (process.env.SIRA_OLLAMA_URL) return { provedor: "ollama", modelo: process.env.SIRA_OLLAMA_MODELO || PROVEDORES.ollama.modeloPadrao, chave: null, baseUrl: process.env.SIRA_OLLAMA_URL, timeoutMs: Number(process.env.SIRA_OLLAMA_TIMEOUT_MS || PROVEDORES.ollama.timeoutMs) };
  return null;
}

module.exports = { publico, salvar, removerChave, ativar, completa, ativa, registrarUso };
