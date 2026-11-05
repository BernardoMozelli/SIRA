// Validador das consultas LIVRES (SQL escrito pela IA). É a barreira de segurança: a IA nunca fala com o banco; o que ela escreve
// só roda se passar por aqui. Política: um único SELECT, somente sobre as views do SIRA (ou CTEs do próprio SELECT), só funções
// da lista permitida, nada de comentários/aspas/ponto-e-vírgula, identificadores de cidadão só dentro de count(...) ou filtros.
// O banco ainda aplica por cima: transação somente leitura, tempo máximo e permissão por coluna do usuário de leitura.

const VIEWS_LIVRES = ["v_unidade", "v_equipe", "v_cidadao", "v_problema_ativo", "v_condicao_ativa", "v_atendimento", "v_qualidade_cadastro"];
const MAX_SQL = 4000, MAX_TOKENS = 900;

const FUNCOES = new Set(["count", "sum", "avg", "min", "max", "round", "ceil", "ceiling", "floor", "trunc", "abs", "coalesce", "nullif", "greatest", "least",
  "date_trunc", "date_part", "extract", "age", "to_char", "make_date", "lower", "upper", "substr", "substring", "left", "right", "length", "btrim", "ltrim", "rtrim", "replace", "concat",
  "percentile_cont", "percentile_disc", "stddev", "variance", "row_number", "rank", "dense_rank", "lag", "lead", "bool_or", "bool_and", "numeric", "decimal", "interval", "date", "timestamp", "now", "current_date"]);
const AGREGADAS_ID = new Set(["count"]); // identificadores de cidadão só entram dentro de count(...)
// Palavras que podem vir antes de "(" sem serem chamada de função.
const ANTES_PAREN = new Set(["in", "and", "or", "not", "as", "on", "using", "exists", "any", "all", "some", "over", "filter", "from", "join", "select", "where", "when", "then", "else", "case", "by", "having", "union", "intersect", "except", "between", "like", "ilike", "is", "materialized", "limit", "offset", "partition", "within", "group", "order", "end", "distinct"]);
const PROIBIDAS = new Set(["insert", "update", "delete", "drop", "alter", "create", "truncate", "grant", "revoke", "copy", "call", "do", "execute", "prepare", "deallocate", "set", "reset", "show", "listen", "notify", "vacuum", "analyze", "refresh", "lock", "into", "returning", "explain", "begin", "commit", "rollback", "savepoint", "declare", "fetch", "move", "discard", "load", "for", "lateral", "window", "values", "tablesample", "recursive", "public", "information_schema", "pg_catalog", "current_user", "session_user", "id_anon", "pg", "unnest", "generate_series"]);
const ID_PESSOA = new Set(["id_interno", "id_anon", "co_cidadao"]);
const CLAUSULAS = new Set(["select", "from", "where", "group", "having", "order", "on", "using", "limit", "offset", "union", "intersect", "except", "partition"]);
const NAO_ALIAS = new Set(["where", "group", "order", "having", "limit", "offset", "join", "left", "right", "inner", "full", "outer", "cross", "on", "using", "union", "intersect", "except", "natural", "as"]);
const FROM_EM_FUNCAO = new Set(["extract", "substring", "trim", "overlay", "position"]);

function tokenizar(sql) {
  const t = []; let i = 0; const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'") { let j = i + 1, ok = false; while (j < n) { if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue; } ok = true; break; } j++; } if (!ok) throw new Error("texto entre aspas não termina"); t.push({ k: "s", v: sql.slice(i, j + 1) }); i = j + 1; continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(sql[i + 1] || ""))) { let j = i; while (j < n && /[0-9.]/.test(sql[j])) j++; t.push({ k: "n", v: sql.slice(i, j) }); i = j; continue; }
    if (/[A-Za-z_]/.test(c)) { let j = i; while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j++; const v = sql.slice(i, j); if (/^[ebxnu]$/i.test(v) && sql[j] === "'") throw new Error("tipo de texto não permitido (E'', B'', X'', N'')"); t.push({ k: "w", v, l: v.toLowerCase() }); i = j; continue; }
    if (c === ":" && sql[i + 1] === ":") { t.push({ k: "p", v: "::" }); i += 2; continue; }
    if ("(),.*+-/%<>=!|".includes(c)) { t.push({ k: "p", v: c }); i++; continue; }
    throw new Error(`caractere não permitido: ${c}`);
  }
  return t;
}

