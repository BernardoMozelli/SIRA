# SIRA — Sistema Inteligente de Respostas e Análises
Autor: Bernardo Mozelli de Medeiros — Desenvolvido por BeMo Sistemas. Pergunte em português aos dados do e-SUS PEC, sem painel pré-montado e sem expor paciente.

## Uma versão só
Há um único programa (a imagem do `Dockerfile`: cérebro + catálogo de consultas). O que muda é só onde ele roda e qual banco usa.

| Etapa | Comando | O que faz |
|---|---|---|
| 1. Laboratório | `./sira.sh teste` | Banco fictício, http://localhost:3210 (`gestor` ou `bemo` / `SIRA@2026`). Compare com o gabarito impresso. |
| 2. Cópia do e-SUS local | `./sira.sh copia-esus CONTAINER esus postgres` | Cria `esus_sira_teste` (cópia) com dados clínicos fictícios; o original só é lido. |
| 3. Homologação / produção | `./sira.sh instalar` | Instala no servidor da prefeitura. Depois: Configurações > Conexão com o banco de dados. |

## Como o SIRA acessa o banco do cliente (nada é instalado nele)
O SIRA consulta o e-SUS com **um usuário de leitura que recebe SELECT só nas colunas que as perguntas usam**. Nome, nome da mãe, CPF, endereço, telefone e e-mail do cidadão não são concedidos (CNS e CPF só se a TI optar, para a pergunta de qualidade do cadastro). As regras de tradução do PEC (equipe, problema ativo, atendimento) viajam dentro de cada consulta; o identificador do cidadão é um hash com sal guardado cifrado no SIRA.

A TI faz uma única coisa: executar um arquivo `.sql` no banco, com um usuário administrador (pgAdmin, DBeaver ou psql). Esse arquivo só cria o usuário e concede SELECT por coluna: não cria tabela, não instala nada, não altera dado. Para obtê-lo:
- na tela **Início > Configurações > Conexão com o banco de dados > Gerar script para a TI** (escolhe usuário e senha, baixa o `.sql`), ou
- `./sira.sh permissoes --banco NOME > sira_permissoes.sql` (opções: `--usuario`, `--ip`, `--cns-cpf`).

Depois, na mesma tela, preencha servidor, porta, banco, usuário e senha, clique em **Testar conexão** e em **Salvar e conectar**. O teste avisa se o PostgreSQL é anterior ao 12, se o usuário lê dado pessoal ou é administrador, e quais perguntas ficaram desativadas por falta de permissão.

Alternativa (opcional): `./sira.sh views --rede IP PORTA BANCO ADMIN` instala o schema `mcp` (views) e o usuário `sira_ro`; o SIRA detecta e usa as views sozinho. Desfazer: `./sira.sh desfazer-views ...`. Resultados e desempenho são os mesmos nos dois modos.

Desempenho e cache: com 320 mil cadastros e 300 mil atendimentos sintéticos, as perguntas respondem em 0,2 a 2,5 s. O mesmo pedido repetido em até 2 minutos usa o resultado já calculado (e a resposta avisa: "Números calculados há X"). Ajuste com `SIRA_CACHE_S`.

Operação: `./sira.sh parar | logs | backup`. Guarde o `SIRA_SEGREDO` do `.env`: sem ele a senha do banco salva não pode ser lida.

## Passo a passo do servidor da prefeitura
1. Linux com Docker na rede interna, alcançando o PostgreSQL do e-SUS (porta 5432 liberada no firewall e no `pg_hba.conf` para o IP deste servidor).
2. `./sira.sh instalar` — cria o SIRA, o usuário `admin` e o `bemo` com senhas provisórias.
3. Peça à TI o usuário de leitura: gere o script (botão na tela de Configurações ou `./sira.sh permissoes ...`) e ela executa no banco uma única vez.
4. `http://IP-DO-SERVIDOR:3200` > entrar como `admin` > Início > Configurações > Conexão com o banco de dados > Testar conexão > Salvar e conectar.
5. Validar 3 perguntas contra o PEC antes de liberar para o gestor.

