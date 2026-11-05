// Uso: node criar_cliente.js <slug> "<Nome da prefeitura>" [token_64_hex]   → imprime o TOKEN do conector (guarde; não é exibido de novo)
const a = require("./src/auth");
const [slug, nome, tokenFixo] = process.argv.slice(2);
if (!slug || !nome) { console.error('Uso: node criar_cliente.js <slug> "<Nome>"'); process.exit(1); }
const token = a.criarCliente(slug, nome, tokenFixo);
console.log(`Cliente criado: ${slug}\nTOKEN DO CONECTOR (guarde, não será mostrado de novo):\n${token}`);
