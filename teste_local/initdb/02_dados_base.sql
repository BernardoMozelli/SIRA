-- Dados-base FICTÍCIOS: 6 unidades, 10 equipes, 8.000 cidadãos (nomes e documentos inventados), CIAP, CBO e profissionais.
INSERT INTO tb_unidade_saude (co_seq_unidade_saude, no_unidade_saude, st_ativo)
  SELECT g, 'UBS TESTE ' || g, 1 FROM generate_series(1, 6) g;
INSERT INTO tb_equipe (co_seq_equipe, nu_ine, st_ativo, co_unidade_saude, no_equipe)
  SELECT g, lpad((900000 + g)::text, 10, '0'), 1, 1 + g % 6, 'Equipe Teste ' || g FROM generate_series(1, 10) g;
INSERT INTO tb_cidadao (co_seq_cidadao, st_ativo, st_faleceu, st_unificado, nu_cns, nu_cpf, no_cidadao, dt_nascimento, no_sexo)
  SELECT g, 1, 0, 0,
         CASE WHEN g % 11 = 0 THEN NULL WHEN g % 97 = 0 THEN '700000000000001' ELSE (700000000000000 + g)::text END,   -- alguns sem CNS e alguns CNS repetidos
         CASE WHEN g % 13 = 0 THEN '' ELSE (99900000000 + g)::text END,
         'CIDADAO TESTE ' || g, date '1945-01-01' + ((g * 37) % 24000),
         CASE WHEN g % 2 = 0 THEN 'FEMININO' ELSE 'MASCULINO' END
  FROM generate_series(1, 8000) g;
INSERT INTO tb_prontuario (co_seq_prontuario, co_cidadao) SELECT g, g FROM generate_series(1, 8000) g;
INSERT INTO tb_ciap (co_seq_ciap, co_ciap, ds_ciap) VALUES (1, 'K86', 'Hipertensão sem complicações'), (2, 'T90', 'Diabetes não insulinodependente'), (3, 'W78', 'Gravidez'), (4, 'A01', 'Dor generalizada');
INSERT INTO tb_cbo (co_cbo, no_cbo) VALUES (1, 'MÉDICO CLÍNICO'), (2, 'ENFERMEIRO DA ESTRATÉGIA DE SAÚDE DA FAMÍLIA'), (3, 'TÉCNICO DE ENFERMAGEM'), (4, 'CIRURGIÃO DENTISTA');
INSERT INTO tb_lotacao (co_ator_papel, co_cbo, co_unidade_saude, co_equipe)
  SELECT 1000 + g, 1 + (g % 4), 1 + (g % 6), 1 + (g % 10) FROM generate_series(1, 24) g;