Voltar atrás: `./sira.sh parar` (o SIRA sai do ar) e, no banco, `DROP ROLE sira_ro` (o fim do script de permissões traz o comando; com o modo de views, `./sira.sh desfazer-views`).

## Segurança — conferir antes de entregar
- Senhas de teste (`SIRA@2026`, `teste_ro_senha`) não existem em produção; a provisória pede troca no 1º acesso.
- `.env` com permissão 600 e cópia do `SIRA_SEGREDO` fora do servidor.
- O modo direto só liga com `SIRA_MODO_DIRETO=1` (já definido na imagem); a senha do banco fica cifrada (AES-256-GCM).
- Contrato de operador de dados (LGPD) e autorização da Secretaria de Saúde.
- Números de gestante/pré-natal são aproximação até mapearmos as fichas `tb_fat_*`. Falta medir num e-SUS com volume real de atendimentos (milhões de linhas) e confirmar que "resolvido" é o código 2 em `tb_problema_evolucao`.
- Exige PostgreSQL 12 ou mais novo no e-SUS (o teste de conexão avisa).
- Restrinja o usuário de leitura ao IP do servidor do SIRA no `pg_hba.conf` (o script traz a linha sugerida).

## Pasta `opcional_conector/`
Só para quem NÃO puder instalar dentro da rede da prefeitura: cérebro numa VPS e um conector na prefeitura, que só faz conexão de saída. Não é necessário para o fluxo acima.

Testes automatizados: `node conector/src/teste_catalogo.js`, `node conector/src/teste_embutido.js` (variáveis `SIRA_ADMIN_URL` e `SIRA_DB_URL`) e do modo direto: `SIRA_TESTE_DB="host=... porta=5432 banco=... ro_usuario=sira_ro ro_senha=... adm_usuario=postgres adm_senha=..." node cerebro/src/teste_direto.js`.

## Histórico de pesquisas (por usuário)

As pesquisas ficam na barra lateral esquerda, como em um chat. **Cada usuário vê apenas as próprias**: o histórico é gravado no servidor
por login (o navegador nunca escolhe de quem é), nem o administrador do cliente consegue abrir o de outra pessoa. Guarda o texto da
pergunta (CPF/telefone mascarados) e a resposta agregada, nunca dado de paciente. Cada pessoa pode renomear, excluir uma pesquisa ou
apagar todo o seu histórico (menu do usuário, "Apagar meu histórico"). Ao excluir um usuário, o histórico dele é apagado.
Retenção padrão: 180 dias (`SIRA_HISTORICO_DIAS`; `0` = sem limite). A tela **Auditoria** (somente administradores) é outro registro,
independente, para controle de uso.

## Como validar se os números estão corretos

1. **"Como foi calculado"**: toda resposta traz a regra em português (clique para abrir). Mostre-a ao responsável técnico da área.
2. **Conferência independente**: rode `banco_real/conferencia_independente.sql` no banco do e-SUS (usuário administrador, somente leitura).
   Ele recalcula, direto das tabelas do PEC e por outro caminho, gestantes, hipertensos/diabéticos sem consulta e atendimentos.
   Os números devem ser **idênticos** aos do SIRA (em dados de teste com 320 mil cidadãos, todos bateram).
3. **Conferência com o PEC**: compare 2 ou 3 números com os relatórios do próprio PEC (gestantes, hipertensos, atendimentos) no mesmo dia.
   Diferenças pequenas são esperadas quando a regra do PEC é outra; o que importa é entender o motivo. Pontos a confirmar:
   situação "resolvido" = 2 (`banco_real/03_conferir_esus.sql`), pré-natal é aproximação (atendimento de médico/enfermeiro na gestação)
   e atendimentos contam a participação de cada profissional.

