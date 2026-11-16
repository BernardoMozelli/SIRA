// Integrações prontas com provedores de IA. Todas fazem uma única coisa: dado um texto (prompt), devolver um JSON.
// O SIRA só envia o texto da pergunta (com números de documento mascarados) e as listas de unidades/equipes.
const PROVEDORES = {
  ollama:     { nome: "Ollama (local, gratuito)",       modeloPadrao: "qwen2.5:3b",        chave: false, baseEditavel: true,  baseUrl: "http://localhost:11434",                     externo: false, timeoutMs: 60000 },
  anthropic:  { nome: "Claude (Anthropic)",             modeloPadrao: "claude-haiku-5-5",  chave: true,  baseEditavel: false, baseUrl: "https://api.anthropic.com",                  externo: true,  timeoutMs: 30000 },
  openai:     { nome: "ChatGPT (OpenAI)",               modeloPadrao: "gpt-4o-mini",       chave: true,  baseEditavel: false, baseUrl: "https://api.openai.com/v1",                  externo: true,  timeoutMs: 30000 },
  gemini:     { nome: "Gemini (Google)",                modeloPadrao: "gemini-2.5-flash",  chave: true,  baseEditavel: false, baseUrl: "https://generativelanguage.googleapis.com",  externo: true,  timeoutMs: 30000 },
  openrouter: { nome: "OpenRouter (vários modelos, uma chave)", modeloPadrao: "openai/gpt-4o-mini", chave: true, baseEditavel: false, baseUrl: "https://openrouter.ai/api/v1", externo: true, timeoutMs: 45000 },
  manus:      { nome: "Manus (agente; mais lento)",       modeloPadrao: "standard",          chave: true,  baseEditavel: false, baseUrl: "https://api.manus.ai",                       externo: true,  timeoutMs: 120000, perfis: ["standard", "lite", "max"] },
  compativel: { nome: "Outro compatível com OpenAI (Groq, OpenRouter, DeepSeek, LM Studio…)", modeloPadrao: "", chave: false, baseEditavel: true, baseUrl: "", obrigaBase: true, externo: true, timeoutMs: 45000 },
};

const SISTEMA = "Você extrai parâmetros de perguntas sobre saúde pública. Responda SOMENTE com um objeto JSON válido, sem texto antes ou depois.";

function baseDe(id, cfg = {}) {
  const p = PROVEDORES[id];
  const b = (p.baseEditavel && cfg.baseUrl) || process.env[`SIRA_BASE_${id.toUpperCase()}`] || p.baseUrl;
  if (!b) throw new Error("Informe a URL base do serviço.");
  if (!/^https?:\/\//i.test(b)) throw new Error("A URL base precisa começar com http:// ou https://");
  return b.replace(/\/+$/, "");
}

function limpar(texto, chave) {
  let s = String(texto || "");
  if (chave && chave.length > 6) s = s.split(chave).join("***");
  return s.replace(/\s+/g, " ").slice(0, 300);
}

async function http(url, { metodo = "POST", headers = {}, corpo, ms = 30000, chave }) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { method: metodo, headers: { "content-type": "application/json", ...headers }, body: corpo ? JSON.stringify(corpo) : undefined, signal: ctl.signal });
    const txt = await r.text(); let json = null; try { json = JSON.parse(txt); } catch {}
    if (!r.ok) {
      const msg = json?.error?.message || json?.error || json?.message || txt;
      throw Object.assign(new Error(`HTTP ${r.status}: ${limpar(typeof msg === "string" ? msg : JSON.stringify(msg), chave)}`), { status: r.status });
    }
    return json ?? {};
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`Tempo esgotado (${Math.round(ms / 1000)} s)`);
    if (e.status) throw e;
    throw new Error("Falha de rede: " + limpar(e.cause?.message || e.message, chave));
  } finally { clearTimeout(t); }
}