// Retorna { sql } (normalizado, sem ponto-e-vírgula final) ou lança Error com a causa em português.
function validarSqlLivre(entrada) {
  let sql = String(entrada || "").trim();
  if (!sql) throw new Error("consulta vazia");
  if (sql.length > MAX_SQL) throw new Error("consulta grande demais");
  sql = sql.replace(/;\s*$/, "");
  if (sql.includes("\\")) throw new Error("a consulta contém barra invertida (não permitida)");
  if (/;|--|\/\*|\*\/|"|\$|`|\u0000/.test(sql.replace(/'(?:[^']|'')*'/g, "''"))) throw new Error("a consulta contém símbolo não permitido (; -- /* aspas $)");
  const tk = tokenizar(sql);
  if (tk.length > MAX_TOKENS) throw new Error("consulta complexa demais");
  const p0 = tk[0]; if (!p0 || p0.k !== "w" || !["select", "with"].includes(p0.l)) throw new Error("só é permitido SELECT");

  // nomes de CTE declarados pela própria consulta
  const ctes = new Set();
  for (let i = 0; i < tk.length; i++) {
    if (tk[i].k === "w" && tk[i + 1]?.l === "as") {
      let j = i + 2; if (tk[j]?.l === "not") j++; if (tk[j]?.l === "materialized") j++;
      if (tk[j]?.v === "(" && (i === 1 || tk[i - 1]?.v === "," || tk[i - 1]?.l === "with")) { if (/^(v_|tb_|pg_|mcp)/.test(tk[i].l)) throw new Error(`nome de CTE não permitido: ${tk[i].v}`); ctes.add(tk[i].l); }
    }
  }
  const tabelaOk = (nome, schema) => {
    if (schema) return schema === "mcp" && VIEWS_LIVRES.includes(nome);
    return VIEWS_LIVRES.includes(nome) || ctes.has(nome);
  };
  let usaVisao = false;
  // item de tabela a partir da posição j: devolve o índice depois do item (com alias)
  function itemTabela(j) {
    const a = tk[j]; if (!a) throw new Error("FROM sem tabela");
    if (a.v === "(") { let d = 0; for (; j < tk.length; j++) { if (tk[j].v === "(") d++; else if (tk[j].v === ")") { d--; if (!d) { j++; break; } } } }
    else if (a.k === "w") {
      let nome = a.l, schema = null;
      if (tk[j + 1]?.v === ".") { schema = a.l; nome = tk[j + 2]?.l; j += 2; }
      if (/^tb_|^pg_/.test(nome || "")) throw new Error(`tabela não permitida: ${nome}`);
      if (VIEWS_LIVRES.includes(nome)) usaVisao = true;
      if (!tabelaOk(nome, schema)) throw new Error(`tabela/visão não permitida: ${schema ? schema + "." : ""}${nome}. Use apenas: ${VIEWS_LIVRES.map((v) => "mcp." + v).join(", ")}`);
      j++;
    } else throw new Error("FROM inválido");
    if (tk[j]?.l === "as") j++;
    if (tk[j]?.k === "w" && !NAO_ALIAS.has(tk[j].l)) j++;
    return j;
  }

  const pilha = [{ fn: null, cl: "top" }]; const topo = () => pilha[pilha.length - 1];
  let temCount = false;
  for (let i = 0; i < tk.length; i++) {
    const x = tk[i], ant = tk[i - 1];
    if (x.k === "w") {
      if (PROIBIDAS.has(x.l) || /^(tb_|pg_|lo_|dblink)/.test(x.l)) throw new Error(`termo não permitido: ${x.v}`);
      if (CLAUSULAS.has(x.l)) topo().cl = x.l;
      if (x.l === "count" && tk[i + 1]?.v === "(") temCount = true;
      if (ID_PESSOA.has(x.l)) {
        const f = topo(); const ok = AGREGADAS_ID.has(f.fn) || ["in", "exists", "any", "all", "some"].includes(f.fn) || ["on", "using", "where", "having", "partition"].includes(f.cl) || f.fn === "over";
        if (!ok || x.l === "id_anon") throw new Error("o identificador do cidadão só pode ser usado dentro de count(...) ou em filtros e junções, nunca listado");
      }
      if (x.l === "from" && !FROM_EM_FUNCAO.has(topo().fn)) {
        let j = itemTabela(i + 1); while (tk[j]?.v === ",") j = itemTabela(j + 1);
      } else if (x.l === "join") itemTabela(i + 1);
    } else if (x.v === "(") {
      let fn = null;
      if (ant?.k === "w" && !ANTES_PAREN.has(ant.l)) { if (!FUNCOES.has(ant.l)) throw new Error(`função não permitida: ${ant.v}`); fn = ant.l; }
      else if (ant?.k === "w") fn = ant.l;
      pilha.push({ fn, cl: "paren" }); if (pilha.length > 12) throw new Error("subconsultas aninhadas demais");
    } else if (x.v === ")") { pilha.pop(); if (!pilha.length) throw new Error("parênteses desbalanceados"); }
  }
  if (pilha.length !== 1) throw new Error("parênteses desbalanceados");
  if (!usaVisao) throw new Error("a consulta precisa ler alguma das visões do SIRA (mcp.v_...)");
  if (!temCount) throw new Error("a consulta precisa contar pessoas ou registros com count(...) e chamar essa coluna de total");
  return { sql };
}

module.exports = { validarSqlLivre, VIEWS_LIVRES };