## Perguntas livres, listas, gráficos, PDF e painéis

**Perguntas livres (precisa de IA ativa em Administração → Inteligência artificial).** Se a pergunta não é uma das consultas prontas do catálogo,
a IA traduz o texto em um SELECT sobre as visões anonimizadas do SIRA (cidadãos, condições, atendimentos, equipes, unidades). A IA recebe só o texto
da pergunta (CPF e telefone mascarados) e os nomes das visões; nunca vê dado de paciente. Antes de rodar, o SIRA valida a consulta
(`conector/src/livre.js`): um único SELECT, só as visões do SIRA, só funções permitidas, nada de comentário/aspas/`;`, identificador de cidadão
nunca listado, sempre agregada (coluna `total`), grupos com menos de 5 pessoas ocultados, no máximo 200 linhas, 15 s, 2 ao mesmo tempo, transação
somente leitura. Cada resposta livre mostra "Como foi calculado" e "Ver a consulta usada". Perguntas **fora do e-SUS** (poema, receita, notícia,
tentativa de mudar as regras) são recusadas com uma mensagem padrão. Sem IA ativa, o SIRA continua respondendo só o catálogo.
`node ../conector/src/teste_validador.js` roda 38 ataques contra o validador.

**Listas com nomes (opcional, desligadas por padrão).** Seis listas prontas (cadastros sem CPF, sem CNS, gestantes, gestantes sem pré-natal,
hipertensos e diabéticos sem consulta), com filtro por inicial do nome e equipe. Exigem três coisas: (1) a TI gera o script de permissões com a opção
**"Listas com nomes"** (libera só o nome e a data de nascimento; precisa da autorização do encarregado de dados/LGPD); (2) o usuário tem o módulo
**autorização específica** do usuário: em Usuários e permissões, botão **"Listas nominais"**, outro administrador autoriza a pessoa por 30, 90 ou 180 dias (ninguém se autoriza, nem o administrador BeMo; perfil e exceções não bastam; vencida ou revogada, bloqueia na hora); (3) na primeira lista a pessoa aceita o **termo de responsabilidade** (LGPD); (4) a cada lista informa o **motivo** e **confirma a senha** (5 erros em 10 min bloqueiam), com limite diário (padrão 20; variável `SIRA_LISTAS_DIA`). Concessão, revogação, termo, senha errada e limite ficam na auditoria. Cada lista fica na auditoria (quem, quando, filtros, quantas linhas, motivo). Os nomes não entram no cache, no histórico nem nos painéis.
Em bancos com o schema `mcp` instalado (caminho A) a visão de nomes existe mas fica sem permissão até a TI executar `GRANT SELECT ON mcp.v_cidadao_nominal TO sira_ro`.

**Gráficos, Excel e PDF.** Toda resposta com tabela mostra gráfico (barras, linhas ou pizza, com troca na tela) e botões **Baixar Excel** e **Baixar PDF**.
Os arquivos são gerados no navegador, com os dados que a tela já recebeu: nada volta ao servidor e nada fica guardado nele.

**Meus painéis.** O botão **Fixar no painel** guarda como calcular (não o resultado). Em Meus painéis, cada item é recalculado com os dados atuais a cada abertura,
com troca do tipo de gráfico, renomear, remover e PDF do painel inteiro. Cada usuário vê só o seu. Consultas livres fixadas levam um selo de integridade e são
revalidadas a cada execução.

**Limites conhecidos.** A qualidade das perguntas livres depende do modelo de IA escolhido: teste com perguntas reais e confira "Ver a consulta usada" antes de usar um
número em decisão. As visões cobrem cadastro, condições (gestante, hipertenso, diabético), atendimentos, equipes e unidades; vacinas, exames, procedimentos e medicamentos
ainda não estão nas visões (a IA responde que os dados não permitem). Listas passam de 5.000 linhas: o SIRA avisa e pede um filtro.
