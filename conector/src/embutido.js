// SIRA — MODO SOMENTE LEITURA (sem instalar nada no banco do e-SUS).
// As mesmas "views" de banco_real/02_views_mcp_esus.sql viajam DENTRO de cada consulta, como WITH (CTE). O banco do cliente só precisa
// de um usuário de leitura com SELECT em COLUNAS específicas (as que estão em ACESSO): nome, CPF, endereço etc. nunca são concedidos.
// Mantenha estas definições IGUAIS às do 02_views_mcp_esus.sql (o teste teste_embutido.js compara os resultados dos dois modos).

const ATIVO = "c.st_ativo = 1 AND COALESCE(c.st_faleceu, 0) = 0 AND c.dt_obito IS NULL AND COALESCE(c.st_unificado, 0) = 0";

// Ordem = dependências primeiro. "usa" = colunas lidas diretamente nas tabelas do PEC (base do script de permissões e do diagnóstico).
const DEFINICOES = {
  v_unidade: {
    usa: { tb_unidade_saude: ["co_seq_unidade_saude", "no_unidade_saude", "st_ativo"] },
    sql: `SELECT u.co_seq_unidade_saude::int AS id, u.no_unidade_saude AS nome FROM public.tb_unidade_saude u WHERE u.st_ativo = 1`,
  },
  v_equipe: {
    usa: { tb_equipe: ["co_seq_equipe", "co_unidade_saude", "no_equipe", "st_ativo"] },
    sql: `SELECT e.co_seq_equipe::int AS id, e.co_unidade_saude::int AS unidade_id, e.no_equipe AS nome FROM public.tb_equipe e WHERE e.st_ativo = 1`,
  },
  v_cidadao_equipe: {
    usa: {
      tb_cidadao_vinculacao_equipe: ["co_cidadao", "nu_ine", "dt_atualizacao_cadastro"],
      tb_cidadao_nucleo_familiar: ["co_cidadao", "nu_ine", "dt_ultima_atualizacao", "st_mudou_se"],
      tb_equipe: ["co_seq_equipe", "nu_ine", "st_ativo"],
    },
    sql: `SELECT DISTINCT ON (x.co_cidadao) x.co_cidadao, x.equipe_id FROM (
  SELECT v.co_cidadao, e.co_seq_equipe::int AS equipe_id, 1 AS fonte, v.dt_atualizacao_cadastro::date AS dt, e.st_ativo
  FROM public.tb_cidadao_vinculacao_equipe v
  JOIN public.tb_equipe e ON ltrim(e.nu_ine, '0') = ltrim(v.nu_ine, '0') AND NULLIF(ltrim(v.nu_ine, '0'), '') IS NOT NULL
  UNION ALL
  SELECT n.co_cidadao, e.co_seq_equipe::int, 2, n.dt_ultima_atualizacao, e.st_ativo
  FROM public.tb_cidadao_nucleo_familiar n
  JOIN public.tb_equipe e ON ltrim(e.nu_ine, '0') = ltrim(n.nu_ine, '0') AND NULLIF(ltrim(n.nu_ine, '0'), '') IS NOT NULL
  WHERE COALESCE(n.st_mudou_se, 0) = 0
) x ORDER BY x.co_cidadao, x.fonte, x.dt DESC NULLS LAST, x.st_ativo DESC, x.equipe_id`,
  },
  v_cidadao: {
    usa: { tb_cidadao: ["co_seq_cidadao", "no_sexo", "dt_nascimento", "st_ativo", "st_faleceu", "dt_obito", "st_unificado"] },
    sql: `SELECT substr(md5(__SAL__ || c.co_seq_cidadao::text), 1, 12) AS id_anon,
       c.co_seq_cidadao AS id_interno,
       upper(left(COALESCE(c.no_sexo, ''), 1)) AS sexo,
       CASE WHEN c.dt_nascimento IS NULL THEN NULL ELSE date_part('year', age(current_date, c.dt_nascimento))::int END AS idade,
       ve.equipe_id,
       (${ATIVO}) AS ativo
FROM public.tb_cidadao c
LEFT JOIN v_cidadao_equipe ve ON ve.co_cidadao = c.co_seq_cidadao`,
  },
  v_problema_ativo: {
    usa: {
      tb_problema: ["co_unico_problema", "co_prontuario", "co_ciap", "co_cid10"],
      tb_prontuario: ["co_seq_prontuario", "co_cidadao"],
      tb_ciap: ["co_seq_ciap", "co_ciap"],
      tb_cid10: ["co_cid10", "nu_cid10"],
      tb_problema_evolucao: ["co_unico_problema", "dt_inicio_problema", "dt_fim_problema", "co_situacao_problema", "co_sequencial_evolucao", "co_seq_problema_evolucao"],
    },
    sql: `WITH rel AS MATERIALIZED (
  SELECT p.co_unico_problema, pr.co_cidadao AS id_interno,
         CASE
           WHEN ci.co_ciap ~ '^(K86|K87)' OR cd.nu_cid10 ~ '^I1[0-5]' THEN 'HIPERTENSO'
           WHEN ci.co_ciap ~ '^(T89|T90)' OR cd.nu_cid10 ~ '^E1[0-4]' THEN 'DIABETICO'
           ELSE 'GESTANTE'
         END AS tipo
  FROM public.tb_problema p
  JOIN public.tb_prontuario pr ON pr.co_seq_prontuario = p.co_prontuario
  LEFT JOIN public.tb_ciap ci ON ci.co_seq_ciap = p.co_ciap
  LEFT JOIN public.tb_cid10 cd ON cd.co_cid10 = p.co_cid10
  WHERE ci.co_ciap ~ '^(K86|K87|T89|T90|W78|W79|W84|W85)' OR cd.nu_cid10 ~ '^(I1[0-5]|E1[0-4]|Z34|Z35|O09)'
), ev AS MATERIALIZED (
  SELECT DISTINCT ON (e.co_unico_problema) e.co_unico_problema, e.dt_inicio_problema, e.dt_fim_problema, e.co_situacao_problema
  FROM public.tb_problema_evolucao e
  WHERE e.co_unico_problema IN (SELECT co_unico_problema FROM rel)
  ORDER BY e.co_unico_problema, e.co_sequencial_evolucao DESC NULLS LAST, e.co_seq_problema_evolucao DESC
)
SELECT rel.id_interno, rel.tipo, ev.dt_inicio_problema AS dt_inicio, ev.dt_fim_problema AS dt_fim,
       (ev.dt_fim_problema IS NULL AND COALESCE(ev.co_situacao_problema, 0) <> 2) AS ativo
FROM rel JOIN ev ON ev.co_unico_problema = rel.co_unico_problema`,
  },
  v_condicao_ativa: {
    usa: {},
    sql: `SELECT DISTINCT ON (a.id_interno, a.tipo) a.id_interno, a.tipo, a.dt_inicio
FROM v_problema_ativo a
WHERE a.tipo IS NOT NULL AND a.ativo
  AND (a.tipo <> 'GESTANTE' OR a.dt_inicio >= current_date - 300)
ORDER BY a.id_interno, a.tipo, a.dt_inicio DESC NULLS LAST`,
  },
  v_atendimento: {
    usa: {
      tb_atend_prof: ["co_atend", "dt_inicio", "st_cancelado", "st_registro_historico", "co_lotacao"],
      tb_atend: ["co_seq_atend", "co_prontuario", "co_unidade_saude", "co_equipe"],
      tb_prontuario: ["co_seq_prontuario", "co_cidadao"],
      tb_lotacao: ["co_ator_papel", "co_equipe", "co_cbo"],
      tb_cbo: ["co_cbo", "no_cbo"],
    },
    sql: `SELECT x.id_interno, x.unidade_id, x.equipe_id, x.categoria,
       CASE WHEN g.id_interno IS NOT NULL AND x.categoria IN ('MEDICO', 'ENFERMEIRO') THEN 'PRENATAL'
            WHEN x.categoria IN ('MEDICO', 'ENFERMEIRO', 'ODONTO') THEN 'CONSULTA'
            ELSE 'OUTRO' END AS tipo,
       x.dt_atendimento
FROM (
  SELECT pr.co_cidadao AS id_interno, a.co_unidade_saude::int AS unidade_id, COALESCE(a.co_equipe, l.co_equipe)::int AS equipe_id,
         CASE WHEN upper(cb.no_cbo) ~ 'ODONTO|DENTIST|CIRURGI.O.DENTISTA' THEN 'ODONTO'
              WHEN upper(cb.no_cbo) ~ 'T.CNICO|AUXILIAR' AND upper(cb.no_cbo) ~ 'ENFERM' THEN 'TECNICO'
              WHEN upper(cb.no_cbo) ~ 'ENFERMEIR' THEN 'ENFERMEIRO'
              WHEN upper(cb.no_cbo) ~ 'M.DIC' AND upper(cb.no_cbo) !~ 'VETERIN' THEN 'MEDICO'
              ELSE 'OUTRO' END AS categoria,
         ap.dt_inicio::date AS dt_atendimento
  FROM public.tb_atend_prof ap
  JOIN public.tb_atend a ON a.co_seq_atend = ap.co_atend
  LEFT JOIN public.tb_prontuario pr ON pr.co_seq_prontuario = a.co_prontuario
  LEFT JOIN public.tb_lotacao l ON l.co_ator_papel = ap.co_lotacao
  LEFT JOIN public.tb_cbo cb ON cb.co_cbo = l.co_cbo
  WHERE ap.dt_inicio IS NOT NULL AND COALESCE(ap.st_cancelado, 0) = 0 AND COALESCE(ap.st_registro_historico, 0) = 0
) x
LEFT JOIN (
  SELECT DISTINCT ON (id_interno) id_interno, dt_inicio, COALESCE(dt_fim, dt_inicio + 300) AS fim
  FROM v_problema_ativo WHERE tipo = 'GESTANTE' AND dt_inicio IS NOT NULL
  ORDER BY id_interno, dt_inicio DESC
) g ON g.id_interno = x.id_interno AND x.dt_atendimento BETWEEN g.dt_inicio AND g.fim`,
  },
  v_cidadao_nominal: {
    opcional: "nomes", // lê o NOME do cidadão: só liberado se a TI conceder essa coluna (opção "listas com nomes" do script)
    usa: { tb_cidadao: ["co_seq_cidadao", "no_cidadao", "dt_nascimento", "st_ativo", "st_faleceu", "dt_obito", "st_unificado"] },
    sql: `SELECT c.co_seq_cidadao AS id_interno, c.no_cidadao AS nome, c.dt_nascimento, ve.equipe_id,
       (${ATIVO}) AS ativo
FROM public.tb_cidadao c
LEFT JOIN v_cidadao_equipe ve ON ve.co_cidadao = c.co_seq_cidadao`,
  },
  v_qualidade_cadastro: {
    opcional: "cnscpf", // lê CNS e CPF: só liberado se a TI conceder essas duas colunas (ver permissões)
    usa: { tb_cidadao: ["co_seq_cidadao", "st_ativo", "st_faleceu", "dt_obito", "st_unificado", "nu_cns", "nu_cpf"] },
    sql: `SELECT c.co_seq_cidadao AS id_interno, ve.equipe_id,
       (${ATIVO}) AS ativo,
       (c.nu_cns IS NULL OR btrim(c.nu_cns) = '') AS sem_cns,
       (c.nu_cpf IS NULL OR btrim(c.nu_cpf) = '') AS sem_cpf,
       (c.st_ativo = 1 AND COALESCE(c.st_unificado, 0) = 0 AND c.nu_cns IS NOT NULL AND btrim(c.nu_cns) <> ''
        AND count(*) FILTER (WHERE c.st_ativo = 1 AND COALESCE(c.st_unificado, 0) = 0) OVER (PARTITION BY c.nu_cns) > 1) AS cns_duplicado
FROM public.tb_cidadao c
LEFT JOIN v_cidadao_equipe ve ON ve.co_cidadao = c.co_seq_cidadao`,
  },
};
// v_condicao_ativa e v_atendimento dependem de v_problema_ativo; v_cidadao de v_cidadao_equipe etc. (calculado abaixo)
const NOMES = Object.keys(DEFINICOES);
const DEPS = Object.fromEntries(NOMES.map((n) => [n, NOMES.filter((m) => m !== n && new RegExp(`\\b${m}\\b`).test(DEFINICOES[n].sql))]));

