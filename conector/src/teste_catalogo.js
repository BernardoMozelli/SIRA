// Teste do catálogo com views instaladas. Banco de teste criado por banco_real/04_dados_teste_clinicos.sql (tem a tabela sira_gabarito).
// Uso: SIRA_ADMIN_URL=postgres://postgres:...@host/banco SIRA_DB_URL=postgres://sira_ro:...@host/banco node src/teste_catalogo.js
const assert = require("assert"), { Pool } = require("pg");
const { perguntas } = require("./catalogo"), { criarExecutor } = require("./executor");
if (!process.env.SIRA_ADMIN_URL || !process.env.SIRA_DB_URL) { console.log("pulado: defina SIRA_ADMIN_URL e SIRA_DB_URL"); process.exit(0); }
process.env.SIRA_CACHE_S = "0";
(async () => {
  const exec = criarExecutor(process.env.SIRA_DB_URL), admin = new Pool({ connectionString: process.env.SIRA_ADMIN_URL }), ro = new Pool({ connectionString: process.env.SIRA_DB_URL });
  const t = (nome, cond) => { assert.ok(cond, nome); console.log("ok -", nome); };
  await exec.diagnostico(); // visões ausentes/sem permissão (ex.: lista com nomes) desativam só as perguntas que dependem delas
  for (const q of perguntas.filter((x) => exec.habilitada(x.id))) { const r = await exec.executar(q.id, {}); t(`executa ${q.id}`, r.resultado && r.resultado.tipo === q.resultado); }
  // gabarito: o que o script de dados de teste criou de propósito (vale para banco que começou sem dados clínicos)
  const gab = Object.fromEntries((await admin.query("SELECT pergunta, esperado FROM public.sira_gabarito")).rows.map((x) => [x.pergunta, Number(x.esperado)]));
  const cmp = async (id, p, chave) => { const r = await exec.executar(id, p); t(`${id} = gabarito (${gab[chave]})`, r.resultado.total === gab[chave]); };
  await cmp("gestantes_ativas", {}, "gestantes ativas");
  await cmp("gestantes_sem_prenatal", { dias: 60 }, "gestantes sem pré-natal há mais de 60 dias");
  await cmp("hipertensos_sem_consulta", { meses: 6 }, "hipertensos sem consulta há mais de 6 meses");
  await cmp("diabeticos_sem_consulta", { meses: 6 }, "diabéticos sem consulta há mais de 6 meses");
  // privacidade
  let negado = false; try { await ro.query("SELECT * FROM public.tb_cidadao LIMIT 1"); } catch { negado = true; } t("sira_ro não lê tabelas do PEC", negado);
  let escrita = false; try { await ro.query("CREATE TABLE mcp.x(a int)"); } catch { escrita = true; } t("sira_ro não escreve", escrita);
  await assert.rejects(exec.executar("pergunta_inexistente", {}), /não existe/); t("pergunta fora do catálogo é recusada", true);
  await exec.fechar(); await admin.end(); await ro.end(); console.log("OK — catálogo"); process.exit(0);
})().catch((e) => { console.error("FALHOU:", e.message); process.exit(1); });
