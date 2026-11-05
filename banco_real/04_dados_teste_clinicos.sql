-- SIRA — dados CLÍNICOS FICTÍCIOS para validar as views em um banco de TESTE (nunca rode em produção nem em homologação real).
-- Reaproveita cadastros reais já existentes (amostra de até 4000 cidadãos ativos) e cria: vínculo com equipe, lista de problemas
-- (hipertensão, diabetes, gestação) e atendimentos de médico/enfermeiro/técnico nos últimos meses. Calcula o GABARITO do que criou
-- (tabela sira_gabarito) para você comparar com as respostas do SIRA.
-- Uso:  psql -d esus_sira_teste -f 04_dados_teste_clinicos.sql        (veja preparar_base_teste.sh)
\set ON_ERROR_STOP on
SELECT setseed(0.42);

-- Insere em tabela real preenchendo automaticamente as outras colunas NOT NULL sem padrão (0, '', data atual), para não depender
-- de colunas que o e-SUS exige e que não nos interessam.
CREATE FUNCTION pg_temp.insere(tab text, cols text, exprs text, fonte text) RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE ex_c text := ''; ex_v text := ''; r record; n bigint;
BEGIN
  FOR r IN SELECT column_name AS c, data_type AS t FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = tab AND is_nullable = 'NO' AND column_default IS NULL
             AND column_name <> ALL (string_to_array(replace(cols, ' ', ''), ',')) LOOP
    ex_c := ex_c || ', ' || quote_ident(r.c);
    ex_v := ex_v || ', ' || CASE WHEN r.t IN ('bigint','integer','smallint','numeric') THEN '0'
                                 WHEN r.t LIKE 'timestamp%' THEN 'now()' WHEN r.t = 'date' THEN 'current_date'
                                 WHEN r.t = 'boolean' THEN 'false' ELSE quote_literal('') END;
  END LOOP;
  EXECUTE format('INSERT INTO public.%I (%s%s) SELECT %s%s FROM (%s) s', tab, cols, ex_c, exprs, ex_v, fonte);
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $f$;

-- ── referências que precisam existir ──────────────────────────────────────────
CREATE TEMP TABLE ref AS
SELECT (SELECT co_seq_ciap FROM public.tb_ciap WHERE co_ciap ~ '^K86' ORDER BY co_seq_ciap LIMIT 1) AS ciap_has,
       (SELECT co_seq_ciap FROM public.tb_ciap WHERE co_ciap ~ '^T90' ORDER BY co_seq_ciap LIMIT 1) AS ciap_dm,
       (SELECT co_seq_ciap FROM public.tb_ciap WHERE co_ciap ~ '^W78' ORDER BY co_seq_ciap LIMIT 1) AS ciap_gest;
DO $$ BEGIN
  IF (SELECT ciap_has IS NULL OR ciap_dm IS NULL OR ciap_gest IS NULL FROM ref) THEN
    RAISE EXCEPTION 'tb_ciap não tem K86, T90 ou W78 neste banco: me envie SELECT co_seq_ciap, co_ciap, ds_ciap FROM tb_ciap LIMIT 20';
  END IF;
END $$;

-- profissionais (lotações) de médico/enfermeiro/técnico de enfermagem, ativas, com unidade
CREATE TEMP TABLE lot AS
SELECT l.co_ator_papel AS lotacao, l.co_unidade_saude AS unidade, l.co_equipe AS equipe,
       CASE WHEN upper(cb.no_cbo) ~ 'T.CNICO|AUXILIAR' AND upper(cb.no_cbo) ~ 'ENFERM' THEN 'TECNICO'
            WHEN upper(cb.no_cbo) ~ 'ENFERMEIR' THEN 'ENFERMEIRO' ELSE 'MEDICO' END AS cat,
       row_number() OVER (ORDER BY l.co_ator_papel) AS rn
FROM public.tb_lotacao l JOIN public.tb_cbo cb ON cb.co_cbo = l.co_cbo
WHERE l.dt_desativacao_lotacao IS NULL AND l.co_unidade_saude IS NOT NULL AND l.co_ator_papel IS NOT NULL
  AND ((upper(cb.no_cbo) ~ 'M.DIC' AND upper(cb.no_cbo) !~ 'VETERIN') OR upper(cb.no_cbo) ~ 'ENFERMEIR' OR (upper(cb.no_cbo) ~ 'T.CNICO|AUXILIAR' AND upper(cb.no_cbo) ~ 'ENFERM'));
