Implementar a estrutura e os comportamentos explicitamente definidos neste prompt, respeitando a arquitetura existente. Sempre que uma decisão exigir uma regra de negócio ainda não especificada, identificar a questão e solicitar esclarecimento antes de implementar esse comportamento.

No dashboard do plugin (admin/plugins/littlebox-strapi-suite), criar mais uma secção: Ecommerce. Crie o card e com o título e descrição. O botão não deve dizer “Settings” mas sim “Manage”. Ao clicar, deve abrir o dashboard do ecommerce. Um menu no lado esquerdo deve ser mostrado com as seguintes opções:

- Produtos
- Encomendas
- Clientes
- Promoções
- Configuraçoes

**Produtos**:

Ao clicar em produtos, deve abrir uma lista com todos os produtos registado na plataforma. Se não houver produtos, deve aparecer no lugar da lista uma ilustração em SVG e um botão para criar o primeiro produto. Se houver algum produto, deve mostrar a thumbnail da primeira fotografia, o nome e o botão editar. Ao clicar em editar ou criar novo produto, deve substituir a lista pela ecrã de gestão de produto e deve ter os seguintes campos (avalie a melhor disposição para cada campo):

- Nome do produto (obrigatório)
- Peso (assume como 0)
- Dimensão largura x altura x profundidade (assume como 0)
- Descrição (obrigatório)
- Galeria de imagens e um botão para adicionar novas imagens.
- Variações do produto
- Estoque
- Preço
- SKU

Ao clicar para adicionar uma imagem, deve aparecer uma modal para fazer o crop ou redimencionamento da imagem, o cliente deve informar a largura e a altura pretendida e o sistema deve converter essa imagem para webp 80% de qualidade e guardar essa versão e descartar a original, para evitar que o servidor fique com imagens muito pesadas. O clicar sobre uma imagem que está na galeria, deve abrir uma modal para consultar o tamanho da imagem, peso, nome e um botão para eliminar a imagem e ao clicar sobre esse botão, deve aparecer uma modal para confirmar. Ao clicar para confirmar, deve remover a imagem do produto e do servidor.

Em relação a variação do produto, deve ser uma tabela em que se não tiver uma variação, deve aparecer uma ilustração svg com o botão para adicionar nova variação. Ao clicar, deve abrir uma modal para inserir o valor da variação (por exemplo, se for uma camisa, o valor da variação pode ser SM, M, L, XL, veja o melhor nome para esse campo), o titulo, o preço, estoque, SKU e imagem (galeria também).

A lista de produtos deve mostrar os primeiros 50 produtos com uma barra de pesquisa pelo nome ou sku. Deve haver paginação.

**Encomendas**:

# 1. Objetivo

Implementar um módulo completo de gestão de encomendas para uma plataforma de e-commerce multi-tenant.

O módulo deverá permitir:

- Consultar encomendas.
- Visualizar os seus detalhes.
- Gerir produtos, quantidades e moradas.
- Processar pagamentos únicos ou complementares.
- Emitir faturas.
- Gerir expedições parciais ou integrais.
- Acompanhar entregas.
- Processar cancelamentos e reembolsos.
- Controlar automaticamente o stock.
- Enviar notificações aos clientes.
- Consultar o histórico de todas as operações.

A implementação deve respeitar a arquitetura, os componentes reutilizáveis, os padrões visuais e as convenções técnicas existentes.

## 1.1. Arquitetura dos estados

A encomenda deverá possuir três dimensões independentes:

1. `OrderStatus` — Estado administrativo da encomenda.
2. `PaymentStatus` — Estado financeiro da encomenda.
3. `FulfillmentStatus` — Estado da expedição.

Não utilizar uma única máquina de estados para representar simultaneamente o pagamento, a expedição e o ciclo administrativo.

O estado de entrega deverá ser acompanhado através dos registos individuais das expedições e dos eventos de transporte.

## 1.2. Isolamento por loja

Todos os dados devem pertencer à respetiva loja.

As encomendas, pagamentos, configurações, credenciais, faturas, expedições e movimentos de stock de uma loja não podem ser acedidos ou modificados por outra loja.

As operações devem utilizar os mecanismos existentes de identificação e isolamento de tenants.

## 1.3. Princípios gerais

- Centralizar as regras de negócio nos serviços de domínio.
- Validar operações no backend.
- Preservar os registos históricos.
- Utilizar identificadores técnicos estáveis.
- Separar a lógica de negócio das integrações externas.
- Garantir idempotência em operações financeiras e de stock.
- Evitar dependências diretas dos fornecedores externos nos módulos de negócio.
- Não implementar regras arbitrárias quando estas ainda não estiverem definidas.

---

# 2. Listagem de Encomendas

## 2.1. Acesso

Ao clicar na opção **Encomendas** do menu principal, apresentar a listagem das encomendas registadas na loja.

## 2.2. Estado vazio

Quando não existirem encomendas:

- Apresentar uma ilustração SVG no lugar da tabela.
- Exibir a mensagem: "Ainda não existem encomendas."
- Respeitar a identidade visual da plataforma.

## 2.3. Tabela de encomendas

Apresentar as seguintes colunas:

| Campo | Descrição |
| --- | --- |
| Referência | Identificador único da encomenda |
| Estado da encomenda | Aberta, Arquivada ou Cancelada |
| Estado do pagamento | Estado financeiro agregado |
| Estado da expedição | Progresso de envio dos produtos |
| Total | Valor total atual |
| Data | Data de criação |
| Ações | Botão Visualizar |

Os estados devem ser apresentados através de indicadores visuais distintos.

## 2.4. Visualização

Ao clicar em **Visualizar**, abrir o ecrã de gestão da encomenda selecionada.

A listagem deve apresentar exclusivamente encomendas pertencentes à loja atual.

---

# 3. Ecrã de Gestão da Encomenda

## 3.1. Objetivo

Apresentar todas as informações relevantes de uma encomenda, organizadas em secções.

## 3.2. Cabeçalho

O cabeçalho deve apresentar:

- Referência da encomenda.
- `OrderStatus`.
- `PaymentStatus`.
- `FulfillmentStatus`.
- Data de criação.
- Ações disponíveis.

Os três estados devem ser visualmente independentes.

## 3.3. Ações

As ações previstas são:

1. Enviar encomenda.
2. Modificar.
3. Cancelar.
4. Reembolso.
5. Adicionar pagamento.
6. Enviar instruções de pagamento.
7. Arquivar encomenda, quando elegível.

As ações de faturação permanecem na secção de pagamentos:

- Gerar fatura.
- Gerar fatura total.

A visibilidade das ações deve respeitar as regras do ponto 10.

## 3.4. Secções do ecrã

Organizar as informações em:

1. Produtos da encomenda.
2. Resumo financeiro.
3. Dados do cliente.
4. Morada de entrega.
5. Morada de faturação.
6. Pagamentos.
7. Faturas.
8. Expedições e entregas.
9. Reembolsos e créditos.
10. Histórico de alterações.

Cada secção deve utilizar os dados efetivamente associados à encomenda.

---

# 4. Produtos da Encomenda

## 4.1. Listagem de produtos

Apresentar uma tabela com todos os produtos associados à encomenda.

| Campo | Descrição |
| --- | --- |
| Fotografia | Imagem do produto |
| Produto | Nome do produto |
| SKU | Identificador da variante |
| Preço unitário | Preço aplicado na encomenda |
| Quantidade | Quantidade encomendada |
| Quantidade enviada | Unidades já expedidas |
| Total | Preço unitário × quantidade |

## 4.2. Preços

Os preços devem corresponder aos valores registados na encomenda.

Alterações posteriores ao preço do produto no catálogo não devem alterar retroativamente os valores de encomendas existentes.

## 4.3. Quantidades expedidas

Apresentar o progresso da expedição através da representação:

**Quantidade encomendada / Quantidade enviada**

Exemplos:

| Quantidade | Significado |
| --- | --- |
| 10 / 0 | Nenhuma unidade enviada |
| 10 / 3 | Três unidades enviadas |
| 10 / 10 | Todas as unidades enviadas |

Quando existirem unidades pendentes, apresentar uma indicação como:

"Faltam enviar 7 unidades".

## 4.4. Histórico das quantidades

As quantidades enviadas devem ser calculadas a partir das expedições registadas.

Não permitir alterações retroativas aos registos de expedição para representar modificações posteriores da encomenda.

---

# 5. Informações do Cliente

## 5.1. Dados do cliente

Apresentar a identificação do cliente associado à encomenda, incluindo os dados disponíveis necessários à gestão comercial.

## 5.2. Morada de entrega

Apresentar a morada indicada para a entrega.

## 5.3. Morada de faturação

Apresentar separadamente a morada utilizada para faturação.

As duas moradas devem ser apresentadas de forma independente, mesmo quando forem iguais.

## 5.4. Preservação dos dados

Os dados utilizados na criação da encomenda devem permanecer associados à mesma.

Uma alteração posterior à ficha geral do cliente não deve modificar silenciosamente os dados históricos da encomenda.

As alterações autorizadas às moradas da encomenda devem ser registadas no histórico.

---

# 6. Histórico de Alterações

## 6.1. Objetivo

Implementar um histórico que permita consultar todas as alterações relevantes efetuadas numa encomenda.

## 6.2. Informações obrigatórias

Cada registo deve identificar:

- Data e hora.
- Tipo de operação.
- Descrição da alteração.
- Valor anterior, quando aplicável.
- Novo valor, quando aplicável.
- Utilizador ou processo responsável.
- Identificador da operação relacionada.

## 6.3. Eventos a registar

Incluir, pelo menos:

- Criação da encomenda.
- Alteração do estado administrativo.
- Alteração do estado financeiro.
- Alteração do estado de expedição.
- Adição ou remoção de produtos.
- Alteração de quantidades.
- Alteração de moradas.
- Criação e liquidação de pagamentos.
- Emissão de faturas.
- Criação de expedições.
- Atualização de entregas.
- Cancelamentos.
- Reembolsos.
- Movimentos de stock.
- Envio de notificações.

## 6.4. Regras

O histórico deve ser preservado e não deve ser sobrescrito quando a encomenda sofrer novas modificações.

Os eventos devem permitir identificar o que efetivamente aconteceu, e não apenas o estado atual.

---

# 7. Gestão de Pagamentos

## 7.1. Relação entre encomendas e pagamentos

Uma encomenda poderá possuir um ou vários pagamentos.

Implementar uma relação de um para muitos entre encomendas e pagamentos.

Cada pagamento deverá constituir uma entidade independente.

## 7.2. Tabela de pagamentos

Apresentar:

| Campo | Descrição |
| --- | --- |
| Método | Stripe, transferência ou outro |
| Valor | Montante do pagamento |
| ID da transação | Identificador interno ou externo |
| Estado | Situação do pagamento |
| Data | Data de criação ou liquidação |
| Ações | Operações disponíveis |

## 7.3. Estados individuais

Os pagamentos devem suportar, inicialmente:

- `PENDING` — Pendente.
- `COMPLETED` — Liquidado.
- `CANCELLED` — Cancelado.

A estrutura deve permitir estados adicionais exigidos pelos fornecedores.

O estado individual de um pagamento não deve ser confundido com o `PaymentStatus` agregado da encomenda.

## 7.4. Pagamentos complementares

O sistema deverá permitir criar pagamentos adicionais após uma modificação.

### Exemplo

1. O cliente cria uma encomenda de 100 €.
2. O pagamento de 100 € é liquidado.
3. O administrador adiciona um produto de 25 €.
4. O total passa para 125 €.
5. O pagamento original permanece liquidado.
6. O `PaymentStatus` passa para `PARTIALLY_PAID`.
7. O administrador pode solicitar ou registar um pagamento complementar de 25 €.
8. Após a liquidação, o `PaymentStatus` volta a `PAID`.

O `OrderStatus` e o `FulfillmentStatus` não devem ser alterados devido ao pagamento complementar.

## 7.5. Integridade

- Não substituir o pagamento original.
- Não alterar retroativamente valores liquidados.
- Não considerar pagamentos pendentes como receita recebida.
- Impedir a duplicação de pagamentos por repetição de eventos.
- Preservar referências de transações externas.

---

# 8. Resumo Financeiro e Consistência

## 8.1. Resumo da encomenda

Apresentar:

- Subtotal dos produtos.
- Custos de envio.
- Total atual da encomenda.
- Total dos pagamentos liquidados.
- Total dos reembolsos concluídos.
- Valor líquido recebido.
- Montante ainda por pagar.
- Montante elegível para devolução, quando aplicável.

## 8.2. Cálculos

O valor líquido recebido corresponde aos pagamentos liquidados menos os reembolsos monetários concluídos.

O valor em dívida deve considerar o total atual da encomenda e os pagamentos efetivamente recebidos, sem contar pagamentos pendentes como liquidados.

Os valores elegíveis para faturação devem excluir montantes anteriormente faturados.

## 8.3. Pagamento parcialmente liquidado

Se uma encomenda tiver um total de 125 € e apenas 100 € liquidados:

- Total da encomenda: 125 €.
- Total liquidado: 100 €.
- Valor em dívida: 25 €.
- Estado financeiro: `PARTIALLY_PAID`.

## 8.4. Excedente financeiro

Quando o valor líquido recebido ultrapassar o total atual da encomenda, o sistema deverá identificar o excedente.

Esse excedente poderá justificar um reembolso, sem alterar automaticamente o estado administrativo ou de expedição.

## 8.5. Regras de consistência

- Utilizar operações monetárias com precisão adequada à moeda.
- Não utilizar valores de ponto flutuante sem controlo de arredondamento.
- Preservar a moeda e os valores originais das transações.
- Não confundir pagamentos, faturas e reembolsos.
- Não faturar duas vezes os mesmos montantes.
- Não reembolsar duas vezes os mesmos valores.
- Preservar todas as operações históricas.

Os códigos promocionais emitidos como compensação devem ser registados separadamente dos reembolsos monetários.

# 9. Gestão dos Estados da Encomenda

## 9.1. Objetivo

Implementar três dimensões independentes:

1. `OrderStatus` — Estado administrativo.
2. `PaymentStatus` — Estado financeiro.
3. `FulfillmentStatus` — Estado de expedição.

Cada dimensão deve ter identificadores técnicos estáveis, independentes das designações traduzidas.

As transições administrativas devem ser validadas por regras explícitas. Os estados financeiros e de expedição devem refletir os dados reais dos pagamentos e das expedições.

## 9.2. OrderStatus

| Identificador | Designação |
| --- | --- |
| `OPEN` | Aberta |
| `ARCHIVED` | Arquivada |
| `CANCELLED` | Cancelada |

### Regras

- A encomenda é criada em `OPEN`.
- Uma encomenda aberta pode ser cancelada.
- Uma encomenda aberta pode ser arquivada.
- Uma encomenda arquivada não pode voltar a ser aberta.
- Uma encomenda cancelada não pode voltar a ser aberta.
- O cancelamento pode ocorrer mesmo depois de os produtos terem sido enviados ou entregues.
- Cancelar uma encomenda não executa automaticamente um reembolso.
- Arquivar uma encomenda não modifica pagamentos, expedições ou stock.

### Arquivamento definitivo

O arquivamento é irreversível.

Uma encomenda arquivada deverá continuar disponível para consulta e auditoria, mas não poderá voltar ao estado `OPEN`.

Por segurança, o arquivamento deve bloquear novas modificações comerciais e expedições.

Caso existam operações financeiras pendentes, a plataforma deve impedir o arquivamento até à sua resolução ou aplicar uma regra de encerramento explicitamente definida.

### Cancelamento

A transição normal é:

`OPEN → CANCELLED`

O cancelamento de encomendas já arquivadas fica bloqueado nesta versão, para preservar a regra de arquivamento definitivo.

O cancelamento executa a reposição de stock definida no ponto 14.

A situação financeira permanece representada pelo `PaymentStatus`, permitindo distinguir uma encomenda cancelada e paga de outra cancelada e reembolsada.

## 9.3. PaymentStatus

| Identificador | Designação |
| --- | --- |
| `PENDING` | Pagamento pendente |
| `PARTIALLY_PAID` | Parcialmente pago |
| `PAID` | Pago |
| `PARTIALLY_REFUNDED` | Parcialmente reembolsado |
| `REFUNDED` | Reembolsado |

### Regras

O estado financeiro é calculado a partir:

- Do total atual da encomenda.
- Dos pagamentos efetivamente liquidados.
- Dos reembolsos monetários concluídos.
- Das operações financeiras em curso.

Não deve ser alterado diretamente através da interface.

### Pagamentos complementares

Quando uma encomenda integralmente paga for modificada e o seu total aumentar, o estado financeiro deverá passar para `PARTIALLY_PAID`, desde que o valor anteriormente liquidado seja positivo e inferior ao novo total.

A encomenda permanece `OPEN`.

O estado de expedição permanece inalterado.

### Reembolsos

O sistema deve reconhecer reembolsos parciais e integrais sem eliminar os pagamentos originais.

A prioridade de apresentação dos estados de reembolso deve ser determinística.

O histórico financeiro deve permitir distinguir uma encomenda parcialmente paga de uma encomenda parcialmente reembolsada.

### Saldos

O `PaymentStatus` é uma representação agregada.

O sistema deve preservar os valores monetários subjacentes, pois um único estado não consegue representar todas as combinações possíveis de dívida e reembolso.

Por exemplo, uma encomenda pode possuir simultaneamente um pagamento complementar pendente e um reembolso parcial anterior.

Nestas situações, o dashboard deverá apresentar o estado agregado apropriado juntamente com os saldos detalhados.

## 9.4. FulfillmentStatus

| Identificador | Designação |
| --- | --- |
| `UNFULFILLED` | Não enviado |
| `PARTIALLY_FULFILLED` | Parcialmente enviado |
| `FULFILLED` | Enviado |

### Regras

- A encomenda começa em `UNFULFILLED`.
- Quando algumas unidades forem expedidas, passa para `PARTIALLY_FULFILLED`.
- Quando todas as unidades forem expedidas, passa para `FULFILLED`.
- O estado deve ser determinado a partir dos registos de expedição e das quantidades atuais da encomenda.

O estado não deve ser alterado manualmente sem uma operação de expedição válida.

### Modificações

Quando uma encomenda for modificada:

- Preservar as expedições existentes.
- Atualizar as quantidades encomendadas.
- Recalcular as quantidades pendentes.
- Recalcular o estado agregado de expedição.

Se novos produtos forem adicionados a uma encomenda anteriormente totalmente enviada, o estado poderá passar de `FULFILLED` para `PARTIALLY_FULFILLED`, pois voltarão a existir unidades por enviar.

Esta alteração não apaga os envios anteriores.

## 9.5. Controlo de entregas

Não implementar um quarto estado principal na encomenda.

A situação da entrega deve ser acompanhada através das expedições e dos eventos disponibilizados pelas transportadoras.

Cada expedição poderá registar:

- Transportadora.
- Código de rastreio.
- Estado do transporte.
- Data de expedição.
- Data de entrega, quando confirmada.
- Eventos de acompanhamento.

O sistema deve permitir identificar:

- Expedições ainda em trânsito.
- Expedições entregues.
- Encomendas parcialmente entregues.
- Encomendas integralmente entregues.

A conclusão da entrega não modifica automaticamente o `FulfillmentStatus`, que continuará a indicar que os produtos foram enviados.

## 9.6. Independência

As três dimensões não devem alterar-se mutuamente sem uma operação de negócio que o justifique.

Exemplos:

- Um pagamento liquidado não significa que a encomenda foi enviada.
- Uma encomenda enviada pode ter um pagamento complementar pendente.
- Uma encomenda cancelada pode continuar a apresentar pagamentos liquidados.
- Uma encomenda reembolsada não deve ser automaticamente marcada como cancelada.
- Uma fatura emitida não modifica a expedição.

## 9.7. Auditoria

Todas as alterações devem ser registadas, incluindo:

- Dimensão afetada.
- Estado anterior.
- Novo estado.
- Evento responsável.
- Data e hora.
- Utilizador ou processo responsável.

## 9.8. Requisitos técnicos

- Utilizar enums ou constantes tipadas.
- Não utilizar traduções na lógica de negócio.
- Centralizar as regras de transição e de cálculo.
- Validar operações no backend.
- Garantir consistência e idempotência.
- Preservar todos os dados históricos.

---

# 10. Ações Disponíveis na Gestão de Encomendas

## 10.1. Objetivo

Definir as ações disponíveis e as respetivas condições de visibilidade.

As ações são:

1. Gerar fatura.
2. Gerar fatura total.
3. Enviar encomenda.
4. Modificar.
5. Cancelar.
6. Reembolso.
7. Adicionar pagamento.
8. Enviar instruções de pagamento.
9. Arquivar.

A disponibilidade deve considerar os três estados, os valores financeiros e os registos existentes.

A validação deve ocorrer tanto na interface como no backend.

## 10.2. Gerar fatura

A ação deve aparecer na linha de cada pagamento liquidado que possua um montante elegível ainda não faturado.

Não deve aparecer no cabeçalho.

### Regras

- Permitir faturar individualmente pagamentos liquidados.
- Não faturar pagamentos pendentes ou cancelados.
- Não faturar novamente montantes anteriormente faturados.
- Permitir faturar valores liquidados mesmo quando a encomenda estiver `PARTIALLY_PAID`.
- Não permitir novas emissões em encomendas canceladas ou arquivadas, salvo operações fiscais de regularização especificamente autorizadas.

A emissão utilizará o sistema de faturação ativo, conforme o ponto 11.

## 10.3. Gerar fatura total

A ação deve aparecer na secção de pagamentos.

Permitir emitir uma fatura conjunta para os montantes liquidados e ainda não faturados.

Não incluir automaticamente valores pendentes de pagamento.

Os montantes já faturados não devem ser incluídos novamente.

## 10.4. Enviar encomenda

O botão deverá aparecer quando:

- `OrderStatus = OPEN`.
- `PaymentStatus = PAID`.
- Existirem produtos ou quantidades pendentes de expedição.

A ação também deverá estar disponível quando o `FulfillmentStatus` for `PARTIALLY_FULFILLED`, desde que as condições financeiras estejam satisfeitas.

### Modal

Ao clicar, apresentar:

- Produtos com quantidades por enviar.
- Fotografia.
- Nome.
- SKU.
- Quantidade encomendada.
- Quantidade enviada.
- Quantidade pendente.
- Campo para selecionar a quantidade a expedir.
- Transportadora e serviço de entrega.

Após a confirmação, utilizar o módulo de transportadoras definido no ponto 12.

### Resultado

- Envio parcial: `PARTIALLY_FULFILLED`.
- Envio integral: `FULFILLED`.

