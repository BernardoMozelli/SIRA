-- SIRA — CONFERÊNCIA INDEPENDENTE DOS NÚMEROS
-- Só LEITURA (SELECT). Rode no banco do e-SUS com um usuário administrador (pgAdmin/DBeaver/psql).
-- Cada consulta abaixo recalcula, por um caminho DIFERENTE do usado pelo SIRA e direto nas tabelas do PEC,
-- a mesma resposta que o SIRA dá. Se o número do SIRA for igual ao daqui, o cálculo está consistente.
-- Para saber se a REGRA bate com a realidade da unidade, compare também com os relatórios do próprio PEC (ver LEIA-ME).
-- Os parâmetros estão no começo de cada bloco: dias = 60 (pré-natal), meses = 6 (hipertensos/diabéticos), período = últimos 30 dias.

-- Base comum: problemas relevantes com a situação MAIS RECENTE de cada problema (maior co_sequencial_evolucao).
CREATE TEMP TABLE conf_prob AS
SELECT pr.co_cidadao,
       CASE WHEN ci.co_ciap ~ '^(K86|K87)' OR cd.nu_cid10 ~ '^I1[0-5]' THEN 'H'
            WHEN ci.co_ciap ~ '^(T89|T90)' OR cd.nu_cid10 ~ '^E1[0-4]' THEN 'D'
            ELSE 'G' END AS tipo,
       ult.dt_inicio_problema AS ini, ult.dt_fim_problema AS fim, ult.co_situacao_problema AS sit
FROM public.tb_problema p
JOIN public.tb_prontuario pr ON pr.co_seq_prontuario = p.co_prontuario
LEFT JOIN public.tb_ciap ci ON ci.co_seq_ciap = p.co_ciap
LEFT JOIN public.tb_cid10 cd ON cd.co_cid10 = p.co_cid10
JOIN LATERAL (SELECT e.* FROM public.tb_problema_evolucao e WHERE e.co_unico_problema = p.co_unico_problema
              ORDER BY e.co_sequencial_evolucao DESC NULLS LAST, e.co_seq_problema_evolucao DESC LIMIT 1) ult ON true
WHERE ci.co_ciap ~ '^(K86|K87|T89|T90|W78|W79|W84|W85)' OR cd.nu_cid10 ~ '^(I1[0-5]|E1[0-4]|Z34|Z35|O09)';

-- Cidadãos ativos (não falecidos, não unificados).
CREATE TEMP TABLE conf_cid AS
SELECT co_seq_cidadao AS id FROM public.tb_cidadao
WHERE st_ativo = 1 AND COALESCE(st_faleceu,0) = 0 AND dt_obito IS NULL AND COALESCE(st_unificado,0) = 0;

-- Último atendimento de médico/enfermeiro/dentista por cidadão (participações não canceladas).
CREATE TEMP TABLE conf_ult AS
SELECT pr.co_cidadao, max(ap.dt_inicio::date) AS ult
FROM public.tb_atend_prof ap
JOIN public.tb_atend a ON a.co_seq_atend = ap.co_atend
JOIN public.tb_prontuario pr ON pr.co_seq_prontuario = a.co_prontuario
JOIN public.tb_lotacao l ON l.co_ator_papel = ap.co_lotacao
JOIN public.tb_cbo cb ON cb.co_cbo = l.co_cbo
WHERE ap.dt_inicio IS NOT NULL AND COALESCE(ap.st_cancelado,0)=0 AND COALESCE(ap.st_registro_historico,0)=0
  AND ( upper(cb.no_cbo) ~ 'ODONTO|DENTIST|CIRURGI.O.DENTISTA'
     OR (upper(cb.no_cbo) ~ 'ENFERMEIR' AND NOT (upper(cb.no_cbo) ~ 'T.CNICO|AUXILIAR'))
     OR (upper(cb.no_cbo) ~ 'M.DIC' AND upper(cb.no_cbo) !~ 'VETERIN') )
GROUP BY pr.co_cidadao;

-- 1) Gestantes ativas  (SIRA: "quantas gestantes temos")
SELECT '1 gestantes_ativas' AS pergunta, count(DISTINCT p.co_cidadao) AS conferencia
FROM conf_prob p JOIN conf_cid c ON c.id = p.co_cidadao
WHERE p.tipo = 'G' AND p.fim IS NULL AND COALESCE(p.sit,0) <> 2 AND p.ini >= current_date - 300;

-- 2) Hipertensos sem consulta há 6 meses  (SIRA: "hipertensos sem consulta há mais de 6 meses")
SELECT '2 hipertensos_sem_consulta_6m', count(DISTINCT p.co_cidadao)
FROM conf_prob p JOIN conf_cid c ON c.id = p.co_cidadao
WHERE p.tipo = 'H' AND p.fim IS NULL AND COALESCE(p.sit,0) <> 2
  AND NOT EXISTS (SELECT 1 FROM conf_ult u WHERE u.co_cidadao = p.co_cidadao AND u.ult >= current_date - interval '6 month');

-- 3) Diabéticos sem consulta há 6 meses  (SIRA: "diabéticos sem consulta há mais de 6 meses")
SELECT '3 diabeticos_sem_consulta_6m', count(DISTINCT p.co_cidadao)
FROM conf_prob p JOIN conf_cid c ON c.id = p.co_cidadao
WHERE p.tipo = 'D' AND p.fim IS NULL AND COALESCE(p.sit,0) <> 2
  AND NOT EXISTS (SELECT 1 FROM conf_ult u WHERE u.co_cidadao = p.co_cidadao AND u.ult >= current_date - interval '6 month');

-- 4) Atendimentos (participações de profissionais) nos últimos 30 dias  (SIRA: "atendimentos nos últimos 30 dias")
SELECT '4 atendimentos_30d', count(*)
FROM public.tb_atend_prof ap
WHERE ap.dt_inicio::date >= current_date - 30 AND ap.dt_inicio::date <= current_date
  AND COALESCE(ap.st_cancelado,0)=0 AND COALESCE(ap.st_registro_historico,0)=0;

-- 5) Cidadãos ativos no total (para comparar com o cadastro do PEC)
SELECT '5 cidadaos_ativos', count(*) FROM conf_cid;

-- Observação: a pergunta "gestantes sem pré-natal" usa uma aproximação (atendimento de médico/enfermeiro durante a gestação);
-- confira-a com o relatório de gestantes do PEC (item 4 do LEIA-ME) antes de usá-la em decisões.
DROP TABLE conf_prob, conf_cid, conf_ult;
