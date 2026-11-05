// Catálogo de perguntas validadas do SIRA.
// ÚNICO lugar com SQL. Só consulta o schema "mcp" (views mascaradas). Todo valor entra por parâmetro ($n).
// O catálogo é versionado por versão do e-SUS PEC: ao mudar o esquema do PEC, reescrevem-se as views e,
// se preciso, o SQL daqui — o cérebro (VPS) não muda.

const VERSAO_CATALOGO = "pec-esus-3";

const P = {
  letra:   { nome: "letra",   tipo: "letra",   obrigatorio: false, rotulo: "Inicial do nome" },
  equipe:  { nome: "equipe",  tipo: "equipe",  obrigatorio: false, rotulo: "Equipe" },
  unidade: { nome: "unidade", tipo: "unidade", obrigatorio: false, rotulo: "Unidade" },
  dias:    (padrao) => ({ nome: "dias",  tipo: "int", min: 1, max: 730, padrao, rotulo: "Dias" }),
  meses:   (padrao) => ({ nome: "meses", tipo: "int", min: 1, max: 36,  padrao, rotulo: "Meses" }),
  periodo: { nome: "periodo", tipo: "periodo", padrao: "ultimos_30_dias", rotulo: "Período" },
};

const FILTRO_EQUIPE = "($1::int IS NULL OR c.equipe_id = $1)";

