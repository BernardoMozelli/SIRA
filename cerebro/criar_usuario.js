// Uso: node criar_usuario.js <slug> <login> "<Nome>" <senha> [gestor|admin|super] [trocar]   ("trocar" = obriga a trocar a senha no primeiro acesso)
const a = require("./src/auth");
const [slug, login, nome, senha, papel, trocar] = process.argv.slice(2);
if (!slug || !login || !nome || !senha) { console.error('Uso: node criar_usuario.js <slug> <login> "<Nome>" <senha> [gestor|admin|super]'); process.exit(1); }
a.criarUsuario(slug, login, nome, senha, papel || "gestor", trocar === "trocar");
console.log(`Usuário ${login} criado em ${slug}.`);