DO $$ BEGIN
  IF (SELECT count(*) FROM lot WHERE cat IN ('MEDICO','ENFERMEIRO')) = 0 THEN
    RAISE EXCEPTION 'Nenhuma lotação ativa de médico/enfermeiro em tb_lotacao: este banco não tem profissionais.';
  END IF;
END $$;
CREATE TEMP TABLE lot_me AS SELECT *, row_number() OVER (ORDER BY lotacao) AS r2 FROM lot WHERE cat IN ('MEDICO','ENFERMEIRO');
CREATE TEMP TABLE lot_t  AS SELECT *, row_number() OVER (ORDER BY lotacao) AS r2 FROM lot WHERE cat = 'TECNICO';

CREATE TEMP TABLE eq AS
SELECT nu_ine, row_number() OVER (ORDER BY co_seq_equipe) AS rn FROM public.tb_equipe WHERE st_ativo = 1 AND nu_ine IS NOT NULL;
DO $$ BEGIN IF (SELECT count(*) FROM eq) = 0 THEN RAISE EXCEPTION 'Sem equipes ativas com INE em tb_equipe.'; END IF; END $$;

-- ── amostra de cidadãos reais (ativos) ────────────────────────────────────────
CREATE TEMP TABLE am AS
SELECT c.co_seq_cidadao AS id, upper(left(COALESCE(c.no_sexo, ''), 1)) AS sexo,
       date_part('year', age(current_date, c.dt_nascimento))::int AS idade,
       (abs(hashtext(c.co_seq_cidadao::text || 'a')) % 1000) / 1000.0 AS u1,
       (abs(hashtext(c.co_seq_cidadao::text || 'b')) % 1000) / 1000.0 AS u2,
       (abs(hashtext(c.co_seq_cidadao::text || 'c')) % 1000) / 1000.0 AS u3,
       (abs(hashtext(c.co_seq_cidadao::text || 'd')) % 1000) / 1000.0 AS u4,
       (abs(hashtext(c.co_seq_cidadao::text || 'e')) % 1000) AS h
FROM public.tb_cidadao c
WHERE c.st_ativo = 1 AND COALESCE(c.st_faleceu, 0) = 0 AND c.dt_obito IS NULL AND COALESCE(c.st_unificado, 0) = 0 AND c.dt_nascimento IS NOT NULL
ORDER BY random() LIMIT 4000;

-- prontuário: cria para quem não tem
SELECT pg_temp.insere('tb_prontuario', 'co_seq_prontuario, co_cidadao', '(SELECT COALESCE(max(co_seq_prontuario),0) FROM public.tb_prontuario) + s.rn, s.id',
  'SELECT a.id, row_number() OVER () AS rn FROM am a WHERE NOT EXISTS (SELECT 1 FROM public.tb_prontuario p WHERE p.co_cidadao = a.id)') AS prontuarios_criados;
CREATE TEMP TABLE am2 AS SELECT a.*, (SELECT min(p.co_seq_prontuario) FROM public.tb_prontuario p WHERE p.co_cidadao = a.id) AS pront FROM am a;

-- vínculo com equipe para 90% (os 10% restantes ficam "sem equipe" de propósito)
CREATE TEMP TABLE vinc AS SELECT a.id, e.nu_ine FROM am2 a JOIN eq e ON e.rn = (a.h % (SELECT count(*) FROM eq)) + 1 WHERE a.u4 < 0.90;
SELECT pg_temp.insere('tb_cidadao_vinculacao_equipe', 'co_seq_cidadao_vinculacao_eqp, co_cidadao, nu_ine, dt_atualizacao_cadastro',
  '(SELECT COALESCE(max(co_seq_cidadao_vinculacao_eqp),0) FROM public.tb_cidadao_vinculacao_equipe) + s.rn, s.id, s.nu_ine, now()',
  'SELECT id, nu_ine, row_number() OVER () AS rn FROM vinc') AS vinculos_criados;

-- ── quem tem qual condição (exclusivas entre si, para o gabarito ficar limpo) ─────────────────────
-- gestante: mulher 15–40 anos (≈15%); depois hipertenso (≈25%) e diabético (≈10%) entre os demais; "esquecida" = gestação aberta há >400 dias
CREATE TEMP TABLE cond AS
SELECT a.*, CASE WHEN a.sexo = 'F' AND a.idade BETWEEN 15 AND 40 AND a.u1 < 0.15 THEN 'GESTANTE'
                 WHEN a.idade >= 30 AND a.u2 < 0.25 THEN 'HIPERTENSO'
                 WHEN a.idade >= 30 AND a.u2 BETWEEN 0.25 AND 0.35 THEN 'DIABETICO' END AS tipo,
       (a.u3 < 0.12) AS resolvido,                               -- problema encerrado (não conta como ativo)
       (a.u3 BETWEEN 0.12 AND 0.22) AS esquecida,                -- só para gestantes: gestação aberta há muito tempo (não conta)
       (a.u4 < 0.60) AS tem_atend                                -- tem atendimento recente de médico/enfermeiro
