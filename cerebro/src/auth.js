const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA = process.env.SIRA_DATA || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA, { recursive: true });
const arq = (n) => path.join(DATA, n);
const ler = (n, padrao) => { try { return JSON.parse(fs.readFileSync(arq(n), "utf8")); } catch { return padrao; } };
const gravar = (n, v) => { const tmp = arq(n) + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(v, null, 2), { mode: 0o600 }); fs.renameSync(tmp, arq(n)); };

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const iguais = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function hashSenha(senha) {
  const sal = crypto.randomBytes(16);
  return `scrypt$${sal.toString("hex")}$${crypto.scryptSync(senha, sal, 32).toString("hex")}`;
}
function confereSenha(senha, h) {
  const [alg, sal, hex] = String(h).split("$");
  if (alg !== "scrypt") return false;
  return iguais(crypto.scryptSync(senha, Buffer.from(sal, "hex"), 32).toString("hex"), hex);
}

const tenants = () => ler("clientes.json", {});
const usuarios = () => ler("usuarios.json", []);

function criarCliente(slug, nome, tokenFixo) {
  const t = tenants(); if (t[slug]) throw new Error("cliente já existe");
  if (tokenFixo && !/^[0-9a-f]{64}$/.test(tokenFixo)) throw new Error("token fixo deve ter 64 caracteres hexadecimais");
  const token = tokenFixo || crypto.randomBytes(32).toString("hex");
  t[slug] = { nome, tokenSha: sha(token), criadoEm: new Date().toISOString() }; gravar("clientes.json", t);
  return token;
}
function criarUsuario(slug, login, nome, senha, papel = "gestor", trocar = false) {
  if (!["gestor", "admin", "super"].includes(papel)) throw new Error("papel deve ser gestor, admin ou super");
  if (!tenants()[slug]) throw new Error("cliente inexistente");
  if (senha.length < 8) throw new Error("senha precisa ter 8+ caracteres");
  const u = usuarios().filter((x) => x.login !== login);
  u.push({ tenant: slug, login, nome, papel, hash: hashSenha(senha), ...(trocar ? { trocar_senha: true } : {}) }); gravar("usuarios.json", u);
}
function tenantPorToken(token) {
  const h = sha(token || ""), t = tenants();
  return Object.keys(t).find((k) => iguais(t[k].tokenSha, h)) || null;
}
function autenticar(login, senha) {
  const u = usuarios().find((x) => x.login === login);
  // custo constante mesmo se o usuário não existir
  const ok = confereSenha(senha, u ? u.hash : "scrypt$00$00") && !!u;
  if (!ok || u.ativo === false) return null;
  return vis(u);
}

// Sessão: cookie assinado (HMAC). Sem estado no servidor.
const SEGREDO_PERSISTENTE = !!process.env.SIRA_SEGREDO;
const SEGREDO = process.env.SIRA_SEGREDO || (console.warn("[aviso] SIRA_SEGREDO não definido — usando segredo temporário (sessões caem ao reiniciar e chaves de IA não podem ser guardadas)"), crypto.randomBytes(32).toString("hex"));
const b64 = (b) => Buffer.from(b).toString("base64url");
function emitirSessao(u, horas = 8) {
  const corpo = b64(JSON.stringify({ l: u.login, i: Date.now(), e: Date.now() + horas * 3600e3 }));
  return `${corpo}.${crypto.createHmac("sha256", SEGREDO).update(corpo).digest("base64url")}`;
}
function lerSessao(cookie) {
  if (!cookie) return null;
  const [corpo, sig] = cookie.split(".");
  if (!corpo || !sig) return null;
  const esperado = crypto.createHmac("sha256", SEGREDO).update(corpo).digest("base64url");
  if (!iguais(sig, esperado)) return null;
  try {
    const p = JSON.parse(Buffer.from(corpo, "base64url").toString());
    if (p.e < Date.now()) return null;
    const u = usuarios().find((x) => x.login === p.l);
    if (!u || u.ativo === false || (u.sessoes_desde && (p.i || 0) < u.sessoes_desde)) return null; // desativado ou sessões encerradas
    return vis(u);
  } catch { return null; }
}

