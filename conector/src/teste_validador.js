// Testa a barreira de segurança das consultas livres (SQL escrito pela IA). Uso: node src/teste_validador.js
const assert = require("assert"); const { validarSqlLivre: v } = require("./livre");
const ok = [
  "SELECT e.nome AS equipe, count(*)::int AS total FROM mcp.v_cidadao c JOIN mcp.v_equipe e ON e.id = c.equipe_id WHERE c.ativo GROUP BY e.nome ORDER BY total DESC",
  "WITH x AS (SELECT equipe_id, count(*) AS total FROM mcp.v_cidadao WHERE idade >= 60 GROUP BY equipe_id) SELECT * FROM x",
  "SELECT date_trunc('month', a.dt_atendimento)::date AS mes, count(*)::int AS total FROM mcp.v_atendimento a WHERE a.dt_atendimento >= current_date - 365 GROUP BY 1 ORDER BY 1",
  "SELECT extract(year FROM current_date) AS ano, count(distinct c.id_interno) AS total FROM mcp.v_cidadao c",
  "SELECT c.sexo, count(*) AS total FROM mcp.v_cidadao c WHERE c.id_interno IN (SELECT id_interno FROM mcp.v_condicao_ativa WHERE tipo = 'HIPERTENSO') GROUP BY 1",
  "SELECT count(*) AS total FROM mcp.v_condicao_ativa h JOIN mcp.v_condicao_ativa d ON d.id_interno = h.id_interno AND d.tipo = 'DIABETICO' WHERE h.tipo = 'HIPERTENSO'",
  "SELECT 'a;b' AS texto, count(*) AS total FROM mcp.v_cidadao", // ; dentro de texto entre aspas simples é só texto
];
const ruim = {
  "tabela crua": "SELECT count(*) AS total FROM tb_cidadao", "schema public": "SELECT count(*) AS total FROM public.tb_cidadao", "catálogo do banco": "SELECT count(*) AS total FROM pg_class",
  "duas instruções": "SELECT count(*) AS total FROM mcp.v_cidadao; DROP TABLE x", "pg_sleep": "SELECT pg_sleep(10), count(*) AS total FROM mcp.v_cidadao", "current_setting": "SELECT current_setting('x'), count(*) AS total FROM mcp.v_cidadao",
  "id listado": "SELECT id_interno, count(*) AS total FROM mcp.v_cidadao GROUP BY id_interno", "id com alias": "SELECT c.id_interno AS x, 1 AS total FROM mcp.v_cidadao c", "id_anon": "SELECT count(id_anon) AS total FROM mcp.v_cidadao",
  "junção com tabela crua": "SELECT count(*) AS total FROM mcp.v_cidadao, tb_cidadao", "junção com catálogo": "SELECT count(*) AS total FROM mcp.v_cidadao c JOIN pg_class p ON true",
  "comentário": "SELECT count(*) AS total FROM mcp.v_cidadao -- x", "comentário em bloco": "SELECT count(*) AS total FROM mcp.v_cidadao /* x */", "aspas duplas": 'SELECT count(*) AS total FROM mcp."v_cidadao"', "cifrão": "SELECT $$x$$, count(*) AS total FROM mcp.v_cidadao",
  "generate_series": "SELECT count(*) AS total FROM generate_series(1, 100000000)", "sem count": "SELECT sexo FROM mcp.v_cidadao", "sem visão": "SELECT count(*) AS total",
  "INSERT": "INSERT INTO x VALUES (1)", "FOR UPDATE": "SELECT count(*) AS total FROM mcp.v_cidadao FOR UPDATE", "subconsulta em tabela crua": "SELECT count(*) AS total FROM (SELECT * FROM tb_cidadao) z",
  "tabela crua em subconsulta WHERE": "SELECT count(*) AS total FROM mcp.v_cidadao WHERE 1 = (SELECT 1 FROM public.tb_cidadao LIMIT 1)", "função desconhecida": "SELECT lo_import('/etc/passwd'), count(*) AS total FROM mcp.v_cidadao",
  "unnest": "SELECT unnest(array[1,2]), count(*) AS total FROM mcp.v_cidadao", "INTO": "SELECT count(*) AS total INTO x FROM mcp.v_cidadao", "CTE com nome de visão": "WITH v_cidadao AS (SELECT 1) SELECT count(*) AS total FROM v_cidadao", "CTE com nome tb_": "WITH tb_x AS (SELECT 1) SELECT count(*) AS total FROM tb_x",
  "CTE listando id": "WITH x AS (SELECT id_interno AS a FROM mcp.v_cidadao) SELECT a, count(*) AS total FROM x GROUP BY a", "parâmetro": "SELECT count(*) AS total FROM mcp.v_cidadao WHERE idade > $1", "vazia": "", "só espaços": "   ", "grande": "SELECT count(*) AS total FROM mcp.v_cidadao WHERE " + "idade > 1 AND ".repeat(400) + "idade > 2",
  "barra invertida": "SELECT count(*) AS total FROM mcp.v_cidadao WHERE sexo = 'a\\'", "string E com escape": "SELECT count(*) AS total FROM mcp.v_cidadao WHERE sexo = E'\\' OR 1=1'", "string B": "SELECT count(*) AS total FROM mcp.v_cidadao WHERE sexo = B'1'", "texto sem fechar": "SELECT count(*) AS total FROM mcp.v_cidadao WHERE sexo = 'F", "COPY": "COPY x TO '/tmp/y'", "WITH + DELETE": "WITH d AS (DELETE FROM x RETURNING 1) SELECT count(*) AS total FROM d",
};
for (const s of ok) assert.doesNotThrow(() => v(s), "deveria passar: " + s.slice(0, 80));
for (const [nome, s] of Object.entries(ruim)) assert.throws(() => v(s), `deveria bloquear (${nome})`);
console.log(`Validador de SQL livre: ${ok.length} consultas válidas aceitas e ${Object.keys(ruim).length} ataques bloqueados — OK`);
