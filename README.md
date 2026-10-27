# Nossa Caixinha

Aplicação estática com Supabase Auth e PostgreSQL. Cada conta possui sua própria caixinha, acessível nos aparelhos em que estiver conectada.

## Atualizar um projeto que já funciona

1. Exporte o extrato atual e faça um backup pelo Supabase antes de atualizar o banco.
2. Abra `migrations/002-ledger.sql`, copie todo o conteúdo para uma nova consulta no SQL Editor e execute.
3. Aguarde a confirmação de sucesso. O script preserva `couple_data`, importa cada movimentação em uma linha da tabela `caixinha_transactions` e cria `caixinha_audit` com o histórico. A importação inicial fica registrada como inclusão. Não é possível reconstruir alterações anteriores à instalação.
4. Se houver erro na validação de dados antigos, a transação é revertida. Não apague as tabelas: confira a mensagem e corrija o registro indicado antes de tentar novamente.
5. Atualize o site com Ctrl+F5. O código novo depende da função `save_caixinha` criada pela migração; não há gravação alternativa que ignore as validações.

Se precisar repetir a instalação, execute o SQL inicial e em seguida a migração. O SQL inicial detecta a função instalada e preserva o bloqueio de escrita direta.

## Instalação do zero

1. Crie um projeto Supabase com Data API ativada e RLS ativado. A exposição automática de novas tabelas pode ficar desativada.
2. Execute `supabase-schema.sql` e depois `migrations/002-ledger.sql`, nessa ordem, no SQL Editor.
3. Em `js/supabase-config.js`, preencha a URL e o campo `anonKey` com a chave pública publishable (ou anon legada). Nunca coloque chaves secret/service_role ou a senha do banco no navegador.
4. Habilite autenticação por e-mail e senha. Com confirmação habilitada, confirme o endereço antes do primeiro login.
5. Em Authentication → URL Configuration, configure Site URL e Redirect URLs. Para o Live Server, inclua o endereço usado de fato, como `http://127.0.0.1:5500/`. `localhost` e `127.0.0.1` são endereços diferentes.
6. Sirva esta pasta por HTTP no desenvolvimento e HTTPS na produção. Com Python: `python -m http.server 8000`. Abra `http://localhost:8000/` e configure também esse endereço nas URLs permitidas, se utilizá-lo.

## Dados, validação e histórico

- `couple_data`: configurações da conta e snapshot de compatibilidade para leitura e Realtime.
- `caixinha_transactions`: uma linha por movimentação, com valor decimal exato, responsável, data e descrição.
- `caixinha_audit`: antes/depois de inclusão, edição e exclusão, além de alterações das configurações. O usuário pode consultar as últimas 100 entradas na interface e consultar o histórico completo no painel.
- A função `save_caixinha` executa a gravação em uma transação, verifica o usuário autenticado, serializa as gravações da mesma conta e compara a revisão para detectar conflitos. O banco valida o JSON e sincroniza a tabela de movimentações; o snapshot é preservado para compatibilidade.
- As políticas RLS restringem consultas aos dados da própria conta. Clientes autenticados não podem escrever diretamente nas tabelas nem modificar a auditoria. Administradores do projeto continuam tendo acesso administrativo.
- O banco rejeita valores negativos ou com mais de duas casas decimais, datas inválidas, responsáveis inválidos, descrições vazias, identificadores duplicados e operações que deixariam o saldo final negativo. O limite por valor é R$ 9.999.999.999,99. Não há validação de saldo histórico por dia; lançamentos retroativos são permitidos.
- Os cálculos do aplicativo usam centavos. O saldo inicial fica separado dos depósitos e aparece no CSV. Para registros antigos, a data de abertura pode ficar vazia, pois ela não era coletada.
- O botão de redefinir a caixinha remove as movimentações ativas de todos os aparelhos da conta e preserva o histórico. Excluir a conta pelo painel administrativo também exclui seus dados e auditoria.
- Não existe edição offline. Em falhas de rede, confira os dados recarregando antes de repetir uma operação. Conflitos exigem conferir o estado atualizado e tentar novamente.