FROM am2 a;
ALTER TABLE cond ADD COLUMN g int, ADD COLUMN ativo_gab boolean;
UPDATE cond SET g = CASE WHEN tipo = 'GESTANTE' AND esquecida THEN 400 + (h % 150) WHEN tipo = 'GESTANTE' THEN 60 + (h % 190) END;
UPDATE cond SET ativo_gab = (tipo IS NOT NULL AND NOT resolvido AND (tipo <> 'GESTANTE' OR NOT esquecida));

-- ── lista de problemas ────────────────────────────────────────────────────────
CREATE TEMP TABLE prob AS
SELECT c.id, c.pront, c.tipo, c.resolvido, c.g,
       CASE c.tipo WHEN 'HIPERTENSO' THEN (SELECT ciap_has FROM ref) WHEN 'DIABETICO' THEN (SELECT ciap_dm FROM ref) ELSE (SELECT ciap_gest FROM ref) END AS ciap,
       row_number() OVER (ORDER BY c.id) AS rn,
       (SELECT COALESCE(max(co_unico_problema), 0) FROM public.tb_problema) AS base_unico,
       (SELECT COALESCE(max(co_seq_problema), 0) FROM public.tb_problema) AS base_prob,
       (SELECT COALESCE(max(co_seq_problema_evolucao), 0) FROM public.tb_problema_evolucao) AS base_evo
FROM cond c WHERE c.tipo IS NOT NULL;
SELECT pg_temp.insere('tb_problema', 'co_seq_problema, co_ciap, co_prontuario, co_unico_problema', 's.base_prob + s.rn, s.ciap, s.pront, s.base_unico + s.rn', 'SELECT * FROM prob') AS problemas_criados;
SELECT pg_temp.insere('tb_problema_evolucao', 'co_seq_problema_evolucao, co_unico_problema, co_situacao_problema, dt_inicio_problema, dt_fim_problema, co_sequencial_evolucao',
  's.base_evo + s.rn, s.base_unico + s.rn, CASE WHEN s.resolvido THEN 2 ELSE 0 END, current_date - COALESCE(s.g, 200 + (s.rn % 500))::int, CASE WHEN s.resolvido THEN current_date - 5 END, 1',
  'SELECT * FROM prob') AS evolucoes_criadas;

-- ── atendimentos (médico/enfermeiro; alguns de técnico) ──────────────────────────────────────────
-- dias_atras escolhido longe das bordas (30/60/180 dias) para o gabarito não depender de arredondamento
CREATE TEMP TABLE plano (rn bigserial, pront bigint, id bigint, tipo text, cat text, lotacao bigint, unidade bigint, equipe bigint, dt timestamp);
-- hipertensos/diabéticos ativos: 60% com consulta nos últimos 5 meses; os demais, só uma antiga (>8 meses)
INSERT INTO plano (pront, id, tipo, lotacao, dt)
SELECT c.pront, c.id, c.tipo, (SELECT lotacao FROM lot_me m WHERE m.r2 = (c.h % (SELECT count(*) FROM lot_me)) + 1),
       now() - (CASE WHEN c.tem_atend THEN 20 + (c.h % 130) ELSE 250 + (c.h % 150) END || ' days')::interval
FROM cond c WHERE c.tipo IN ('HIPERTENSO', 'DIABETICO') AND c.ativo_gab;
-- gestantes ativas: 65% com atendimento nos últimos 50 dias (dentro da gestação); as demais, só um antigo (70+ dias) quando a gestação permite
INSERT INTO plano (pront, id, tipo, lotacao, dt)
SELECT c.pront, c.id, c.tipo, (SELECT lotacao FROM lot_me m WHERE m.r2 = (c.h % (SELECT count(*) FROM lot_me)) + 1),
       now() - (CASE WHEN c.u4 < 0.65 THEN 3 + (c.h % 45) ELSE 70 + (c.h % 5) END || ' days')::interval
