const fmt = (n) => new Intl.NumberFormat("pt-BR").format(n);
const br = (s) => s.split("-").reverse().join("/");

function escopo(params, ent) {
  const partes = [];
  if (params.unidade) partes.push(ent.unidades.find((u) => u.id === params.unidade)?.nome);
  if (params.equipe) partes.push(ent.equipes.find((e) => e.id === params.equipe)?.nome);
  const lista = partes.filter(Boolean);
  return lista.length ? " — " + lista.join(", ") : " em todo o município";
}

// Modelo de texto: {campo} e {campo|singular,plural}
function montar(q, params, resultado, ent) {
  const val = resultado.tipo === "valor" ? (resultado.suprimido ? `menos de 5` : fmt(resultado.total)) : "";
  const num = resultado.tipo === "valor" ? (resultado.suprimido ? 2 : resultado.total) : 0;
  const dados = {
    total: val, dias: params.dias, meses: params.meses,
    escopo: escopo(params, ent),
    letra_txt: params.letra ? ` com nomes iniciados por ${params.letra}` : "",
    periodo_txt: params.periodo ? `de ${br(params.periodo.de)} a ${br(params.periodo.ate)}` : "",
  };
  return q.resposta.replace(/\{(\w+)(?:\|([^}]*))?\}/g, (_, k, formas) => {
    if (formas) { const [s, p] = formas.split(","); return num === 1 ? s : p; }
    return dados[k] ?? "";
  });
}

function tabela(q, resultado) {
  return {
    colunas: q.colunas,
    linhas: resultado.linhas.map((l) => q.colunas.map((c) => c.chave === "total" ? (l.suprimido ? l.faixa : fmt(l.total)) : l[c.chave])),
  };
}

function tabelaLista(q, r) {
  return { colunas: q.colunas, linhas: r.linhas };
}
module.exports = { montar, tabela, tabelaLista };