const perguntas = [
  {
    id: "gestantes_ativas",
    criterio: "Conta cidadãs com cadastro ativo (não falecidas e não unificadas a outro cadastro) que têm, na lista de problemas do prontuário, uma gestação em aberto: CIAP W78, W79, W84 ou W85, ou CID Z34, Z35 ou O09, iniciada há menos de 300 dias.",
    titulo: "Gestantes ativas",
    descricao: "Quantas gestantes estão ativas (acompanhadas) no município, por equipe se desejado.",
    exemplos: ["quantas gestantes temos", "quantas grávidas estão sendo acompanhadas", "número de gestantes ativas na equipe 3"],
    params: [P.equipe],
    resultado: "valor",
    resposta: "Há {total} {total|gestante ativa,gestantes ativas}{escopo}.",
    sql: `SELECT count(*)::int AS total
          FROM mcp.v_condicao_ativa co JOIN mcp.v_cidadao c ON c.id_interno = co.id_interno
          WHERE co.tipo = 'GESTANTE' AND c.ativo AND ${FILTRO_EQUIPE}`,
    ordem: (p) => [p.equipe ?? null],
  },
  {
    id: "gestantes_sem_prenatal",
    criterio: "Parte das gestantes ativas (gestação em aberto, iniciada há menos de 300 dias) que não tiveram, durante a gestação, atendimento de médico ou enfermeiro nos últimos N dias. O pré-natal é uma aproximação: o SIRA ainda não lê as fichas específicas de pré-natal do PEC.",
    titulo: "Gestantes sem pré-natal recente",
    descricao: "Gestantes ativas que não tiveram atendimento de pré-natal nos últimos N dias.",
    exemplos: ["quantas gestantes estão sem pré-natal há mais de 60 dias", "grávidas sem consulta de pré-natal", "gestantes sem acompanhamento na equipe 3"],
    params: [P.dias(60), P.equipe],
    resultado: "valor",
    resposta: "Há {total} {total|gestante,gestantes} sem atendimento de pré-natal nos últimos {dias} dias{escopo}.",
    sql: `SELECT count(*)::int AS total
          FROM mcp.v_condicao_ativa co JOIN mcp.v_cidadao c ON c.id_interno = co.id_interno
          LEFT JOIN (SELECT a.id_interno, max(a.dt_atendimento) AS ult FROM mcp.v_atendimento a WHERE a.tipo = 'PRENATAL' GROUP BY a.id_interno) u ON u.id_interno = co.id_interno
          WHERE co.tipo = 'GESTANTE' AND c.ativo AND ${FILTRO_EQUIPE}
            AND (u.ult IS NULL OR u.ult < current_date - $2::int)`,
    ordem: (p) => [p.equipe ?? null, p.dias],
  },
  {
    id: "gestantes_sem_prenatal_por_equipe",
    criterio: "Mesma regra de gestantes sem pré-natal, agrupada pela equipe do cadastro da gestante. Gestantes sem equipe não aparecem na tabela.",
    gatilhos: ["por equipe","ranking","qual equipe","cada equipe","equipes"],
    titulo: "Gestantes sem pré-natal, por equipe",
    descricao: "Ranking por equipe de gestantes sem pré-natal nos últimos N dias.",
    exemplos: ["gestantes sem pré-natal por equipe", "qual equipe tem mais grávidas sem acompanhamento", "ranking de equipes com gestantes sem pré-natal"],
    params: [P.dias(60)],
    resultado: "tabela",
    colunas: [{ chave: "equipe", rotulo: "Equipe" }, { chave: "total", rotulo: "Gestantes sem pré-natal", numerica: true }],
    resposta: "Gestantes sem atendimento de pré-natal nos últimos {dias} dias, por equipe:",
    sql: `SELECT e.nome AS equipe, count(*)::int AS total
          FROM mcp.v_condicao_ativa co
          JOIN mcp.v_cidadao c ON c.id_interno = co.id_interno
          JOIN mcp.v_equipe e ON e.id = c.equipe_id
          LEFT JOIN (SELECT a.id_interno, max(a.dt_atendimento) AS ult FROM mcp.v_atendimento a WHERE a.tipo = 'PRENATAL' GROUP BY a.id_interno) u ON u.id_interno = co.id_interno
          WHERE co.tipo = 'GESTANTE' AND c.ativo
            AND (u.ult IS NULL OR u.ult < current_date - $1::int)
          GROUP BY e.id, e.nome ORDER BY total DESC, e.nome`,
    ordem: (p) => [p.dias],
  },
  {
    id: "hipertensos_sem_consulta",
    criterio: "Cadastros ativos com hipertensão em aberto na lista de problemas (CIAP K86 ou K87, ou CID I10 a I15) e sem nenhum atendimento de médico, enfermeiro ou odontologia nos últimos N meses.",
    titulo: "Hipertensos sem consulta recente",
    descricao: "Pessoas com hipertensão ativas sem nenhuma consulta nos últimos N meses.",
    exemplos: ["quantos hipertensos estão sem consulta há mais de 6 meses", "pressão alta sem acompanhamento", "hipertensos sem consulta no último ano na equipe 5"],
    params: [P.meses(6), P.equipe],
    resultado: "valor",
    resposta: "Há {total} {total|pessoa,pessoas} com hipertensão sem consulta nos últimos {meses} meses{escopo}.",
    sql: `SELECT count(*)::int AS total
          FROM mcp.v_condicao_ativa co JOIN mcp.v_cidadao c ON c.id_interno = co.id_interno
          LEFT JOIN (SELECT a.id_interno, max(a.dt_atendimento) AS ult FROM mcp.v_atendimento a WHERE a.tipo = 'CONSULTA' GROUP BY a.id_interno) u ON u.id_interno = co.id_interno
          WHERE co.tipo = 'HIPERTENSO' AND c.ativo AND ${FILTRO_EQUIPE}
            AND (u.ult IS NULL OR u.ult < current_date - ($2::int * interval '1 month'))`,
    ordem: (p) => [p.equipe ?? null, p.meses],
  },
  {
    id: "diabeticos_sem_consulta",
    criterio: "Cadastros ativos com diabetes em aberto na lista de problemas (CIAP T89 ou T90, ou CID E10 a E14) e sem nenhum atendimento de médico, enfermeiro ou odontologia nos últimos N meses.",
    titulo: "Diabéticos sem consulta recente",
    descricao: "Pessoas com diabetes ativas sem nenhuma consulta nos últimos N meses.",
    exemplos: ["quantos diabéticos estão sem consulta há mais de 6 meses", "diabetes sem acompanhamento", "diabéticos sem consulta na equipe 2"],
    params: [P.meses(6), P.equipe],
    resultado: "valor",
    resposta: "Há {total} {total|pessoa,pessoas} com diabetes sem consulta nos últimos {meses} meses{escopo}.",
    sql: `SELECT count(*)::int AS total
          FROM mcp.v_condicao_ativa co JOIN mcp.v_cidadao c ON c.id_interno = co.id_interno
          LEFT JOIN (SELECT a.id_interno, max(a.dt_atendimento) AS ult FROM mcp.v_atendimento a WHERE a.tipo = 'CONSULTA' GROUP BY a.id_interno) u ON u.id_interno = co.id_interno
          WHERE co.tipo = 'DIABETICO' AND c.ativo AND ${FILTRO_EQUIPE}
            AND (u.ult IS NULL OR u.ult < current_date - ($2::int * interval '1 month'))`,
    ordem: (p) => [p.equipe ?? null, p.meses],
  },
  {
    id: "atendimentos_periodo",
    criterio: "Conta a participação de cada profissional em atendimentos iniciados e não cancelados dentro do período. Se dois profissionais participam do mesmo atendimento, contam duas vezes.",
    titulo: "Atendimentos no período",
    descricao: "Total de atendimentos realizados em um período, com filtro opcional de unidade ou equipe.",
    exemplos: ["quantos atendimentos tivemos no mês passado", "total de atendimentos nos últimos 30 dias", "atendimentos este ano na UBS Centro"],
    params: [P.periodo, P.unidade, P.equipe],
    resultado: "valor",
    resposta: "Foram realizados {total} {total|atendimento,atendimentos} no período {periodo_txt}{escopo}.",
    sql: `SELECT count(*)::int AS total FROM mcp.v_atendimento a
          WHERE a.dt_atendimento BETWEEN $1::date AND $2::date
            AND ($3::int IS NULL OR a.unidade_id = $3) AND ($4::int IS NULL OR a.equipe_id = $4)`,
    ordem: (p) => [p.periodo.de, p.periodo.ate, p.unidade ?? null, p.equipe ?? null],
  },
  {
    id: "atendimentos_por_unidade",
    criterio: "Mesma contagem de atendimentos (participações de profissionais, não canceladas), agrupada pela unidade de saúde do atendimento.",
    gatilhos: ["por unidade","ranking","qual unidade","cada unidade","unidades","por ubs"],
    titulo: "Atendimentos por unidade",
    descricao: "Atendimentos por unidade de saúde em um período, do maior para o menor.",
    exemplos: ["atendimentos por unidade no mês passado", "qual unidade atende mais", "ranking de atendimentos das UBS"],
    params: [P.periodo],
    resultado: "tabela",
    colunas: [{ chave: "unidade", rotulo: "Unidade" }, { chave: "total", rotulo: "Atendimentos", numerica: true }],
    resposta: "Atendimentos por unidade no período {periodo_txt}:",
    sql: `SELECT u.nome AS unidade, count(*)::int AS total
          FROM mcp.v_atendimento a JOIN mcp.v_unidade u ON u.id = a.unidade_id
          WHERE a.dt_atendimento BETWEEN $1::date AND $2::date
          GROUP BY u.id, u.nome ORDER BY total DESC, u.nome`,
    ordem: (p) => [p.periodo.de, p.periodo.ate],
  },
  {
    id: "atendimentos_por_categoria",
    criterio: "Mesma contagem de atendimentos, agrupada pela categoria do profissional, definida pelo CBO: médico, enfermeiro, técnico/auxiliar de enfermagem, odontologia ou outro.",
    gatilhos: ["categoria","profission","medico","enfermeir","odont","tecnico"],
    titulo: "Atendimentos por categoria profissional",
    descricao: "Atendimentos por categoria profissional (médico, enfermeiro, técnico, odontologia) no período.",
    exemplos: ["atendimentos por categoria profissional", "quantas consultas de médico e de enfermeiro", "atendimentos por profissional no último mês"],
    params: [P.periodo, P.unidade],
    resultado: "tabela",
    colunas: [{ chave: "categoria", rotulo: "Categoria" }, { chave: "total", rotulo: "Atendimentos", numerica: true }],
    resposta: "Atendimentos por categoria profissional no período {periodo_txt}{escopo}:",
    sql: `SELECT a.categoria, count(*)::int AS total FROM mcp.v_atendimento a
          WHERE a.dt_atendimento BETWEEN $1::date AND $2::date AND ($3::int IS NULL OR a.unidade_id = $3)
          GROUP BY a.categoria ORDER BY total DESC`,
    ordem: (p) => [p.periodo.de, p.periodo.ate, p.unidade ?? null],
  },
  {
    id: "cadastro_pendencias",
    criterio: "Entre os cadastros ativos: sem CNS = campo CNS vazio; sem CPF = campo CPF vazio; CNS duplicado = o mesmo número de CNS aparece em mais de um cadastro ativo.",
    titulo: "Qualidade do cadastro (CNS/CPF)",
    descricao: "Cadastros ativos sem CNS, sem CPF ou com CNS duplicado — problemas que afetam os indicadores.",
    exemplos: ["quantos cadastros estão sem CNS", "cadastros duplicados", "problemas de qualidade do cadastro na equipe 4", "cidadãos sem CPF"],
    params: [P.equipe],
    resultado: "tabela",
    colunas: [{ chave: "indicador", rotulo: "Pendência" }, { chave: "total", rotulo: "Cadastros", numerica: true }],
    resposta: "Pendências de qualidade nos cadastros ativos{escopo}:",
    sql: `SELECT t.indicador, t.total FROM (
            SELECT 1 AS o, 'Sem CNS' AS indicador, count(*) FILTER (WHERE q.sem_cns)::int AS total
              FROM mcp.v_qualidade_cadastro q JOIN mcp.v_cidadao c ON c.id_interno = q.id_interno WHERE c.ativo AND ${FILTRO_EQUIPE}
            UNION ALL
            SELECT 2, 'Sem CPF', count(*) FILTER (WHERE q.sem_cpf)::int
              FROM mcp.v_qualidade_cadastro q JOIN mcp.v_cidadao c ON c.id_interno = q.id_interno WHERE c.ativo AND ${FILTRO_EQUIPE}
            UNION ALL
            SELECT 3, 'CNS duplicado', count(*) FILTER (WHERE q.cns_duplicado)::int
              FROM mcp.v_qualidade_cadastro q JOIN mcp.v_cidadao c ON c.id_interno = q.id_interno WHERE c.ativo AND ${FILTRO_EQUIPE}
          ) t ORDER BY t.o`,
    ordem: (p) => [p.equipe ?? null],
  },
  {
    id: "cadastros_por_equipe",
    criterio: "Cadastros ativos agrupados pela equipe a que a pessoa está vinculada (vinculação mais recente; se não houver, o núcleo familiar). Cadastros sem equipe não aparecem.",
    gatilhos: ["por equipe","cada equipe","equipes"],
    titulo: "Cadastros ativos por equipe",
    descricao: "Quantidade de cidadãos ativos cadastrados em cada equipe.",
    exemplos: ["quantas pessoas cadastradas por equipe", "população por equipe", "cadastros ativos em cada equipe"],
    params: [],
    resultado: "tabela",
    colunas: [{ chave: "equipe", rotulo: "Equipe" }, { chave: "total", rotulo: "Cadastros ativos", numerica: true }],
    resposta: "Cadastros ativos por equipe:",
    sql: `SELECT e.nome AS equipe, count(*)::int AS total
          FROM mcp.v_cidadao c JOIN mcp.v_equipe e ON e.id = c.equipe_id
          WHERE c.ativo GROUP BY e.id, e.nome ORDER BY e.id`,
    ordem: () => [],
  },
];