O botão desaparece quando não existem quantidades por enviar.

Se uma modificação posterior adicionar produtos, poderá voltar a aparecer.

## 10.5. Modificar

O botão deverá aparecer quando:

- `OrderStatus = OPEN`.
- O estado de expedição for `UNFULFILLED` ou `PARTIALLY_FULFILLED`.

Não deve aparecer quando:

- A encomenda estiver cancelada ou arquivada.
- Todos os produtos tiverem sido expedidos.

### Operações permitidas

- Adicionar produtos.
- Remover produtos.
- Alterar quantidades.
- Alterar morada de entrega.
- Alterar morada de faturação.

As alterações devem respeitar as quantidades já enviadas e não podem modificar retroativamente expedições concluídas.

### Impacto financeiro

Após a modificação:

1. Recalcular o total.
2. Preservar os pagamentos anteriores.
3. Recalcular o `PaymentStatus`.
4. Identificar valores em dívida ou excedentes.
5. Atualizar o stock conforme o ponto 14.
6. Registar a alteração no histórico.

## 10.6. Cancelar

O botão deverá estar disponível para encomendas `OPEN`.

O cancelamento pode ocorrer independentemente dos estados de pagamento e expedição, incluindo quando a entrega já foi concluída.

### Comportamento

- Alterar `OrderStatus` para `CANCELLED`.
- Executar a reposição de stock definida no ponto 14.
- Preservar pagamentos, faturas e expedições anteriores.
- Registar a operação.
- Enviar a notificação de cancelamento.

O cancelamento não executa automaticamente um reembolso.

O botão desaparece após o cancelamento.

## 10.7. Reembolso

O botão deve aparecer quando existir um montante elegível para devolução.

Casos previstos:

- Encomenda cancelada com pagamentos ainda não reembolsados.
- Valor líquido recebido superior ao total atual da encomenda.
- Devolução de produtos com valor aprovado para reembolso.

A existência de um pagamento liquidado não significa, por si só, que qualquer montante possa ser reembolsado sem motivo ou elegibilidade.

A ação deverá abrir a modal definida no ponto 15.

## 10.8. Adicionar pagamento

O botão deverá aparecer quando existir um valor por liquidar.

Condição principal:

**Total recebido inferior ao total atual da encomenda.**

A ação destina-se ao registo de pagamentos manuais.

### Modal

Permitir introduzir:

- Valor recebido.
- Referência ou identificador da transação.
- Método de pagamento, quando aplicável.

Após a confirmação, criar um pagamento independente associado à encomenda.

O pagamento deve aparecer na tabela de pagamentos.

O `PaymentStatus` deverá ser recalculado.

## 10.9. Enviar instruções de pagamento

O botão deverá aparecer quando:

- A encomenda estiver aberta.
- Existir um montante por pagar.

Ao clicar, abrir uma modal com duas opções:

### Pagamento manual

Apresentar uma caixa de texto onde o administrador poderá escrever as instruções.

Exemplos:

- Transferência bancária.
- Referência Multibanco.
- Outros métodos externos.

### Stripe

Criar uma operação de pagamento para o valor remanescente e obter o respetivo link.

O sistema deve evitar múltiplas cobranças ativas indevidas para a mesma dívida.

### E-mail

Em ambas as modalidades, enviar ao cliente um e-mail com:

- Referência da encomenda.
- Valor pendente.
- Método selecionado.
- Instruções ou link Stripe.

## 10.10. Arquivar encomenda

Disponibilizar uma ação de arquivamento administrativo.

O arquivamento deve ser definitivo.

A ação só deverá estar disponível quando a encomenda não necessitar de novas operações comerciais ou logísticas.

Não deverá ser possível reabrir uma encomenda arquivada.

O histórico e os documentos devem permanecer acessíveis.

## 10.11. Regras gerais

- Centralizar a avaliação das ações.
- Não utilizar apenas um dos três estados para todas as decisões.
- Validar novamente as condições no backend.
- Rejeitar operações inválidas.
- Garantir idempotência.
- Registar todas as operações no histórico.

---

# 11. Sistema Modular de Faturação

## 11.1. Objetivo

Implementar um sistema de faturação independente dos fornecedores externos, baseado em plugins.

Inicialmente, implementar o Moloni.

Os módulos de encomendas e pagamentos não devem depender diretamente da API do Moloni.

## 11.2. Configuração

Disponibilizar:

**Configurações → Integração com sistemas de faturação**

Apresentar os plugins disponíveis.

Inicialmente:

- Moloni.

Cada plugin deve permitir:

- Configuração.
- Ativação.
- Desativação.
- Verificação do estado da integração, quando suportada.

## 11.3. Ativação exclusiva

Apenas um fornecedor de faturação poderá estar ativo de cada vez por loja.

Ao ativar outro fornecedor, o anterior deverá ser desativado.

A plataforma poderá permanecer sem fornecedor ativo.

Neste caso, não deverá permitir executar novas emissões até existir uma configuração válida.

## 11.4. Contrato comum

Todos os plugins devem implementar uma abstração comum que permita:

- Criar faturas.
- Consultar documentos.
- Obter PDFs.
- Consultar estados de emissão.
- Identificar capacidades do fornecedor.

O serviço central deverá identificar o plugin ativo e encaminhar a operação.

Os botões de faturação deverão ser agnósticos em relação ao fornecedor.

## 11.5. Moloni

Implementar o Moloni como primeiro plugin.

O plugin deve:

- Gerir a autenticação.
- Comunicar com a API oficial.
- Criar documentos fiscais.
- Consultar os documentos emitidos.
- Recuperar os PDFs.
- Tratar erros.
- Normalizar as respostas.

As credenciais devem permanecer exclusivamente no backend e estar isoladas por loja.

## 11.6. Faturação individual

Ao clicar em **Gerar fatura**:

1. Validar o pagamento liquidado.
2. Identificar o montante elegível ainda não faturado.
3. Obter os dados de faturação do cliente.
4. Preparar produtos, valores e impostos.
5. Identificar o fornecedor ativo.
6. Solicitar a emissão.
7. Persistir o documento e a associação aos montantes faturados.
8. Disponibilizar o PDF.
9. Notificar o cliente.

O `PaymentStatus` pode ser `PARTIALLY_PAID`, desde que o pagamento individual a faturar esteja liquidado.

## 11.7. Faturação total

Permitir emitir uma fatura conjunta para os valores liquidados ainda não faturados.

Não incluir pagamentos pendentes nem voltar a faturar montantes já abrangidos por documentos anteriores.

A distribuição dos montantes pelas linhas fiscais deverá respeitar os requisitos do fornecedor e as regras fiscais aplicáveis.

## 11.8. Dados do cliente

Utilizar:

- Nome ou denominação social.
- NIF, quando fornecido.
- Morada de faturação.
- Código postal.
- Localidade.
- País.

Quando não existir NIF, utilizar a identificação de Consumidor Final adequada ao enquadramento fiscal e suportada pelo fornecedor.

Não inventar identificadores fiscais.

## 11.9. Download

O PDF deve estar disponível através da própria plataforma.

Não redirecionar o utilizador para o Moloni.

O endpoint de download deverá:

- Identificar o documento.
- Verificar a autorização de acesso.
- Obter o PDF armazenado ou recuperá-lo através do plugin.
- Devolver diretamente o ficheiro.

O acesso deve ser protegido.

## 11.10. Notificação

Após a emissão confirmada, enviar um e-mail ao cliente com:

- Referência da encomenda.
- Identificação da fatura.
- Link direto para download.

Uma falha de e-mail não deve provocar nova emissão.

## 11.11. Persistência

Guardar:

- Identificador interno.
- Fornecedor responsável.
- Identificador externo.
- Número e série.
- Encomenda.
- Pagamentos ou valores faturados.
- Valor.
- Data.
- Estado.
- Referência do PDF.

A desativação do fornecedor não deve impedir a consulta dos documentos históricos.

## 11.12. Tratamento de erros

Garantir:

- Idempotência.
- Novas tentativas seguras.
- Reconciliação de resultados incertos.
- Ausência de documentos duplicados.
- Registo de auditoria.

## 11.13. Extensibilidade

A introdução de novos fornecedores não deve exigir alterações nos botões de faturação, no módulo de encomendas, no histórico ou no serviço de e-mail.

---

# 12. Gestão de Expedições e Integração Modular com Transportadoras

## 12.1. Objetivo

Implementar um sistema modular de cálculo de portes e gestão de expedições.

Inicialmente, integrar o CTT Expresso.

O sistema deverá suportar várias transportadoras ativas simultaneamente por loja.

As operações de checkout e fulfillment devem utilizar um serviço central independente dos fornecedores.

## 12.2. Contrato comum

Os plugins devem permitir, conforme as capacidades do fornecedor:

- Consultar serviços de entrega.
- Calcular portes.
- Criar expedições.
- Obter referências de envio.
- Gerar etiquetas.
- Recuperar etiquetas.
- Consultar informações de transporte.

Cada fornecedor deve encapsular a respetiva API.

## 12.3. Configuração

Disponibilizar:

**Configurações → Métodos de entrega**

A lista deverá apresentar os plugins instalados.

Inicialmente:

- CTT Expresso.

Cada plugin deverá apresentar:

- Nome.
- Estado de ativação.
- Opção para ativar ou desativar.
- Configurações.
- Estado da ligação, quando verificável.

### Múltiplos fornecedores

Uma loja poderá manter várias transportadoras ativas.

Ativar um plugin não deverá desativar os restantes.

As configurações e credenciais devem estar isoladas por loja.

O CTT Expresso estará disponível de origem, ficando operacional após a introdução das credenciais necessárias.

## 12.4. Plugin CTT Expresso

Implementar a comunicação com a API oficial contratada para:

1. Autenticação.
2. Consulta de serviços.
3. Cálculo de portes.
4. Criação de expedições.
5. Referências de transporte.
6. Geração e recuperação de etiquetas.
7. Consulta de informações de envio, quando suportada.
8. Tratamento de erros.

O frontend não deverá aceder diretamente à API externa.

## 12.5. Portes no checkout

### Fluxo

1. O cliente seleciona a morada de entrega.
2. O frontend solicita os portes ao backend.
3. O serviço central identifica os plugins ativos.
4. Consulta os serviços elegíveis.
5. Normaliza as respostas.
6. Devolve as opções disponíveis.
7. O cliente seleciona o método de entrega.

O cálculo deve considerar os dados exigidos pela transportadora, como origem, destino, peso e dimensões.

Não inventar preços quando não existir uma cotação válida.

### Múltiplas transportadoras

Agregar as opções válidas de todos os fornecedores ativos.

Uma falha isolada não deverá impedir a apresentação das opções das restantes transportadoras.

Se nenhuma opção estiver disponível, informar o cliente adequadamente.

### Persistência

Guardar na encomenda:

- Transportadora selecionada.
- Serviço escolhido.
- Preço dos portes.
- Informações necessárias à expedição.

## 12.6. Fulfillment

O botão **Enviar encomenda** deverá respeitar as regras do ponto 10.

Ao clicar, apresentar uma modal com:

- Produtos ainda não totalmente enviados.
- Fotografia.
- Nome.
- SKU.
- Quantidade encomendada.
- Quantidade enviada.
- Quantidade pendente.
- Quantidade a expedir.
- Serviço de transporte.

A quantidade selecionada não pode ultrapassar a quantidade pendente.

## 12.7. Criação da expedição

Após confirmação:

1. Validar as condições administrativas e financeiras.
2. Validar as quantidades.
3. Identificar a transportadora.
4. Preparar os dados da expedição.
5. Solicitar a criação através do plugin.
6. Guardar a referência de transporte.
7. Obter a etiqueta.
8. Registar os produtos e as quantidades expedidas.
9. Recalcular `FulfillmentStatus`.
10. Registar a operação no histórico.
11. Produzir o evento necessário à notificação do cliente.

Não marcar produtos como enviados sem uma operação válida.

## 12.8. Expedições parciais

Uma encomenda poderá possuir várias expedições independentes.

### Exemplo

Uma encomenda contém 10 unidades.

O administrador envia 4.

O sistema deverá apresentar:

- Encomendadas: 10.
- Enviadas: 4.
- Pendentes: 6.
- `FulfillmentStatus = PARTIALLY_FULFILLED`.

O botão continuará disponível quando as condições de pagamento estiverem satisfeitas.

Quando as restantes 6 unidades forem enviadas:

- Enviadas: 10.
- Pendentes: 0.
- `FulfillmentStatus = FULFILLED`.

## 12.9. Histórico das expedições

Cada expedição deve guardar:

- Identificador.
- Encomenda.
- Transportadora.
- Serviço.
- Produtos e quantidades.
- Referência de transporte.
- Data.
- Estado operacional.
- Etiquetas.

Não substituir expedições anteriores.

## 12.10. Etiquetas

Após a criação da expedição, disponibilizar:

- Visualização.
- Download.
- Impressão.

O ficheiro deve ser obtido através da plataforma, sem obrigar o administrador a aceder ao portal externo.

## 12.11. Entregas

O acompanhamento da entrega deverá ocorrer ao nível de cada expedição.

Guardar os eventos e informações de rastreio disponibilizados pelo fornecedor.

Permitir identificar quando:

- Uma expedição ainda está em trânsito.
- Uma expedição foi entregue.
- Parte da encomenda foi entregue.
- Todas as expedições foram entregues.

Não criar um quarto estado principal da encomenda.

O estado de entrega não deve substituir o `FulfillmentStatus`.

## 12.12. Notificações

Produzir eventos de expedição parcial, expedição integral e entrega confirmada para o módulo de notificações.

Os e-mails devem incluir os produtos efetivamente enviados e os dados de rastreio disponíveis.

## 12.13. Tratamento de erros

- Não criar expedições duplicadas.
- Não marcar produtos como enviados sem confirmação.
- Permitir novas tentativas seguras.
- Reconciliar operações externas de resultado incerto.
- Preservar os registos anteriores.

## 12.14. Extensibilidade

A introdução de uma nova transportadora deve exigir apenas:

1. Implementação do contrato comum.
2. Registo do plugin.
3. Configuração.
4. Ativação na loja.

Checkout e gestão de encomendas não devem conter dependências diretas do CTT Expresso.

# 13. Notificações por E-mail ao Cliente

## 13.1. Objetivo

Implementar um sistema centralizado de notificações por e-mail, orientado a eventos de negócio.

As notificações devem informar o cliente sobre os acontecimentos relevantes da sua encomenda.

O sistema deverá ser independente dos módulos de encomendas, pagamentos, faturação e expedições.

## 13.2. Eventos

| Evento | Notificação |
| --- | --- |
| Encomenda criada | Confirmação da encomenda |
| Pagamento liquidado | Confirmação de pagamento |
| Pagamento complementar solicitado | Instruções de pagamento |
| Expedição parcial | Confirmação dos produtos enviados |
| Expedição integral | Confirmação de envio |
| Entrega confirmada | Confirmação de entrega |
| Encomenda cancelada | Confirmação de cancelamento |
| Reembolso concluído | Confirmação de reembolso |
| Fatura emitida | Disponibilização da fatura |

Os e-mails devem ser acionados pelos eventos efetivamente ocorridos, não apenas porque uma encomenda foi guardada com determinado estado.

## 13.3. Confirmação de encomenda

Quando uma encomenda for criada, enviar um e-mail contendo:

- Referência.
- Data.
- Produtos.
- Quantidades.
- Preços unitários.
- Total por produto.
- Subtotal.
- Portes.
- Total final.
- Situação do pagamento.

Quando existir um valor pendente e uma operação Stripe disponível, apresentar o botão **Pagar encomenda**.

O link deve corresponder ao montante em dívida.

## 13.4. Confirmação de pagamento

Quando um pagamento individual for liquidado, enviar um e-mail com:

- Referência da encomenda.
- Valor recebido.
- Método de pagamento, quando disponível.
- Valor ainda pendente, quando aplicável.

Como uma encomenda pode ter vários pagamentos, cada liquidação distinta deve poder gerar a sua própria notificação.

A liquidação parcial não deve ser apresentada como pagamento integral da encomenda.

## 13.5. Pagamento complementar

Quando o administrador utilizar **Enviar instruções de pagamento**, enviar um e-mail com:

- Referência da encomenda.
- Montante pendente.
- Método selecionado.
- Instruções manuais ou link Stripe.

Um pagamento manual já liquidado deverá originar uma confirmação de pagamento, não novas instruções para o cliente pagar.

## 13.6. Expedição parcial

Após uma expedição parcial confirmada, enviar:

- Referência da encomenda.
- Informação sobre o envio parcial.
- Produtos e quantidades dessa expedição.
- Produtos ou quantidades ainda pendentes.
- Transportadora.
- Código de rastreio, quando disponível.
- Link de acompanhamento, quando disponível.

Cada expedição parcial independente deverá produzir a respetiva notificação.

## 13.7. Expedição integral

Quando a última expedição concluir o envio de todas as unidades, enviar um e-mail contendo:

- Confirmação da expedição integral.
- Produtos e quantidades incluídos no envio.
- Transportadora.
- Código de rastreio.
- Link de acompanhamento.

Quando existirem várias expedições, preservar as referências de rastreio correspondentes.

## 13.8. Confirmação de entrega

A confirmação de entrega deve resultar dos registos de transporte e não de uma alteração do `OrderStatus`.

Quando a entrega integral for confirmada, enviar um e-mail contendo:

- Referência da encomenda.
- Confirmação da entrega.
- Data, quando disponível.
- Mensagem de agradecimento.

Não enviar uma confirmação de entrega integral enquanto existirem expedições ainda por entregar.

## 13.9. Cancelamento

Quando `OrderStatus` passar para `CANCELLED`, enviar:

- Referência da encomenda.
- Confirmação do cancelamento.
- Data.
- Informação financeira relevante, quando aplicável.

Não afirmar que foi efetuado um reembolso se este ainda não tiver sido concluído.

## 13.10. Reembolso

Após a conclusão efetiva de um reembolso monetário, enviar:

- Referência da encomenda.
- Valor reembolsado.
- Método.
- Referência da operação, quando disponível.

Os reembolsos parciais devem ser identificados como tal.

Para operações Stripe ainda em processamento, utilizar uma notificação que indique que o reembolso foi iniciado, sem afirmar que o cliente já recebeu o dinheiro.

Os códigos promocionais devem utilizar uma comunicação própria, identificando-os como crédito comercial.

## 13.11. Fatura disponível

Após uma emissão fiscal confirmada, enviar:

- Referência da encomenda.
- Número ou referência da fatura.
- Botão **Descarregar fatura**.

O download deve ocorrer através da plataforma, sem redirecionamento para o Moloni ou outro fornecedor.

## 13.12. Serviço central de notificações

O sistema deverá:

1. Receber o evento.
2. Identificar a loja e o destinatário.
3. Selecionar o modelo.
4. Preparar os dados.
5. Enviar o e-mail.
6. Registar o resultado.

Preferencialmente, utilizar processamento assíncrono.

Uma falha temporária no serviço de e-mail não deve impedir a conclusão da operação comercial.

## 13.13. Modelos de e-mail

Os modelos devem:

- Utilizar a identidade visual da loja.
- Apresentar o logótipo.
- Ser responsivos.
- Utilizar dados reais da encomenda.
- Respeitar a moeda.
- Utilizar o idioma aplicável, quando disponível.
- Apresentar botões apenas quando relevantes.

A alteração de um modelo não deverá exigir modificações nas regras de negócio.

## 13.14. Histórico e idempotência

Registar:

- Tipo de notificação.
- Evento de origem.
- Encomenda.
- Destinatário.
- Data.
- Estado de envio.
- Identificador do fornecedor de e-mail, quando disponível.
- Informações de erro.

A repetição do mesmo evento não deve provocar e-mails duplicados.

Eventos distintos do mesmo tipo devem continuar a gerar notificações independentes.

---

# 14. Validação, Reserva e Reposição de Stock

## 14.1. Objetivo

Implementar um serviço centralizado de gestão de stock, garantindo que a plataforma apenas aceita encomendas quando existirem quantidades disponíveis.

O serviço deve controlar:

- Validação na criação.
- Desconto de stock.
- Alterações de quantidades.
- Cancelamentos.
- Reposições.
- Histórico de movimentos.

## 14.2. Validação antes da criação

Antes de registar a encomenda e iniciar o pagamento Stripe:

1. Identificar todos os produtos e quantidades.
2. Consultar o stock disponível.
3. Validar a disponibilidade.
4. Rejeitar a operação se algum produto não tiver stock suficiente.
5. Criar a encomenda se todos estiverem disponíveis.
6. Registar `OrderStatus = OPEN`.
7. Registar `PaymentStatus = PENDING`.
8. Registar `FulfillmentStatus = UNFULFILLED`.
9. Descontar imediatamente as quantidades do stock disponível.
10. Iniciar a criação do pagamento Stripe.

A validação e o desconto devem ser atómicos.

Duas encomendas concorrentes não poderão consumir as mesmas unidades disponíveis.

## 14.3. Desconto na criação

O stock é descontado quando a encomenda é criada, antes da liquidação do pagamento.

### Exemplo

- Stock inicial: 15 unidades.
- Quantidade encomendada: 4.
- Stock disponível após a criação: 11.

O pagamento continua pendente, mas as 4 unidades já não estão disponíveis para novas encomendas.

Quando o pagamento for liquidado, não deverá ocorrer outro desconto.

## 14.4. Adição de produtos

Quando o administrador adicionar um produto ou aumentar a quantidade:

1. Validar o stock adicional necessário.
2. Impedir a alteração se não existir disponibilidade.
3. Descontar apenas a diferença.
4. Atualizar a encomenda.
5. Recalcular o estado financeiro, quando necessário.
6. Recalcular o estado de expedição, quando necessário.
7. Registar o movimento.

### Exemplo

Quantidade anterior: 2.

Nova quantidade: 5.

Descontar apenas 3 unidades adicionais.

## 14.5. Redução de quantidades

Quando o administrador reduzir a quantidade ou remover um produto, repor a diferença que ainda não tenha sido reposta.

### Exemplo

Quantidade anterior: 5.

Nova quantidade: 3.

Repor 2 unidades.

A operação deverá respeitar as restrições de modificação de produtos já expedidos.

Não modificar retroativamente os registos de transporte.

## 14.6. Cancelamento

Quando o `OrderStatus` passar de `OPEN` para `CANCELLED`, repor imediatamente todas as quantidades anteriormente descontadas e ainda não repostas.

Esta regra aplica-se mesmo quando:

- A encomenda já foi paga.
- A encomenda foi parcialmente enviada.
- Todos os produtos foram enviados.
- Parte dos produtos foi entregue.
- Todos os produtos foram entregues.