// ---------- perfis, módulos e gestão de usuários (painel administrativo) ----------
// Cada papel tem módulos padrão; um usuário pode ter exceções (true = libera, false = bloqueia).
const MODULOS = { perguntar: "Fazer perguntas", auditoria: "Auditoria de perguntas", listas: "Listas nominais (nomes de cidadãos)", usuarios: "Usuários e permissões", configuracoes: "Configurações", ia: "Inteligência artificial" };
const PAPEIS = { gestor: "Gestor", admin: "Administrador", super: "Administrador BeMo" };
const PADRAO = { gestor: ["perguntar"], admin: ["perguntar", "auditoria", "usuarios", "configuracoes"], super: Object.keys(MODULOS) };
// Listas nominais: NÃO dependem de perfil. Exigem autorização nominal, com validade, concedida por OUTRO administrador.
const TERMO_VERSAO = 1;
const TERMO_TEXTO = "Declaro que usarei as listas com nomes de cidadãos somente para finalidade de saúde pública vinculada às minhas atribuições, que não as copiarei nem compartilharei fora do serviço, e que estou ciente de que cada geração fica registrada em auditoria com meu usuário e meu motivo (Lei 13.709/2018 – LGPD).";
function listasInfo(u) {
  const l = u.listas, ativa = !!l && Number(l.ate) > Date.now();
  return { ativa, ate: l ? l.ate : null, por: l ? l.por : null, em: l ? l.em : null, expirada: !!l && !ativa, termo: !!u.termo_listas && u.termo_listas.v === TERMO_VERSAO };
}
function modulosDe(u) {
  const base = new Set(PADRAO[u.papel] || []); base.delete("listas");
  if (u.papel !== "super") for (const [m, v] of Object.entries(u.mod || {})) { if (m in MODULOS && m !== "ia" && m !== "listas") { if (v === true) base.add(m); else if (v === false) base.delete(m); } }
  const r = Object.fromEntries(Object.keys(MODULOS).map((m) => [m, u.papel === "super" || base.has(m)]));
  r.listas = !!u.login && listasInfo(u).ativa; // só com autorização vigente (vale também para o administrador BeMo)
  return r;
}
const vis = (u) => ({ login: u.login, nome: u.nome, tenant: u.tenant, papel: u.papel, trocarSenha: !!u.trocar_senha, modulos: modulosDe(u), listas: listasInfo(u) });
const pode = (u, m) => !!u && !!u.modulos && u.modulos[m] === true;
const publico = (u) => ({ login: u.login, nome: u.nome, papel: u.papel, ativo: u.ativo !== false, trocarSenha: !!u.trocar_senha, excecoes: u.mod || {}, modulos: modulosDe(u), listas: listasInfo(u) });
function validaSenha(senha) { if (typeof senha !== "string" || senha.length < 8) throw new Error("A senha precisa ter 8 ou mais caracteres."); if (senha.length > 200) throw new Error("Senha muito longa."); }
function limparMod(mod) { const o = {}; for (const [k, v] of Object.entries(mod || {})) if (k in MODULOS && k !== "ia" && k !== "listas" && typeof v === "boolean") o[k] = v; return o; }
function podeGerir(ator, alvoPapel) { return ator.papel === "super" || alvoPapel !== "super"; } // só super mexe em contas super