// ── LISTAS NOMINAIS ── mostram NOME do cidadão. Só existem se a TI liberou a leitura do nome (ver script de permissões) e só saem para
// usuários com o módulo "Listas nominais", com motivo informado e registro na auditoria. Nunca entram no cache nem no histórico.
const LETRA = "($1::text IS NULL OR translate(upper(left(n.nome, 1)), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC') = $1)";
const COLS_NOME = [{ chave: "nome", rotulo: "Nome" }, { chave: "nascimento", rotulo: "Nascimento" }, { chave: "equipe", rotulo: "Equipe" }];
const SEL_NOME = "n.nome, to_char(n.dt_nascimento, 'DD/MM/YYYY') AS nascimento, e.nome AS equipe";
const JOIN_EQ = "LEFT JOIN mcp.v_equipe e ON e.id = n.equipe_id";
const ULT = (tipo) => `LEFT JOIN (SELECT a.id_interno, max(a.dt_atendimento) AS ult FROM mcp.v_atendimento a WHERE a.tipo = '${tipo}' GROUP BY a.id_interno) u ON u.id_interno = co.id_interno`;
const lista = (o) => ({ resultado: "lista", sensivel: true, maxLinhas: 5000, ...o });
perguntas.push(
  lista({
    id: "lista_cadastros_sem_cpf", gatilhos: ["lista", "listar", "listagem", "relacao", "nomes", "quais pessoas", "quem"],
    criterio: "Cadastros ativos (não falecidos, não unificados) com o campo CPF vazio. Se uma letra for informada, só os nomes que começam com ela (acentos ignorados). Ordenado por nome.",
    titulo: "Lista nominal: cadastros sem CPF", descricao: "Lista com nomes dos cidadãos ativos sem CPF no cadastro, com filtro opcional pela inicial do nome e por equipe, para correção do cadastro.",
    exemplos: ["gere uma lista dos cadastros sem cpf", "lista de cidadãos sem cpf cujos nomes comecem com a letra B", "relação de pessoas sem cpf na equipe 3"],
    params: [P.letra, P.equipe], colunas: COLS_NOME, resposta: "Lista de cadastros ativos sem CPF{escopo}{letra_txt}:",
    sql: `SELECT ${SEL_NOME} FROM mcp.v_cidadao_nominal n JOIN mcp.v_qualidade_cadastro q ON q.id_interno = n.id_interno ${JOIN_EQ}
          WHERE n.ativo AND q.sem_cpf AND ${LETRA} AND ($2::int IS NULL OR n.equipe_id = $2) ORDER BY n.nome`,
    ordem: (p) => [p.letra ?? null, p.equipe ?? null],
  }),
  lista({
    id: "lista_cadastros_sem_cns", gatilhos: ["lista", "listar", "listagem", "relacao", "nomes", "quais pessoas", "quem"],
    criterio: "Cadastros ativos (não falecidos, não unificados) com o campo CNS (cartão SUS) vazio. Se uma letra for informada, só os nomes que começam com ela (acentos ignorados). Ordenado por nome.",
    titulo: "Lista nominal: cadastros sem CNS", descricao: "Lista com nomes dos cidadãos ativos sem CNS (cartão SUS) no cadastro, com filtro opcional pela inicial do nome e por equipe.",
    exemplos: ["gere uma lista dos cadastros sem cns", "lista de pessoas sem cartão sus com nomes começando com M", "relação de cidadãos sem cns na equipe 2"],
    params: [P.letra, P.equipe], colunas: COLS_NOME, resposta: "Lista de cadastros ativos sem CNS{escopo}{letra_txt}:",
    sql: `SELECT ${SEL_NOME} FROM mcp.v_cidadao_nominal n JOIN mcp.v_qualidade_cadastro q ON q.id_interno = n.id_interno ${JOIN_EQ}
          WHERE n.ativo AND q.sem_cns AND ${LETRA} AND ($2::int IS NULL OR n.equipe_id = $2) ORDER BY n.nome`,
    ordem: (p) => [p.letra ?? null, p.equipe ?? null],
  }),
  lista({
    id: "lista_gestantes", gatilhos: ["lista", "listar", "listagem", "relacao", "nomes", "quais gestantes", "quem"],
    criterio: "Gestantes ativas: cadastro ativo com gestação em aberto (CIAP W78, W79, W84, W85 ou CID Z34, Z35, O09), iniciada há menos de 300 dias. Ordenado por nome.",
    titulo: "Lista nominal: gestantes ativas", descricao: "Lista com nomes das gestantes ativas, com filtro opcional por equipe e pela inicial do nome.",
    exemplos: ["lista de gestantes", "relação das gestantes da equipe 3", "gere uma lista com os nomes das gestantes"],
    params: [P.letra, P.equipe], colunas: COLS_NOME, resposta: "Lista de gestantes ativas{escopo}{letra_txt}:",
    sql: `SELECT ${SEL_NOME} FROM mcp.v_condicao_ativa co JOIN mcp.v_cidadao_nominal n ON n.id_interno = co.id_interno ${JOIN_EQ}
          WHERE co.tipo = 'GESTANTE' AND n.ativo AND ${LETRA} AND ($2::int IS NULL OR n.equipe_id = $2) ORDER BY n.nome`,
    ordem: (p) => [p.letra ?? null, p.equipe ?? null],
  }),
  lista({
    id: "lista_gestantes_sem_prenatal", gatilhos: ["lista", "listar", "listagem", "relacao", "nomes", "quais gestantes", "quem"],
    criterio: "Gestantes ativas que não tiveram, durante a gestação, atendimento de médico ou enfermeiro nos últimos N dias (aproximação do pré-natal). Mostra a data do último atendimento. Ordenado por nome.",
    titulo: "Lista nominal: gestantes sem pré-natal recente", descricao: "Lista com nomes das gestantes ativas sem atendimento de pré-natal nos últimos N dias, para busca ativa.",
    exemplos: ["lista de gestantes sem pré-natal há mais de 60 dias", "quais gestantes estão sem pré-natal, com nomes", "relação de grávidas sem consulta na equipe 2"],
    params: [P.dias(60), P.equipe], colunas: [...COLS_NOME, { chave: "ultimo", rotulo: "Último atendimento" }], resposta: "Gestantes sem atendimento de pré-natal nos últimos {dias} dias{escopo}:",
    sql: `SELECT ${SEL_NOME}, to_char(u.ult, 'DD/MM/YYYY') AS ultimo FROM mcp.v_condicao_ativa co JOIN mcp.v_cidadao_nominal n ON n.id_interno = co.id_interno ${JOIN_EQ} ${ULT("PRENATAL")}
          WHERE co.tipo = 'GESTANTE' AND n.ativo AND ($2::int IS NULL OR n.equipe_id = $2) AND (u.ult IS NULL OR u.ult < current_date - $1::int) ORDER BY n.nome`,
    ordem: (p) => [p.dias, p.equipe ?? null],
  }),
  lista({
    id: "lista_hipertensos_sem_consulta", gatilhos: ["lista", "listar", "listagem", "relacao", "nomes", "quais pessoas", "quem"],
    criterio: "Cadastros ativos com hipertensão em aberto (CIAP K86/K87 ou CID I10 a I15) sem atendimento de médico, enfermeiro ou odontologia nos últimos N meses. Mostra a data do último atendimento. Ordenado por nome.",
    titulo: "Lista nominal: hipertensos sem consulta recente", descricao: "Lista com nomes das pessoas com hipertensão sem consulta nos últimos N meses, para busca ativa.",
    exemplos: ["lista de hipertensos sem consulta há mais de 6 meses", "quais hipertensos estão sem acompanhamento, com nomes", "relação de pressão alta sem consulta na equipe 4"],
    params: [P.meses(6), P.equipe], colunas: [...COLS_NOME, { chave: "ultimo", rotulo: "Último atendimento" }], resposta: "Pessoas com hipertensão sem consulta nos últimos {meses} meses{escopo}:",
    sql: `SELECT ${SEL_NOME}, to_char(u.ult, 'DD/MM/YYYY') AS ultimo FROM mcp.v_condicao_ativa co JOIN mcp.v_cidadao_nominal n ON n.id_interno = co.id_interno ${JOIN_EQ} ${ULT("CONSULTA")}
          WHERE co.tipo = 'HIPERTENSO' AND n.ativo AND ($2::int IS NULL OR n.equipe_id = $2) AND (u.ult IS NULL OR u.ult < current_date - ($1::int * interval '1 month')) ORDER BY n.nome`,
    ordem: (p) => [p.meses, p.equipe ?? null],
  }),
  lista({
    id: "lista_diabeticos_sem_consulta", gatilhos: ["lista", "listar", "listagem", "relacao", "nomes", "quais pessoas", "quem"],
    criterio: "Cadastros ativos com diabetes em aberto (CIAP T89/T90 ou CID E10 a E14) sem atendimento de médico, enfermeiro ou odontologia nos últimos N meses. Mostra a data do último atendimento. Ordenado por nome.",
    titulo: "Lista nominal: diabéticos sem consulta recente", descricao: "Lista com nomes das pessoas com diabetes sem consulta nos últimos N meses, para busca ativa.",
    exemplos: ["lista de diabéticos sem consulta há mais de 6 meses", "quais diabéticos estão sem acompanhamento, com nomes", "relação de diabetes sem consulta na equipe 2"],
    params: [P.meses(6), P.equipe], colunas: [...COLS_NOME, { chave: "ultimo", rotulo: "Último atendimento" }], resposta: "Pessoas com diabetes sem consulta nos últimos {meses} meses{escopo}:",
    sql: `SELECT ${SEL_NOME}, to_char(u.ult, 'DD/MM/YYYY') AS ultimo FROM mcp.v_condicao_ativa co JOIN mcp.v_cidadao_nominal n ON n.id_interno = co.id_interno ${JOIN_EQ} ${ULT("CONSULTA")}
          WHERE co.tipo = 'DIABETICO' AND n.ativo AND ($2::int IS NULL OR n.equipe_id = $2) AND (u.ult IS NULL OR u.ult < current_date - ($1::int * interval '1 month')) ORDER BY n.nome`,
    ordem: (p) => [p.meses, p.equipe ?? null],
  }),
);

// Manifesto enviado ao cérebro: SEM SQL.
function manifesto() {
  return perguntas.map((q) => ({
    id: q.id, gatilhos: q.gatilhos || null, titulo: q.titulo, descricao: q.descricao, exemplos: q.exemplos,
    params: q.params, resultado: q.resultado, colunas: q.colunas || null, resposta: q.resposta, criterio: q.criterio || null, sensivel: !!q.sensivel,
  }));
}

module.exports = { VERSAO_CATALOGO, perguntas, manifesto };
