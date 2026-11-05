// Teste do painel administrativo (usuários, perfis, exceções, senha, configurações). Uso: node src/teste_admin.js
const assert=require('assert'),os=require('os'),fs=require('fs'),path=require('path');
process.env.SIRA_DATA=fs.mkdtempSync(path.join(os.tmpdir(),'sira-adm-')); process.env.SIRA_SEGREDO='teste-segredo';
const auth=require('./auth'); auth.criarCliente('demo','Prefeitura Demonstração');
auth.criarUsuario('demo','gestor','Coordenadora Demo','SIRA@2026','admin'); auth.criarUsuario('demo','bemo','BeMo Sistemas (super)','SIRA@2026','super');
const { server } = require('./index'); let B;
async function login(u,s='SIRA@2026'){const r=await fetch(B+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({login:u,senha:s})});return {s:r.status,c:(r.headers.get('set-cookie')||'').split(';')[0]};}
const call=async(c,m,p,b)=>{const r=await fetch(B+p,{method:m,headers:{cookie:c,'content-type':'application/json'},body:b?JSON.stringify(b):undefined});let j={};try{j=await r.json()}catch{};return {s:r.status,...j,_h:r.headers};};
(async()=>{
 await new Promise((ok)=>server.listen(0,'127.0.0.1',ok)); B='http://127.0.0.1:'+server.address().port;
 const adm=(await login('gestor')).c, sup=(await login('bemo')).c;
 let r=await call(adm,'GET','/api/eu'); assert(r.modulos.usuarios&&r.modulos.configuracoes&&!r.modulos.ia);
 r=await call(sup,'GET','/api/eu'); assert(r.modulos.ia);
 r=await call(adm,'GET','/api/ia'); assert.equal(r.s,403,'admin sem IA');
 r=await call(adm,'GET','/api/usuarios'); assert.equal(r.s,200); assert(!r.papeis.super,'admin não vê perfil super');
 r=await call(adm,'POST','/api/usuarios',{login:'x',nome:'Fulano de Tal',papel:'gestor',senha:'12345678'}); assert.equal(r.s,400);
 r=await call(adm,'POST','/api/usuarios',{login:'maria',nome:'Maria Silva',papel:'super',senha:'12345678'}); assert.equal(r.s,400,'admin não cria super');
 r=await call(adm,'POST','/api/usuarios',{login:'maria',nome:'Maria Silva',papel:'gestor',senha:'curta'}); assert.equal(r.s,400);
 r=await call(adm,'POST','/api/usuarios',{login:'maria',nome:'Maria Silva',papel:'gestor',senha:'senha1234'}); assert.equal(r.s,200);
 r=await call(adm,'POST','/api/usuarios',{login:'maria',nome:'Maria Silva',papel:'gestor',senha:'senha1234'}); assert.equal(r.s,400,'duplicado');
 let m=(await login('maria','senha1234')).c; r=await call(m,'GET','/api/eu'); assert.equal(r.trocarSenha,true);
 r=await call(m,'GET','/api/catalogo'); assert.equal(r.s,403,'bloqueado até trocar a senha');
 r=await call(m,'POST','/api/senha',{atual:'errada',nova:'novasenha1'}); assert.equal(r.s,400);
 r=await call(m,'POST','/api/senha',{atual:'senha1234',nova:'novasenha1'}); assert.equal(r.s,200); m=r._h.get('set-cookie').split(';')[0];
 r=await call(m,'GET','/api/eu'); assert.equal(r.trocarSenha,false); assert(r.modulos.perguntar&&!r.modulos.usuarios);
 r=await call(m,'GET','/api/usuarios'); assert.equal(r.s,403,'gestor não gere usuários');
 r=await call(m,'GET','/api/config'); assert.equal(r.s,403);
 r=await call(m,'GET','/api/auditoria'); assert.notEqual(r.s,200,'gestor sem auditoria');
 // exceção por usuário: libera auditoria, bloqueia perguntar
 r=await call(adm,'PUT','/api/usuarios/maria',{excecoes:{auditoria:true,perguntar:false}}); assert.equal(r.s,200);
 r=await call(m,'GET','/api/eu'); assert.equal(r.s,200,'sessão sobrevive a mudança de exceção'); assert(r.modulos.auditoria&&!r.modulos.perguntar);
 r=await call(m,'POST','/api/perguntar',{texto:'quantas gestantes'}); assert.equal(r.s,403);
 r=await call(adm,'PUT','/api/usuarios/maria',{papel:'admin'}); assert.equal(r.s,200); r=await call(m,'GET','/api/eu'); assert.equal(r.s,401,'mudança de perfil derruba sessão');
 r=await call(adm,'PUT','/api/usuarios/gestor',{ativo:false}); assert.equal(r.s,400,'não desativa a si mesmo');
 r=await call(adm,'DELETE','/api/usuarios/gestor'); assert.equal(r.s,400);
 r=await call(adm,'PUT','/api/usuarios/bemo',{ativo:false}); assert.equal(r.s,400,'admin não mexe em super');
 r=await call(adm,'POST','/api/usuarios/maria/senha',{senha:'outrasenha9'}); assert.equal(r.s,200);
 m=(await login('maria','outrasenha9')).c; assert((await call(m,'GET','/api/eu')).trocarSenha);
 r=await call(adm,'POST','/api/usuarios/maria/sessoes'); assert.equal(r.s,200); assert.equal((await call(m,'GET','/api/eu')).s,401);
 r=await call(adm,'PUT','/api/usuarios/maria',{ativo:false}); assert.equal((await login('maria','outrasenha9')).s,401,'desativado não entra');
 r=await call(adm,'DELETE','/api/usuarios/maria'); assert.equal(r.s,200);
 // super não pode ser o último admin removido? gestor(admin)+bemo(super): remover bemo por super
 r=await call(sup,'PUT','/api/usuarios/gestor',{ativo:false}); assert.equal(r.s,200); assert.equal((await call(adm,'GET','/api/eu')).s,401); r=await call(sup,'PUT','/api/usuarios/gestor',{ativo:true}); assert.equal(r.s,200);
 // configurações
 const adm2=(await login('gestor')).c;
 r=await call(adm2,'GET','/api/config'); assert.equal(r.config.limite_perguntas_min,20); assert.equal(r.podeToken,false);
 r=await call(adm2,'PUT','/api/config',{limite_perguntas_min:0}); assert.equal(r.s,400);
 r=await call(adm2,'PUT','/api/config',{cliente:'Prefeitura de Teste',limite_perguntas_min:5,sessao_horas:2,sugestoes_inicio:3}); assert.equal(r.s,200); assert.equal(r.cliente,'Prefeitura de Teste');
 r=await call(adm2,'GET','/api/eu'); assert.equal(r.cliente,'Prefeitura de Teste'); assert.equal(r.sugestoes,3);
 let l=await login('gestor'); assert(/Max-Age=7200/.test((await fetch(B+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({login:'gestor',senha:'SIRA@2026'})})).headers.get('set-cookie')),'sessão 2h');
 r=await call(adm2,'POST','/api/config/token'); assert.equal(r.s,403);
 const sup2=(await login('bemo')).c; r=await call(sup2,'POST','/api/config/token'); assert.equal(r.s,200); assert(/^[0-9a-f]{64}$/.test(r.token));
 const aud=require('fs').readFileSync(process.env.SIRA_DATA+'/auditoria-demo.jsonl','utf8'); assert(/novo_token/.test(aud)&&/"criar"/.test(aud)&&!/senha1234|outrasenha9|novasenha1/.test(aud),'auditoria sem senhas');
 console.log('API admin: todos os testes ok'); process.exit(0);
})().catch(e=>{console.error('FALHOU',e);process.exit(1)});
