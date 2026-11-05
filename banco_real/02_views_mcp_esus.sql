-- SIRA — camada de views mascaradas sobre o esquema REAL do e-SUS PEC (tabelas tb_*, schema public).
-- Substitui o 02_views_mcp.sql da demonstração: as views têm os MESMOS nomes de colunas, então o catálogo não muda.
-- Execute com um usuário administrador do banco (ex.: postgres), uma vez por ambiente:
--   psql -d esus -v sal='SAL-SECRETO-DA-PREFEITURA' -v senha='SENHA-DO-sira_ro' -f 02_views_mcp_esus.sql
-- Nada de nome, CPF, CNS, nascimento ou endereço sai destas views. O identificador do cidadão é um hash com sal local.
\set ON_ERROR_STOP on
DROP SCHEMA IF EXISTS mcp CASCADE;
CREATE SCHEMA mcp;

-- ── unidades e equipes ────────────────────────────────────────────────────────
CREATE VIEW mcp.v_unidade AS
SELECT u.co_seq_unidade_saude::int AS id, u.no_unidade_saude AS nome
FROM public.tb_unidade_saude u WHERE u.st_ativo = 1;

CREATE VIEW mcp.v_equipe AS
SELECT e.co_seq_equipe::int AS id, e.co_unidade_saude::int AS unidade_id, e.no_equipe AS nome
FROM public.tb_equipe e WHERE e.st_ativo = 1;

-- Equipe do cidadão: 1) vinculação mais recente (tb_cidadao_vinculacao_equipe); 2) se não houver, o núcleo familiar (tb_cidadao_nucleo_familiar,
-- mais recente, sem "mudou-se"). O INE é comparado sem zeros à esquerda (ex.: 0000268631).
CREATE VIEW mcp.v_cidadao_equipe AS
SELECT DISTINCT ON (x.co_cidadao) x.co_cidadao, x.equipe_id FROM (
  SELECT v.co_cidadao, e.co_seq_equipe::int AS equipe_id, 1 AS fonte, v.dt_atualizacao_cadastro::date AS dt, e.st_ativo
  FROM public.tb_cidadao_vinculacao_equipe v
  JOIN public.tb_equipe e ON ltrim(e.nu_ine, '0') = ltrim(v.nu_ine, '0') AND NULLIF(ltrim(v.nu_ine, '0'), '') IS NOT NULL
  UNION ALL
  SELECT n.co_cidadao, e.co_seq_equipe::int, 2, n.dt_ultima_atualizacao, e.st_ativo
  FROM public.tb_cidadao_nucleo_familiar n
  JOIN public.tb_equipe e ON ltrim(e.nu_ine, '0') = ltrim(n.nu_ine, '0') AND NULLIF(ltrim(n.nu_ine, '0'), '') IS NOT NULL
  WHERE COALESCE(n.st_mudou_se, 0) = 0
) x ORDER BY x.co_cidadao, x.fonte, x.dt DESC NULLS LAST, x.st_ativo DESC, x.equipe_id;

-- ── cidadãos (sem nome, CPF, CNS, nascimento) ────────────────────────────────
-- Ativo = cadastro ativo, não falecido e não unificado a outro.
CREATE VIEW mcp.v_cidadao AS
SELECT substr(md5(:'sal' || c.co_seq_cidadao::text), 1, 12) AS id_anon,
       c.co_seq_cidadao AS id_interno,
       upper(left(COALESCE(c.no_sexo, ''), 1)) AS sexo,
       CASE WHEN c.dt_nascimento IS NULL THEN NULL ELSE date_part('year', age(current_date, c.dt_nascimento))::int END AS idade,
       ve.equipe_id,
       (c.st_ativo = 1 AND COALESCE(c.st_faleceu, 0) = 0 AND c.dt_obito IS NULL AND COALESCE(c.st_unificado, 0) = 0) AS ativo
FROM public.tb_cidadao c
LEFT JOIN mcp.v_cidadao_equipe ve ON ve.co_cidadao = c.co_seq_cidadao;

-- ── condições ativas (gestante, hipertenso, diabético) ───────────────────────
-- Fonte: lista de problemas do prontuário (tb_problema) com a ÚLTIMA evolução (tb_problema_evolucao).
-- Ativo = evolução mais recente sem data de fim e com situação diferente de "resolvido" (2). CONFERIR com 03_conferir_esus.sql.
-- Códigos: hipertensão CIAP K86/K87 e CID I10–I15; diabetes CIAP T89/T90 e CID E10–E14;
--          gestação CIAP W78/W79/W84/W85 e CID Z34/Z35/O09 (só se iniciada há menos de 300 dias, para não carregar gestação "esquecida" aberta).
CREATE VIEW mcp.v_problema_ativo AS
WITH rel AS MATERIALIZED (   -- só os problemas que interessam (hipertensão, diabetes, gestação), com o cidadão
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
), ev AS MATERIALIZED (      -- última evolução de cada problema
  SELECT DISTINCT ON (e.co_unico_problema) e.co_unico_problema, e.dt_inicio_problema, e.dt_fim_problema, e.co_situacao_problema
  FROM public.tb_problema_evolucao e
  WHERE e.co_unico_problema IN (SELECT co_unico_problema FROM rel)
  ORDER BY e.co_unico_problema, e.co_sequencial_evolucao DESC NULLS LAST, e.co_seq_problema_evolucao DESC
)
SELECT rel.id_interno, rel.tipo, ev.dt_inicio_problema AS dt_inicio, ev.dt_fim_problema AS dt_fim,
       (ev.dt_fim_problema IS NULL AND COALESCE(ev.co_situacao_problema, 0) <> 2) AS ativo