function jsonSeguro(texto) {
  let s = String(texto || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("A IA não devolveu JSON");
  try { return JSON.parse(s.slice(a, b + 1)); } catch { throw new Error("A IA devolveu um JSON inválido"); }
}

const adaptadores = {
  async anthropic({ modelo, chave, base, prompt, ms, sistema, maxTokens }) {
    const r = await http(`${base}/v1/messages`, { headers: { "x-api-key": chave, "anthropic-version": "2023-06-01" }, ms, chave,
      corpo: { model: modelo, max_tokens: maxTokens || 400, system: sistema || SISTEMA, messages: [{ role: "user", content: prompt }] } });
    return jsonSeguro((r.content || []).filter((b) => b.type === "text").map((b) => b.text).join(""));
  },
  async openai({ modelo, chave, base, prompt, ms, semFormato, extra = {}, sistema, maxTokens }) {
    const corpo = { model: modelo, messages: [{ role: "system", content: sistema || SISTEMA }, { role: "user", content: prompt }] }; if (maxTokens) corpo.max_tokens = maxTokens;
    if (!semFormato) corpo.response_format = { type: "json_object" };
    const headers = { ...(chave ? { authorization: `Bearer ${chave}` } : {}), ...extra };
    try {
      const r = await http(`${base}/chat/completions`, { headers, ms, chave, corpo });
      return jsonSeguro(r.choices?.[0]?.message?.content);
    } catch (e) {
      // alguns servidores compatíveis não aceitam response_format: tenta de novo sem ele
      if (!semFormato && e.status === 400 && /response_format|json_object|unsupported/i.test(e.message)) return adaptadores.openai({ modelo, chave, base, prompt, ms, semFormato: true, extra, sistema, maxTokens });
      throw e;
    }
  },
  async gemini({ modelo, chave, base, prompt, ms, sistema }) {
    const m = encodeURIComponent(String(modelo).replace(/^models\//, ""));
    const r = await http(`${base}/v1beta/models/${m}:generateContent`, { headers: { "x-goog-api-key": chave }, ms, chave,
      corpo: { systemInstruction: { parts: [{ text: sistema || SISTEMA }] }, contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0 } } });
    return jsonSeguro((r.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join(""));
  },
  async ollama({ modelo, base, prompt, ms, sistema }) {
    const r = await http(`${base}/api/chat`, { ms, corpo: { model: modelo, stream: false, format: "json", messages: [{ role: "system", content: sistema || SISTEMA }, { role: "user", content: prompt }] } });
    return jsonSeguro(r.message?.content);
  },
};
// Manus é um agente: cada pedido vira uma "tarefa" assíncrona (criar e consultar até terminar), por isso é mais lento que os demais.
adaptadores.manus = async ({ modelo, chave, base, prompt, ms, sistema }) => {
  const h = { "x-manus-api-key": chave }, limite = Date.now() + ms;
  const texto = `${sistema || SISTEMA}\n\n${prompt}\n\nResponda diretamente, sem usar ferramentas, sem navegar e sem criar arquivos. A resposta deve ser SOMENTE o objeto JSON pedido.`;
  const c = await http(`${base}/v2/task.create`, { headers: h, ms: Math.min(30000, ms), chave, corpo: { message: { content: texto }, agent_profile: modelo || "standard", hide_in_task_list: true, title: "SIRA" } });
  if (c.ok === false || !c.task_id) throw new Error(`Manus: ${limpar(c.error?.message || "não criou a tarefa", chave)}`);
  const lerTexto = (m) => { const x = m.assistant_message?.content; return typeof x === "string" ? x : Array.isArray(x) ? x.map((p) => p.text || "").join("") : ""; };
  await new Promise((r) => setTimeout(r, 2500));
  while (Date.now() < limite) {
    const r = await http(`${base}/v2/task.listMessages?task_id=${encodeURIComponent(c.task_id)}&order=asc&limit=200`, { metodo: "GET", headers: h, ms: Math.min(20000, Math.max(3000, limite - Date.now())), chave });
    const msgs = r.messages || [];
    const erro = msgs.find((m) => m.type === "error_message"); if (erro) throw new Error(`Manus: ${limpar(erro.error_message?.content || erro.error_message?.message || "erro na tarefa", chave)}`);
    const status = [...msgs].reverse().find((m) => m.type === "status_update")?.status_update?.agent_status;
    if (status === "error") throw new Error("Manus: a tarefa terminou com erro");
    if (status === "waiting") throw new Error("Manus: o agente pediu informação adicional; use o perfil standard ou lite");
    if (status === "stopped") { const t = [...msgs].reverse().map(lerTexto).find((x) => x.trim()); if (!t) throw new Error("Manus: a tarefa terminou sem resposta"); return jsonSeguro(t); }
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error(`Tempo esgotado (${Math.round(ms / 1000)} s). O Manus é um agente e pode demorar mais que os outros provedores.`);
};
adaptadores.compativel = adaptadores.openai;
// OpenRouter fala o protocolo da OpenAI; os cabeçalhos abaixo só identificam o aplicativo no painel deles.
adaptadores.openrouter = (a) => adaptadores.openai({ ...a, extra: { "HTTP-Referer": "https://bemosistemas.com.br", "X-Title": "SIRA - BeMo Sistemas" } });

async function extrairJSON({ provedor, modelo, chave, baseUrl, prompt, timeoutMs, sistema, maxTokens }) {
  const p = PROVEDORES[provedor]; if (!p) throw new Error("Provedor desconhecido");
  if (p.chave && !chave) throw new Error("Cadastre a chave de API deste provedor.");
  if (!modelo) throw new Error("Informe o modelo.");
  return adaptadores[provedor]({ modelo, chave, base: baseDe(provedor, { baseUrl }), prompt, ms: timeoutMs || p.timeoutMs, sistema, maxTokens });
}

async function listarModelos({ provedor, chave, baseUrl }) {
  const p = PROVEDORES[provedor]; if (!p) throw new Error("Provedor desconhecido");
  if (p.chave && !chave) throw new Error("Cadastre a chave de API primeiro.");
  if (p.perfis) return p.perfis.slice(); // Manus não lista modelos: usa perfis fixos (standard, lite, max)
  const base = baseDe(provedor, { baseUrl }); const ms = 20000; let ids = [];
  if (provedor === "anthropic") ids = ((await http(`${base}/v1/models?limit=100`, { metodo: "GET", headers: { "x-api-key": chave, "anthropic-version": "2023-06-01" }, ms, chave })).data || []).map((m) => m.id);
  else if (provedor === "gemini") ids = ((await http(`${base}/v1beta/models?pageSize=100`, { metodo: "GET", headers: { "x-goog-api-key": chave }, ms, chave })).models || []).filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent")).map((m) => String(m.name).replace(/^models\//, ""));
  else if (provedor === "ollama") ids = ((await http(`${base}/api/tags`, { metodo: "GET", ms })).models || []).map((m) => m.name);
  else ids = ((await http(`${base}/models`, { metodo: "GET", headers: chave ? { authorization: `Bearer ${chave}` } : {}, ms, chave })).data || []).map((m) => m.id);
  return ids.filter(Boolean).sort();
}

// Antes de qualquer texto sair para um provedor, mascara números que parecem documento ou contato.
function mascarar(t) {
  return String(t)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[e-mail]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[nº]")
    .replace(/\b\d{15}\b/g, "[nº]")
    .replace(/\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, "[telefone]")
    .replace(/\b\d{9,}\b/g, "[nº]");
}

module.exports = { PROVEDORES, extrairJSON, listarModelos, mascarar, baseDe };
