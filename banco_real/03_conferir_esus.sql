-- Conferência das views contra o PEC. Só totais (nenhum dado de paciente). Rode como administrador:
\timing on
--   psql -d esus -f 03_conferir_esus.sql
\echo '== 1) situações de problema que existem no seu PEC (confirme qual número é "resolvido"; as views assumem 2) =='
SELECT e.co_situacao_problema AS situacao, s.ds_situacao_problema AS descricao, count(*) AS qtd
FROM public.tb_problema_evolucao e LEFT JOIN public.tb_dim_situacao_problema s ON s.nu_identificador = e.co_situacao_problema::text
GROUP BY 1, 2 ORDER BY 1;
\echo '== 2) totais do SIRA para comparar com os relatórios do PEC / Metabase =='
SELECT 'cidadãos ativos' AS item, count(*) FROM mcp.v_cidadao WHERE ativo
UNION ALL SELECT 'gestantes ativas', count(*) FROM mcp.v_condicao_ativa WHERE tipo = 'GESTANTE'
UNION ALL SELECT 'hipertensos ativos', count(*) FROM mcp.v_condicao_ativa WHERE tipo = 'HIPERTENSO'
UNION ALL SELECT 'diabéticos ativos', count(*) FROM mcp.v_condicao_ativa WHERE tipo = 'DIABETICO'
UNION ALL SELECT 'atendimentos (últimos 30 dias)', count(*) FROM mcp.v_atendimento WHERE dt_atendimento >= current_date - 30
UNION ALL SELECT 'unidades', count(*) FROM mcp.v_unidade UNION ALL SELECT 'equipes', count(*) FROM mcp.v_equipe;
\echo '== 3) cadastros ativos sem equipe vinculada (se for muito, a vinculação por INE precisa de ajuste) =='
SELECT count(*) FILTER (WHERE equipe_id IS NULL) AS sem_equipe, count(*) AS total FROM mcp.v_cidadao WHERE ativo;
\echo '== 4) categorias profissionais encontradas =='
SELECT categoria, count(*) FROM mcp.v_atendimento GROUP BY 1 ORDER BY 2 DESC;
