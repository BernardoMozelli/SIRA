// Histórico por usuário: isolamento, privacidade, limites e exclusão. Uso: node src/teste_historico.js
const assert=require('assert'),os=require('os'),fs=require('fs'),path=require('path');
process.env.SIRA_DATA=fs.mkdtempSync(path.join(os.tmpdir(),'sira-hist-')); process.env.SIRA_SEGREDO='teste-segredo';
const auth=require('./auth'); auth.criarCliente('demo','Prefeitura Demonstração'); auth.criarCliente('outra','Outra Prefeitura');
auth.criarUsuario('demo','ana','Ana Souza','SIRA@2026','gestor'); auth.criarUsuario('demo','beto','Beto Lima','SIRA@2026','gestor'); auth.criarUsuario('demo','adm','Admin Demo','SIRA@2026','admin');
auth.criarUsuario('outra','ana2','Ana de Outra','SIRA@2026','gestor');
const hist=require('./historico'); const { server }=require('./index'); let B;
async function login(u,s='SIRA@2026',cli='demo'){const r=await fetch(B+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({login:u,senha:s,cliente:cli})});return (r.headers.get('set-cookie')||'').split(';')[0];}
const call=async(c,m,p,b)=>{const r=await fetch(B+p,{method:m,headers:{cookie:c,'content-type':'application/json'},body:b?JSON.stringify(b):undefined});let j={};try{j=await r.json()}catch{};return {s:r.status,...j};};
(async()=>{
 await new Promise((ok)=>server.listen(0,'127.0.0.1',ok)); B='http://127.0.0.1:'+server.address().port;
 // as senhas provisórias exigem troca: troca para liberar o uso
 const entrar=async(u,cli)=>{let c=await login(u,'SIRA@2026',cli); const r=await fetch(B+'/api/senha',{method:'POST',headers:{cookie:c,'content-type':'application/json'},body:JSON.stringify({atual:'SIRA@2026',nova:'senhaNova123'})}); return (r.headers.get('set-cookie')||c).split(';')[0];};
 const ana=await entrar('ana'), beto=await entrar('beto'), adm=await entrar('adm'), anaOutra=await entrar('ana2','outra');
 assert(ana&&beto&&adm&&anaOutra,'logins');
 const U={tenant:'demo',login:'ana'};
 const resp={ok:true,pergunta:'gestantes_sem_prenatal',texto:'29 gestantes',tabela:{colunas:['a'],linhas:[[1]]},criterio:'regra',ms:12,campoInterno:'nao-deve-ficar'};
 const c1=hist.adicionar(U,null,'Quantas gestantes sem pré-natal? CPF 123.456.789-09 telefone (11) 91234-5678',resp);
 hist.adicionar(U,c1.id,'e por equipe?',resp);
 let r=await call(ana,'GET','/api/historico'); assert.equal(r.s,200); assert.equal(r.conversas.length,1); assert.equal(r.conversas[0].mensagens,4);
 assert(!/123\.456\.789|91234/.test(JSON.stringify(r)),'documento mascarado no título');
 r=await call(ana,'GET','/api/historico/'+c1.id); assert.equal(r.s,200); assert(!/123\.456\.789|91234/.test(JSON.stringify(r)),'documento mascarado nas mensagens'); assert(!JSON.stringify(r).includes('campoInterno'),'só campos esperados');
 // isolamento
 r=await call(beto,'GET','/api/historico'); assert.equal(r.conversas.length,0,'Beto não vê as de Ana');
 for(const [m,b] of [['GET'],['PUT',{titulo:'invadido'}],['DELETE']]){ r=await call(beto,m,'/api/historico/'+c1.id,b); assert(r.s===404||r.s===400,'Beto não acessa por id: '+m+' '+r.s); }
 r=await call(adm,'GET','/api/historico'); assert.equal(r.conversas.length,0,'admin também não vê histórico alheio'); r=await call(adm,'GET','/api/historico/'+c1.id); assert.equal(r.s,404);
 r=await call(anaOutra,'GET','/api/historico'); assert.equal(r.conversas.length,0,'usuário de outro cliente tem histórico próprio');
 r=await call(ana,'GET','/api/historico/'+c1.id); assert.equal(r.conversa.titulo.startsWith('Quantas gestantes'),true,'continua intacto');
 // parâmetro de dono forjado é ignorado
 r=await call(beto,'GET','/api/historico?login=ana&tenant=demo'); assert.equal(r.conversas.length,0);
 // renomear / excluir
 r=await call(ana,'PUT','/api/historico/'+c1.id,{titulo:'Pré-natal'}); assert.equal(r.s,200); assert.equal(r.conversa.titulo,'Pré-natal');
 r=await call(ana,'PUT','/api/historico/'+c1.id,{titulo:'  '}); assert.notEqual(r.s,200);
 // arquivos: nome sem login em claro, modo 0600
 const dir=path.join(process.env.SIRA_DATA,'historico'); const fs_=fs.readdirSync(dir); assert(fs_.every(f=>!/ana|beto/.test(f)),'nome do arquivo não expõe login'); assert.equal((fs.statSync(path.join(dir,fs_[0])).mode&0o777),0o600);
 // limites
 for(let i=0;i<305;i++) hist.adicionar({tenant:'demo',login:'beto'},null,'p'+i,resp); assert.equal(hist.listar({tenant:'demo',login:'beto'}).length,300,'limite de conversas');
 // retenção
 process.env.SIRA_HISTORICO_DIAS='1'; const f=path.join(dir,fs.readdirSync(dir).find(x=>fs.readFileSync(path.join(dir,x),'utf8').includes('Pré-natal'))); const j=JSON.parse(fs.readFileSync(f,'utf8')); j.conversas[0].atualizada=Date.now()-5*864e5; fs.writeFileSync(f,JSON.stringify(j));
 assert.equal(hist.listar(U).length,0,'retenção expira antigas'); delete process.env.SIRA_HISTORICO_DIAS;
 // apagar tudo só afeta o próprio
 hist.adicionar(U,null,'nova',resp); r=await call(beto,'DELETE','/api/historico'); assert.equal(r.s,200); assert.equal(hist.listar({tenant:'demo',login:'beto'}).length,0); assert.equal(hist.listar(U).length,2,'apagar o de Beto não toca no de Ana');
 // exclusão de usuário apaga o histórico
 r=await call(adm,'DELETE','/api/usuarios/ana'); assert.equal(r.s,200); assert.equal(hist.listar(U).length,0,'histórico removido com o usuário');
 // sem sessão
 r=await call('','GET','/api/historico'); assert.equal(r.s,401);
 console.log('Histórico por usuário: todos os testes ok'); process.exit(0);
})().catch(e=>{console.error('FALHOU',e);process.exit(1)});
