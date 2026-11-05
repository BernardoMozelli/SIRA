// Prova do modo SOMENTE LEITURA: (1) mesmas respostas que as views instaladas; (2) o usuário com permissão por COLUNA não lê dado pessoal;
// (3) pergunta que depende de CNS/CPF fica desativada sem a permissão opcional; (4) escrita é impossível.
// Uso: SIRA_ADMIN_URL=postgres://postgres:...@host/banco SIRA_DB_URL=postgres://sira_ro:...@host/banco node src/teste_embutido.js
const assert = require("assert"), { Pool } = require("pg");
const { perguntas } = require("./catalogo"), { criarExecutor } = require("./executor"), emb = require("./embutido");
process.env.SIRA_CACHE_S = "0";
const ADM = process.env.SIRA_ADMIN_URL, RO = process.env.SIRA_DB_URL;
if (!ADM || !RO) { console.log("pulado: defina SIRA_ADMIN_URL e SIRA_DB_URL"); process.exit(0); }
const banco = new URL(ADM).pathname.slice(1), SAL = "SalDeTeste12345";
const usar = async (cs, senha) => { const u = new URL(ADM); u.username = "sira_col"; u.password = senha; return u.toString(); };
(async () => {
  const adm = new Pool({ connectionString: ADM });
  // sal igual ao das views instaladas: lê do hash? As views usam o sal de instalação; para comparar ids não usamos id_anon nas respostas (só agregados).
  const SENHA = "Senha-Forte-Teste-123";
  const aplicar = async (cnscpf, nomes = false) => { await adm.query(emb.scriptPermissoes({ usuario: "sira_col", senha: SENHA, banco, incluirCnsCpf: cnscpf, incluirNomes: nomes })); };
  await adm.query("DROP OWNED BY sira_col").catch(() => {}); await adm.query("DROP ROLE IF EXISTS sira_col");
  await aplicar(false);
  const url = await usar(null, SENHA);
  const A = criarExecutor(RO, { modo: "views" }), B = criarExecutor(url, { modo: "embutido", sal: SAL });
  process.env.SIRA_CACHE_S = "0";
  const dB = await B.diagnostico(); const off = dB.desabilitadas.map((x) => x.id);
  const LISTAS = perguntas.filter((q) => q.sensivel).map((q) => q.id);
  assert.deepEqual(off.sort(), ["cadastro_pendencias", ...LISTAS].sort(), "sem CNS/CPF e sem nomes ficam desligadas a pergunta de qualidade e as listas nominais: " + JSON.stringify(dB));
  console.log("ok - padrão (sem CNS/CPF e sem nomes): desativadas a qualidade do cadastro e as", LISTAS.length, "listas com nomes");
  const ents = await A.entidades(); const eq = ents.equipes[0]?.id;
  const comparar = async (B2) => { for (const q of perguntas) { if (!B2.habilitada(q.id) || q.sensivel) continue; // listas nominais não existem no banco com views; são conferidas em teste_livre.js
      for (const p of [{}, eq ? { equipe: eq } : {}]) { if (p.equipe && !q.params.some((x) => x.nome === "equipe")) continue;
        let t0 = Date.now(); const a = await A.executar(q.id, p); const ta = Date.now() - t0; t0 = Date.now(); const b = await B2.executar(q.id, p); const tb = Date.now() - t0;
        assert.deepEqual(b.resultado, a.resultado, `resultado diferente em ${q.id} ${JSON.stringify(p)}`);
        console.log(`ok - ${q.id.padEnd(34)} ${JSON.stringify(p).padEnd(14)} views ${String(ta).padStart(5)} ms | embutido ${String(tb).padStart(5)} ms`); } } };
  await comparar(B);
  // privacidade: o usuário de colunas não lê dado pessoal, nem escreve
  const raw = new Pool({ connectionString: url });
  for (const sql of ["SELECT no_cidadao FROM public.tb_cidadao LIMIT 1", "SELECT nu_cpf FROM public.tb_cidadao LIMIT 1", "SELECT nu_cns FROM public.tb_cidadao LIMIT 1", "SELECT * FROM public.tb_cidadao LIMIT 1",
                    "UPDATE public.tb_cidadao SET st_ativo = 0 WHERE false", "CREATE TABLE public.x_sira(a int)"]) {
    await assert.rejects(raw.query(sql), /permiss|permission|read-only|somente leitura/i, "deveria negar: " + sql);
  }
  console.log("ok - sira_col não lê nome/CPF/CNS e não escreve (permissão por coluna + transação somente leitura)");
  // opção: libera CNS/CPF
  await aplicar(true); await B.fechar(); const B2 = criarExecutor(url, { modo: "embutido", sal: SAL }); const d2 = await B2.diagnostico();
  assert.deepEqual(d2.desabilitadas.map((x) => x.id).sort(), [...LISTAS].sort(), "com CNS/CPF só as listas (nomes) seguem desligadas"); await comparar(B2); console.log("ok - com a opção CNS/CPF as demais ligam e batem com as views; listas com nomes seguem desligadas");
  await aplicar(true, true); await B2.fechar(); const B3 = criarExecutor(url, { modo: "embutido", sal: SAL }); const d3 = await B3.diagnostico(); assert.equal(d3.desabilitadas.length, 0, "com nomes liberados tudo liga");
  for (const id of LISTAS) { const r = await B3.executar(id, {}); assert.equal(r.resultado.tipo, "lista"); assert(r.resultado.linhas.length > 0 || id.includes("sem_consulta") || id.includes("prenatal"), "lista vazia: " + id); }
  console.log("ok - com a opção de nomes as listas nominais ligam e retornam linhas"); await B3.fechar();
  await assert.rejects(Promise.resolve().then(() => emb.montarSql("SELECT 1 FROM mcp.v_cidadao", "x'; DROP")), /Sal/); console.log("ok - sal inválido recusado");
  await assert.rejects(Promise.resolve().then(() => emb.scriptPermissoes({ usuario: "a;b", senha: "123456789012", banco })), /usuário/i);
  await assert.rejects(Promise.resolve().then(() => emb.scriptPermissoes({ usuario: "ok_user", senha: "abc'def123456", banco })), /senha/i); console.log("ok - script de permissões recusa nome/senha perigosos");
  await adm.query("DROP OWNED BY sira_col"); await adm.query("DROP ROLE sira_col"); await adm.end(); await raw.end(); await A.fechar();
  console.log("OK — modo embutido"); process.exit(0);
})().catch((e) => { console.error("FALHOU:", e.message); process.exit(1); });
