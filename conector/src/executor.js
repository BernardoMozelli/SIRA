const pg = require("pg");
const { Pool } = pg;
const { perguntas } = require("./catalogo");
const { validarParametros } = require("./validar");
const emb = require("./embutido");
const { validarSqlLivre, VIEWS_LIVRES } = require("./livre");

const MIN_GRUPO = Number(process.env.SIRA_MIN_GRUPO ?? 5);
const MAX_LINHAS = 200;

// opcoes.modo: "views" (schema mcp instalado no banco; padrão) ou "embutido" (só leitura, sem instalar nada: as views viajam dentro da consulta; exige opcoes.sal).
// Cache: o mesmo pedido (pergunta + parâmetros) dentro de SIRA_CACHE_S segundos (padrão 120; 0 desliga) devolve o resultado já calculado.
function criarExecutor(dbUrl, opcoes = {}) {
  const modo = opcoes.modo || "views", sal = opcoes.sal || null;
  if (modo === "embutido" && !sal) throw new Error("Modo embutido exige o sal do hash.");
  const sqlFinal = (sql) => (modo === "embutido" ? emb.montarSql(sql, sal) : sql);
  const CACHE_S = Number(process.env.SIRA_CACHE_S ?? 120), cache = new Map();
  let livresAtivas = 0, desabilitadas = new Map(), colunasNegadas = new Set(), viewsOk = null; // id da pergunta -> motivo (modo embutido, quando faltam permissões)
  const pool = new Pool({ connectionString: dbUrl, max: 4, idleTimeoutMillis: 30000, connectionTimeoutMillis: 8000, application_name: "sira", types: { getTypeParser: (oid, f) => (oid === 1082 ? (v) => v : pg.types.getTypeParser(oid, f)) } }); // date como texto AAAA-MM-DD (sem fuso)
  pool.on("error", (e) => console.error("[pool]", e.message));

  async function consultar(sql, valores, tetoMs) {
    const cli = await pool.connect();
    try {
      await cli.query("BEGIN READ ONLY");
      await cli.query(`SET LOCAL statement_timeout = '${tetoMs ? Math.min(tetoMs, 120000) : Math.min(120000, Math.max(2000, Number(process.env.SIRA_TIMEOUT_MS) || 30000))}'`);
      const r = await cli.query(sql, valores);
      await cli.query("ROLLBACK");
      return r;
    } catch (e) {
      try { await cli.query("ROLLBACK"); } catch {}
      throw e;
    } finally { cli.release(); }
  }

  let entCache = null;
  async function entidades() {
    if (entCache && Date.now() - entCache.em < 300000) return entCache.v;
    const [e, u] = await Promise.all([
      consultar(sqlFinal("SELECT id, nome FROM mcp.v_equipe ORDER BY id"), []),
      consultar(sqlFinal("SELECT id, nome FROM mcp.v_unidade ORDER BY id"), []),
    ]);
    const v = { equipes: e.rows, unidades: u.rows }; entCache = { em: Date.now(), v }; return v;
  }

  // Diagnóstico: no modo embutido, confere quais colunas o usuário consegue ler e desliga as perguntas que dependem de colunas negadas.
  async function diagnostico() {
    desabilitadas = new Map(); const faltas = []; colunasNegadas = new Set(); viewsOk = null;
    if (modo === "views") {
      // o schema mcp pode ser antigo (sem alguma visão) ou ter visões não liberadas (ex.: a de nomes): desativa só o que depende delas
      const r = await consultar(`SELECT c.relname AS v, has_table_privilege(current_user, c.oid, 'SELECT') AS ok FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'mcp' AND c.relkind IN ('v', 'm')`, []);
      viewsOk = new Set(r.rows.filter((x) => x.ok).map((x) => x.v));
      for (const q of perguntas) { const f = emb.viewsDe(q.sql).filter((v) => !viewsOk.has(v)); if (f.length) desabilitadas.set(q.id, "visão sem permissão ou inexistente: mcp." + f.join(", mcp.")); }
    }
    if (modo === "embutido") {
      const pares = []; const porPergunta = new Map();
      for (const q of perguntas) { const cols = emb.colunasDe(q.sql); const lista = []; for (const [t, cs] of Object.entries(cols)) for (const c of cs) { lista.push(`${t}.${c}`); pares.push([t, c]); } porPergunta.set(q.id, lista); }
      const unicos = [...new Map(pares.map(([t, c]) => [`${t}.${c}`, [t, c]])).values()];
      const r = await consultar(`SELECT t, c, has_column_privilege(current_user, format('public.%I', t), c, 'SELECT') AS ok FROM unnest($1::text[], $2::text[]) AS x(t, c)`, [unicos.map((x) => x[0]), unicos.map((x) => x[1])]);
      const negadas = new Set(r.rows.filter((x) => !x.ok).map((x) => `${x.t}.${x.c}`)); colunasNegadas = negadas;
      for (const q of perguntas) { const f = porPergunta.get(q.id).filter((k) => negadas.has(k)); if (f.length) { desabilitadas.set(q.id, "sem permissão de leitura em " + f.join(", ")); } }
      faltas.push(...negadas);
    }
    return { modo, desabilitadas: [...desabilitadas].map(([id, motivo]) => ({ id, motivo })), colunasNegadas: faltas };
  }
  const habilitada = (id) => !desabilitadas.has(id);

  // Supressão de grupos pequenos: 1..(MIN_GRUPO-1) nunca sai do conector.
  function suprimir(v) {
    return Number.isInteger(v) && v > 0 && v < MIN_GRUPO ? { suprimido: true, faixa: `menos de ${MIN_GRUPO}` } : v;
  }

  async function executar(idPergunta, paramsBrutos) {
    const q = perguntas.find((x) => x.id === idPergunta);
    if (!q) throw new Error("Pergunta não existe no catálogo");
    if (!habilitada(q.id)) throw new Error("Esta pergunta está desativada: " + desabilitadas.get(q.id) + ".");
    const ents = await entidades();
    const params = validarParametros(q, paramsBrutos, ents);
    if (q.resultado === "lista") { // dados pessoais: sem cache, sem supressão (a permissão e o motivo são exigidos pelo cérebro)
      const max = q.maxLinhas || 5000, r = await consultar(sqlFinal(q.sql) + ` LIMIT ${max + 1}`, q.ordem(params), 90000); // listas nominais varrem o cadastro inteiro: teto maior (90 s)
      const linhas = r.rows.slice(0, max).map((l) => q.colunas.map((c) => l[c.chave] ?? ""));
      return { params, resultado: { tipo: "lista", colunas: q.colunas, linhas, truncado: r.rows.length > max, maximo: max }, entidades: ents };
    }
    const chave = q.id + "|" + JSON.stringify(q.ordem(params)), hit = cache.get(chave);
    if (CACHE_S > 0 && hit && Date.now() - hit.em < CACHE_S * 1000) return { ...hit.v, cacheSegundos: Math.round((Date.now() - hit.em) / 1000) };
    const r = await consultar(sqlFinal(q.sql), q.ordem(params));
    let resultado;
    if (q.resultado === "valor") {
      const total = r.rows[0]?.total ?? 0;
      const s = suprimir(total);
      resultado = { tipo: "valor", total: typeof s === "number" ? s : null, suprimido: typeof s !== "number", faixa: s.faixa || null };
    } else {
      const linhas = r.rows.slice(0, MAX_LINHAS).map((l) => {
        const s = suprimir(l.total);
        return { ...l, total: typeof s === "number" ? s : null, suprimido: typeof s !== "number", faixa: s.faixa || null };
      });
      resultado = { tipo: "tabela", colunas: q.colunas, linhas };
    }
    const saida = { params, resultado, entidades: ents };
    if (CACHE_S > 0) { if (cache.size > 500) cache.clear(); cache.set(chave, { em: Date.now(), v: saida }); }
    return saida;
  }

  // Consulta LIVRE (escrita pela IA): passa pelo validador, roda só sobre as visões do SIRA, com limite de linhas e supressão de grupos pequenos.
  // Exige coluna "total" (contagem): linhas com total entre 1 e 4 saem sem números. Nunca devolve linha de cidadão.
  async function executarLivre(sqlBruto) {
    const { sql } = validarSqlLivre(sqlBruto);
    if (modo === "embutido") {
      const cols = emb.colunasDe(sql.replace(/\bmcp\.(v_\w+)/g, "mcp.$1")); const falta = [];
      for (const [t, cs] of Object.entries(cols)) for (const c of cs) if (colunasNegadas.has(`${t}.${c}`)) falta.push(`${t}.${c}`);
      if (falta.length) throw new Error("O usuário de leitura não tem permissão em " + falta.join(", ") + ".");
    } else if (viewsOk) {
      const f = emb.viewsDe(sql).filter((v) => !viewsOk.has(v)); if (f.length) throw new Error("Visão não disponível neste banco: mcp." + f.join(", mcp."));
    }
    // consultas livres têm teto menor (15 s) e no máximo 2 ao mesmo tempo: uma consulta mal feita não pode travar o sistema
    if (livresAtivas >= 2) throw new Error("Há consultas livres em andamento. Tente de novo em instantes.");
    const MAX = 200; let r; livresAtivas++;
    try { r = await consultar(`SELECT * FROM (${sqlFinal(sql)}) AS _q LIMIT ${MAX + 1}`, [], 15000); }
    catch (e) { if (/statement timeout|canceling statement/i.test(e.message)) throw new Error("A consulta demorou demais (mais de 15 s). Peça algo mais específico (um período menor, uma equipe)."); throw e; }
    finally { livresAtivas--; }
    const campos = r.fields.map((f) => f.name);
    if (!campos.includes("total")) throw new Error('a consulta precisa devolver a coluna "total" (contagem)');
    if (campos.some((c) => /^(id_interno|id_anon|co_cidadao)$/i.test(c))) throw new Error("a consulta não pode listar identificadores de cidadãos");
    const NUM = new Set([20, 21, 23, 700, 701, 1700]); const idNum = new Set(r.fields.filter((f) => NUM.has(f.dataTypeID)).map((f) => f.name));
    const medidas = campos.filter((c) => c !== "total" && idNum.has(c) && /(media|mediana|pct|percent|taxa|soma|razao|proporcao|minimo|maximo|desvio|avg|sum)/i.test(c));
    for (const l of r.rows) for (const c of idNum) if (l[c] !== null && l[c] !== undefined) l[c] = Number(l[c]);
    let suprimidas = 0;
    const linhas = r.rows.slice(0, MAX).map((l) => {
      const t = Number(l.total); const peq = Number.isFinite(t) && t > 0 && t < MIN_GRUPO;
      if (peq) { suprimidas++; const o = { ...l, total: null }; for (const c of medidas) o[c] = null; o.__suprimido = `menos de ${MIN_GRUPO}`; return o; }
      return l;
    });
    return { colunas: campos, linhas, truncado: r.rows.length > MAX, suprimidas, maximo: MAX, sqlExecutado: sql };
  }

  return { executar, executarLivre, entidades, diagnostico, habilitada, modo, fechar: () => pool.end() };
}

module.exports = { criarExecutor, MIN_GRUPO };