Não aguardar pela devolução física.

### Processamento

1. Identificar os produtos.
2. Consultar os movimentos anteriores.
3. Calcular as quantidades líquidas ainda descontadas.
4. Repor essas quantidades.
5. Registar os movimentos.
6. Confirmar o cancelamento.

A operação deve ser idempotente.

A repetição do cancelamento não pode aumentar novamente o stock.

## 14.7. Encomendas sem pagamento

Não implementar cancelamento automático por falta de pagamento.

Uma encomenda poderá permanecer em:

- `OrderStatus = OPEN`.
- `PaymentStatus = PENDING`.

Sem limite de tempo definido.

As quantidades descontadas deverão continuar indisponíveis enquanto a encomenda permanecer ativa.

O stock não deverá ser libertado automaticamente devido ao tempo decorrido.

## 14.8. Pagamentos complementares

A existência de novos pagamentos não deve provocar movimentos de stock.

O stock é alterado exclusivamente em função da operação comercial que modificou os produtos ou quantidades.

### Exemplo

1. Uma encomenda contém 2 unidades.
2. O cliente paga integralmente.
3. O administrador adiciona uma unidade.
4. O sistema desconta uma unidade adicional.
5. O `PaymentStatus` passa para `PARTIALLY_PAID`.
6. O cliente liquida o valor complementar.
7. O `PaymentStatus` passa para `PAID`.

A última operação não provoca qualquer desconto adicional.

## 14.9. Falhas de pagamento

Se a encomenda for criada e o stock descontado, mas a criação da operação Stripe falhar:

- Não duplicar a encomenda.
- Não descontar novamente o stock.
- Permitir recuperar a operação de pagamento.
- Manter o histórico.
- Não cancelar automaticamente a encomenda.

## 14.10. Movimentos de stock

Guardar:

- Produto ou variante.
- Encomenda.
- Tipo de movimento.
- Quantidade.
- Data e hora.
- Origem.
- Identificador da operação.
- Utilizador ou processo responsável.

Distinguir descontos, reposições e correções.

Não eliminar movimentos históricos.

## 14.11. Concorrência e consistência

Garantir:

- Stock disponível não negativo.
- Operações atómicas.
- Proteção contra concorrência.
- Idempotência.
- Prevenção de descontos duplicados.
- Prevenção de reposições duplicadas.
- Consistência entre encomendas e movimentos de stock.

Nenhum módulo deverá modificar diretamente o stock contornando o serviço central.

## 14.12. Integração com os três estados

O desconto de stock ocorre na criação da encomenda, independentemente de o pagamento estar pendente.

A liquidação de um pagamento não altera o stock.

A expedição não provoca novo desconto, pois as quantidades já foram retiradas da disponibilidade.

O cancelamento administrativo executa a reposição definida neste ponto.

O `FulfillmentStatus` e os registos de transporte devem ser preservados para auditoria, mesmo quando a encomenda for cancelada.

## 14.13. Critérios de aceitação

1. Validar o stock antes de criar a encomenda.
2. Descontar na criação.
3. Não descontar novamente na liquidação.
4. Descontar apenas quantidades adicionais.
5. Repor diferenças após reduções.
6. Repor todas as quantidades elegíveis após cancelamento.
7. Aplicar a reposição mesmo após expedição ou entrega.
8. Não cancelar automaticamente encomendas sem pagamento.
9. Preservar todos os movimentos.
10. Garantir consistência concorrente.
11. Impedir operações duplicadas.
12. Permitir recuperar falhas de criação de pagamentos.

---

# 15. Gestão de Reembolsos Totais e Parciais

## 15.1. Objetivo

Implementar um sistema centralizado de gestão de reembolsos, permitindo devolver total ou parcialmente os valores anteriormente pagos.

O sistema deverá suportar:

1. Transferência bancária manual.
2. Crédito através de código promocional.
3. Reembolso automático através do Stripe.

Os reembolsos devem ser independentes do `OrderStatus`.

Uma encomenda pode estar cancelada e continuar paga até que o reembolso seja efetivamente realizado.

## 15.2. Situações elegíveis

Permitir reembolsos quando:

- Uma encomenda for cancelada.
- Um produto for removido.
- A quantidade de um produto for reduzida.
- Um produto estiver indisponível.
- Ocorrer uma devolução aprovada.
- Existir outro motivo de negócio autorizado.

O montante deverá ser validado em função dos pagamentos efetivamente recebidos e do valor aprovado para devolução.

## 15.3. Reembolso total

Permitir devolver integralmente o saldo pago e ainda não reembolsado.

### Exemplo

1. O cliente paga 150 €.
2. A encomenda é cancelada.
3. O `OrderStatus` passa para `CANCELLED`.
4. O `PaymentStatus` permanece `PAID` até ocorrer o reembolso.
5. O administrador inicia o reembolso de 150 €.
6. Após a conclusão integral, o `PaymentStatus` passa para `REFUNDED`.

O cancelamento não deve executar automaticamente o reembolso.

## 15.4. Reembolso parcial

Permitir devolver apenas parte dos valores.

### Exemplo

1. O cliente compra duas unidades de 50 €.
2. Paga 100 €.
3. Uma unidade é removida antes da expedição.
4. O novo total passa para 50 €.
5. O sistema identifica 50 € elegíveis para devolução.
6. O administrador inicia um reembolso parcial.
7. Após a conclusão, o estado financeiro deverá refletir o reembolso realizado, preservando os saldos detalhados.

## 15.5. Modal de reembolso

Ao clicar em **Reembolso**, apresentar:

- Referência da encomenda.
- Total atual.
- Total recebido.
- Total anteriormente reembolsado.
- Reembolsos em processamento.
- Montante máximo reembolsável.
- Valor pretendido.
- Motivo.
- Modalidade.

Antes da confirmação, apresentar um resumo da operação.

## 15.6. Transferência bancária manual

Permitir introduzir:

- Valor.
- Referência da transferência.
- Descrição.

O administrador realiza a transferência fora da plataforma.

Depois, regista e confirma a operação.

O sistema deve:

1. Validar o montante.
2. Criar o registo.
3. Guardar a referência.
4. Atualizar os saldos.
5. Atualizar o estado financeiro agregado.
6. Registar a operação.
7. Enviar a notificação.

Não executar automaticamente transferências bancárias nesta modalidade.

## 15.7. Código promocional

Permitir emitir um código promocional como alternativa de compensação, mediante aceitação do cliente e quando aplicável.

### Comportamento

1. Selecionar Código promocional.
2. Introduzir o valor.
3. Gerar um código aleatório e único.
4. Associá-lo ao cliente.
5. Registar o valor.
6. Guardar a operação.
7. Enviar um e-mail com o código e as condições.

As regras de utilização, validade, acumulação e utilização parcial serão definidas no módulo de códigos promocionais.

Um código promocional deve ser tratado como crédito comercial, não como dinheiro devolvido à conta bancária.

Não deve reduzir automaticamente o total dos reembolsos monetários apenas por ter sido emitido.

## 15.8. Stripe

Permitir reembolsos automáticos através da API oficial do Stripe.

### Condições

- Existir pagamento Stripe liquidado.
- O pagamento pertencer à encomenda.
- Existir saldo ainda reembolsável.
- O montante solicitado não ultrapassar o saldo elegível.

Não utilizar uma transação Stripe não relacionada para reembolsar um pagamento manual.

### Processamento

1. Identificar os pagamentos Stripe elegíveis.
2. Selecionar os pagamentos de origem.
3. Calcular o saldo reembolsável.
4. Validar o valor.
5. Criar o reembolso através da API.
6. Guardar o identificador externo.
7. Atualizar o estado da operação.
8. Acompanhar os eventos do Stripe.
9. Registar a conclusão ou falha.
10. Notificar o cliente.

Não criar links de pagamento para reembolsar valores.

O reembolso deve ser associado ao pagamento original e processado para o método de origem, conforme suportado pelo Stripe.

## 15.9. Múltiplos reembolsos

Permitir vários reembolsos parciais sobre o mesmo pagamento, desde que a soma não ultrapasse o valor ainda reembolsável.

Quando uma encomenda tiver vários pagamentos, permitir distribuir o reembolso pelas transações elegíveis.

Preservar a associação entre cada reembolso e o respetivo pagamento de origem.

## 15.10. Estados individuais dos reembolsos

Utilizar:

| Identificador | Designação |
| --- | --- |
| `PENDING` | Pendente |
| `PROCESSING` | Em processamento |
| `COMPLETED` | Concluído |
| `FAILED` | Falhou |
| `CANCELLED` | Cancelado |

O estado individual do reembolso deve ser independente do `PaymentStatus` agregado.

## 15.11. Listagem

Apresentar:

- Referência.
- Modalidade.
- Valor.
- Data.
- Estado.
- Identificador externo.
- Ação Visualizar.

Nos detalhes, apresentar também o motivo, a descrição, o responsável e os pagamentos associados.

## 15.12. Notificações

### Transferência bancária

Após confirmação, informar:

- Valor.
- Método.
- Referência da operação.

### Código promocional

Enviar:

- Valor do crédito.
- Código.
- Condições de utilização.

### Stripe

Quando o reembolso for iniciado, informar que está em processamento e que será encaminhado para o método de pagamento original.

Quando a operação for concluída, permitir enviar a confirmação correspondente.

Não afirmar que o cliente já recebeu os fundos enquanto o reembolso estiver pendente.

## 15.13. Consistência financeira

Preservar:

- Pagamentos originais.
- Reembolsos individuais.
- Identificadores externos.
- Montantes reembolsados.
- Montantes ainda reembolsáveis.
- Créditos promocionais emitidos.
- Histórico de operações.

Não modificar retroativamente os pagamentos originais para representar reembolsos.

## 15.14. Integração com faturação

Um reembolso não deverá eliminar ou modificar faturas anteriormente emitidas.

Quando existir necessidade de regularização fiscal, utilizar o sistema de faturação ativo para emitir o documento adequado, como uma nota de crédito.

As regras fiscais específicas serão definidas separadamente.

## 15.15. Integração com stock

Um reembolso não deve, por si só, provocar movimentos de stock.

A reposição continua a obedecer ao ponto 14.

O cancelamento ou a alteração dos produtos pode gerar movimentos de stock, mas a devolução financeira não deverá gerar uma segunda reposição.

## 15.16. Erros e idempotência

O sistema deve:

- Impedir reembolsos acima do saldo elegível.
- Evitar operações duplicadas.
- Utilizar idempotência nas chamadas Stripe.
- Permitir novas tentativas seguras.
- Reconciliar operações de resultado desconhecido.
- Registar falhas.
- Não repetir reembolsos por falhas de e-mail.

## 15.17. Critérios de aceitação

1. Permitir reembolsos totais.
2. Permitir reembolsos parciais.
3. Registar transferências bancárias manuais.
4. Emitir códigos promocionais como compensação.
5. Processar reembolsos Stripe.
6. Associar reembolsos às transações originais.
7. Validar os limites financeiros.
8. Atualizar os estados financeiros agregados.
9. Preservar o histórico.
10. Enviar notificações.
11. Não duplicar movimentos de stock.
12. Garantir idempotência.
13. Preservar faturas e documentos anteriores.

# 16. Condições e Limites para Modificação de Encomendas

## 16.1. Objetivo

Implementar um mecanismo de modificação de encomendas que permita alterar produtos, quantidades, moradas e portes de envio, garantindo a consistência financeira, do stock e das expedições.

Sempre que uma encomenda for modificada, o sistema deverá:

1. Validar se a modificação é permitida.
2. Validar a disponibilidade de stock.
3. Recalcular os valores dos produtos.
4. Permitir ao administrador decidir como tratar os portes.
5. Determinar o novo total da encomenda.
6. Comparar o novo total com os pagamentos liquidados.
7. Identificar valores adicionais a cobrar ou valores elegíveis para reembolso.
8. Apresentar um resumo antes da confirmação.
9. Guardar as alterações autorizadas.
10. Atualizar os estados financeiros e de expedição, quando necessário.
11. Apresentar automaticamente a modal de pagamento complementar quando a modificação criar dívida.
12. Registar todas as operações no histórico.

O sistema não deverá executar cobranças ou reembolsos automaticamente sem uma ação explícita do administrador.

## 16.2. Condições para permitir modificações

A ação **Modificar** deverá estar disponível quando:

- `OrderStatus = OPEN`.
- `FulfillmentStatus = UNFULFILLED` ou `PARTIALLY_FULFILLED`.

Não deverá estar disponível quando:

- `OrderStatus = CANCELLED`.
- `OrderStatus = ARCHIVED`.
- `FulfillmentStatus = FULFILLED`.

O `PaymentStatus` não deverá impedir, por si só, a modificação.

Assim, uma encomenda poderá ser modificada estando com pagamento pendente, parcialmente paga, integralmente paga ou parcialmente reembolsada, desde que as restantes regras de negócio sejam satisfeitas.

## 16.3. Alterações permitidas

A funcionalidade deverá permitir:

1. Adicionar produtos.
2. Remover produtos.
3. Aumentar quantidades.
4. Diminuir quantidades.
5. Alterar a morada de entrega.
6. Alterar a morada de faturação.
7. Recalcular os portes.
8. Definir manualmente o valor dos portes.

A interface deverá permitir visualizar os valores anteriores e os novos valores.

## 16.4. Validação das quantidades

### Adição de produtos

Ao adicionar produtos ou aumentar quantidades:

1. Validar a disponibilidade de stock.
2. Impedir a alteração se não existir quantidade suficiente.
3. Descontar apenas as quantidades adicionais.
4. Registar os movimentos de stock.

### Remoção de produtos

Ao remover produtos ou diminuir quantidades:

1. Identificar a diferença.
2. Repor as quantidades correspondentes no stock, conforme o ponto 14.
3. Atualizar o total.
4. Registar os movimentos.

### Produtos parcialmente enviados

Não permitir reduzir a quantidade encomendada para um valor inferior ao número de unidades já expedidas.

**Exemplo:**

Uma encomenda contém 10 unidades de um produto.

Já foram expedidas 4 unidades.

O administrador poderá reduzir a quantidade para 4 ou mais unidades, mas não para 3.

Os registos das expedições anteriores deverão permanecer inalterados.

## 16.5. Gestão dos portes durante a modificação

Sempre que uma encomenda for modificada, o administrador deverá poder decidir como tratar os portes.

Disponibilizar três opções:

1. Manter portes atuais.
2. Recalcular portes.
3. Definir portes manualmente.

O sistema não deverá impor automaticamente o recálculo dos portes em todas as modificações.

### 16.5.1. Manter portes atuais

Quando esta opção for selecionada:

- Preservar o valor atualmente cobrado.
- Não consultar novamente as transportadoras.
- Não alterar o valor dos portes na encomenda.
- Recalcular apenas os restantes valores modificados.

### 16.5.2. Recalcular portes

Quando o administrador selecionar **Recalcular portes**, utilizar o serviço central de métodos de entrega definido no ponto 12.

O cálculo deverá considerar:

- Custos das expedições já realizadas.
- Produtos e quantidades ainda por enviar.
- Morada de entrega atualizada.
- Método de entrega aplicável.
- Peso e dimensões dos produtos pendentes.

Preservar os custos de transporte das expedições anteriores.

Calcular uma nova cotação apenas para os produtos ainda pendentes de envio.

**Fórmula:**

Novos portes totais = Custos das expedições anteriores + Nova cotação dos produtos pendentes

Diferença de portes = Novos portes totais − Portes anteriormente cobrados

A diferença deverá ser considerada no recálculo financeiro.

### Exemplo

Uma encomenda possui portes de 10 €.

Já foi realizada uma expedição com custo registado de 6 €.

Após adicionar um produto, a nova cotação dos produtos ainda pendentes corresponde a 8 €.

O sistema deverá calcular:

- Expedições anteriores: 6 €.
- Nova cotação: 8 €.
- Novos portes totais: 14 €.
- Portes anteriormente cobrados: 10 €.
- Diferença: +4 €.

Os 4 € serão incluídos no novo valor da encomenda.

Se o cliente já tiver pago o total anterior, poderá existir um pagamento complementar.

### Diferença negativa

Se os portes recalculados forem inferiores aos anteriormente cobrados, o total da encomenda deverá diminuir.

Caso o valor líquido recebido seja superior ao novo total, a diferença poderá originar um reembolso.

### 16.5.3. Botão Recalcular portes

Disponibilizar o botão **Recalcular portes** durante a edição.

Ao clicar:

1. Identificar os produtos e quantidades atualmente selecionados.
2. Identificar as quantidades ainda por enviar.
3. Preservar os custos das expedições anteriores.
4. Solicitar uma cotação ao serviço central de transportadoras.
5. Calcular o novo valor.
6. Atualizar a simulação financeira.
7. Apresentar a diferença ao administrador.

A utilização deste botão não deverá guardar automaticamente a encomenda.

### 16.5.4. Definir portes manualmente

Permitir ao administrador introduzir diretamente o valor total dos portes.

Disponibilizar um campo editável:

**Valor dos portes**

O valor manual deverá substituir o valor anteriormente calculado para efeitos de cobrança ao cliente.

Os custos efetivos das expedições anteriores deverão permanecer preservados.

A alteração manual deverá ficar registada no histórico.

### 16.5.5. Seleção ao guardar

Ao guardar, respeitar a opção escolhida:

- Manter o valor atual.
- Aplicar o valor recalculado.
- Aplicar o valor manual.

A opção deverá aparecer claramente no resumo de confirmação.

### 16.5.6. Independência das transportadoras

O módulo de modificação não deverá comunicar diretamente com o CTT Expresso ou outro fornecedor.

O recálculo deverá utilizar exclusivamente o serviço central de métodos de entrega.

Se a cotação falhar, apresentar o erro ao administrador.

Não utilizar preços inventados.

O administrador poderá manter os portes atuais ou definir um valor manual válido.

## 16.6. Recálculo financeiro

Após modificar produtos, quantidades ou portes, recalcular o total.

Considerar:

- Subtotal atualizado.
- Portes selecionados.
- Descontos aplicáveis.
- Total atual.
- Pagamentos liquidados.
- Reembolsos concluídos.
- Valores pendentes.

Identificar:

1. Valor adicional a cobrar.
2. Valor elegível para devolver.
3. Ausência de diferença financeira.

O cálculo deve considerar os pagamentos efetivamente liquidados, sem contabilizar pagamentos pendentes como dinheiro recebido.

## 16.7. Modificação que aumenta o valor

Quando o novo total ultrapassar o valor líquido recebido, identificar o montante por pagar.

### Exemplo

1. O cliente paga uma encomenda de 100 €.
2. O administrador adiciona um produto de 25 €.
3. Os portes aumentam 4 €.
4. O novo total passa para 129 €.
5. O valor recebido permanece em 100 €.
6. O sistema identifica 29 € em dívida.
7. O `PaymentStatus` passa para `PARTIALLY_PAID`.

O `OrderStatus` permanece `OPEN`.

O `FulfillmentStatus` deverá ser recalculado apenas quando a modificação afetar as quantidades por enviar.

### Abertura automática da modal

**Após guardar com sucesso uma modificação que crie um valor adicional por pagar, abrir automaticamente a modal de pagamento complementar.**

Não será necessário o administrador clicar manualmente no botão **Enviar instruções de pagamento**.

A modal deverá apresentar:

- Referência da encomenda.
- Total atualizado.
- Valor já liquidado.
- Valor adicional por pagar.
- Opções para solicitar o pagamento.

## 16.8. Modal de pagamento complementar

A modal deverá permitir escolher entre três opções:

1. **Pagamento manual.**
2. **Pagamento via Stripe.**
3. **Enviar mais tarde.**

O administrador deverá poder decidir como pretende solicitar o pagamento adicional.

### 16.8.1. Pagamento manual

Quando o administrador selecionar Pagamento manual, apresentar uma caixa de texto para escrever as instruções.

O administrador poderá indicar, por exemplo:

- Dados para transferência bancária.
- Referência Multibanco.
- Outro procedimento externo à plataforma.

### Exemplo de instruções

"Foi adicionado um produto à sua encomenda, originando um valor adicional de 25 €. Para concluir o pagamento, efetue uma transferência para o IBAN indicado, utilizando a referência da encomenda."

O administrador deverá poder editar o texto antes de o enviar.

### Envio

Ao confirmar:

1. Validar o valor pendente.
2. Preparar a mensagem.
3. Enviar o e-mail ao cliente.
4. Registar a solicitação no histórico.
5. Preservar o `PaymentStatus` até à confirmação do pagamento.

O envio de instruções manuais não deverá marcar automaticamente o valor como liquidado.

Após a receção do dinheiro, o administrador poderá utilizar **Adicionar pagamento** para registar a transação efetivamente realizada.

### 16.8.2. Pagamento via Stripe

Quando o administrador selecionar Stripe:

1. Identificar o montante adicional em dívida.
2. Verificar se já existe uma operação de cobrança válida para esse mesmo montante.
3. Criar ou reutilizar uma operação Stripe elegível.
4. Obter o link de pagamento.
5. Associar a referência da operação à encomenda.
6. Preparar o e-mail.
7. Enviar o link ao cliente.
8. Registar a solicitação no histórico.

O link deverá corresponder ao valor efetivamente pendente.

### Confirmação do pagamento

A liquidação deverá ser confirmada através dos mecanismos de integração do Stripe.

Após a confirmação:

- Atualizar o pagamento individual.
- Recalcular o `PaymentStatus`.
- Registar a transação.
- Enviar a confirmação de pagamento ao cliente.

A criação ou o envio do link não deverá ser interpretado como pagamento liquidado.

### 16.8.3. Enviar mais tarde

Quando o administrador selecionar **Enviar mais tarde**:

- Fechar a modal.
- Manter a modificação guardada.
- Manter o valor adicional em dívida.
- Não criar automaticamente uma nova operação de cobrança Stripe.
- Não enviar instruções por e-mail.
- Não marcar o pagamento como liquidado.

O administrador poderá posteriormente utilizar o botão **Enviar instruções de pagamento**, disponível no ecrã de gestão da encomenda.

### Regra de reabertura

Se o administrador abandonar a modal sem escolher uma modalidade, a encomenda deverá permanecer modificada e a dívida deverá continuar registada.

O sistema não poderá eliminar o valor em dívida por a modal ter sido fechada.

## 16.9. Modificação que diminui o valor

Quando o novo total for inferior ao valor líquido recebido, identificar o excedente.

### Exemplo

1. O cliente paga 100 €.
2. O administrador remove um produto de 30 €.
3. Os portes permanecem iguais.
4. O novo total passa para 70 €.
5. O sistema identifica 30 € elegíveis para devolução.

