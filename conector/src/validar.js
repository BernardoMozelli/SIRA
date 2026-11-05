// Validação rígida dos parâmetros recebidos do cérebro. Nada vira SQL: tudo vai como parâmetro ($n).
function ehDataISO(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function validarParametros(pergunta, bruto, entidades) {
  const entrada = bruto && typeof bruto === "object" ? bruto : {};
  const nomesValidos = new Set(pergunta.params.map((p) => p.nome));
  for (const k of Object.keys(entrada)) if (!nomesValidos.has(k)) throw new Error(`Parâmetro não permitido: ${k}`);

  const saida = {};
  for (const def of pergunta.params) {
    let v = entrada[def.nome];
    if (v === undefined || v === null || v === "") {
      if (def.tipo === "periodo") v = periodoPadrao(def.padrao);
      else if (def.padrao !== undefined) v = def.padrao;
      else if (def.obrigatorio) throw new Error(`Parâmetro obrigatório: ${def.nome}`);
      else continue;
    }
    switch (def.tipo) {
      case "int": {
        if (!Number.isInteger(v)) throw new Error(`${def.nome} deve ser inteiro`);
        if (v < def.min || v > def.max) throw new Error(`${def.nome} fora do limite (${def.min}–${def.max})`);
        saida[def.nome] = v; break;
      }
      case "equipe": case "unidade": {
        if (!Number.isInteger(v)) throw new Error(`${def.nome} inválido`);
        const lista = def.tipo === "equipe" ? entidades.equipes : entidades.unidades;
        if (!lista.some((x) => x.id === v)) throw new Error(`${def.nome} inexistente`);
        saida[def.nome] = v; break;
      }
      case "letra": {
        const l = String(v).trim().toUpperCase(); if (!/^[A-Z]$/.test(l)) throw new Error("letra inválida (use uma letra de A a Z)");
        saida[def.nome] = l; break;
      }
      case "periodo": {
        if (!v || !ehDataISO(v.de) || !ehDataISO(v.ate)) throw new Error("periodo inválido");
        if (v.de > v.ate) throw new Error("periodo invertido");
        const dias = (new Date(v.ate) - new Date(v.de)) / 86400000;
        if (dias > 1100) throw new Error("periodo maior que 3 anos");
        saida[def.nome] = { de: v.de, ate: v.ate }; break;
      }
      default: throw new Error("tipo de parâmetro desconhecido");
    }
  }
  return saida;
}

function periodoPadrao() {
  const fim = new Date(); const ini = new Date(Date.now() - 29 * 86400000);
  const f = (d) => d.toISOString().slice(0, 10);
  return { de: f(ini), ate: f(fim) };
}

module.exports = { validarParametros, ehDataISO };