// Colunas com dado pessoal que o usuário de leitura NÃO deve conseguir ler (o diagnóstico avisa se conseguir).
const SENSIVEIS = { tb_cidadao: ["no_cidadao", "no_mae", "no_pai", "nu_cpf", "nu_cns", "nu_telefone_celular", "ds_logradouro", "ds_email"] };
const OPCIONAIS_PII = new Set(["tb_cidadao.nu_cns", "tb_cidadao.nu_cpf", "tb_cidadao.no_cidadao"]);

// Views (com dependências, em ordem) necessárias para um SQL do catálogo.
function viewsDe(sql) {
  const achadas = new Set(); const pilha = [...sql.matchAll(/\bmcp\.(v_\w+)/g)].map((m) => m[1]);
  while (pilha.length) { const n = pilha.pop(); if (!DEFINICOES[n]) throw new Error("view desconhecida: " + n); if (achadas.has(n)) continue; achadas.add(n); pilha.push(...DEPS[n]); }
  return NOMES.filter((n) => achadas.has(n));
}

const SAL_OK = /^[A-Za-z0-9]{8,64}$/;
// Converte um SQL do catálogo (que lê mcp.v_*) em um SQL autônomo que lê direto as tabelas do PEC.
function montarSql(sql, sal) {
  if (!SAL_OK.test(String(sal || ""))) throw new Error("Sal do hash inválido (8 a 64 letras/números).");
  const vs = viewsDe(sql);
  const ctes = vs.map((n) => `${n} AS NOT MATERIALIZED (\n${DEFINICOES[n].sql.replace(/__SAL__/g, `'${sal}'`)}\n)`).join(",\n");
  const corpo = sql.replace(/\bmcp\.(v_\w+)/g, "$1");
  if (!vs.length) return corpo;
  return /^\s*WITH\s/i.test(corpo) ? `WITH ${ctes},\n${corpo.replace(/^\s*WITH\s+/i, "")}` : `WITH ${ctes}\n${corpo}`;
}