O administrador poderá iniciar um reembolso.

A modificação não deverá executar automaticamente a devolução do dinheiro.

## 16.10. Modalidades de reembolso

Quando existir um valor elegível para devolver, disponibilizar:

1. Transferência bancária manual.
2. Código promocional.
3. Stripe.

As operações deverão utilizar o serviço central de reembolsos definido no ponto 15.

A modificação da encomenda e a execução do reembolso são operações independentes.

## 16.11. Reembolso manual por transferência bancária

Apresentar:

- Valor do reembolso.
- Referência ou identificador da transferência.
- Descrição da operação.

O administrador realiza a transferência fora da plataforma.

Depois, regista e confirma os dados.

### Processamento

1. Validar o montante.
2. Guardar a referência.
3. Guardar a descrição.
4. Confirmar a realização da transferência.
5. Registar o reembolso.
6. Atualizar os saldos.
7. Enviar a confirmação ao cliente.

Não executar automaticamente a transferência bancária.

## 16.12. Compensação através de código promocional

Permitir oferecer ao cliente um código promocional correspondente ao valor aprovado para compensação, mediante aceitação do cliente, quando aplicável.

### Comportamento

1. Selecionar Código promocional.
2. Introduzir o valor.
3. Solicitar a criação ao módulo de promoções.
4. Gerar um código único e aleatório.
5. Associar o código ao cliente.
6. Registar a compensação.
7. Enviar o código por e-mail.

As regras de validade, acumulação e utilização serão definidas no futuro módulo de códigos promocionais.

O código deverá ser tratado como crédito comercial, não como transferência monetária.

## 16.13. Reembolso automático via Stripe

A modalidade Stripe apenas deverá estar disponível quando existir um pagamento Stripe liquidado com saldo reembolsável.

### Condições

- Pagamento Stripe pertencente à encomenda.
- Pagamento efetivamente liquidado.
- Saldo ainda reembolsável.
- Montante solicitado dentro do limite elegível.

Não permitir utilizar o Stripe para reembolsar pagamentos realizados exclusivamente por transferência bancária externa.

### Processamento

1. Identificar os pagamentos Stripe elegíveis.
2. Identificar a transação original.
3. Calcular o saldo reembolsável.
4. Validar o montante.
5. Solicitar o reembolso através da API Stripe.
6. Guardar o identificador.
7. Acompanhar o estado.
8. Registar a conclusão ou falha.
9. Atualizar os saldos.
10. Notificar o cliente.

Não criar links de pagamento para reembolsos.

O reembolso deverá ser executado sobre a transação original, através do mecanismo disponibilizado pelo Stripe.

## 16.14. Notificações dos reembolsos

### Transferência bancária

Após confirmação, enviar:

- Referência da encomenda.
- Valor reembolsado.
- Método.
- Descrição registada pelo administrador.

### Código promocional

Enviar:

- Referência da encomenda.
- Valor do crédito.
- Código.
- Condições de utilização.

### Stripe

Quando o reembolso for iniciado, informar:

- Referência da encomenda.
- Valor.
- Estado de processamento.
- Informação de que será utilizado o método de pagamento original.

Após a conclusão, poderá ser enviada uma confirmação definitiva.

Não afirmar que os fundos já foram recebidos enquanto o reembolso estiver pendente.

## 16.15. Resumo antes da confirmação

Antes de guardar as modificações, apresentar uma comparação:

| Campo | Antes | Depois |
| --- | --- | --- |
| Produtos | Lista original | Lista modificada |
| Quantidades | Originais | Atualizadas |
| Subtotal | Valor anterior | Novo valor |
| Portes | Valor anterior | Valor escolhido |
| Total | Total anterior | Novo total |
| Valor recebido | Liquidado | Liquidado |
| Diferença | — | A cobrar ou devolver |

Apresentar também:

- Produtos adicionados.
- Produtos removidos.
- Quantidades alteradas.
- Moradas modificadas.
- Método de definição dos portes.
- Custos das expedições anteriores.
- Nova cotação, quando aplicável.
- Diferença financeira.
- Movimentos de stock previstos.

O administrador deverá confirmar explicitamente as alterações.

## 16.16. Confirmação e persistência

Após a confirmação:

1. Validar novamente as condições.
2. Validar quantidades e stock.
3. Validar os portes selecionados.
4. Persistir as alterações.
5. Executar os movimentos de stock.
6. Atualizar os totais.
7. Recalcular `PaymentStatus`.
8. Recalcular `FulfillmentStatus`, quando aplicável.
9. Preservar pagamentos e expedições anteriores.
10. Registar a alteração no histórico.

### Tratamento após guardar

Quando o resultado financeiro indicar:

- **Valor adicional a pagar:** abrir automaticamente a modal de pagamento complementar.
- **Valor elegível para reembolso:** disponibilizar a ação de reembolso.
- **Sem diferença financeira:** concluir normalmente a operação.

A falha no envio das instruções de pagamento não deverá reverter uma modificação já confirmada.

Nesse caso, a dívida permanecerá registada e o administrador poderá repetir o envio.

## 16.17. Relação com faturas emitidas

As modificações não deverão eliminar ou alterar faturas anteriormente emitidas.

Quando existir necessidade de regularização fiscal, utilizar o sistema de faturação ativo definido no ponto 11.

Os documentos fiscais de regularização deverão respeitar as regras aplicáveis.

## 16.18. Histórico de alterações

Registar:

- Data e hora.
- Utilizador responsável.
- Produtos adicionados e removidos.
- Quantidades anteriores e novas.
- Moradas alteradas.
- Portes anteriores.
- Novos portes.
- Método de definição dos portes.
- Custos das expedições anteriores.
- Nova cotação, quando aplicável.
- Total anterior.
- Novo total.
- Diferença financeira.
- Movimentos de stock.
- Pagamentos complementares associados.
- Instruções de pagamento enviadas.
- Reembolsos associados.

O histórico deverá permitir reconstruir as operações efetuadas.

## 16.19. Tratamento de erros

O sistema deverá:

- Impedir modificações não autorizadas.
- Impedir quantidades superiores ao stock disponível.
- Impedir reduções abaixo das quantidades já expedidas.
- Rejeitar valores monetários inválidos.
- Não aceitar cotações inválidas como válidas.
- Não criar pagamentos duplicados.
- Não criar links Stripe duplicados indevidamente.
- Não executar reembolsos duplicados.
- Não executar movimentos de stock duplicados.
- Permitir novas tentativas seguras.
- Preservar o histórico.

Se ocorrer uma falha antes da confirmação, manter os dados anteriormente válidos.

Se uma operação externa posterior falhar, preservar a modificação confirmada e registar a situação pendente.

## 16.20. Critérios de aceitação

A funcionalidade estará concluída quando:

1. Apenas encomendas elegíveis puderem ser modificadas.
2. For possível adicionar e remover produtos.
3. For possível aumentar e reduzir quantidades.
4. For possível alterar moradas.
5. O stock for validado.
6. As expedições anteriores forem preservadas.
7. O administrador puder manter os portes existentes.
8. O administrador puder recalcular os portes.
9. O recálculo considerar apenas os produtos pendentes de envio.
10. Os custos das expedições anteriores forem preservados.
11. O administrador puder definir os portes manualmente.
12. A opção escolhida for respeitada ao guardar.
13. O novo total for corretamente calculado.
14. O sistema identificar valores adicionais a cobrar.
15. O sistema identificar valores elegíveis para reembolso.
16. Os pagamentos anteriores permanecerem inalterados.
17. O `PaymentStatus` for atualizado corretamente.
18. O `FulfillmentStatus` refletir as quantidades enviadas.
19. A modal de pagamento complementar abrir automaticamente após uma modificação que crie dívida.
20. O administrador puder escolher entre pagamento manual, Stripe e Enviar mais tarde.
21. As instruções manuais puderem ser escritas pelo administrador.
22. Os links Stripe corresponderem ao valor efetivamente pendente.
23. Os e-mails serem enviados após a confirmação da modalidade.
24. A opção Enviar mais tarde preservar a dívida sem enviar notificações.
25. For possível solicitar posteriormente o pagamento através do botão existente.
26. For possível realizar reembolsos manuais, por código promocional ou Stripe.
27. Todas as alterações ficarem registadas.
28. As operações forem idempotentes e consistentes.

**Instrução final para a IA:** implementar um mecanismo de modificação de encomendas que valide produtos, quantidades e stock e permita ao administrador manter, recalcular ou definir manualmente os portes. O recálculo deverá preservar os custos das expedições anteriores e acrescentar a cotação dos produtos ainda por enviar. Após guardar uma modificação que crie dívida, abrir automaticamente uma modal que permita solicitar o pagamento complementar por método manual ou Stripe, ou adiar o envio das instruções. Preservar os três estados independentes, os pagamentos anteriores, os registos de expedição e o histórico de todas as operações.

# 17. Gestão de Clientes e Encomendas sem Registo

## 17.1. Objetivo

Implementar um sistema interno de gestão de clientes que permita identificar e acompanhar os clientes da plataforma, sem exigir que estes criem uma conta para efetuar encomendas.

A plataforma deverá suportar compras sem registo (*guest checkout*).

Durante o checkout, o cliente deverá apenas fornecer os dados necessários para processar a encomenda, incluindo:

- Nome.
- Apelido.
- E-mail.
- Telefone.
- Morada de faturação.
- Morada de entrega.

Não será necessário criar uma palavra-passe, iniciar sessão ou possuir uma conta.

Apesar disso, a plataforma deverá criar e manter uma entidade interna de cliente, permitindo associar todas as encomendas efetuadas com o mesmo e-mail.

## 17.2. Distinção entre Cliente e Conta de Utilizador

A arquitetura deverá distinguir:

### Cliente

Entidade interna que representa uma pessoa que efetuou uma compra.

Contém os dados necessários à identificação e ao relacionamento comercial.

### Conta de utilizador

Entidade de autenticação que permitiria ao cliente iniciar sessão e aceder a funcionalidades reservadas.

**Nesta fase, não será implementado um sistema de contas de clientes.**

Consequentemente:

- Não haverá registo obrigatório.
- Não haverá palavra-passe.
- Não haverá autenticação de clientes no checkout.
- Não haverá área reservada de cliente.
- Não haverá recuperação de palavra-passe.
- Não haverá APIs públicas de gestão de contas de clientes.

A entidade Cliente deverá, contudo, ser estruturada para permitir uma futura associação a contas autenticadas, caso essa funcionalidade seja introduzida posteriormente.

## 17.3. Entidade Cliente

Criar uma entidade interna responsável por representar os clientes de cada loja.

### Campos principais

| Campo | Descrição |
| --- | --- |
| ID | Identificador interno único |
| Nome | Primeiro nome do cliente |
| Apelido | Apelido do cliente |
| E-mail | Endereço eletrónico |
| Telefone | Número de contacto |
| Data de criação | Data do primeiro registo |
| Data de atualização | Última atualização dos dados |

O identificador interno deverá ser independente do endereço de e-mail.

O e-mail será utilizado como critério de identificação durante o checkout, mas não deverá ser utilizado como chave primária da entidade.

### Isolamento por loja

Os clientes devem pertencer à respetiva loja.

A mesma pessoa poderá existir como cliente em lojas diferentes, sem que os dados sejam automaticamente partilhados entre elas.

A pesquisa e associação de clientes deverá respeitar o isolamento multi-tenant da plataforma.

## 17.4. Identificação automática durante o checkout

Sempre que uma encomenda for criada através do frontend, o backend deverá verificar se já existe um cliente com o e-mail fornecido.

### Fluxo

1. O utilizador preenche os dados no checkout.
2. O frontend envia os dados ao backend.
3. O backend valida o endereço de e-mail.
4. Normaliza o e-mail de acordo com as regras de comparação definidas.
5. Pesquisa a existência de um cliente com esse e-mail na loja atual.
6. Se existir, reutiliza o respetivo identificador.
7. Se não existir, cria automaticamente uma nova entidade Cliente.
8. Associa a encomenda ao cliente identificado ou criado.
9. Continua o processamento normal da encomenda.

### Cliente existente

Quando o e-mail já estiver associado a um cliente, a nova encomenda deverá ser associada à entidade existente.

Não deverá ser criado um segundo cliente para o mesmo e-mail dentro da mesma loja.

### Novo cliente

Quando o e-mail não existir, criar automaticamente o cliente com os dados fornecidos.

O processo deverá ocorrer sem qualquer intervenção adicional do utilizador.

## 17.5. Prevenção de duplicações

O sistema deve impedir a criação de clientes duplicados devido a operações concorrentes.

### Regras

- Utilizar o e-mail normalizado para a pesquisa.
- Garantir a unicidade do e-mail por loja.
- Implementar a operação de procura ou criação de forma segura perante concorrência.
- Não criar um novo cliente quando dois checkouts simultâneos utilizarem o mesmo e-mail.

A normalização deverá evitar duplicações por diferenças triviais, como maiúsculas e minúsculas, sem aplicar transformações específicas de fornecedores de e-mail que possam associar incorretamente endereços diferentes.

## 17.6. Associação entre clientes e encomendas

Implementar uma relação de um para muitos:

**Cliente → Encomendas**

Um cliente poderá possuir várias encomendas.

Cada encomenda deverá estar associada a um cliente interno.

A associação deverá utilizar o identificador interno do cliente, e não apenas o endereço de e-mail.

### Exemplo

Um cliente efetua três compras utilizando:

`cliente@exemplo.pt`

O sistema deverá criar apenas uma entidade Cliente e associar as três encomendas a essa entidade.

O histórico deverá permitir consultar todas as encomendas desse cliente.

## 17.7. Moradas de faturação e entrega

As moradas de faturação e entrega deverão pertencer às encomendas.

Não criar, nesta fase, uma lista permanente de moradas associadas diretamente à entidade Cliente.

### Regras

- Cada encomenda deverá guardar a sua própria morada de faturação.
- Cada encomenda deverá guardar a sua própria morada de entrega.
- Alterações posteriores não deverão modificar retroativamente as moradas de encomendas anteriores.
- A entidade Cliente deverá guardar apenas os seus dados principais.

As moradas de uma encomenda anterior poderão ser reutilizadas como sugestão ao criar uma nova encomenda manualmente, conforme definido adiante.

## 17.8. Menu Clientes

Adicionar ao menu principal do e-commerce a opção:

**Clientes**

Ao clicar, abrir o ecrã de gestão de clientes da loja.

O ecrã deverá apresentar uma lista paginada dos clientes registados.

## 17.9. Estado vazio da listagem

Se não existirem clientes:

- Apresentar uma ilustração SVG no lugar da tabela.
- Exibir a mensagem: "Ainda não existem clientes."
- Respeitar a identidade visual da plataforma.

## 17.10. Listagem de clientes

Quando existirem clientes, apresentar uma tabela com:

| Campo | Descrição |
| --- | --- |
| Nome | Nome e apelido do cliente |
| E-mail | Endereço eletrónico |
| Ações | Botão Editar |

### Paginação

A listagem deverá apresentar, no máximo, 50 clientes por página.

Implementar paginação no backend.

Não carregar todos os clientes para posteriormente realizar a paginação apenas no frontend.

### Pesquisa

Disponibilizar uma barra de pesquisa por e-mail.

A pesquisa deverá ser executada sobre os clientes pertencentes à loja atual.

Os resultados também deverão respeitar a paginação de 50 registos.

## 17.11. Ecrã de detalhe do cliente

Ao clicar em **Editar**, abrir o ecrã de detalhe do cliente selecionado.

Este ecrã deverá apresentar:

### Informações do cliente

- Nome.
- Apelido.
- E-mail.
- Telefone.

Os campos deverão poder ser editados por um administrador autorizado.

### Histórico de encomendas

Apresentar uma tabela com todas as encomendas associadas ao cliente.

Não apresentar uma secção permanente de moradas de faturação ou entrega na ficha do cliente, uma vez que esses dados pertencem às encomendas.

## 17.12. Edição dos dados do cliente

Permitir modificar:

- Nome.
- Apelido.
- E-mail.
- Telefone.

### Alteração de e-mail

O sistema deverá validar se o novo e-mail já está associado a outro cliente da mesma loja.

Não permitir criar uma duplicação através da alteração do e-mail.

A alteração do e-mail da entidade Cliente não deve modificar retroativamente os endereços utilizados nas encomendas anteriores.

As alterações deverão ser registadas para efeitos de auditoria.

## 17.13. Histórico de encomendas do cliente

No ecrã de detalhe, apresentar uma tabela com:

| Campo | Descrição |
| --- | --- |
| Referência | Identificador da encomenda |
| Data | Data de criação |
| Total | Valor total |
| Estado | Estado administrativo |
| Pagamento | Estado financeiro |
| Expedição | Estado de expedição |
| Ações | Botão Visualizar |

### Paginação

Apresentar, no máximo, 50 encomendas por página.

A paginação deverá ocorrer no backend.

### Pesquisa

Disponibilizar pesquisa por referência da encomenda.

A pesquisa deverá considerar apenas as encomendas associadas ao cliente atual.

### Visualização

Ao clicar em **Visualizar**, encaminhar o administrador para o ecrã de gestão da encomenda selecionada.

## 17.14. Estado vazio do histórico

Quando o cliente não tiver encomendas associadas:

- Apresentar uma ilustração SVG.
- Exibir a mensagem: "Este cliente ainda não tem encomendas."

A ilustração deverá respeitar a identidade visual da plataforma.

## 17.15. Criar encomenda a partir da ficha do cliente

No ecrã de detalhe do cliente, disponibilizar o botão:

**Criar encomenda**

Este botão deverá permitir criar uma nova encomenda manualmente em nome do cliente selecionado.

### Comportamento

Ao clicar:

1. Abrir o formulário de criação de encomenda.
2. Associar automaticamente o cliente selecionado.
3. Preencher o nome, apelido, e-mail e telefone com os dados do cliente.
4. Consultar a última encomenda do cliente, quando existir.
5. Permitir reutilizar as moradas de faturação e entrega dessa encomenda.
6. Permitir selecionar os produtos e quantidades.
7. Calcular os valores.
8. Permitir confirmar a criação.

### Reutilização de moradas

Se existir uma encomenda anterior, o sistema poderá utilizar as respetivas moradas para pré-preencher os campos da nova encomenda.

As moradas deverão continuar editáveis.

A criação de uma nova encomenda não deverá modificar os dados da encomenda anterior.

Se o cliente não possuir encomendas, os campos de morada deverão começar vazios.

## 17.16. Criação manual através do menu Encomendas

No módulo **Encomendas**, disponibilizar também a ação:

**Criar encomenda**

Ao clicar, abrir um formulário de criação manual.

### Dados solicitados

O formulário deverá permitir introduzir:

- Nome.
- Apelido.
- E-mail.
- Telefone.
- Morada de faturação.
- Morada de entrega.
- Produtos.
- Quantidades.
- Método de entrega.
- Informações necessárias ao pagamento.

O formulário deverá seguir as mesmas regras de validação utilizadas no checkout.

## 17.17. Identificação automática na criação manual

Quando uma encomenda for criada manualmente, aplicar a mesma lógica de identificação de clientes utilizada no checkout.

### Cliente existente

Se o e-mail já estiver associado a um cliente da loja:

- Reutilizar a entidade existente.
- Associar a nova encomenda a esse cliente.

### Cliente inexistente

Se não existir:

1. Criar automaticamente a entidade Cliente.
2. Guardar os dados principais.
3. Associar a encomenda ao novo cliente.

O administrador não deverá ser obrigado a criar previamente uma ficha de cliente.

## 17.18. Seleção de produtos

Durante a criação manual, permitir:

- Procurar produtos.
- Selecionar variantes.
- Definir quantidades.
- Consultar preços.
- Calcular subtotais.
- Calcular os portes.
- Consultar o total.

O stock deverá ser validado através do serviço central definido no ponto 14.

Não permitir criar uma encomenda com quantidades superiores às disponíveis, salvo se uma regra específica de venda sem stock for definida futuramente.

## 17.19. Pagamentos nas encomendas manuais

As encomendas manuais deverão utilizar o mesmo modelo financeiro das encomendas criadas no checkout.

Após a criação, o administrador poderá:

- Registar um pagamento manual.
- Enviar instruções de pagamento.
- Criar um link de pagamento Stripe.

A encomenda deverá iniciar com:

- `OrderStatus = OPEN`.
- `PaymentStatus = PENDING`, se não existir pagamento liquidado.
- `FulfillmentStatus = UNFULFILLED`.

O stock deverá ser descontado na criação, conforme o ponto 14.

As regras de faturação, expedição e reembolso serão as mesmas das restantes encomendas.

## 17.20. APIs e arquitetura interna

Nesta fase, não implementar APIs públicas de registo, autenticação ou gestão de contas de clientes.

Contudo, o backend deverá possuir os serviços e endpoints administrativos internos necessários para:

- Listar clientes.
- Pesquisar clientes por e-mail.
- Consultar detalhes.
- Atualizar dados.
- Consultar encomendas associadas.
- Criar encomendas manualmente.
- Identificar ou criar clientes durante o checkout.

Esses endpoints administrativos devem exigir autorização adequada.

A criação automática de clientes deverá ser uma operação interna do domínio, reutilizada pelo checkout e pela criação manual de encomendas.

A arquitetura deverá permitir a introdução futura de contas autenticadas sem exigir a substituição da entidade Cliente.

## 17.21. Segurança e privacidade

O e-mail deverá ser utilizado para associar encomendas à entidade interna Cliente, mas não deverá, por si só, conceder acesso ao histórico de compras.

**Conhecer o e-mail de outra pessoa não deve permitir consultar as suas encomendas.**

Como não existirá uma conta autenticada nesta fase:

- Não disponibilizar endpoints públicos que revelem se um e-mail pertence a determinado cliente.
- Não devolver o histórico de encomendas durante o checkout.
- Não apresentar dados de compras anteriores a um visitante apenas por ter introduzido um e-mail.
- Proteger os endpoints administrativos.
- Garantir isolamento por loja.
- Respeitar as regras aplicáveis de proteção de dados pessoais.

A associação interna por e-mail não constitui autenticação nem prova de titularidade do endereço.

## 17.22. Consistência e concorrência

O sistema deverá garantir:

- Unicidade do e-mail normalizado por loja.
- Criação concorrente segura.
- Ausência de clientes duplicados.
- Associação correta das encomendas.
- Preservação dos dados históricos.
- Paginação eficiente.
- Isolamento entre lojas.

Se dois processos tentarem criar simultaneamente um cliente com o mesmo e-mail, apenas uma entidade deverá ser criada.

Ambas as encomendas deverão ser associadas ao mesmo cliente.