FROM rel JOIN ev ON ev.co_unico_problema = rel.co_unico_problema;

CREATE VIEW mcp.v_condicao_ativa AS
SELECT DISTINCT ON (a.id_interno, a.tipo) a.id_interno, a.tipo, a.dt_inicio
FROM mcp.v_problema_ativo a
WHERE a.tipo IS NOT NULL AND a.ativo
  AND (a.tipo <> 'GESTANTE' OR a.dt_inicio >= current_date - 300)
ORDER BY a.id_interno, a.tipo, a.dt_inicio DESC NULLS LAST;

-- ── atendimentos ─────────────────────────────────────────────────────────────
-- Uma linha por participação de profissional (tb_atend_prof) já iniciada e não cancelada.
-- categoria: pelo CBO do profissional (MEDICO, ENFERMEIRO, TECNICO, ODONTO, OUTRO).
-- tipo: PRENATAL = atendimento de médico/enfermeiro a uma cidadã durante a gestação mais recente dela (problema de gestação); CONSULTA = demais atendimentos de
--       médico/enfermeiro/odontologia; OUTRO = restante. (Aproximação: o PEC guarda o tipo em tabelas de ficha que ainda não mapeamos.)
CREATE VIEW mcp.v_atendimento AS
SELECT x.id_interno, x.unidade_id, x.equipe_id, x.categoria,
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
LEFT JOIN (   -- gestação mais recente de cada cidadã (uma linha por pessoa: a junção não duplica atendimentos)
  SELECT DISTINCT ON (id_interno) id_interno, dt_inicio, COALESCE(dt_fim, dt_inicio + 300) AS fim
  FROM mcp.v_problema_ativo WHERE tipo = 'GESTANTE' AND dt_inicio IS NOT NULL
  ORDER BY id_interno, dt_inicio DESC
) g ON g.id_interno = x.id_interno AND x.dt_atendimento BETWEEN g.dt_inicio AND g.fim;

-- ── qualidade do cadastro (só marcadores; sem o número do documento) ─────────
CREATE VIEW mcp.v_qualidade_cadastro AS
SELECT c.co_seq_cidadao AS id_interno, ve.equipe_id,
       (c.st_ativo = 1 AND COALESCE(c.st_faleceu, 0) = 0 AND c.dt_obito IS NULL AND COALESCE(c.st_unificado, 0) = 0) AS ativo,
       (c.nu_cns IS NULL OR btrim(c.nu_cns) = '') AS sem_cns,
       (c.nu_cpf IS NULL OR btrim(c.nu_cpf) = '') AS sem_cpf,
       (c.st_ativo = 1 AND COALESCE(c.st_unificado, 0) = 0 AND c.nu_cns IS NOT NULL AND btrim(c.nu_cns) <> ''
        AND count(*) FILTER (WHERE c.st_ativo = 1 AND COALESCE(c.st_unificado, 0) = 0) OVER (PARTITION BY c.nu_cns) > 1) AS cns_duplicado
FROM public.tb_cidadao c
LEFT JOIN mcp.v_cidadao_equipe ve ON ve.co_cidadao = c.co_seq_cidadao;

-- ── lista NOMINAL (nome do cidadão): NÃO é liberada ao usuário sira_ro por padrão (ver REVOKE abaixo) ─────────
-- Só habilite (GRANT SELECT ON mcp.v_cidadao_nominal TO sira_ro) se a prefeitura autorizar listas com nomes no SIRA.
CREATE VIEW mcp.v_cidadao_nominal AS
SELECT c.co_seq_cidadao AS id_interno, c.no_cidadao AS nome, c.dt_nascimento, ve.equipe_id,
       (c.st_ativo = 1 AND COALESCE(c.st_faleceu, 0) = 0 AND c.dt_obito IS NULL AND COALESCE(c.st_unificado, 0) = 0) AS ativo
FROM public.tb_cidadao c
LEFT JOIN mcp.v_cidadao_equipe ve ON ve.co_cidadao = c.co_seq_cidadao;

-- ── usuário de leitura: só o schema mcp, só SELECT, somente leitura, com limite de tempo ─────────
SELECT format('CREATE ROLE sira_ro LOGIN PASSWORD %L', :'senha') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sira_ro') \gexec
SELECT format('ALTER ROLE sira_ro PASSWORD %L', :'senha') \gexec
ALTER ROLE sira_ro SET default_transaction_read_only = on;
ALTER ROLE sira_ro SET statement_timeout = '30s';
ALTER ROLE sira_ro SET search_path = mcp;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM sira_ro;
GRANT USAGE ON SCHEMA mcp TO sira_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA mcp TO sira_ro;
REVOKE ALL ON mcp.v_cidadao_nominal FROM sira_ro; -- nomes só com autorização explícita da prefeitura
