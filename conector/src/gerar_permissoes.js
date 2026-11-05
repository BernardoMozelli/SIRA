#!/usr/bin/env node
// Gera o script de permissões (usuário de leitura com SELECT por coluna) para a TI executar uma vez no banco do e-SUS.
// Uso: node gerar_permissoes.js --banco esus [--usuario sira_ro] [--senha ...] [--ip 10.0.0.20] [--cns-cpf] > sira_permissoes.sql
const crypto = require("crypto"), { scriptPermissoes } = require("./embutido");
const a = process.argv.slice(2), v = (k) => { const i = a.indexOf("--" + k); return i >= 0 ? a[i + 1] : null; };
const banco = v("banco"); if (!banco) { console.error("Uso: node gerar_permissoes.js --banco NOME [--usuario sira_ro] [--senha SENHA] [--ip IP_DO_SIRA] [--cns-cpf]"); process.exit(1); }
const alfa = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const senha = v("senha") || Array.from(crypto.randomBytes(22), (x) => alfa[x % alfa.length]).join("");
try {
  process.stdout.write(scriptPermissoes({ usuario: v("usuario") || "sira_ro", senha, banco, incluirCnsCpf: a.includes("--cns-cpf"), incluirNomes: a.includes("--nomes"), ip: v("ip") }));
  if (!v("senha")) console.error(`\nSenha gerada para o usuário ${v("usuario") || "sira_ro"}: ${senha}\n(guarde: é a senha que vai no campo Senha da tela de Configurações do SIRA)`);
} catch (e) { console.error("ERRO:", e.message); process.exit(1); }