## 17.23. Critérios de aceitação

A funcionalidade estará concluída quando:

1. O checkout permitir comprar sem registo.
2. Não for necessário criar palavra-passe.
3. O sistema identificar automaticamente clientes por e-mail.
4. Clientes inexistentes forem criados automaticamente.
5. Clientes existentes forem reutilizados.
6. Não forem criados clientes duplicados na mesma loja.
7. Cada encomenda ficar associada a um cliente.
8. Existir uma opção Clientes no menu.
9. A lista vazia apresentar uma ilustração SVG.
10. A listagem apresentar nome, e-mail e botão Editar.
11. A listagem possuir paginação de 50 clientes.
12. Existir pesquisa por e-mail.
13. A ficha permitir consultar e editar os dados principais.
14. A ficha apresentar o histórico de encomendas.
15. O histórico possuir paginação de 50 encomendas.
16. Existir pesquisa por referência.
17. O histórico vazio apresentar uma ilustração SVG.
18. Cada encomenda possuir um botão de visualização.
19. For possível criar uma encomenda a partir da ficha do cliente.
20. Os dados principais forem pré-preenchidos.
21. As moradas da última encomenda puderem ser reutilizadas.
22. For possível criar uma encomenda diretamente no módulo Encomendas.
23. A criação manual aplicar as mesmas regras de identificação de clientes.
24. A criação manual validar stock e calcular os valores.
25. As encomendas manuais utilizarem os mesmos processos de pagamento, faturação, expedição e reembolso.
26. Não forem implementadas APIs públicas de contas de clientes nesta fase.
27. Os dados estiverem protegidos e isolados por loja.

**Instrução final para a IA:** implementar um sistema interno de gestão de clientes sem exigir registo ou autenticação no checkout. Sempre que uma encomenda for criada, identificar o cliente através do e-mail normalizado no contexto da loja, reutilizando a entidade existente ou criando uma nova quando necessário. Implementar o menu Clientes, a listagem paginada, a ficha de detalhe e o histórico de encomendas. Permitir criar encomendas manualmente a partir da ficha do cliente ou diretamente no módulo Encomendas, reutilizando os dados do cliente e, opcionalmente, as moradas da última encomenda. Preservar a separação entre a entidade Cliente e uma futura conta de utilizador autenticada.

**Promoções**

# 1. Sistema de Promoções e Motor de Regras

## 1.1. Objetivo

Implementar um sistema de promoções flexível, extensível e configurável, permitindo criar campanhas promocionais com diferentes condições, benefícios e métodos de aplicação.

O sistema deverá suportar:

- Códigos promocionais.
- Promoções automáticas.
- Descontos fixos.
- Descontos percentuais.
- Descontos sobre produtos específicos.
- Portes gratuitos.
- Promoções do tipo "Compre X, receba Y".
- Condições baseadas no valor da encomenda.
- Condições baseadas em produtos e quantidades.
- Condições baseadas no e-mail do cliente.
- Limites de utilização.
- Períodos de validade.
- Combinação de promoções.

A implementação deverá utilizar um motor centralizado de avaliação de regras, evitando criar lógica específica para cada campanha.

O sistema deve funcionar de forma independente para cada loja da plataforma.

## 1.2. Estrutura de uma promoção

Cada promoção deverá possuir quatro componentes principais:

1. Método de aplicação.
2. Condições de elegibilidade.
3. Ações ou benefícios.
4. Regras de acumulação.

Adicionalmente, deverá possuir informações administrativas, limites de utilização e período de validade.

Uma promoção poderá conter várias condições e, quando permitido, vários benefícios.

## 1.3. Menu Promoções

Adicionar ao menu principal do e-commerce a opção:

**Promoções**

Ao clicar, apresentar a listagem das promoções registadas na loja.

### Estado vazio

Quando não existirem promoções:

- Apresentar uma ilustração SVG.
- Exibir a mensagem: "Ainda não existem promoções."
- Disponibilizar o botão **Criar promoção**.

### Listagem

Apresentar:

| Campo | Descrição |
| --- | --- |
| Nome | Nome interno da promoção |
| Código | Código promocional, quando existir |
| Método | Automática ou por código |
| Estado | Ativa, Agendada, Inativa ou Expirada |
| Validade | Período de aplicação |
| Utilizações | Quantidade utilizada |
| Ações | Editar |

A listagem deverá permitir pesquisar promoções por nome ou código.

## 1.4. Criação de promoções

Ao clicar em **Criar promoção**, abrir um formulário organizado em secções:

1. Informações gerais.
2. Método de aplicação.
3. Período de validade.
4. Elegibilidade dos clientes.
5. Condições.
6. Benefícios.
7. Limites de utilização.
8. Regras de acumulação.
9. Resumo e confirmação.

O formulário deve permitir configurar promoções simples sem exigir conhecimentos técnicos.

As opções avançadas deverão estar disponíveis quando necessário.

## 1.5. Informações gerais

Cada promoção deverá possuir:

| Campo | Descrição |
| --- | --- |
| ID | Identificador interno |
| Nome | Nome administrativo |
| Código | Identificador promocional |
| Descrição | Descrição interna |
| Estado | Situação da promoção |
| Data inicial | Início da validade |
| Data final | Fim da validade, quando definido |
| Prioridade | Prioridade de avaliação, quando aplicável |

O nome administrativo não precisa corresponder ao texto apresentado no checkout.

## 1.6. Método de aplicação

O sistema deverá suportar dois métodos.

### 1.6.1. Promoção por código

A promoção apenas será aplicada quando o cliente introduzir o respetivo código no carrinho ou checkout.

Exemplo:

`VERAO20`

O cliente introduz o código e o sistema verifica todas as condições.

Se a promoção for válida, aplica o benefício.

Se não for elegível, apresentar uma mensagem adequada.

### 1.6.2. Promoção automática

A promoção deverá ser avaliada automaticamente durante o cálculo do carrinho e do checkout.

Não será necessário introduzir qualquer código.

A promoção poderá continuar a possuir um identificador administrativo, utilizado para relatórios, auditoria e identificação da campanha.

Exemplo:

`CAMPANHA_NATAL_2026`

Esse identificador não precisa de ser apresentado ao cliente.

### Regra comum

Os dois métodos deverão utilizar o mesmo motor de condições e benefícios.

A única diferença será a forma como a promoção é ativada.

## 1.7. Período de validade

Permitir configurar:

- Data e hora de início.
- Data e hora de fim, opcionais.
- Ativação ou desativação manual.

### Regras

- Antes da data inicial, a promoção estará agendada.
- Durante o período configurado, poderá ser aplicada se estiver ativa.
- Após a data final, deverá expirar automaticamente.
- Uma promoção desativada não deverá ser aplicada, mesmo dentro do período de validade.

As datas deverão ser interpretadas de acordo com o fuso horário configurado para a loja.

## 1.8. Elegibilidade dos clientes

Permitir definir a quem se destina a promoção.

### Opções

1. Todos os clientes.
2. Apenas clientes com e-mails específicos.
3. Clientes pertencentes a uma lista de e-mails autorizados.

### E-mail específico

Permitir introduzir um ou vários endereços.

Exemplo:

`cliente@exemplo.pt`

A promoção só poderá ser aplicada quando o e-mail informado no checkout corresponder a um endereço autorizado.

### Integração com a gestão de clientes

A elegibilidade deverá utilizar a entidade Cliente definida no capítulo de gestão de encomendas.

Como a plataforma permite compras sem autenticação, a verificação será efetuada através do e-mail fornecido no checkout.

A associação ao e-mail não deve conceder acesso à conta ou ao histórico de encomendas.

### Recomendação de segurança

Promoções de elevado valor, créditos individuais ou utilizações únicas deverão exigir uma validação adicional da elegibilidade, para evitar que outra pessoa utilize o benefício apenas por conhecer o e-mail do destinatário.

## 1.9. Motor de condições

Implementar um motor de regras responsável por avaliar se uma promoção pode ser aplicada.

Cada promoção poderá conter uma ou várias condições.

### Operadores

As condições deverão suportar:

- Igual a.
- Diferente de.
- Maior que.
- Maior ou igual a.
- Menor que.
- Menor ou igual a.
- Contém.
- Não contém.

Os operadores disponíveis deverão depender do tipo de condição.

## 1.10. Condições baseadas no valor da encomenda

Permitir configurar condições sobre o subtotal elegível dos produtos.

### Exemplos

- Subtotal igual ou superior a 50 €.
- Subtotal superior a 100 €.
- Subtotal entre 100 € e 200 €.

Para condições por intervalo, permitir definir um valor mínimo e máximo.

Por defeito, o subtotal utilizado para testar valores mínimos deverá excluir portes e impostos, salvo se uma regra específica determinar outro comportamento.

O sistema deverá evitar dependências circulares entre descontos e condições de elegibilidade.

## 1.11. Condições baseadas em produtos

Permitir criar condições relacionadas com produtos específicos.

### Tipos

1. O carrinho contém determinado produto.
2. O carrinho não contém determinado produto.
3. O carrinho contém qualquer produto de uma lista.
4. O carrinho contém todos os produtos de uma lista.
5. O cliente compra uma quantidade mínima de determinado produto.
6. O cliente compra uma quantidade exata de determinado produto.
7. O cliente compra determinada quantidade combinada de produtos elegíveis.

### Exemplos

**Produto obrigatório**

Aplicar a promoção quando o Produto A estiver no carrinho.

**Quantidade mínima**

Aplicar quando o cliente comprar pelo menos 3 unidades do Produto A.

**Combinação de produtos**

Aplicar quando o carrinho contiver os produtos A e B.

**Qualquer produto de uma lista**

Aplicar quando existir pelo menos um produto pertencente ao conjunto configurado.

As regras deverão utilizar identificadores internos de produtos ou variantes, não nomes apresentados ao cliente.

## 1.12. Condições baseadas em quantidades

Permitir configurar:

- Quantidade mínima total de produtos.
- Quantidade mínima de um produto específico.
- Quantidade mínima combinada de uma lista.
- Quantidade exata de um produto.
- Quantidade mínima de produtos distintos.

### Exemplo

O cliente deverá comprar pelo menos 5 unidades entre os produtos A, B e C.

O motor deverá somar apenas as quantidades elegíveis.

## 1.13. Combinação de condições

Permitir combinar várias condições através de operadores lógicos.

### Operador AND

Todas as condições devem ser satisfeitas.

Exemplo:

- Subtotal igual ou superior a 100 €.
- E-mail igual a `cliente@exemplo.pt`.
- Carrinho contém o Produto A.

A promoção só será aplicada quando todas forem verdadeiras.

### Operador OR

Basta uma das condições ser satisfeita.

Exemplo:

- Carrinho contém o Produto A.
- OU carrinho contém o Produto B.

### Grupos de condições

A arquitetura deverá suportar grupos aninhados de condições.

Exemplo:

**(Produto A OU Produto B) E subtotal ≥ 100 €**

A interface deverá permitir construir estas regras visualmente, sem exigir que o administrador escreva expressões técnicas.

## 1.14. Motor de benefícios

Cada promoção deverá possuir uma ou várias ações que representam os benefícios concedidos ao cliente.

Os benefícios deverão ser calculados apenas depois de todas as condições de elegibilidade serem satisfeitas.

## 1.15. Desconto fixo sobre a encomenda

Permitir aplicar um valor monetário fixo ao subtotal elegível.

### Exemplo

Subtotal: 100 €.

Desconto: 20 €.

Novo subtotal: 80 €.

O desconto não poderá ultrapassar o valor elegível.

## 1.16. Desconto percentual sobre a encomenda

Permitir aplicar uma percentagem ao subtotal elegível.

### Exemplo

Subtotal: 100 €.

Desconto: 10%.

Valor do desconto: 10 €.

Novo subtotal: 90 €.

A percentagem deverá ser validada para impedir valores negativos ou superiores a 100%.

## 1.17. Desconto fixo sobre produtos

Permitir aplicar um desconto monetário a produtos específicos.

Configurar:

- Produto ou lista de produtos.
- Valor do desconto.
- Aplicação por unidade ou sobre o conjunto elegível.
- Quantidade máxima abrangida, quando aplicável.

### Exemplo

Produto A: 30 € por unidade.

Desconto: 5 € por unidade.

Novo preço elegível: 25 € por unidade.

O sistema deverá impedir que o desconto torne o valor do produto negativo.

## 1.18. Desconto percentual sobre produtos

Permitir aplicar uma percentagem sobre produtos ou variantes específicas.

### Exemplo

Produto A: 50 €.

Desconto: 20%.

Novo valor: 40 €.

Quando existirem vários produtos elegíveis, aplicar a percentagem às linhas configuradas.

## 1.19. Portes gratuitos

Permitir criar promoções que ofereçam entrega gratuita.

### Condições possíveis

- Subtotal mínimo.
- Produto específico.
- Quantidade mínima.
- E-mail elegível.
- Combinação de condições.

### Comportamento

O sistema deverá primeiro obter os portes através do serviço de métodos de entrega.

Depois, aplicar o desconto promocional sobre o valor elegível dos portes.

A promoção não deverá impedir a criação da expedição nem alterar o custo real cobrado pela transportadora à loja.

### Limites opcionais

Permitir configurar um valor máximo de portes abrangido.

Exemplo:

Portes grátis até 10 €.

Caso a entrega custe 15 €, a promoção poderá conceder apenas 10 € de desconto, deixando 5 € a pagar.

O comportamento deverá ser claramente configurável.

## 1.20. Promoções Compre X, Receba Y

Implementar promoções do tipo **Buy X Get Y**.

O sistema deverá permitir definir:

### Condição de compra

- Produto ou produtos que o cliente precisa comprar.
- Quantidade mínima.
- Valor mínimo elegível.
- Possibilidade de combinar produtos diferentes.

### Benefício

- Produto oferecido.
- Quantidade oferecida.
- Desconto percentual sobre o produto oferecido.
- Desconto fixo sobre o produto oferecido.
- Produto totalmente gratuito.

### Exemplos

**Compre 1, receba 1**

Ao comprar uma unidade do Produto A, o cliente recebe uma unidade do Produto B.

**Compre 2, receba 1**

Ao comprar duas unidades do Produto A, recebe uma unidade do Produto B.

**Compre 3, pague 2**

Ao comprar três unidades elegíveis, uma recebe 100% de desconto.

**Compre A e B, receba C**

Quando o carrinho contém os produtos A e B, o cliente recebe o Produto C.

**Compre 2 unidades de A, receba 50% em B**

O benefício é aplicado apenas ao Produto B elegível.

## 1.21. Produtos oferecidos

O sistema deverá suportar produtos oferecidos como parte de uma promoção.

### Regras

- Validar a disponibilidade de stock.
- Identificar os produtos oferecidos.
- Registar as quantidades na encomenda.
- Aplicar o desconto correspondente.
- Incluir os produtos nas expedições.
- Incluir os produtos nos movimentos de stock.
- Preservar a rastreabilidade do benefício.

### Adição automática

A arquitetura deverá permitir adicionar automaticamente produtos oferecidos ao carrinho quando as condições forem satisfeitas.

Quando existirem variantes ou várias opções de produtos oferecidos, o sistema deverá permitir ao cliente selecionar a opção aplicável.

Se a promoção deixar de ser elegível, os benefícios automáticos deverão ser recalculados.

O sistema deverá distinguir produtos adicionados manualmente pelo cliente de produtos adicionados automaticamente pela promoção.

## 1.22. Repetição de benefícios

Permitir configurar quantas vezes o mesmo benefício poderá ser aplicado numa encomenda.

### Exemplo

Promoção:

**Compre 2 unidades do Produto A e receba 1 unidade do Produto B.**

Se o cliente comprar 4 unidades do Produto A:

- Com uma utilização máxima por encomenda, recebe 1 Produto B.
- Com duas utilizações permitidas, recebe 2 unidades do Produto B.

O administrador deverá poder configurar o limite.

## 1.23. Limites de utilização

Permitir configurar:

1. Número máximo de utilizações globais.
2. Número máximo de utilizações por cliente.
3. Número máximo de aplicações por encomenda.
4. Ausência de limite, quando pretendido.

### Limite global

Exemplo:

Código válido para as primeiras 100 utilizações.

Após atingir o limite, não deverá ser aplicado a novas encomendas.

### Limite por cliente

Exemplo:

Uma utilização por cliente.

Utilizar a entidade Cliente e o e-mail normalizado dentro da loja para controlar o limite.

Como não existe autenticação obrigatória, esta restrição não deve ser considerada uma prova absoluta de identidade.

### Concorrência

A validação e a contabilização das utilizações devem impedir que checkouts simultâneos ultrapassem os limites configurados.

As regras de contabilização deverão distinguir uma promoção aplicada numa encomenda de uma promoção efetivamente consumida.

## 1.24. Acumulação de promoções

Permitir definir se uma promoção pode ser combinada com outras.

O sistema deverá distinguir três classes:

1. Descontos sobre produtos.
2. Descontos sobre a encomenda.
3. Descontos sobre portes.

### Configuração

Cada promoção deverá permitir selecionar:

- Não acumular com outras promoções.
- Acumular com descontos de produtos.
- Acumular com descontos sobre a encomenda.
- Acumular com descontos de portes.

### Compatibilidade

A combinação deverá ser permitida apenas quando as regras das promoções envolvidas forem compatíveis.

Não basta uma promoção permitir acumulação se a outra a proibir.

## 1.25. Ordem de aplicação

Recomenda-se a seguinte ordem:

1. Identificar produtos elegíveis.
2. Aplicar benefícios sobre produtos.
3. Calcular o subtotal atualizado.
4. Aplicar descontos sobre a encomenda.
5. Calcular os portes através dos métodos de entrega.
6. Aplicar descontos sobre portes.
7. Calcular os impostos aplicáveis.
8. Apresentar o total final.

O cálculo fiscal deve respeitar o enquadramento aplicável e a forma correta de repartir os descontos pelas linhas da encomenda.

A ordem de cálculo deverá ser centralizada e determinística.

## 1.26. Conflitos entre promoções

Quando duas promoções não puderem ser combinadas, o sistema deverá identificar o conflito.

A política recomendada é selecionar automaticamente a promoção ou combinação permitida que produza o maior benefício monetário para o cliente.

### Exemplo

Promoção A: 10% de desconto.

Promoção B: 20 € de desconto.

Se ambas forem incompatíveis, calcular o benefício de cada uma e aplicar a opção mais vantajosa.

A avaliação deverá considerar o carrinho completo e não apenas o valor nominal de cada promoção.

Se existir um conflito com um código introduzido pelo cliente, apresentar uma mensagem explicativa.

A política exata de prioridade e desempate deve ser determinística.

## 1.27. Limites de descontos

O motor deverá garantir que:

- Nenhuma linha fique com valor negativo.
- Os descontos monetários não ultrapassem os montantes elegíveis.
- Uma unidade não seja utilizada incorretamente várias vezes como benefício da mesma promoção.
- Não sejam oferecidas quantidades superiores às permitidas.
- Não sejam concedidos produtos sem stock quando o controlo de stock for obrigatório.
- Promoções incompatíveis não sejam aplicadas simultaneamente.

## 1.28. Aplicação no carrinho e checkout

O sistema deverá avaliar as promoções quando ocorrerem alterações relevantes no carrinho.

Exemplos:

- Adição de produtos.
- Remoção de produtos.
- Alteração de quantidades.
- Introdução ou remoção de código promocional.
- Alteração do e-mail.
- Alteração da morada que afete os portes.
- Alteração do método de entrega.

### Promoções automáticas

Devem ser avaliadas automaticamente.

### Códigos promocionais

Devem ser avaliados quando o cliente os introduzir.

### Apresentação

O frontend deverá apresentar:

- Promoções aplicadas.
- Valor de cada benefício.
- Desconto total.
- Produtos oferecidos.
- Novo subtotal.
- Portes.
- Total final.

Quando uma promoção deixar de ser elegível, o sistema deverá recalcular os valores e informar o cliente quando necessário.

## 1.29. Validação antes da encomenda

Antes de criar a encomenda e iniciar o pagamento Stripe:

1. Reavaliar todas as promoções.
2. Confirmar as datas de validade.
3. Confirmar os limites de utilização.
4. Confirmar as condições do carrinho.
5. Confirmar a elegibilidade do cliente.
6. Confirmar a disponibilidade dos produtos oferecidos.
7. Recalcular os valores.
8. Validar o total final.
9. Prosseguir com a criação da encomenda.

O backend deverá ser a autoridade final para os cálculos.

Não confiar em descontos ou preços enviados pelo frontend.

## 1.30. Integração com encomendas

Quando uma encomenda for criada, guardar:

- Identificador de cada promoção aplicada.
- Código utilizado, quando aplicável.
- Condições relevantes da aplicação.
- Benefícios concedidos.
- Valor de desconto por linha.
- Valor de desconto sobre a encomenda.
- Desconto nos portes.
- Produtos oferecidos.
- Total final.

As alterações posteriores às promoções não deverão modificar retroativamente os descontos de encomendas já criadas.

## 1.31. Integração com stock

Os produtos oferecidos deverão utilizar as mesmas regras de stock dos produtos comprados.

Na criação da encomenda, o stock deverá ser validado e descontado, incluindo as unidades oferecidas.

Os movimentos de stock deverão respeitar as regras do módulo de encomendas.

Uma promoção não deverá permitir vender ou oferecer unidades indisponíveis.

## 1.32. Integração com faturação

Os descontos devem ser representados corretamente nos dados enviados ao sistema de faturação ativo.

As faturas deverão refletir os valores efetivamente cobrados e os descontos aplicados.

A implementação deverá preservar:

- Preços originais.
- Descontos.
- Valores líquidos.
- Impostos.
- Produtos oferecidos.

A distribuição dos descontos e o tratamento fiscal de produtos gratuitos deverão respeitar as regras aplicáveis.

## 1.33. Códigos promocionais de compensação

O sistema deverá permitir criar códigos promocionais a partir do módulo de reembolsos e compensações definido no capítulo de encomendas.

### Requisitos

- Gerar automaticamente um código único.
- Associá-lo ao cliente.
- Definir o valor.
- Registar a origem da emissão.
- Enviar o código por e-mail.
- Controlar a utilização.
- Preservar o histórico.

Estes códigos deverão permitir distinguir créditos comerciais emitidos como compensação de campanhas promocionais convencionais.

As regras específicas de consumo parcial e saldo remanescente serão definidas posteriormente.

## 1.34. Persistência e auditoria

Cada promoção deverá guardar:

- Identificador.
- Loja.
- Nome.
- Código.
- Método de aplicação.
- Estado.
- Datas.
- Condições.
- Benefícios.
- Regras de acumulação.
- Limites.
- Utilizações.
- Data de criação.
- Data de atualização.