FROM cond c WHERE c.tipo = 'GESTANTE' AND c.ativo_gab AND (c.u4 < 0.65 OR c.g > 80);
-- demais pessoas da amostra (sem condição): 1 a 3 atendimentos nos últimos 90 dias, com médico/enfermeiro/técnico
INSERT INTO plano (pront, id, tipo, lotacao, dt)
SELECT c.pront, c.id, NULL, (SELECT lotacao FROM lot_me m WHERE m.r2 = ((c.h + k) % (SELECT count(*) FROM lot_me)) + 1),
       now() - ((1 + ((c.h * (k + 1)) % 88)) || ' days')::interval
FROM cond c CROSS JOIN generate_series(1, 3) k WHERE c.tipo IS NULL AND k <= 1 + (c.h % 3);
UPDATE plano p SET unidade = l.unidade, equipe = l.equipe, cat = l.cat FROM lot l WHERE l.lotacao = p.lotacao;
-- alguns atendimentos de técnico de enfermagem (se houver) para exercitar a categoria
INSERT INTO plano (pront, id, tipo, lotacao, unidade, equipe, cat, dt)
SELECT c.pront, c.id, NULL, t.lotacao, t.unidade, t.equipe, t.cat, now() - ((2 + (c.h % 60)) || ' days')::interval
FROM cond c JOIN lot_t t ON t.r2 = (c.h % GREATEST((SELECT count(*) FROM lot_t), 1)) + 1 WHERE c.tipo IS NULL AND c.u1 > 0.85;

SELECT pg_temp.insere('tb_atend', 'co_seq_atend, co_prontuario, co_unidade_saude, co_equipe, dt_inicio, dt_fim, st_atend',
  '(SELECT COALESCE(max(co_seq_atend),0) FROM public.tb_atend) + s.rn, s.pront, s.unidade, s.equipe, s.dt, s.dt + interval ''20 minutes'', 6',
  'SELECT * FROM plano') AS atendimentos_criados;
SELECT pg_temp.insere('tb_atend_prof', 'co_seq_atend_prof, co_atend, co_lotacao, dt_inicio, dt_fim, st_cancelado',
  '(SELECT COALESCE(max(co_seq_atend_prof),0) FROM public.tb_atend_prof) + s.rn, (SELECT COALESCE(max(co_seq_atend),0) FROM public.tb_atend) - (SELECT count(*) FROM plano) + s.rn, s.lotacao, s.dt, s.dt + interval ''20 minutes'', 0',
  'SELECT * FROM plano') AS participacoes_criadas;

-- ── GABARITO: o que foi criado, calculado a partir das tabelas de plano (independente das views) ─────────────
DROP TABLE IF EXISTS public.sira_gabarito;
CREATE TABLE public.sira_gabarito AS
SELECT 'gestantes ativas' AS pergunta, (SELECT count(*) FROM cond WHERE tipo = 'GESTANTE' AND ativo_gab)::int AS esperado
UNION ALL SELECT 'gestantes sem pré-natal há mais de 60 dias',
  (SELECT count(*) FROM cond c WHERE c.tipo = 'GESTANTE' AND c.ativo_gab AND NOT EXISTS (SELECT 1 FROM plano p WHERE p.id = c.id AND p.dt >= now() - interval '60 days' AND p.dt::date >= current_date - c.g))::int
UNION ALL SELECT 'hipertensos ativos', (SELECT count(*) FROM cond WHERE tipo = 'HIPERTENSO' AND ativo_gab)::int
UNION ALL SELECT 'hipertensos sem consulta há mais de 6 meses',
  (SELECT count(*) FROM cond c WHERE c.tipo = 'HIPERTENSO' AND c.ativo_gab AND NOT EXISTS (SELECT 1 FROM plano p WHERE p.id = c.id AND p.dt::date >= current_date - interval '6 months'))::int
UNION ALL SELECT 'diabéticos ativos', (SELECT count(*) FROM cond WHERE tipo = 'DIABETICO' AND ativo_gab)::int
UNION ALL SELECT 'diabéticos sem consulta há mais de 6 meses',
  (SELECT count(*) FROM cond c WHERE c.tipo = 'DIABETICO' AND c.ativo_gab AND NOT EXISTS (SELECT 1 FROM plano p WHERE p.id = c.id AND p.dt::date >= current_date - interval '6 months'))::int
UNION ALL SELECT 'atendimentos criados nos últimos 30 dias (soma ao que já existia)', (SELECT count(*) FROM plano WHERE dt::date >= current_date - 30)::int
UNION ALL SELECT 'atendimentos de técnico criados (soma ao que já existia)', (SELECT count(*) FROM plano WHERE cat = 'TECNICO')::int;
\echo
\echo '== GABARITO (compare com o que o SIRA responde; "soma ao que já existia" = some com o total anterior do banco) =='
SELECT * FROM public.sira_gabarito;