// Colunas das tabelas do PEC que um SQL do catálogo precisa ler.
function colunasDe(sql) {
  const r = {};
  for (const n of viewsDe(sql)) for (const [t, cols] of Object.entries(DEFINICOES[n].usa)) (r[t] ||= new Set()), cols.forEach((c) => r[t].add(c));
  return r;
}
function todasColunas(incluirCnsCpf, incluirNomes = false) {
  const r = {};
  for (const n of NOMES) { const o = DEFINICOES[n].opcional; if ((o === "cnscpf" && !incluirCnsCpf) || (o === "nomes" && !incluirNomes)) continue; for (const [t, cols] of Object.entries(DEFINICOES[n].usa)) (r[t] ||= new Set()), cols.forEach((c) => r[t].add(c)); }
  return Object.fromEntries(Object.entries(r).map(([t, s]) => [t, [...s].sort()]));
}
const ident = (s) => { if (!/^[A-Za-z0-9_]{1,63}$/.test(s)) throw new Error("identificador inválido: " + s); return '"' + s + '"'; };

// Script de permissões para a TI executar UMA vez (pgAdmin, DBeaver ou psql) com um usuário administrador.
function scriptPermissoes({ usuario = "sira_ro", senha, banco, incluirCnsCpf = false, incluirNomes = false, ip = null }) {
  if (!/^[a-z_][a-z0-9_]{2,40}$/.test(usuario)) throw new Error("Nome de usuário inválido (letras minúsculas, números e _).");
  if (typeof senha !== "string" || senha.length < 12 || senha.length > 100 || /['\\\0]/.test(senha)) throw new Error("A senha precisa ter de 12 a 100 caracteres, sem aspas simples nem barra invertida.");
  const u = ident(usuario), b = ident(banco), cols = todasColunas(incluirCnsCpf, incluirNomes);
  const L = [];
  L.push("-- SIRA — permissões do usuário de LEITURA. Rode UMA vez, com um usuário administrador do PostgreSQL, conectado ao banco do e-SUS.");
  L.push("-- Este script NÃO cria tabelas, NÃO altera dados e NÃO instala nada: só cria um usuário e concede SELECT em colunas.");
  L.push("-- Nome da mãe, endereço, telefone e e-mail dos cidadãos NÃO são concedidos em nenhuma hipótese." + (incluirNomes ? "" : " O NOME do cidadão também não.") + (incluirCnsCpf ? " CNS e CPF foram liberados por opção, para a pergunta de qualidade do cadastro." : " CNS e CPF também não."));
  if (incluirNomes) L.push("-- ATENÇÃO: este script libera a leitura do NOME e da data de nascimento do cidadão, para as LISTAS NOMINAIS do SIRA (ex.: cadastros sem CPF).", "--          Isso exige autorização do encarregado de dados (LGPD) da prefeitura. O SIRA registra quem gerou cada lista e o motivo informado.");
  L.push("-- Para desfazer: REASSIGN/DROP OWNED não é necessário; basta  DROP ROLE " + u + ";  (veja o fim do arquivo).", "");
  L.push("DO $$ BEGIN",
    `  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${usuario}') THEN CREATE ROLE ${u} LOGIN PASSWORD '${senha}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 5;`,
    `  ELSE ALTER ROLE ${u} LOGIN PASSWORD '${senha}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 5; END IF;`, "END $$;");
  L.push(`ALTER ROLE ${u} SET default_transaction_read_only = on;`, `ALTER ROLE ${u} SET statement_timeout = '30s';`, `ALTER ROLE ${u} SET idle_in_transaction_session_timeout = '60s';`, `ALTER ROLE ${u} SET lock_timeout = '3s';`);
  L.push(`GRANT CONNECT ON DATABASE ${b} TO ${u};`, `GRANT USAGE ON SCHEMA public TO ${u};`, "");
  L.push("-- SELECT somente nas colunas que as perguntas do SIRA usam:");
  for (const [t, cs] of Object.entries(cols)) L.push(`GRANT SELECT (${cs.map(ident).join(", ")}) ON public.${ident(t)} TO ${u};`);
  L.push("", "-- Recomendado: no pg_hba.conf, libere este usuário apenas para o IP do servidor do SIRA" + (ip ? ` (${ip})` : "") + ", por exemplo:");
  L.push(`--   host  ${banco}  ${usuario}  ${ip || "IP_DO_SERVIDOR_SIRA"}/32  scram-sha-256`, "");
  L.push("-- Para remover o acesso do SIRA no futuro:", `--   REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${u};  REVOKE CONNECT ON DATABASE ${b} FROM ${u};  DROP ROLE ${u};`);
  return L.join("\n") + "\n";
}

module.exports = { DEFINICOES, DEPS, SENSIVEIS, OPCIONAIS_PII, viewsDe, montarSql, colunasDe, todasColunas, scriptPermissoes };