O sistema também deverá manter um histórico das utilizações.

Cada utilização deverá permitir identificar a encomenda e o cliente associados.

## 1.35. Extensibilidade

A arquitetura deverá permitir acrescentar novos tipos de condições e benefícios sem alterar o motor central.

Recomenda-se separar:

- Avaliação de condições.
- Cálculo dos benefícios.
- Resolução de conflitos.
- Contabilização das utilizações.
- Persistência.
- Apresentação no frontend.

Não implementar as promoções através de uma sucessão de condições específicas associadas aos nomes dos códigos.

Os códigos devem identificar promoções configuráveis, não determinar diretamente a lógica de cálculo.

## 1.36. Critérios de aceitação

A funcionalidade estará concluída quando:

1. Existir um menu Promoções.
2. A listagem vazia apresentar uma ilustração SVG.
3. For possível criar e editar promoções.
4. For possível utilizar códigos promocionais.
5. For possível criar promoções automáticas.
6. For possível configurar períodos de validade.
7. For possível limitar utilizações.
8. For possível restringir por e-mail.
9. For possível configurar condições por subtotal.
10. For possível configurar condições por produtos.
11. For possível configurar condições por quantidades.
12. For possível combinar condições com AND e OR.
13. For possível criar descontos fixos.
14. For possível criar descontos percentuais.
15. For possível aplicar descontos a produtos específicos.
16. For possível oferecer portes gratuitos.
17. For possível configurar promoções Compre X, Receba Y.
18. For possível oferecer produtos gratuitos.
19. For possível limitar a repetição dos benefícios.
20. For possível configurar a acumulação.
21. O sistema resolver conflitos de forma determinística.
22. As promoções forem recalculadas no checkout.
23. O backend validar novamente todas as condições antes de criar a encomenda.
24. Os descontos ficarem registados nas encomendas.
25. Os produtos oferecidos respeitarem o controlo de stock.
26. Os documentos fiscais refletirem os descontos.
27. Os códigos de compensação puderem ser criados pelo módulo de reembolsos.
28. Todas as utilizações ficarem registadas.
29. A implementação respeitar o isolamento por loja.
30. O motor permitir a introdução futura de novas condições e benefícios.

**Instrução final para a IA:** implementar um motor de promoções baseado em regras configuráveis, separando método de aplicação, condições de elegibilidade, benefícios e regras de acumulação. Suportar promoções por código e automáticas, descontos fixos e percentuais, produtos oferecidos, portes gratuitos e campanhas Compre X, Receba Y. Todas as promoções deverão ser avaliadas no backend, integradas com o checkout, encomendas, stock e faturação, preservando os valores e as condições aplicadas em cada encomenda.

# 2. Regras de Acumulação, Prioridade e Resolução de Conflitos

## 2.1. Objetivo

Implementar um mecanismo centralizado de resolução de conflitos entre promoções, garantindo que os descontos são aplicados de forma previsível, consistente e financeiramente correta.

O sistema deverá:

1. Identificar todas as promoções elegíveis.
2. Verificar as respetivas regras de acumulação.
3. Determinar as combinações permitidas.
4. Calcular os benefícios de cada combinação.
5. Selecionar a combinação mais vantajosa para o cliente.
6. Aplicar os benefícios selecionados.
7. Apresentar os descontos no carrinho e checkout.
8. Preservar os resultados na encomenda.

O motor deverá funcionar tanto com promoções automáticas como com códigos promocionais.

## 2.2. Classes de descontos

Os benefícios deverão ser classificados em três categorias principais:

| Identificador | Categoria |
| --- | --- |
| `PRODUCT_DISCOUNT` | Desconto sobre produtos |
| `ORDER_DISCOUNT` | Desconto sobre a encomenda |
| `SHIPPING_DISCOUNT` | Desconto sobre portes |

### Descontos sobre produtos

Incluem:

- Percentagem sobre produtos.
- Valor fixo por produto.
- Compre X, receba Y.
- Produtos gratuitos.

### Descontos sobre a encomenda

Incluem:

- Percentagem sobre o subtotal.
- Valor fixo sobre o subtotal.

### Descontos sobre portes

Incluem:

- Portes gratuitos.
- Desconto fixo nos portes.
- Desconto percentual nos portes.

Uma promoção poderá conter benefícios de mais do que uma categoria.

## 2.3. Configuração da acumulação

Cada promoção deverá permitir definir com quais categorias pode ser combinada.

### Opções

- Não acumular com outras promoções.
- Acumular com descontos sobre produtos.
- Acumular com descontos sobre a encomenda.
- Acumular com descontos sobre portes.

A interface deverá disponibilizar estas opções através de controlos simples.

### Regra de compatibilidade

Duas promoções só poderão ser combinadas quando ambas permitirem essa combinação.

A autorização deve ser recíproca.

### Exemplo

Promoção A:

- 10% de desconto no carrinho.
- Permite acumular com descontos sobre produtos.

Promoção B:

- 5 € de desconto no Produto X.
- Não permite acumular com descontos sobre encomendas.

Neste caso, as promoções não poderão ser aplicadas simultaneamente.

## 2.4. Promoções exclusivas

Permitir configurar uma promoção como exclusiva.

Uma promoção exclusiva não poderá ser combinada com outras promoções.

### Exemplo

Promoção A:

- 30% de desconto.
- Exclusiva.

Promoção B:

- Portes gratuitos.

O motor deverá comparar os resultados permitidos e aplicar a opção que produz o menor total a pagar, sem acumular benefícios incompatíveis.

## 2.5. Promoções com vários benefícios

Uma única promoção poderá conter vários benefícios.

### Exemplo

Promoção `NATAL2026`:

- 10% de desconto na encomenda.
- Portes gratuitos.

Estes dois benefícios pertencem à mesma promoção.

O motor deverá tratá-los como um conjunto de benefícios associado a uma única campanha.

### Regra

Não considerar os benefícios internos da mesma promoção como promoções independentes para efeitos de acumulação.

Contudo, a combinação dessa promoção com outra deverá respeitar as classes de todos os seus benefícios.

### Exemplo

A promoção `NATAL2026` inclui:

- `ORDER_DISCOUNT`
- `SHIPPING_DISCOUNT`

Se outra promoção apenas permitir acumulação com descontos sobre encomendas, mas não com descontos sobre portes, não poderá ser combinada com `NATAL2026` na sua configuração atual.

## 2.6. Ordem de aplicação dos benefícios

Para garantir resultados determinísticos, utilizar a seguinte ordem:

1. Identificar os produtos elegíveis.
2. Aplicar descontos sobre produtos.
3. Calcular o subtotal atualizado.
4. Aplicar descontos sobre a encomenda.
5. Calcular os portes através do módulo de entregas.
6. Aplicar descontos sobre portes.
7. Calcular os impostos aplicáveis.
8. Determinar o total final.

A sequência deverá ser centralizada e aplicada consistentemente.

O cálculo fiscal deve respeitar o enquadramento aplicável, incluindo a distribuição dos descontos pelas linhas dos produtos.

## 2.7. Acumulação de descontos sobre produtos

### Produtos diferentes

Permitir acumular descontos de produtos quando estes incidirem sobre linhas diferentes e as promoções forem compatíveis.

### Exemplo

Produto A: 100 €.

Produto B: 50 €.

Promoção 1:

- 10% no Produto A.

Promoção 2:

- 20% no Produto B.

Resultado:

- Produto A: 90 €.
- Produto B: 40 €.
- Total: 130 €.

Ambas as promoções poderão ser aplicadas.

### Mesmo produto

Por defeito, não permitir acumular vários descontos da classe `PRODUCT_DISCOUNT` sobre a mesma unidade de produto.

### Exemplo

Produto A: 100 €.

Promoção 1: 20%.

Promoção 2: 30%.

Se as duas promoções concorrerem sobre a mesma unidade, aplicar apenas a que produzir o maior benefício.

Neste exemplo, aplicar 30%.

Esta restrição evita descontos sucessivos inesperados.

A arquitetura poderá permitir acumulação sobre a mesma unidade futuramente, mediante uma regra específica.

## 2.8. Descontos sobre produtos e sobre encomendas

Permitir combinar descontos sobre produtos com descontos sobre a encomenda, quando ambas as promoções autorizarem essa combinação.

### Exemplo

Produto A: 100 €.

Produto B: 50 €.

Promoção 1:

- 20% sobre o Produto A.

Promoção 2:

- 10% sobre o subtotal atualizado.

Cálculo:

1. Produto A passa para 80 €.
2. Produto B permanece em 50 €.
3. Novo subtotal: 130 €.
4. Desconto de 10%: 13 €.
5. Subtotal final: 117 €.

O desconto sobre a encomenda deverá incidir sobre a base definida depois dos descontos sobre produtos.

## 2.9. Vários descontos sobre a encomenda

Permitir que diferentes descontos da classe `ORDER_DISCOUNT` sejam combinados quando configurados como compatíveis.

Para a versão inicial, utilizar uma base de cálculo comum: o subtotal elegível após os descontos sobre produtos, antes da aplicação dos descontos sobre a encomenda.

### Exemplo

Subtotal elegível: 100 €.

Promoção A: 10%.

Promoção B: 20%.

Ambas são acumuláveis.

Resultado:

- Desconto A: 10 €.
- Desconto B: 20 €.
- Desconto total: 30 €.
- Subtotal final: 70 €.

Não aplicar automaticamente a segunda percentagem sobre o subtotal já reduzido pela primeira.

A utilização de uma base comum deverá evitar que a ordem de processamento altere o resultado.

O total dos descontos não poderá ultrapassar o subtotal elegível.

## 2.10. Descontos sobre portes

Permitir combinar descontos de portes com descontos sobre produtos ou encomendas quando as regras de compatibilidade o permitirem.

### Vários descontos sobre os mesmos portes

Por defeito, aplicar apenas um desconto da classe `SHIPPING_DISCOUNT` sobre a mesma opção de entrega.

Se existirem vários descontos elegíveis, selecionar o mais vantajoso.

### Exemplo

Portes: 12 €.

Promoção A: 5 € de desconto nos portes.

Promoção B: portes gratuitos.

Aplicar a Promoção B, desde que seja compatível com a restante combinação selecionada.

O desconto de portes não poderá ultrapassar o custo de envio cobrado ao cliente.

## 2.11. Promoções Compre X, Receba Y

As promoções `BUY_X_GET_Y` deverão participar no mecanismo de resolução de conflitos.

### Regras

- Identificar as unidades que satisfazem a condição de compra.
- Identificar as unidades elegíveis para receber o benefício.
- Impedir que a mesma unidade seja indevidamente utilizada várias vezes na mesma aplicação.
- Respeitar os limites de repetição.
- Respeitar o stock disponível.
- Evitar benefícios incompatíveis sobre a mesma unidade.

### Exemplo

O cliente compra:

- 2 unidades do Produto A.
- 1 unidade do Produto B.

Promoção:

- Compre 2 unidades de A e receba B gratuitamente.

O motor deverá:

1. Validar as duas unidades de A.
2. Identificar a unidade de B.
3. Aplicar 100% de desconto à unidade de B.
4. Registar o benefício.
5. Impedir que outra promoção incompatível volte a descontar a mesma unidade.

## 2.12. Múltiplas promoções Compre X, Receba Y

Quando duas promoções deste tipo forem elegíveis, o motor deverá verificar se utilizam os mesmos produtos ou unidades.

### Exemplo

Promoção A:

- Compre 2 unidades do Produto X e receba uma unidade do Produto Y.

Promoção B:

- Compre 2 unidades do Produto X e receba uma unidade do Produto Z.

Se ambas utilizarem as mesmas duas unidades de X como condição, não deverão ser acumuladas por defeito.

O motor deverá selecionar a combinação mais vantajosa.

Se existirem quatro unidades de X e ambas as promoções permitirem acumulação, o motor poderá distribuir duas unidades para cada promoção, desde que não reutilize indevidamente as mesmas unidades.

## 2.13. Seleção da melhor combinação

Quando existirem promoções incompatíveis, o sistema deverá avaliar as combinações válidas.

### Objetivo

Selecionar a combinação que produza o menor total a pagar pelo cliente.

### Processo

1. Identificar todas as promoções elegíveis.
2. Identificar as incompatibilidades.
3. Construir as combinações permitidas.
4. Calcular os benefícios.
5. Calcular os totais finais.
6. Selecionar a combinação com o menor total.
7. Aplicar o resultado.

### Exemplo

Carrinho:

- Produtos: 150 €.
- Portes: 10 €.

Promoção A:

- 10% sobre os produtos.
- Total final: 145 €.

Promoção B:

- 20 € de desconto.
- Total final: 140 €.

Promoção C:

- Portes gratuitos.
- Total final: 150 €.

Se as promoções forem exclusivas, selecionar a Promoção B.

Se A e C forem acumuláveis, a combinação produzirá um total de 135 €.

Nesse caso, selecionar A + C.

## 2.14. Prioridade das promoções

Cada promoção poderá possuir um campo administrativo de prioridade.

A prioridade não deverá, por defeito, substituir a regra de seleção do maior benefício.

Deverá ser utilizada como critério de desempate ou em políticas futuras especificamente configuradas.

### Critérios recomendados de desempate

Quando duas combinações produzirem o mesmo total:

1. Preferir uma combinação que inclua o código introduzido explicitamente pelo cliente, quando elegível.
2. Aplicar a prioridade administrativa.
3. Aplicar um critério técnico estável e determinístico.

O resultado não poderá depender da ordem acidental de consulta à base de dados.

## 2.15. Códigos promocionais e promoções automáticas

O motor deverá avaliar simultaneamente:

- Promoções automáticas elegíveis.
- Códigos promocionais introduzidos pelo cliente.

### Regras

Uma promoção automática não deverá impedir automaticamente a utilização de um código promocional.

O motor deverá verificar as regras de acumulação.

### Exemplo

Promoção automática:

- 10% sobre a encomenda.

Código:

- Portes gratuitos.

Se forem compatíveis, aplicar ambos.

Se forem incompatíveis, selecionar a melhor combinação permitida.

### Comunicação

Quando um código introduzido não puder ser aplicado devido a incompatibilidade, apresentar uma mensagem explicativa.

Não apresentar apenas uma mensagem genérica de código inválido quando o código existe e é elegível, mas entra em conflito com outra promoção.

## 2.16. Limites de utilização e concorrência

Os limites definidos no ponto 1 devem ser respeitados independentemente da combinação selecionada.

### Regras

- Não ultrapassar utilizações globais.
- Não ultrapassar utilizações por cliente.
- Não ultrapassar repetições por encomenda.
- Não contabilizar como utilizada uma promoção apenas por ter sido visualizada no carrinho.
- Proteger as operações contra concorrência.

### Momento de contabilização

Recomenda-se distinguir:

1. Promoção elegível.
2. Promoção aplicada ao carrinho.
3. Promoção associada a uma encomenda criada.
4. Promoção consumida definitivamente.

Na criação da encomenda, a utilização deve ficar associada ou reservada à encomenda.

Como o módulo de encomendas não cancela automaticamente encomendas sem pagamento, a utilização reservada deverá permanecer associada à encomenda enquanto esta estiver ativa.

O sistema deverá definir e executar as libertações ou correções necessárias quando ocorrer cancelamento ou modificação da encomenda.

Estas operações devem ser idempotentes.

## 2.17. Alterações no carrinho

O motor deverá reavaliar as promoções quando ocorrerem alterações que possam afetar a elegibilidade.

Exemplos:

- Adição de produto.
- Remoção de produto.
- Alteração de quantidade.
- Introdução de código.
- Remoção de código.
- Alteração de e-mail.
- Alteração da morada.
- Alteração do método de entrega.

A reavaliação deverá utilizar o carrinho atualizado.

Promoções anteriormente elegíveis poderão deixar de o ser.

O sistema deverá remover os benefícios que já não cumprirem as condições.

## 2.18. Produtos oferecidos e alterações no carrinho

Quando uma promoção adicionar automaticamente produtos oferecidos:

- Identificar a origem promocional dessas unidades.
- Distingui-las de unidades adicionadas manualmente.
- Respeitar o stock.
- Recalcular a elegibilidade quando o carrinho mudar.
- Remover ou ajustar os benefícios automáticos quando a condição deixar de ser satisfeita.

### Exemplo

Promoção:

- Compre 2 unidades de A e receba 1 unidade de B.

O cliente adiciona duas unidades de A.

O sistema adiciona uma unidade promocional de B, conforme as regras da campanha.

Se o cliente reduzir A para uma unidade, o benefício deixa de ser elegível.

O sistema deverá remover ou ajustar a unidade promocional de B, sem eliminar indevidamente unidades de B que tenham sido adicionadas manualmente pelo cliente.

## 2.19. Modificações de encomendas existentes

As encomendas deverão preservar os descontos originalmente aplicados.

Quando o administrador modificar uma encomenda, o sistema não deverá aplicar automaticamente novas promoções que não faziam parte da compra original.

As promoções existentes devem permanecer identificadas e os seus valores históricos preservados.

Quando uma modificação afetar produtos ou quantidades que beneficiavam de uma promoção, o sistema deverá identificar o impacto e permitir calcular os novos valores aplicáveis.

A política exata de reavaliação de promoções durante modificações administrativas deverá ser definida separadamente.

## 2.20. Cálculo financeiro

O motor deverá produzir um resultado detalhado que identifique:

- Promoções avaliadas.
- Promoções elegíveis.
- Promoções selecionadas.
- Promoções rejeitadas por incompatibilidade.
- Benefícios por produto.
- Descontos sobre a encomenda.
- Descontos sobre portes.
- Produtos oferecidos.
- Total dos descontos.
- Total final.

O cálculo deverá utilizar precisão monetária adequada.

Não permitir resultados negativos.

## 2.21. Persistência na encomenda

Quando a encomenda for criada, guardar um registo dos benefícios efetivamente aplicados.

Preservar:

- Identificadores das promoções.
- Códigos utilizados.
- Versão ou configuração relevante das regras.
- Benefícios concedidos.
- Valores dos descontos.
- Produtos e unidades abrangidos.
- Total final.

Alterações futuras às promoções não deverão modificar retroativamente os valores históricos das encomendas.

## 2.22. Desempenho

O mecanismo de seleção da melhor combinação não deverá depender de uma pesquisa combinatória ilimitada.

### Requisitos

- Filtrar previamente promoções inelegíveis.
- Identificar incompatibilidades.
- Eliminar combinações redundantes.
- Utilizar limites técnicos configuráveis para proteger o checkout.
- Garantir resultados determinísticos.
- Manter um desempenho adequado mesmo com várias promoções ativas.

Se não for possível avaliar todas as combinações dentro dos limites técnicos, o sistema deverá utilizar uma estratégia explicitamente definida e não afirmar que encontrou a combinação globalmente ótima sem a ter calculado.

O backend deverá ser a autoridade final do cálculo.

## 2.23. Segurança

Não confiar nos valores de desconto enviados pelo frontend.

O backend deverá:

- Reavaliar promoções.
- Validar condições.
- Validar limites.
- Validar combinações.
- Confirmar disponibilidade de stock.
- Recalcular o total.
- Garantir isolamento por loja.

O cliente não poderá modificar os parâmetros de uma promoção através dos pedidos ao backend.

## 2.24. Testes

Implementar testes automatizados para:

- Promoções exclusivas.
- Promoções acumuláveis.
- Descontos em produtos diferentes.
- Descontos concorrentes no mesmo produto.
- Descontos sobre o total.
- Portes gratuitos.
- Promoções Compre X, Receba Y.
- Códigos combinados com promoções automáticas.
- Condições AND e OR.
- Limites de utilização.
- Alterações no carrinho.
- Produtos oferecidos.
- Concorrência.
- Arredondamentos.
- Persistência histórica.

## 2.25. Critérios de aceitação

A implementação estará concluída quando:

1. Existirem classes de descontos para produtos, encomenda e portes.
2. For possível definir regras de acumulação.
3. A compatibilidade for validada reciprocamente.
4. For possível criar promoções exclusivas.
5. Uma promoção puder possuir vários benefícios.
6. A ordem de cálculo for determinística.
7. Descontos sobre produtos diferentes puderem acumular.
8. Descontos incompatíveis sobre a mesma unidade não forem acumulados.
9. Descontos sobre produtos e encomendas puderem combinar quando permitido.
10. Descontos sobre portes respeitarem os limites.
11. Promoções Compre X, Receba Y respeitarem as quantidades.
12. O motor impedir a utilização indevida das mesmas unidades em benefícios incompatíveis.
13. O sistema calcular as combinações permitidas.
14. A melhor combinação elegível for selecionada.
15. Existirem critérios determinísticos de desempate.
16. Códigos e promoções automáticas puderem coexistir.
17. Os limites de utilização forem respeitados.
18. As promoções forem reavaliadas quando o carrinho mudar.
19. Os produtos oferecidos forem corretamente geridos.
20. Os descontos aplicados ficarem preservados nas encomendas.
21. O backend validar todos os cálculos.
22. As operações forem consistentes e idempotentes.
23. Existirem testes automatizados para os principais cenários.

**Instrução final para a IA:** implementar um motor centralizado de resolução de conflitos e acumulação de promoções. As promoções deverão ser classificadas por tipo de benefício, possuir regras explícitas de compatibilidade e ser avaliadas em conjunto para selecionar a combinação permitida que minimize o total a pagar pelo cliente. Garantir cálculos determinísticos, respeito pelos limites de utilização, proteção contra descontos duplicados, integração com o checkout e persistência histórica dos benefícios aplicados.

# 3. Visualização de Promoções e Descontos na Encomenda

## 3.1. Objetivo

Garantir que todas as promoções e descontos aplicados a uma encomenda sejam apresentados de forma clara, detalhada e facilmente identificável no ecrã de gestão da encomenda.

O administrador deverá conseguir identificar:

- Quais as promoções aplicadas.
- Quais os códigos promocionais utilizados.
- Que produtos beneficiaram dos descontos.
- Qual o valor de cada desconto.
- Quais os produtos oferecidos.
- Se foram concedidos portes gratuitos.
- Qual o valor total dos descontos aplicados.

## 3.2. Secção de promoções

Adicionar ao ecrã de gestão da encomenda uma secção denominada:

**Promoções e descontos**

Esta secção deverá apresentar todas as promoções associadas à encomenda.

Para cada promoção, apresentar:

| Campo | Descrição |
| --- | --- |
| Nome | Nome da promoção |
| Código | Código utilizado, quando aplicável |
| Método | Automática ou código promocional |
| Tipo | Produto, encomenda ou portes |
| Benefício | Descrição do desconto concedido |
| Valor | Montante efetivamente descontado |