function listarUsuarios(ator) { return usuarios().filter((u) => u.tenant === ator.tenant).map(publico).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")); }
function novoUsuario(ator, d) {
  const login = String(d.login || "").trim().toLowerCase(); const nome = String(d.nome || "").trim(); const papel = String(d.papel || "gestor");
  if (!/^[a-z0-9._-]{3,40}$/.test(login)) throw new Error("Usuário: use 3 a 40 letras minúsculas, números, ponto, hífen ou sublinhado.");
  if (nome.length < 3 || nome.length > 120) throw new Error("Informe o nome completo.");
  if (!PAPEIS[papel]) throw new Error("Perfil inválido."); if (!podeGerir(ator, papel)) throw new Error("Apenas o administrador BeMo cria contas desse perfil.");
  validaSenha(d.senha); const u = usuarios();
  if (u.some((x) => x.login === login)) throw new Error("Já existe um usuário com esse login.");
  u.push({ tenant: ator.tenant, login, nome, papel, hash: hashSenha(d.senha), ativo: true, trocar_senha: true, mod: limparMod(d.excecoes) }); gravar("usuarios.json", u);
  return login;
}
function editarUsuario(ator, login, d) {
  const u = usuarios(); const i = u.findIndex((x) => x.login === login && x.tenant === ator.tenant); if (i < 0) throw new Error("Usuário não encontrado.");
  const alvo = u[i]; if (!podeGerir(ator, alvo.papel)) throw new Error("Apenas o administrador BeMo altera essa conta.");
  const papel = d.papel !== undefined ? String(d.papel) : alvo.papel; if (!PAPEIS[papel]) throw new Error("Perfil inválido."); if (!podeGerir(ator, papel)) throw new Error("Apenas o administrador BeMo atribui esse perfil.");
  const ativo = d.ativo !== undefined ? !!d.ativo : alvo.ativo !== false;
  if (alvo.login === ator.login && (!ativo || papel !== alvo.papel)) throw new Error("Você não pode desativar nem mudar o perfil da sua própria conta.");
  const restantes = u.filter((x, j) => j !== i && x.tenant === ator.tenant && x.ativo !== false && ["admin", "super"].includes(x.papel));
  if (["admin", "super"].includes(alvo.papel) && alvo.ativo !== false && !(["admin", "super"].includes(papel) && ativo) && !restantes.length) throw new Error("Deve restar ao menos um administrador ativo.");
  if (d.nome !== undefined) { const n = String(d.nome).trim(); if (n.length < 3 || n.length > 120) throw new Error("Informe o nome completo."); alvo.nome = n; }
  if (papel !== alvo.papel || ativo !== (alvo.ativo !== false)) alvo.sessoes_desde = Date.now(); // mudança de perfil/ativação derruba sessões abertas
  alvo.papel = papel; alvo.ativo = ativo; if (d.excecoes !== undefined) alvo.mod = limparMod(d.excecoes);
  gravar("usuarios.json", u);
}
function autorizarListas(ator, login, dias) {
  if (!["admin", "super"].includes(ator.papel)) throw new Error("Somente administradores concedem essa autorização.");
  const u = usuarios(); const alvo = u.find((x) => x.login === login && x.tenant === ator.tenant); if (!alvo) throw new Error("Usuário não encontrado.");
  if (alvo.login === ator.login) throw new Error("Você não pode autorizar a si mesmo. Peça a outro administrador.");
  if (!podeGerir(ator, alvo.papel)) throw new Error("Apenas o administrador BeMo altera essa conta.");
  if (alvo.ativo === false) throw new Error("Usuário desativado.");
  const d = Number(dias); if (!Number.isInteger(d) || d < 1 || d > 180) throw new Error("Validade inválida (de 1 a 180 dias).");
  alvo.listas = { ate: Date.now() + d * 86400e3, por: ator.login, em: Date.now() }; delete alvo.termo_listas; // nova autorização = novo aceite do termo
  gravar("usuarios.json", u); return alvo.listas.ate;
}
function revogarListas(ator, login) {
  const u = usuarios(); const alvo = u.find((x) => x.login === login && x.tenant === ator.tenant); if (!alvo) throw new Error("Usuário não encontrado.");
  if (!podeGerir(ator, alvo.papel)) throw new Error("Apenas o administrador BeMo altera essa conta.");
  delete alvo.listas; delete alvo.termo_listas; gravar("usuarios.json", u);
}
function aceitarTermoListas(login) {
  const u = usuarios(); const alvo = u.find((x) => x.login === login); if (!alvo || !listasInfo(alvo).ativa) throw new Error("Você não tem autorização vigente para listas nominais.");
  alvo.termo_listas = { v: TERMO_VERSAO, em: Date.now() }; gravar("usuarios.json", u);
}
const falhasSenha = new Map(); // login -> [instantes]
function confirmarSenha(login, senha) { // reconfirmação a cada lista; 5 erros em 10 min bloqueiam
  const agora = Date.now(), f = (falhasSenha.get(login) || []).filter((t) => agora - t < 600e3);
  if (f.length >= 5) return "bloqueada";
  const alvo = usuarios().find((x) => x.login === login);
  if (alvo && confereSenha(String(senha || ""), alvo.hash)) { falhasSenha.delete(login); return "ok"; }
  f.push(agora); falhasSenha.set(login, f); return "incorreta";
}
function redefinirSenha(ator, login, senha) {
  const u = usuarios(); const alvo = u.find((x) => x.login === login && x.tenant === ator.tenant); if (!alvo) throw new Error("Usuário não encontrado.");
  if (!podeGerir(ator, alvo.papel)) throw new Error("Apenas o administrador BeMo altera essa conta."); validaSenha(senha);
  alvo.hash = hashSenha(senha); alvo.trocar_senha = true; alvo.sessoes_desde = Date.now(); gravar("usuarios.json", u);
}
function encerrarSessoes(ator, login) {
  const u = usuarios(); const alvo = u.find((x) => x.login === login && x.tenant === ator.tenant); if (!alvo) throw new Error("Usuário não encontrado.");
  if (!podeGerir(ator, alvo.papel)) throw new Error("Apenas o administrador BeMo altera essa conta."); alvo.sessoes_desde = Date.now(); gravar("usuarios.json", u);
}
function excluirUsuario(ator, login) {
  const u = usuarios(); const i = u.findIndex((x) => x.login === login && x.tenant === ator.tenant); if (i < 0) throw new Error("Usuário não encontrado.");
  const alvo = u[i]; if (!podeGerir(ator, alvo.papel)) throw new Error("Apenas o administrador BeMo exclui essa conta.");
  if (alvo.login === ator.login) throw new Error("Você não pode excluir a sua própria conta.");
  if (["admin", "super"].includes(alvo.papel) && alvo.ativo !== false && !u.some((x, j) => j !== i && x.tenant === ator.tenant && x.ativo !== false && ["admin", "super"].includes(x.papel))) throw new Error("Deve restar ao menos um administrador ativo.");
  u.splice(i, 1); gravar("usuarios.json", u);
}
function trocarSenha(login, atual, nova) {
  const u = usuarios(); const alvo = u.find((x) => x.login === login);
  if (!alvo || !confereSenha(String(atual || ""), alvo.hash)) throw new Error("A senha atual não confere."); validaSenha(nova);
  if (confereSenha(nova, alvo.hash)) throw new Error("A nova senha deve ser diferente da atual.");
  alvo.hash = hashSenha(nova); alvo.trocar_senha = false; alvo.sessoes_desde = Date.now() - 1000; gravar("usuarios.json", u); // derruba as outras sessões; a atual é reemitida
}

// ---------- configurações do cliente (editáveis no painel) ----------
const CONFIG_PADRAO = { limite_perguntas_min: Number(process.env.SIRA_LIMITE_PERGUNTAS || 20), sessao_horas: 8, sugestoes_inicio: 8 };
const LIMITES = { limite_perguntas_min: [1, 300], sessao_horas: [1, 24], sugestoes_inicio: [0, 12] };
function configDe(slug) { return { ...CONFIG_PADRAO, ...((ler("configuracoes.json", {})[slug]) || {}) }; }
function salvarConfig(slug, d) {
  const todas = ler("configuracoes.json", {}), atual = { ...configDe(slug) };
  for (const [k, [min, max]] of Object.entries(LIMITES)) if (d[k] !== undefined) { const n = Number(d[k]); if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Valor inválido em "${k}" (use de ${min} a ${max}).`); atual[k] = n; }
  todas[slug] = atual; gravar("configuracoes.json", todas); return atual;
}
function renomearCliente(slug, nome) { const n = String(nome || "").trim(); if (n.length < 3 || n.length > 120) throw new Error("Informe o nome do cliente (3 a 120 caracteres)."); const t = tenants(); if (!t[slug]) throw new Error("Cliente inexistente."); t[slug].nome = n; gravar("clientes.json", t); }
function novoToken(slug) { const t = tenants(); if (!t[slug]) throw new Error("Cliente inexistente."); const token = crypto.randomBytes(32).toString("hex"); t[slug].tokenSha = sha(token); t[slug].tokenEm = new Date().toISOString(); gravar("clientes.json", t); return token; }

module.exports = { TERMO_TEXTO, TERMO_VERSAO, listasInfo, autorizarListas, revogarListas, aceitarTermoListas, confirmarSenha, MODULOS, PAPEIS, modulosDe, pode, listarUsuarios, novoUsuario, editarUsuario, redefinirSenha, encerrarSessoes, excluirUsuario, trocarSenha, configDe, salvarConfig, CONFIG_PADRAO, LIMITES, renomearCliente, novoToken, SEGREDO, SEGREDO_PERSISTENTE, DATA, criarCliente, criarUsuario, tenantPorToken, autenticar, emitirSessao, lerSessao, tenants };