## Recuperação de senha e confirmação

Na tela de entrada, preencha o e-mail e clique em **Esqueci minha senha**. O link recebido abre um formulário de nova senha. O aplicativo usa os eventos de recuperação do SDK e não aceita trocar a senha apenas por abrir uma URL sem sessão válida. O Supabase aplica a política de senha configurada no projeto; a tela exige pelo menos oito caracteres.

O botão **Reenviar confirmação de e-mail** solicita um novo link para contas pendentes. Há espera de um minuto no aplicativo entre solicitações de cada tipo, mas os limites do Supabase podem exigir uma espera maior. Use sempre o e-mail mais recente. Erros de link inválido/expirado são mostrados na página.

## Configurar envio de e-mails (etapa externa pendente)

O serviço padrão de e-mails do Supabase é destinado a testes e tem limites baixos. Para uso regular:

1. Escolha um provedor de e-mail transacional que ofereça SMTP.
2. Valide um domínio e configure os registros DNS exigidos pelo provedor.
3. No painel Supabase, encontre Authentication → Email → SMTP Settings (o nome pode variar) e habilite SMTP personalizado.
4. Preencha remetente, servidor, porta e credenciais fornecidas pelo provedor. Essas credenciais pertencem ao painel do Supabase, não ao código do site.
5. Confira os limites em Authentication → Rate Limits e teste confirmação e recuperação com uma conta de teste.

A contratação do provedor, domínio, DNS e configuração das credenciais não foram executadas por este projeto.

## Publicar em HTTPS (etapa externa pendente)

### GitHub e Vercel

Repositório: https://github.com/Joao-RSbisneto/minha-caixinha

Na Vercel, importe esse repositório e selecione o preset **Other**. O arquivo `vercel.json` define o comando `npm run build` e a pasta de saída `dist`. O build copia apenas os sete arquivos necessários ao site e verifica se a configuração usa uma chave pública do Supabase. SQL, testes e dependências não são publicados como páginas.

Depois do primeiro deploy, adicione a URL de produção em Authentication → URL Configuration no Supabase (Site URL e Redirect URLs). Mantenha também os endereços locais caso continue desenvolvendo no computador. Essa configuração é necessária para os links de recuperação de senha retornarem ao site publicado.

Atualizações enviadas à branch de produção do repositório podem ser publicadas automaticamente pela integração Git da Vercel.

Hospede os arquivos estáticos em um provedor com HTTPS. Não é necessário compilar a aplicação. Publique `index.html`, `css/` e `js/`; não publique `node_modules/`, arquivos de teste nem credenciais privadas. A chave pública do Supabase faz parte do cliente por definição; o isolamento depende das regras do banco.

Após escolher o endereço público, atualize Site URL e Redirect URLs no Supabase para esse endereço. Faça os testes abaixo em produção antes de registrar dados importantes. A hospedagem ainda não foi criada nem publicada.

## Testes

Requer Node.js 20 ou superior:

```sh
npm ci
npm test
```

Os testes incluem cálculos, CSV, falhas de gravação, recuperação de senha e a migração executada em um PostgreSQL embarcado (PGlite), incluindo isolamento entre duas contas. Não acessam o projeto Supabase real nem enviam e-mails.

Validação manual após a migração:

1. Criar duas contas e confirmar os e-mails.
2. Configurar a caixinha da conta A e registrar depósito e retirada com centavos.
3. Editar um lançamento, excluir outro e conferir o histórico e o CSV.
4. Recarregar a página e conferir os valores.
5. Entrar na conta B e verificar que ela não vê os dados da conta A.
6. Abrir a conta A em dois aparelhos e conferir o tratamento de alterações simultâneas.
7. Solicitar recuperação de senha, definir uma nova e entrar novamente.
8. Testar no celular, fechar modais com Escape e navegar com Tab.

## Documentação oficial

- [Recuperação de senha](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)
- [Funções do banco](https://supabase.com/docs/guides/database/functions)
- [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [SMTP personalizado](https://supabase.com/docs/guides/auth/auth-smtp)