Uma promoção que conceda vários benefícios deverá permitir identificar cada benefício individualmente.

## 3.3. Descontos na tabela de produtos

Quando um desconto for aplicado diretamente a um produto, essa informação deverá aparecer na respetiva linha da tabela de produtos.

Apresentar:

- Preço unitário original.
- Desconto aplicado.
- Preço unitário após desconto.
- Quantidade.
- Total da linha após desconto.

O valor original poderá ser apresentado visualmente riscado, acompanhado do valor final.

### Exemplo

Produto A:

- Preço original: 50 €.
- Promoção: 20% de desconto.
- Desconto: 10 € por unidade.
- Preço final: 40 €.
- Quantidade: 2.
- Total: 80 €.

## 3.4. Produtos oferecidos

Quando uma promoção oferecer produtos gratuitamente, estes deverão aparecer na tabela de produtos da encomenda.

Apresentar:

- Nome e fotografia.
- SKU.
- Quantidade oferecida.
- Preço original.
- Desconto aplicado.
- Total final: 0 €, quando integralmente oferecido.

Identificar visualmente o produto como:

**Oferta promocional**

O produto deverá continuar a ser considerado nas operações de stock e expedição.

## 3.5. Descontos sobre os portes

Quando uma promoção conceder portes gratuitos ou um desconto no transporte, apresentar:

- Valor original dos portes.
- Desconto aplicado.
- Valor final cobrado.

### Exemplo

- Portes originais: 8 €.
- Promoção: Portes grátis.
- Desconto: −8 €.
- Portes finais: 0 €.

O desconto promocional não deverá eliminar o registo do custo original dos portes.

## 3.6. Resumo financeiro

O resumo financeiro da encomenda deverá discriminar os descontos.

### Exemplo

| Descrição | Valor |
| --- | --- |
| Subtotal original dos produtos | 150,00 € |
| Descontos sobre produtos | −20,00 € |
| Desconto sobre a encomenda | −13,00 € |
| Subtotal após descontos | 117,00 € |
| Portes originais | 8,00 € |
| Desconto nos portes | −8,00 € |
| **Total da encomenda** | **117,00 €** |

Os valores deverão ser apresentados de forma consistente com o cálculo efetivamente realizado.

O resumo deverá permitir identificar o desconto total concedido ao cliente.

## 3.7. Múltiplas promoções

Quando existirem várias promoções aplicadas, apresentar cada uma individualmente.

Não agrupar todos os descontos num único valor sem permitir identificar a sua origem.

O administrador deverá conseguir perceber quais as promoções combinadas e o benefício efetivo de cada uma.

## 3.8. Preservação do histórico

Os descontos devem refletir os valores e as condições efetivamente aplicados no momento da criação ou modificação autorizada da encomenda.

Alterações posteriores à configuração de uma promoção não deverão modificar retroativamente os valores históricos.

A ficha da encomenda deverá consultar os registos promocionais associados à própria encomenda, sem recalcular automaticamente as promoções atuais apenas para apresentar os valores.

## 3.9. Critérios de aceitação

A funcionalidade estará concluída quando:

1. A ficha da encomenda apresentar uma secção de promoções e descontos.
2. Todas as promoções aplicadas forem identificadas.
3. Os códigos promocionais utilizados forem apresentados.
4. Os descontos sobre produtos forem visíveis nas respetivas linhas.
5. Os produtos oferecidos forem identificados.
6. Os descontos sobre portes forem discriminados.
7. O resumo financeiro apresentar os descontos separadamente.
8. As promoções acumuladas forem apresentadas individualmente.
9. O valor total dos descontos for claramente identificável.
10. Os valores históricos forem preservados.

**Instrução final para a IA:** atualizar o ecrã de gestão de encomendas para apresentar explicitamente todas as promoções e descontos aplicados. Discriminar os benefícios por promoção, produto, encomenda e portes, incluindo produtos oferecidos e códigos promocionais utilizados. O resumo financeiro deverá apresentar os valores originais, os descontos e o total final, preservando os valores efetivamente registados na encomenda.

# 3. Visualização de Promoções e Descontos na Encomenda

## 3.1. Objetivo

Garantir que todas as promoções e descontos aplicados a uma encomenda sejam apresentados de forma clara, detalhada e facilmente identificável no ecrã de gestão da encomenda.

O administrador deverá conseguir identificar:

- Quais as promoções aplicadas.
- Quais os códigos promocionais utilizados.
- Que produtos beneficiaram dos descontos.
- Qual o valor de cada desconto.
- Quais os produtos oferecidos.
- Se foram concedidos portes gratuitos.
- Qual o valor total dos descontos aplicados.

## 3.2. Secção de promoções

Adicionar ao ecrã de gestão da encomenda uma secção denominada:

**Promoções e descontos**

Esta secção deverá apresentar todas as promoções associadas à encomenda.

Para cada promoção, apresentar:

| Campo | Descrição |
| --- | --- |
| Nome | Nome da promoção |
| Código | Código utilizado, quando aplicável |
| Método | Automática ou código promocional |
| Tipo | Produto, encomenda ou portes |
| Benefício | Descrição do desconto concedido |
| Valor | Montante efetivamente descontado |

Uma promoção que conceda vários benefícios deverá permitir identificar cada benefício individualmente.

## 3.3. Descontos na tabela de produtos

Quando um desconto for aplicado diretamente a um produto, essa informação deverá aparecer na respetiva linha da tabela de produtos.

Apresentar:

- Preço unitário original.
- Desconto aplicado.
- Preço unitário após desconto.
- Quantidade.
- Total da linha após desconto.

O valor original poderá ser apresentado visualmente riscado, acompanhado do valor final.

### Exemplo

Produto A:

- Preço original: 50 €.
- Promoção: 20% de desconto.
- Desconto: 10 € por unidade.
- Preço final: 40 €.
- Quantidade: 2.
- Total: 80 €.

## 3.4. Produtos oferecidos

Quando uma promoção oferecer produtos gratuitamente, estes deverão aparecer na tabela de produtos da encomenda.

Apresentar:

- Nome e fotografia.
- SKU.
- Quantidade oferecida.
- Preço original.
- Desconto aplicado.
- Total final: 0 €, quando integralmente oferecido.

Identificar visualmente o produto como:

**Oferta promocional**

O produto deverá continuar a ser considerado nas operações de stock e expedição.

## 3.5. Descontos sobre os portes

Quando uma promoção conceder portes gratuitos ou um desconto no transporte, apresentar:

- Valor original dos portes.
- Desconto aplicado.
- Valor final cobrado.

### Exemplo

- Portes originais: 8 €.
- Promoção: Portes grátis.
- Desconto: −8 €.
- Portes finais: 0 €.

O desconto promocional não deverá eliminar o registo do custo original dos portes.

## 3.6. Resumo financeiro

O resumo financeiro da encomenda deverá discriminar os descontos.

### Exemplo

| Descrição | Valor |
| --- | --- |
| Subtotal original dos produtos | 150,00 € |
| Descontos sobre produtos | −20,00 € |
| Desconto sobre a encomenda | −13,00 € |
| Subtotal após descontos | 117,00 € |
| Portes originais | 8,00 € |
| Desconto nos portes | −8,00 € |
| **Total da encomenda** | **117,00 €** |

Os valores deverão ser apresentados de forma consistente com o cálculo efetivamente realizado.

O resumo deverá permitir identificar o desconto total concedido ao cliente.

## 3.7. Múltiplas promoções

Quando existirem várias promoções aplicadas, apresentar cada uma individualmente.

Não agrupar todos os descontos num único valor sem permitir identificar a sua origem.

O administrador deverá conseguir perceber quais as promoções combinadas e o benefício efetivo de cada uma.

## 3.8. Preservação do histórico

Os descontos devem refletir os valores e as condições efetivamente aplicados no momento da criação ou modificação autorizada da encomenda.

Alterações posteriores à configuração de uma promoção não deverão modificar retroativamente os valores históricos.

A ficha da encomenda deverá consultar os registos promocionais associados à própria encomenda, sem recalcular automaticamente as promoções atuais apenas para apresentar os valores.

## 3.9. Critérios de aceitação

A funcionalidade estará concluída quando:

1. A ficha da encomenda apresentar uma secção de promoções e descontos.
2. Todas as promoções aplicadas forem identificadas.
3. Os códigos promocionais utilizados forem apresentados.
4. Os descontos sobre produtos forem visíveis nas respetivas linhas.
5. Os produtos oferecidos forem identificados.
6. Os descontos sobre portes forem discriminados.
7. O resumo financeiro apresentar os descontos separadamente.
8. As promoções acumuladas forem apresentadas individualmente.
9. O valor total dos descontos for claramente identificável.
10. Os valores históricos forem preservados.

**Instrução final para a IA:** atualizar o ecrã de gestão de encomendas para apresentar explicitamente todas as promoções e descontos aplicados. Discriminar os benefícios por promoção, produto, encomenda e portes, incluindo produtos oferecidos e códigos promocionais utilizados. O resumo financeiro deverá apresentar os valores originais, os descontos e o total final, preservando os valores efetivamente registados na encomenda.

**Configurações**

# 1. Configurações do Plugin

## 1.1. Objetivo

Implementar um módulo centralizado de configurações do e-commerce, permitindo que cada loja configure as suas integrações, credenciais, serviços externos e modelos de e-mail através da interface administrativa.

A plataforma utiliza Strapi como backend.

Todas as configurações específicas das lojas deverão ser armazenadas na base de dados gerida pelo Strapi.

As alterações efetuadas na interface deverão produzir efeitos em tempo de execução, sem necessidade de rebuild, redeploy ou reinício da aplicação.

## 1.2. Princípio arquitetural

Distinguir dois tipos de configurações:

1. Configurações globais do servidor.
2. Configurações específicas das lojas.

### Configurações globais

Poderão utilizar os mecanismos normais de configuração do servidor Strapi.

Incluem:

- Configurações de infraestrutura.
- Ligações internas.
- Parâmetros globais de execução.
- Chaves técnicas necessárias à cifragem de segredos.
- Outras configurações independentes das lojas.

### Configurações das lojas

Deverão ser geridas exclusivamente através do módulo de configurações.

Incluem:

- Credenciais Stripe.
- Credenciais Moloni.
- Credenciais CTT Expresso.
- Credenciais Resend.
- Ativação de integrações.
- Parâmetros dos fornecedores.
- Configurações de envio de e-mails.
- Modelos de e-mail personalizados.

Não criar variáveis de ambiente específicas para as credenciais das lojas.

## 1.3. Menu Configurações

Adicionar ao menu do e-commerce:

**Configurações**

Organizar o ecrã nas seguintes secções:

1. Pagamentos.
2. Sistemas de faturação.
3. Métodos de entrega.
4. Serviço de e-mail.
5. Modelos de e-mail.

Cada secção deverá permitir consultar e modificar as configurações da loja atual.

## 1.4. Persistência no Strapi

As configurações deverão ser persistidas na base de dados utilizada pelo Strapi.

Implementar uma estrutura que permita associar cada configuração:

- À loja.
- Ao plugin ou integração.
- Ao respetivo conjunto de parâmetros.
- Ao estado de ativação.
- À data de atualização.

### Requisitos

- Isolamento por loja.
- Validação dos dados.
- Persistência segura.
- Atualização em tempo de execução.
- Ausência de necessidade de rebuild.
- Compatibilidade com a arquitetura existente do Strapi.

As configurações não deverão depender de valores incorporados no código da aplicação.

## 1.5. Carregamento dinâmico das configurações

Sempre que uma integração necessitar de executar uma operação, deverá obter as configurações atualmente válidas para a loja.

### Fluxo

1. O serviço identifica a loja.
2. Identifica o plugin necessário.
3. Consulta as configurações através do serviço central.
4. Obtém os parâmetros não sensíveis.
5. Recupera e decifra os segredos necessários.
6. Executa a operação externa.
7. Descarta as referências aos segredos assim que deixarem de ser necessárias.

### Cache

A implementação poderá utilizar cache para reduzir consultas repetidas à base de dados.

Contudo:

- Uma alteração deve invalidar a cache correspondente.
- As novas configurações devem ficar disponíveis sem rebuild.
- Não permitir utilização indefinida de credenciais antigas.
- A cache não deverá expor segredos ao frontend.

## 1.6. Armazenamento cifrado das credenciais

As credenciais sensíveis deverão ser cifradas no backend antes de serem persistidas.

### Regras

- Nunca guardar chaves privadas em texto simples na base de dados.
- Utilizar cifragem autenticada adequada.
- Manter o material de cifragem do servidor separado dos dados cifrados.
- Decifrar apenas quando a integração necessitar de utilizar a credencial.
- Não registar segredos em logs.
- Não incluir segredos em mensagens de erro.
- Não devolver segredos completos através de APIs administrativas.

A implementação deverá utilizar os mecanismos criptográficos disponíveis no ambiente do servidor Strapi.

### Chave de cifragem

A chave mestra utilizada para cifrar as credenciais poderá ser uma configuração global do servidor.

Essa chave não pertence a nenhuma loja.

Não deverá ser armazenada juntamente com as credenciais cifradas na mesma tabela.

A solução não deverá depender de Azure Key Vault ou de outro serviço externo de gestão de segredos.

## 1.7. Apresentação mascarada das credenciais

Ao consultar as configurações, o backend deverá devolver apenas uma representação mascarada de cada credencial sensível.

### Formato

Apresentar:

**Primeiros quatro caracteres + `....`**

Exemplo:

Chave original, apenas para ilustrar:

`abcd123456789`

Representação devolvida:

`abcd....`

### Regras

- O frontend nunca deverá receber a chave completa.
- O mascaramento deverá ocorrer no backend.
- O backend não deverá disponibilizar um endpoint para revelar a credencial original.
- O valor mascarado deverá servir apenas como indicação visual de que existe uma configuração.

### Atualização

Quando o administrador pretender substituir uma credencial:

1. Introduz uma nova chave.
2. O backend valida a entrada.
3. Cifra a nova credencial.
4. Substitui o valor anterior.
5. Devolve apenas a nova representação mascarada.

Se o administrador guardar outras alterações sem introduzir uma nova chave, a credencial anteriormente armazenada deverá permanecer inalterada.

O valor mascarado nunca poderá ser interpretado como uma nova credencial.

## 1.8. Configuração do Stripe

Na secção:

**Configurações → Pagamentos**

Disponibilizar os parâmetros necessários à integração Stripe.

### Funcionalidades

- Introduzir credenciais.
- Atualizar credenciais.
- Configurar parâmetros suportados.
- Consultar o estado da integração.
- Executar testes de ligação, quando possível.

As configurações deverão ser utilizadas pelos serviços responsáveis por:

- Pagamentos.
- Links de pagamento.
- Pagamentos complementares.
- Reembolsos.

A implementação deverá respeitar as particularidades do modelo de integração Stripe utilizado pela plataforma.

## 1.9. Configuração dos sistemas de faturação

Na secção:

**Configurações → Sistemas de faturação**

Apresentar os plugins instalados.

Inicialmente:

**Moloni**

Cada plugin deverá permitir:

- Introduzir credenciais.
- Configurar parâmetros.
- Ativar.
- Desativar.
- Consultar o estado da configuração.

### Regra de exclusividade

Apenas um sistema de faturação poderá estar ativo por loja.

Ao ativar um fornecedor, desativar o anteriormente ativo.

O serviço central de faturação deverá utilizar o plugin ativo.

## 1.10. Configuração dos métodos de entrega

Na secção:

**Configurações → Métodos de entrega**

Apresentar os plugins de transportadoras.

Inicialmente:

**CTT Expresso**

Permitir:

- Configurar credenciais.
- Configurar serviços.
- Ativar.
- Desativar.
- Testar a ligação, quando suportado.

### Múltiplas transportadoras

Uma loja poderá manter várias transportadoras ativas simultaneamente.

A ativação de uma não deverá desativar as restantes.

Checkout e fulfillment deverão utilizar o serviço central de métodos de entrega.

## 1.11. Configuração do Resend

Na secção:

**Configurações → Serviço de e-mail**

Implementar a configuração do **Resend**.

O Resend será o fornecedor inicial responsável pelo envio dos e-mails transacionais.

### Campos configuráveis

Disponibilizar os parâmetros necessários à integração, incluindo:

- Chave da API.
- Endereço de e-mail do remetente.
- Nome apresentado como remetente.
- Outros parâmetros exigidos pela integração.

### Regras

- Guardar a chave da API cifrada.
- Apresentar apenas a representação mascarada.
- Permitir substituir a chave.
- Não exigir rebuild.
- Utilizar a configuração da loja atual.
- Permitir enviar um e-mail de teste.

O serviço central de notificações deverá utilizar a integração Resend para enviar as mensagens.

Os módulos de encomendas, pagamentos e promoções não deverão comunicar diretamente com a API Resend.

## 1.12. Modelos de e-mail

Na secção:

**Configurações → Modelos de e-mail**

Disponibilizar todos os modelos transacionais da plataforma.

### Modelos iniciais

1. Confirmação de encomenda.
2. Confirmação de pagamento.
3. Instruções de pagamento.
4. Pagamento complementar.
5. Expedição parcial.
6. Expedição integral.
7. Confirmação de entrega.
8. Cancelamento.
9. Reembolso iniciado.
10. Reembolso concluído.
11. Fatura disponível.
12. Código promocional emitido.

Cada loja deverá iniciar com modelos padrão prontos a utilizar.

## 1.13. Templates padrão

Os modelos disponibilizados de origem deverão:

- Possuir um design profissional.
- Ser responsivos.
- Utilizar a identidade visual da loja.
- Suportar variáveis dinâmicas.
- Apresentar botões de ação.
- Ser compatíveis com clientes de e-mail comuns.

O administrador poderá utilizar os modelos sem qualquer personalização.

Também deverá poder editá-los.

As alterações de uma loja não deverão afetar outras lojas.

## 1.14. Editor de HTML

Implementar um editor que permita modificar diretamente o código HTML do e-mail.

A interface deverá apresentar duas áreas:

### Lado esquerdo

Editor de código.

Permitir modificar:

- HTML.
- Estilos.
- Textos.
- Cores.
- Imagens.
- Botões.
- Variáveis.

### Lado direito

Pré-visualização do e-mail.

A pré-visualização deverá atualizar-se à medida que o código for modificado.

O administrador deverá poder editar e visualizar simultaneamente.

## 1.15. Assunto do e-mail

Permitir editar o assunto de cada modelo.

O assunto deverá suportar variáveis dinâmicas.

Exemplo:

`A sua encomenda {{order.reference}} foi enviada`

O valor deverá ser substituído antes do envio.

## 1.16. Variáveis dinâmicas

Implementar um catálogo de variáveis suportadas.

### Exemplos

| Variável | Descrição |
| --- | --- |
| `{{customer.firstName}}` | Nome |
| `{{customer.lastName}}` | Apelido |
| `{{customer.email}}` | E-mail |
| `{{order.reference}}` | Referência da encomenda |
| `{{order.total}}` | Total |
| `{{payment.amount}}` | Valor do pagamento |
| `{{payment.link}}` | Link de pagamento |
| `{{invoice.number}}` | Número da fatura |
| `{{invoice.downloadUrl}}` | Download da fatura |
| `{{shipment.trackingCode}}` | Código de rastreio |
| `{{shipment.trackingUrl}}` | Link de acompanhamento |
| `{{promotion.code}}` | Código promocional |

Os identificadores concretos deverão respeitar as convenções técnicas do projeto.

### Catálogo

No editor, apresentar as variáveis disponíveis para cada tipo de e-mail.

Permitir copiá-las ou inseri-las diretamente no código.

## 1.17. Pré-visualização

A pré-visualização deverá utilizar dados fictícios.

Exemplo:

Modelo:

`Olá, {{customer.firstName}}`

Pré-visualização:

`Olá, João`

Não utilizar dados reais de clientes sem necessidade.

A pré-visualização deverá ser executada num contexto isolado, impedindo que o HTML personalizado interfira com a interface administrativa.

## 1.18. Validação dos modelos

Antes de guardar, verificar:

- Sintaxe suportada.
- Variáveis utilizadas.
- Variáveis não reconhecidas.
- Elementos inseguros.
- Estrutura do modelo.
- Links dinâmicos.

Não permitir execução arbitrária de código através dos templates.

## 1.19. Envio de teste

Disponibilizar o botão:

**Enviar e-mail de teste**

### Fluxo

1. Solicitar o e-mail de destino.
2. Preparar o modelo com dados fictícios.
3. Carregar a configuração Resend da loja.
4. Enviar o e-mail.
5. Apresentar o resultado.
6. Registar a operação.

O envio deverá utilizar a configuração atual da loja, sem rebuild.

## 1.20. Restaurar modelo padrão

Disponibilizar a ação:

**Restaurar modelo padrão**

A operação deverá permitir recuperar o template original.

Antes de executar, solicitar confirmação.

Recomenda-se manter histórico de versões para recuperar alterações anteriores.

## 1.21. Persistência dos modelos

Guardar no Strapi:

- Identificador do modelo.
- Loja.
- Tipo de evento.
- Assunto.
- HTML.
- Versão.
- Data de atualização.
- Utilizador responsável.

As personalizações devem ser independentes por loja.

## 1.22. Serviço central de notificações

Todos os módulos deverão utilizar um serviço central de e-mails.

### Fluxo

1. Ocorre um evento de negócio.
2. O serviço recebe o evento.
3. Identifica a loja.
4. Carrega o modelo correspondente.
5. Carrega as variáveis.
6. Substitui os valores dinâmicos.
7. Obtém a configuração Resend da loja.
8. Decifra a credencial necessária.
9. Envia o e-mail.
10. Regista o resultado.

As notificações deverão respeitar as regras de idempotência e histórico já definidas.

## 1.23. Atualização sem rebuild

Todas as alterações efetuadas através do módulo de configurações deverão ficar disponíveis em tempo de execução.

### Exemplos

- Substituir a chave Resend.
- Atualizar a chave Moloni.
- Alterar credenciais Stripe.
- Ativar uma transportadora.
- Desativar um plugin.
- Alterar um modelo de e-mail.
- Alterar o nome do remetente.

Nenhuma destas operações deverá exigir:

- Rebuild.
- Redeploy.
- Reinício do Strapi.
- Alteração de variáveis de ambiente da loja.

Se existir cache, deverá ser invalidada quando a configuração for atualizada.

## 1.24. Configurações extensíveis

A arquitetura deverá permitir que novos plugins declarem os seus próprios campos de configuração.

Cada plugin poderá definir:

- Identificador.
- Nome.
- Campos.
- Tipos.
- Campos obrigatórios.
- Campos sensíveis.
- Valores padrão.
- Regras de validação.
- Estado de ativação.

O módulo central deverá fornecer os mecanismos de persistência, leitura, atualização e proteção desses valores.

## 1.25. Controlo de acesso

Apenas utilizadores administrativos autorizados poderão modificar configurações.

As operações sensíveis deverão ser validadas no backend.

Registar:

- Loja.
- Utilizador.
- Tipo de alteração.
- Data e hora.
- Identificador da integração.

Não registar os valores secretos anteriores ou novos no histórico de auditoria.

## 1.26. Exclusões

Não implementar configurações de CAPTCHA nesta fase.

As integrações iniciais são:

- Stripe.
- Moloni.
- CTT Expresso.
- Resend.

Não implementar dependência de Azure Key Vault ou outro serviço externo de gestão de segredos.

## 1.27. Critérios de aceitação

A funcionalidade estará concluída quando:

1. Existir um menu Configurações.
2. Todas as configurações forem isoladas por loja.
3. As configurações forem persistidas na base de dados do Strapi.
4. As credenciais sensíveis forem cifradas antes da persistência.
5. As credenciais forem decifradas apenas no backend quando necessário.
6. O frontend receber apenas os quatro primeiros caracteres seguidos de `....`.
7. Não existir endpoint para revelar a chave completa.
8. For possível substituir credenciais.
9. Guardar configurações sem alterar segredos existentes não os substituir por valores mascarados.
10. As alterações entrarem em vigor sem rebuild.
11. As alterações entrarem em vigor sem reiniciar o Strapi.
12. Existir suporte para invalidação de cache.
13. O Stripe puder ser configurado pela interface.
14. O Moloni puder ser configurado pela interface.
15. O CTT Expresso puder ser configurado pela interface.
16. O Resend puder ser configurado pela interface.
17. Apenas um sistema de faturação puder estar ativo.
18. Várias transportadoras puderem estar ativas.
19. Existirem modelos padrão de e-mail.
20. O administrador puder editar HTML e assunto.
21. Existir pré-visualização simultânea.
22. Existir um catálogo de variáveis.
23. For possível enviar e-mails de teste.
24. For possível restaurar modelos padrão.
25. Os modelos personalizados forem isolados por loja.
26. Os segredos não forem expostos em logs.
27. Os endpoints administrativos forem protegidos.
28. A arquitetura permitir configurações de novos plugins.
29. Não existir dependência de Key Vault.
30. Não forem introduzidas configurações de CAPTCHA.

**Instrução final para a IA:** implementar um módulo centralizado de configurações utilizando a infraestrutura e a base de dados do Strapi. Todas as configurações específicas das lojas, incluindo credenciais Stripe, Moloni, CTT Expresso e Resend, deverão ser geridas através da interface administrativa e carregadas dinamicamente em tempo de execução, sem rebuild ou redeploy. As credenciais sensíveis deverão ser cifradas no backend, persistidas na base de dados e decifradas apenas quando necessárias. As APIs administrativas deverão devolver exclusivamente uma representação mascarada, formada pelos primeiros quatro caracteres seguidos de `....`, sem nunca expor a credencial completa. Implementar também a gestão de modelos de e-mail com templates padrão, editor HTML, pré-visualização em tempo real, variáveis dinâmicas, testes de envio e integração com o Resend.

**APIs**

**1. API do Storefront**

**1.1. Objetivo**

Implementar uma API pública, mínima e segura, destinada ao frontend do e-commerce.

A API deverá disponibilizar exclusivamente as operações necessárias para:

- Consultar produtos disponíveis para venda.
- Calcular o carrinho.
- Aplicar códigos promocionais.
- Consultar métodos e custos de entrega.
- Criar encomendas.
- Iniciar ou retomar pagamentos.

A plataforma não terá registo ou autenticação de clientes nesta fase.

Consequentemente, não deverão ser criados endpoints públicos para registo, login, perfil ou histórico de clientes.

**1.2. Separação entre APIs**

Distinguir:

1. API administrativa.
2. API pública do storefront.
3. Integrações externas e webhooks.

A API administrativa deverá continuar protegida por autenticação e permissões.

A API pública deverá expor apenas os dados necessários ao checkout.

Os serviços internos deverão ser reutilizados por ambas, evitando duplicação de regras de negócio.

**1.3. Listagem de produtos**

`GET /api/storefront/products`

Deverá devolver apenas produtos ativos, publicados e disponíveis para apresentação no storefront.

**Dados**

- Identificador público.
- Nome.
- Slug.
- Imagem.
- Preço.
- Moeda.
- Informação de disponibilidade.
- Informações públicas necessárias à apresentação.

**Regras**

- Suportar paginação.
- Suportar pesquisa e filtros necessários ao catálogo.
- Não devolver dados administrativos.
- Não expor custos internos, margens ou fornecedores.
- Respeitar a loja atual.

**1.4. Detalhes do produto**

`GET /api/storefront/products/:slug`

Deverá apresentar as informações públicas de um produto.

**Dados**

- Nome.
- Descrição.
- Imagens.
- Preço.
- Variantes.
- SKU público, quando aplicável.
- Disponibilidade.
- Características necessárias à compra.

Não devolver informações internas ou confidenciais.

**1.5. Cálculo do carrinho**

`POST /api/storefront/cart/quote`

Este endpoint deverá constituir a principal operação de cálculo do checkout.

**Entrada**

- Produtos e variantes.
- Quantidades.
- Código promocional, quando introduzido.
- E-mail, quando disponível e necessário para a elegibilidade.
- Morada de entrega, quando disponível.
- Método de entrega selecionado, quando aplicável.

**Processamento**

1. Consultar os produtos reais.
2. Validar as variantes.
3. Obter preços atuais.
4. Avaliar promoções automáticas.
5. Avaliar códigos promocionais.
6. Resolver regras de acumulação.
7. Consultar os métodos de entrega ativos.
8. Calcular os portes.
9. Calcular os impostos aplicáveis.
10. Devolver o resumo financeiro.

**Resposta**

Devolver:

- Produtos.
- Quantidades.
- Preços.
- Promoções aplicadas.
- Descontos.
- Produtos oferecidos.
- Subtotal.
- Métodos de entrega disponíveis.
- Portes.
- Impostos.
- Total estimado.

A resposta deverá permitir ao frontend atualizar o carrinho sem reproduzir as regras de cálculo.

**Importante:** a cotação não deverá reservar nem descontar stock.

**1.6. Aplicação de código promocional**

`POST /api/storefront/discounts/apply`

Permitir validar um código introduzido pelo cliente.

**Entrada**

- Código promocional.
- Conteúdo atual do carrinho.
- E-mail, quando necessário.
- Dados relevantes à avaliação.

**Comportamento**

- Validar a existência do código.
- Validar o período de utilização.
- Validar os limites.
- Validar as condições.
- Verificar compatibilidade com promoções automáticas.
- Calcular os benefícios.
- Devolver o resultado.

O endpoint deverá utilizar o mesmo motor de promoções usado pelo cálculo do carrinho.

Não implementar regras promocionais duplicadas.

O resultado deverá indicar se o código foi aplicado e, caso contrário, apresentar um motivo adequado.

A aplicação do código no carrinho não deverá contabilizar imediatamente uma utilização definitiva.

**1.7. Criação de encomendas**

`POST /api/storefront/orders`

Este endpoint deverá permitir criar uma encomenda sem autenticação.

**Entrada**

- Nome.
- Apelido.
- E-mail.
- Telefone.
- Morada de faturação.
- Morada de entrega.
- Produtos e quantidades.
- Método de entrega.
- Código promocional, quando aplicável.
- Informações necessárias ao checkout.

**Processamento**

1. Validar os dados.
2. Identificar a loja.
3. Consultar os produtos e preços reais.
4. Reavaliar as promoções.
5. Validar os custos de envio.
6. Recalcular o total.
7. Validar o stock.
8. Identificar o cliente pelo e-mail normalizado.
9. Reutilizar o cliente existente ou criar uma nova entidade.
10. Criar a encomenda associada ao cliente.
11. Descontar o stock.
12. Registar os estados iniciais.
13. Criar a operação de pagamento, quando solicitada e disponível.
14. Produzir o evento de confirmação da encomenda.

**Estados iniciais**

- `OrderStatus = OPEN`.
- `PaymentStatus = PENDING`.
- `FulfillmentStatus = UNFULFILLED`.

**Criação automática do cliente**

A API pública não deverá expor uma operação autónoma de criação de clientes.

A identificação ou criação deverá ocorrer internamente durante o processamento da encomenda.

A mesma regra deverá ser reutilizada nas encomendas criadas manualmente pelo administrador.

**Consistência**

A criação da encomenda e o desconto de stock deverão ser consistentes.

O endpoint deverá suportar idempotência para evitar encomendas duplicadas quando o cliente repetir o pedido.

**1.8. Início ou recuperação do pagamento**

`POST /api/storefront/orders/:id/payment`

Permitir criar ou recuperar uma operação de pagamento válida para uma encomenda anteriormente criada.

**Comportamento**

1. Validar a autorização temporária associada ao checkout.
2. Identificar a encomenda.
3. Confirmar o valor pendente.
4. Identificar uma operação de pagamento existente, quando reutilizável.
5. Criar uma nova operação Stripe apenas quando necessário.
6. Devolver os dados necessários para iniciar o pagamento.

Não permitir criar cobranças duplicadas para o mesmo montante.

O endpoint não deverá permitir consultar arbitrariamente encomendas através dos seus identificadores.

O valor a cobrar deve ser calculado pelo backend, sem confiar num valor fornecido pelo frontend.

**1.9. Confirmação dos pagamentos**

A confirmação efetiva dos pagamentos Stripe deverá ocorrer através da integração backend com o fornecedor.

O frontend não deverá ter permissão para marcar pagamentos como liquidados.

O retorno do utilizador à página de sucesso não constitui prova suficiente de pagamento.

Os eventos e confirmações do fornecedor deverão atualizar os pagamentos e o `PaymentStatus` agregado.

**1.10. Segurança**

A API pública deverá:

- Aplicar validação rigorosa das entradas.
- Aplicar rate limiting.
- Proteger contra pedidos abusivos.
- Respeitar o isolamento por loja.
- Não expor credenciais.
- Não confiar em preços enviados pelo frontend.
- Não permitir alterar diretamente estados financeiros.
- Não permitir alterar diretamente stock.
- Não revelar dados de outros clientes.
- Utilizar identificadores públicos opacos quando necessário.
- Validar novamente os dados antes de persistir a encomenda.

A identificação por e-mail não constitui autenticação.

**1.11. APIs não necessárias nesta fase**

Não implementar endpoints públicos para:

- Registo de clientes.
- Login.
- Recuperação de palavra-passe.
- Perfil do cliente.
- Listagem de clientes.
- Histórico pessoal de encomendas.
- Edição de encomendas.
- Cancelamento de encomendas.
- Reembolsos.
- Faturação administrativa.
- Gestão de expedições.
- Configuração de integrações.
- Gestão de promoções.

Estas operações pertencem à API administrativa ou a processos internos do backend.

**1.12. Integração com o Strapi**

A implementação deverá respeitar a arquitetura existente do Strapi.

Utilizar serviços de domínio reutilizáveis para:

- Produtos.
- Promoções.
- Clientes.
- Encomendas.
- Pagamentos.
- Stock.
- Métodos de entrega.

A API pública deverá funcionar como uma camada de entrada, encaminhando as operações para os serviços existentes.

Evitar implementar lógica de negócio diretamente nos controllers.

**1.13. Critérios de aceitação**

A implementação estará concluída quando:

1. O frontend conseguir listar produtos ativos.
2. For possível consultar detalhes dos produtos.
3. O carrinho puder ser calculado pelo backend.
4. Promoções automáticas forem avaliadas.
5. Códigos promocionais puderem ser validados.
6. Os portes forem obtidos através dos plugins ativos.
7. O checkout funcionar sem registo.
8. O cliente for identificado ou criado automaticamente.
9. A encomenda ficar associada ao cliente.
10. O stock for validado e descontado.
11. For possível iniciar o pagamento Stripe.
12. O backend impedir cobranças duplicadas.
13. A liquidação depender da confirmação do fornecedor.
14. Não existirem APIs públicas de contas de clientes.
15. Os dados administrativos não forem expostos.
16. Todos os endpoints respeitarem o isolamento por loja.
17. As operações de criação forem idempotentes.

**Instrução final para a IA:** implementar uma API pública mínima para o storefront, utilizando os serviços de domínio existentes no Strapi. Expor apenas as operações necessárias à consulta de produtos, cálculo do carrinho, aplicação de promoções, obtenção de portes, criação de encomendas e início de pagamentos. O checkout deverá funcionar sem autenticação. A criação ou identificação do cliente deverá ocorrer internamente durante a criação da encomenda, sem disponibilizar APIs públicas de contas de clientes.

**2. Autorização de Sessões Anónimas no Checkout**

**2.1. Objetivo**

Implementar um mecanismo de sessões anónimas que permita aos visitantes criar encomendas e iniciar pagamentos sem necessidade de registo ou autenticação numa conta de cliente.

O mecanismo deverá garantir que cada visitante apenas consegue executar operações autorizadas sobre a sua própria sessão de checkout e a encomenda criada nessa sessão.

**2.2. Princípio arquitetural**

O sistema deverá distinguir três entidades:

1. `Customer` — Identidade comercial interna.
2. `GuestCheckoutSession` — Sessão temporária do visitante.
3. `Order` — Encomenda criada durante o checkout.

A sessão anónima não representa uma conta autenticada.

O e-mail fornecido pelo cliente poderá ser utilizado para identificar ou criar a entidade `Customer`, mas não deverá conceder acesso ao histórico de encomendas dessa entidade.

**2.3. Criação da sessão**

Implementar:

`POST /api/storefront/checkout/session`

Ao iniciar o checkout, o frontend deverá solicitar uma sessão anónima.

O backend deverá:

1. Identificar a loja.
2. Verificar se existe uma sessão anónima válida.
3. Reutilizá-la quando apropriado.
4. Caso contrário, criar uma nova sessão.
5. Gerar um identificador criptograficamente aleatório.
6. Persistir a sessão no backend.
7. Devolver o identificador através de um cookie seguro.

Não utilizar identificadores sequenciais ou previsíveis como credenciais de sessão.

**2.4. Cookie de sessão**

Preferencialmente, utilizar um cookie com:

- `HttpOnly`.
- `Secure`.
- Política `SameSite` adequada.
- Âmbito restrito ao domínio e caminho necessários.

O cookie não deverá estar acessível através de JavaScript no navegador.

Quando o frontend e a API estiverem em origens diferentes, configurar cuidadosamente CORS, cookies e proteção contra CSRF.

Não utilizar `localStorage` como armazenamento principal da credencial de sessão.

**2.5. Persistência no Strapi**

Implementar uma entidade ou mecanismo de persistência para sessões de checkout.

Guardar, pelo menos:

- Identificador interno.
- Loja.
- Hash do token de sessão.
- Data de criação.
- Data da última utilização.
- Data de expiração.
- Estado da sessão.
- Encomenda associada, quando existir.

Não guardar o token de sessão em texto simples quando for suficiente persistir uma representação criptográfica para validação.

**2.6. Autorização por sessão**

As operações sensíveis do checkout deverão validar a sessão anónima.

A sessão deverá permitir apenas operações explicitamente autorizadas.

Exemplos:

- Criar uma encomenda.
- Iniciar o pagamento dessa encomenda.
- Recuperar os dados mínimos necessários para concluir o checkout.
- Consultar o resultado do pagamento dessa encomenda.

Não permitir:

- Consultar todas as encomendas associadas ao e-mail.
- Consultar outros clientes.
- Modificar outras encomendas.
- Aceder a configurações administrativas.
- Executar reembolsos.
- Alterar diretamente o estado financeiro.
- Consultar documentos de outras encomendas.

**2.7. Criação da encomenda**

O endpoint:

`POST /api/storefront/orders`

deverá utilizar a sessão anónima.

**Fluxo**

1. Validar a sessão.
2. Identificar a loja.
3. Validar os dados do checkout.
4. Recalcular produtos, promoções e portes.
5. Validar o stock.
6. Identificar ou criar o cliente pelo e-mail.
7. Criar a encomenda.
8. Descontar o stock.
9. Associar a encomenda à sessão.
10. Devolver os dados mínimos necessários para continuar o checkout.

A criação deverá ser idempotente.

A repetição do pedido não poderá criar novas encomendas nem descontar novamente o stock.

**2.8. Associação ao cliente**

A identificação automática deverá seguir as regras do módulo de gestão de clientes.

Se o e-mail já existir na loja, reutilizar o `customerId`.

Caso contrário, criar uma nova entidade Cliente.

A associação deverá ocorrer internamente no backend.

Não criar uma conta autenticada.

Não emitir tokens de autenticação da entidade Cliente.

Não disponibilizar dados históricos de clientes através da sessão anónima.

**2.9. Associação da sessão à encomenda**

Após a criação, o sistema deverá estabelecer uma associação entre a sessão e a encomenda.

A autorização para operar sobre a encomenda não deverá depender apenas do seu identificador público.

O backend deverá verificar a posse da sessão ou de uma credencial específica de acesso à encomenda.

A referência pública da encomenda não poderá funcionar como segredo de autenticação.

**2.10. Criação do pagamento**

Implementar ou adaptar:

`POST /api/storefront/orders/:id/payment`

**Validações**

Antes de criar uma operação Stripe:

1. Validar a sessão.
2. Confirmar a associação à encomenda.
3. Confirmar que a encomenda pertence à loja.
4. Validar o estado administrativo.
5. Calcular o montante ainda por pagar.
6. Verificar operações de cobrança já existentes.
7. Criar uma nova operação apenas quando necessário.

O frontend não deverá enviar um valor monetário que seja aceite sem validação.

O backend deverá calcular o valor efetivamente devido.

**2.11. Confirmação do pagamento**

A confirmação financeira deverá ocorrer através da integração backend com o Stripe.

O retorno do cliente à página de sucesso não deverá ser considerado prova de pagamento.

A plataforma deverá validar os eventos recebidos do Stripe e atualizar os pagamentos correspondentes.

O processamento deverá ser idempotente.

O frontend poderá consultar o resultado através de um endpoint limitado à encomenda autorizada.

**2.12. Consulta do resultado**

Implementar:

`GET /api/storefront/orders/:id/status`

O endpoint deverá exigir uma sessão ou credencial válida associada à encomenda.

**Resposta**

Devolver apenas as informações necessárias à página de confirmação, como:

- Referência da encomenda.
- Estado financeiro.
- Total.
- Resultado do pagamento.
- Informação adequada para apresentar ao cliente.

Não devolver dados administrativos ou outras encomendas do mesmo cliente.

**2.13. Expiração das sessões**

As sessões anónimas deverão possuir uma validade limitada.

A expiração da sessão não deverá cancelar a encomenda.

Esta regra é essencial para respeitar a decisão anteriormente definida de não cancelar automaticamente encomendas sem pagamento.

**Distinção**

- Sessão expirada: a credencial temporária deixa de autorizar operações.
- Encomenda pendente: permanece registada e mantém o stock descontado.

O ciclo de vida da sessão deverá ser independente do ciclo de vida da encomenda.

**2.14. Recuperação do acesso**

Caso o cliente perca a sessão, não deverá conseguir recuperar o acesso simplesmente introduzindo o e-mail.

Para permitir acesso posterior a uma encomenda específica, poderá ser implementado um mecanismo de ligação segura enviada por e-mail.

Esse mecanismo deverá:

- Utilizar um token aleatório.
- Possuir validade limitada.
- Autorizar apenas a encomenda correspondente.
- Não disponibilizar o histórico completo do cliente.
- Impedir a utilização de referências previsíveis como credenciais.

A recuperação do acesso não implica criar uma conta de cliente.

**2.15. Proteção contra CSRF**

Quando forem utilizados cookies para autorizar operações que alteram dados, implementar proteção adequada contra CSRF.

Não considerar `SameSite` como substituto universal de todos os mecanismos de proteção.

As operações deverão também validar a origem da chamada quando apropriado.

**2.16. Proteção contra abusos**

Implementar:

- Rate limiting.
- Validação de entradas.
- Identificadores imprevisíveis.
- Verificação de autorização por encomenda.
- Proteção contra enumeração.
- Limites de criação de sessões.
- Limites de criação de encomendas.
- Registo de eventos de segurança.

Não revelar informações sobre clientes existentes através de respostas públicas.

**2.17. Isolamento multi-tenant**

Cada sessão deverá estar associada à loja correspondente.

A mesma credencial não poderá ser utilizada para aceder a dados de outra loja.

Todos os pedidos deverão validar a identidade da loja através do mecanismo de resolução de tenants da plataforma.

**2.18. Integração com a API existente**

A API do storefront deverá continuar a utilizar os serviços de domínio existentes.

Não duplicar as regras de:

- Clientes.
- Encomendas.
- Pagamentos.
- Stock.
- Promoções.
- Transportadoras.

Os controllers deverão limitar-se à validação da entrada, autorização e encaminhamento para os serviços adequados.

**2.19. Critérios de aceitação**

A funcionalidade estará concluída quando:

1. Um visitante conseguir iniciar um checkout sem registo.
2. O backend criar uma sessão anónima segura.
3. O cookie de sessão possuir as proteções necessárias.
4. A sessão ficar associada à loja.
5. A criação de encomendas validar a sessão.
6. A encomenda ficar associada à sessão.
7. O cliente ser identificado ou criado automaticamente.
8. Não ser criada uma conta autenticada.
9. O pagamento apenas puder ser iniciado para uma encomenda autorizada.
10. Não forem aceites valores financeiros arbitrários do frontend.
11. A referência pública da encomenda não permitir acesso indevido.
12. O frontend conseguir consultar o resultado do checkout.
13. A liquidação depender de confirmação do Stripe.
14. A expiração da sessão não cancelar a encomenda.
15. O stock permanecer sujeito às regras já definidas.
16. Existir proteção contra CSRF e abuso.
17. As operações forem idempotentes.
18. O isolamento por loja for garantido.

**Instrução final para a IA:** implementar um mecanismo de sessões anónimas para o checkout, utilizando identificadores criptograficamente seguros, cookies protegidos e persistência no backend Strapi. Cada sessão deverá permitir apenas operações autorizadas sobre o checkout e a encomenda correspondente. A criação da encomenda deverá identificar ou criar internamente a entidade Cliente, sem gerar uma conta autenticada. A confirmação dos pagamentos deverá depender do Stripe, e a expiração da sessão não deverá alterar o estado ou cancelar a encomenda.