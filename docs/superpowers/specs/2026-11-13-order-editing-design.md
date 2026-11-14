# Edição da encomenda por secções: design

Data: 2026-11-13. Módulo E-commerce do `@littlebox/strapi-suite`, no admin e no servidor.
Substitui o fluxo único **Modify** (modal de modificação) por edição dentro de cada secção da
ficha da encomenda. Altera as decisões 4.8 (promoções em encomendas modificadas) e completa a 4.4
(faturação por pagamento) do design do e-commerce
(`docs/superpowers/specs/2026-11-11-ecommerce-design.md`), que tem de ser atualizado.

Marcas: **[Decisão]** foi decidido pelo dono do produto; **[Escolha]** foi decidido por quem
escreveu este documento e pode ser revisto.

## 1. Intenção

Hoje, para mexer numa encomenda, o lojista abre uma modal única que mistura quantidades, morada,
modo dos portes e desconto, e o sistema aplica tudo de uma vez. O lojista quer:

- mexer em cada coisa **onde ela aparece** (produtos na secção Products, portes na secção de
  envios, descontos na secção de promoções, morada na modal da morada);
- que uma alteração **nunca mude sozinha** portes ou descontos: o sistema **avisa** que é preciso
  rever, e o lojista decide quando e como;
- ver os portes como **uma tabela de cobranças**, porque uma encomenda parcialmente enviada pode
  ser alterada e os portes desses envios já estão "gastos";
- ter controlo sobre o dinheiro: nada de reembolsos, notas de crédito ou e-mails automáticos.

Sucesso: o lojista do cliente piloto consegue acrescentar/remover produtos, trocar morada ou
método de entrega antes do envio, acertar portes e descontos, e acabar com o saldo certo
(a pagar ou a reembolsar), com tudo no histórico.

**Anti-objetivos (seria um fracasso mesmo que funcionasse):**
- alterar portes ou descontos sem o lojista confirmar;
- emitir nota de crédito, fazer reembolso ou enviar e-mail ao comprador automaticamente;
- mudar uma fatura emitida ou o valor de portes já gastos num envio (as correções entram como
  diferenças no saldo: pagamento extra ou reembolso, e a nota de crédito fica a pedido do lojista);
- mudar o contrato da API do storefront.

## 2. Regras de disponibilidade

"A encomenda pode ser alterada" = `OrderStatus = OPEN` e nenhum envio `PENDING` na
transportadora. **[Decisão, 2026-11-13]** Ao contrário da regra atual de `MODIFY`, uma encomenda
**totalmente enviada** (`FULFILLED`, ainda não arquivada) também pode ser alterada, mas só para
**acrescentar** produtos (os enviados não se removem): o `FulfillmentStatus` volta a
`PARTIALLY_FULFILLED`, o botão Enviar reaparece para as unidades novas e o arquivamento deixa de
estar disponível até serem enviadas. As unidades novas seguem para a morada da encomenda. Cada
botão abaixo soma condições a esta:

| Ação | Condições além de "pode ser alterada" |
|---|---|
| Adicionar produtos (modal de produtos) | nenhuma |
| Alterar morada de entrega | nenhum envio (nem parcial) **[Decisão]** |
| Recalcular portes | nenhuma |
| Edit numa linha de portes (trocar método/preço) | nenhum envio **[Decisão]**; a linha não pode estar paga (`SHIPPING_LINE_PAID`) **[Decisão, 2026-11-14]** |
| Adicionar portes (linha manual) | nenhuma **[Escolha]** |
| Recalcular descontos | nenhuma **[Decisão, 2026-11-13]**: se ainda se podem acrescentar ou remover produtos, ainda se podem aplicar descontos, mesmo com faturas emitidas ou envios parciais |
| Adicionar desconto (livre) | nenhuma **[Decisão]** |
| Remover um desconto livre | nenhuma **[Escolha]** |

Exemplo que motivou a regra **[Decisão]**: o cliente comprou 2 unidades de X, pagou, foi faturado,
ainda nada foi enviado; lembra-se de que "2× X oferece Y", liga ao suporte; o lojista acrescenta Y e
recalcula os descontos para aplicar a oferta. As faturas emitidas não mudam: a diferença entra no
saldo (pagamento extra ou reembolso) e a nota de crédito, se for precisa, é a pedido do lojista.

"Nenhuma fatura emitida" (usado na regra 6.2) = nenhuma fatura no estado emitido (os registos
`UNCERTAIN` contam como emitidos, por prudência **[Escolha]**). Notas de crédito não contam.

O servidor aplica as mesmas regras (a UI só esconde). Fora das regras: `409` com código próprio.

## 3. Avisos persistentes

**[Decisão]** Dois avisos, guardados **na encomenda** (sobrevivem a recarregar a página):

- `SHIPPING_REVIEW`: "Os portes podem precisar de ser recalculados."
- `DISCOUNTS_REVIEW`: "Os descontos podem precisar de ser reavaliados."

Mostram-se no topo da ficha da encomenda como **alertas vermelhos**, um por aviso, cada um com o
motivo (ex.: "Produtos alterados a 13/11 14:05") e um atalho para a secção respetiva
**[Escolha: atalho]**.

Quem os acende e quem os apaga:

| Aviso | Acende quando | Apaga quando |
|---|---|---|
| `SHIPPING_REVIEW` | depois de guardar produtos ou morada, os portes devidos (6.3) **diferem** dos portes cobrados — para mais ou para menos **[Decisão]**; ou a cotação falha (método já não serve o destino/peso) | Recalcular portes confirmado; Edit de uma linha de portes guardado; Adicionar portes guardado |
| `DISCOUNTS_REVIEW` | depois de guardar produtos, alguma promoção aplicada deixa de cumprir as condições, **ou** alguma promoção (automática, ou com código usado no checkout) passaria a aplicar-se **[Escolha]**; **ou** os portes brutos mudaram e a encomenda tem uma promoção de portes **[Decisão]** | Recalcular descontos confirmado |

- Acender um aviso que já está aceso atualiza o motivo e a data.
- Se um aviso estiver aceso mas a encomenda deixar de poder ser alterada (ficou totalmente enviada,
  cancelada), o alerta mantém-se e explica que já não é possível recalcular; o lojista pode
  **dispensá-lo** (fica no histórico) **[Escolha]**.
- Acender e apagar fica no histórico.

## 4. Produtos

**[Decisão]** O botão **Modify** da barra de topo desaparece. A modal de modificação atual é
retirada; as suas funções passam para as secções descritas aqui. O endpoint de modificação pode
ser reaproveitado internamente, mas a UI deixa de o expor como fluxo único.

Na secção **Products**, enquanto a encomenda puder ser alterada, aparece no canto superior direito
o botão **Adicionar produtos**, que abre a modal de produtos:

- pesquisa no catálogo (nome/SKU), escolhe variante e quantidade, acrescenta;
- muda quantidades das linhas existentes e remove linhas **[Escolha: também muda quantidades]**;
- mantém as regras atuais: não desce abaixo do já enviado (`QUANTITY_BELOW_SHIPPED`), unidades
  acrescentadas entram **sem promoção** (numa linha de desconto, as unidades extra vão para uma
  linha nova ao preço cheio), stock reservado/libertado como hoje;
- mostra antes/depois do subtotal e do total;
- **Guardar** altera **só as linhas**: portes e descontos **não mudam** (as linhas com desconto por
  unidade mantêm-no; se a quantidade de uma linha com desconto baixar, o desconto baixa na
  proporção, como hoje). O desconto de encomenda em euros mantém o valor, limitado ao novo subtotal.
- Depois de guardar, o servidor faz as duas avaliações da secção 3, por esta ordem: **portes**,
  depois **descontos**. Só acende avisos; não altera nada.
- Histórico: uma entrada com as linhas acrescentadas, alteradas e removidas e o total antes/depois.

### 4.1 Desconto manual por linha **[Decisão, 2026-11-14]**

Na modal **Editar produtos** e no ecrã de **criar encomenda manual**, cada linha tem um campo
**"Desconto %"** opcional:

- valor de 0 (exclusivo) a 100, com até 2 casas decimais; vazio = sem desconto manual
  **[Decisão: basta a percentagem, sem motivo]**;
- o desconto por unidade é `round(preço unitário × % / 100)` em cêntimos **[Escolha]**; a linha
  guarda a percentagem para a mostrar ("−10 %");
- só se pode pôr, mudar ou tirar numa linha **sem unidades enviadas** **[Decisão]**; o efeito no
  dinheiro trata-se pelo saldo (pagar mais ou reembolso), como as outras alterações;
- numa linha que tinha desconto de uma promoção, a % manual **substitui-o**: a linha deixa de
  pertencer a essa promoção e acende `DISCOUNTS_REVIEW` **[Escolha]**. Tirar a % deixa a linha ao
  preço cheio (também acende `DISCOUNTS_REVIEW` se a linha tinha promoção);
- acrescentar unidades a uma linha com % manual mantém a % em toda a linha (sem dividir a linha,
  ao contrário das linhas com desconto de promoção) **[Escolha]**;
- **Recalcular descontos** trata as linhas com % manual como fixas: mantêm o desconto e não recebem
  promoções de produto, mas contam (ao preço líquido) para as bases das promoções sobre a
  encomenda **[Decisão]**;
- ao criar uma encomenda manual, as promoções avaliam-se com as linhas com % manual fixas, da
  mesma forma;
- a ficha da encomenda mostra a % na linha; a fatura já usa o preço líquido de cada linha;
- histórico: a alteração de produtos regista a % de cada linha alterada;
- a API do storefront **nunca** aceita este campo (campos desconhecidos são ignorados).

## 5. Morada de entrega

A modal **Shipping address** (botão no cabeçalho de Shipments):

- **Pode alterar** (secção 2): mostra um formulário com os campos da morada. O **país** só aceita
  os mercados que o método de entrega atual serve **[Decisão]**. Ao guardar, volta a cotar o método
  atual; se der diferente (ou falhar), acende `SHIPPING_REVIEW`. Histórico: morada antes/depois.
- **Não pode**: mostra os mesmos campos **bloqueados** e um aviso com o motivo (ex.: "A encomenda
  já tem envios", "A encomenda está cancelada").

A morada de faturação fica como está hoje (só leitura) **[Escolha: fora deste trabalho]**.

## 6. Portes: tabela de cobranças

### 6.1 Modelo

**[Decisão]** Os portes deixam de ser um valor único e passam a ser **linhas de portes**. Cada
linha: método (fornecedor, serviço, nome), valor (cêntimos, pode ser **negativo**), taxa de IVA,
origem (`CHECKOUT`, `RECALCULATION`, `EDIT`, `MANUAL`), data, utilizador, e se já está **gasta**
(existe qualquer envio na encomenda **[Escolha]**) ou **faturada** (incluída numa fatura em vigor, não anulada por uma Correção).
**Portes cobrados** = soma de todas as linhas (incluindo manuais e negativas).
**Método atual** = o método da linha mais recente que escolheu um método (`CHECKOUT`, `EDIT` ou
`MANUAL`); as linhas de diferença (`RECALCULATION`) herdam o método e não o mudam **[Escolha]**. O total de portes da
encomenda é a soma das linhas, menos o desconto de portes das promoções.

- Encomendas existentes: migração para uma linha `CHECKOUT` com os portes atuais.
- A faturação dos portes segue o design de faturação por seleção (4.4); a tabela
  mostra, por linha, o valor e se está faturada/gasta **[Escolha: colunas exatas ao builder]**.
- A API do storefront não muda: `shippingTotal` etc. continuam a ser os totais.

### 6.2 Regra única de substituir ou acrescentar

**[Decisão]** Uma linha de portes **pode ser substituída** (valor e/ou método) **só se não há
nenhum envio e nenhuma fatura emitida a inclui**. Caso contrário, qualquer alteração cria **uma
linha nova com a diferença** (positiva ou negativa).

Consequências:
- diferença positiva → aumenta o valor em dívida; **Adicionar pagamento** e **Enviar instruções de
  pagamento** usam o novo valor (verificar que já usam o total atual; se não, corrigir);
- diferença negativa → cria excedente, que aparece como **Elegível para reembolso** e ativa o botão
  **Reembolsar**. **[Decisão]** Nunca há reembolso, nota de crédito nem vale automáticos: o lojista
  escolhe o método de reembolso (Stripe, transferência, crédito na carteira) e se emite nota de
  crédito.

### 6.3 Secção Shipments and deliveries

Acima da tabela de envios e entregas aparece a **tabela de portes** (uma linha por cobrança).

- **Recalcular portes** (botão no topo da secção, enquanto puder ser alterada) **[Decisão]**: os
  portes são sempre recalculados em função do **estado atual** da encomenda. As três situações
  **[Decisão]** usam a mesma fórmula abaixo: **totalmente enviada** → cota só os produtos
  acrescentados (são as únicas unidades por enviar); **parcialmente enviada** → cota o que falta
  enviar + os produtos novos; **sem envios** → cota a encomenda inteira (recálculo de raiz). **Portes devidos** =
  custo dos envios já feitos + cotação do método atual para as **unidades ainda por enviar** e a
  morada atual (como o `RECALCULATE` de hoje). Compara com os **portes cobrados** (6.1):
  - devidos > cobrados → cobrança extra (regra 6.2: substitui ou linha positiva), que entra no
    próximo pagamento;
  - devidos < cobrados → a diferença volta ao cliente pelo fluxo de reembolso existente (regra 6.2:
    substitui ou linha negativa → excedente → Reembolsar);
  - iguais → nada muda (o aviso apaga-se).
  Comparação sempre em valores **brutos**: o desconto de portes das promoções não entra; mudar os
  portes brutos nunca mexe nos descontos, só acende `DISCOUNTS_REVIEW` se houver promoção de portes
  **[Decisão]**. Mostra o resultado antes de confirmar **[Escolha]**. Apaga `SHIPPING_REVIEW`.
- **Edit** (coluna Actions, só sem envios e só em linhas **não pagas** **[Decisão, 2026-11-14]**): abre a modal de portes. Lista **só os métodos que servem
  o país da morada e aguentam o peso** da encomenda, cada um com o **preço sugerido** (cotação); o
  lojista escolhe o método e pode **alterar o preço**. Guardar segue 6.2. Apaga `SHIPPING_REVIEW`.
- **Adicionar portes** (botão no topo): a mesma modal, mas cria **sempre uma linha nova** (ex.:
  segundo envio, envio urgente). Apaga `SHIPPING_REVIEW`.
- A coluna Actions só aparece se alguma linha tiver ação (como nas outras tabelas).
- Promoções de portes **[Decisão]**: mudar portes (substituir ou acrescentar linha) **não** mexe no
  desconto de portes, que fica com o valor em euros que tinha (limitado aos portes brutos); acende
  `DISCOUNTS_REVIEW` para o lojista decidir em **Recalcular descontos** se a promoção passa a cobrir
  os portes novos. Isto substitui o comportamento atual (que deixava cair a promoção ao recalcular).
- Tudo no histórico (método e valor antes/depois, linha criada).

## 7. Promoções e descontos

### 7.1 Recalcular descontos

**[Decisão]** Botão **Recalcular descontos** no canto superior direito da secção, com as regras da
secção 2. Abre uma modal que **não altera nada** até confirmar.

O servidor avalia a encomenda **tal como está agora** (linhas atuais, portes brutos cobrados)
contra as **promoções ativas hoje** (as mesmas regras de elegibilidade, acumulação e prioridade do
checkout, com o e-mail do cliente da encomenda). **[Decisão]** Só entram as promoções
**automáticas** e as promoções com código **cujo código o comprador usou no checkout** (os códigos
gravados na encomenda); códigos nunca introduzidos não aparecem (para isso há o desconto livre).
Devolve uma tabela, uma linha por promoção:

| Grupo | O que mostra | Seleção inicial |
|---|---|---|
| Aplicada e ainda válida | valor atual e valor recalculado | marcada (manter) |
| Aplicada mas **já não válida hoje** | "Não é válida hoje, mas era no dia da compra" + motivo (desativada, expirada, condições por cumprir, limite de utilizações) e o valor atual | marcada (manter) — o lojista pode desmarcar para remover **[Decisão: pode ser mantida]** |
| Nova, aplicar-se-ia agora | valor que daria | desmarcada **[Escolha]** |
| Desconto livre (7.2) | motivo e valor | marcada |

- Por baixo: total atual e total depois, com a seleção atual (atualiza ao marcar/desmarcar).
- Uma promoção mantida mas já não válida conserva **o valor que tinha** (não é recalculada, porque
  as regras de hoje já não lhe dão valor) **[Escolha]**. As válidas aplicam o valor recalculado.
- Acumulação: se a seleção juntar promoções que não acumulam, a modal avisa e não deixa confirmar
  **[Escolha]**.
- **Confirmar**: aplica os descontos escolhidos às linhas/encomenda/portes, recalcula o total,
  conta (ou liberta) utilizações das promoções, apaga `DISCOUNTS_REVIEW` e regista no histórico
  (promoções acrescentadas, removidas e mantidas, total antes/depois).
- Depois de confirmar, a modal mostra o novo saldo e, se for o caso, o botão **Reembolsar**
  (excedente) ou **Adicionar pagamento** / **Enviar instruções de pagamento** (em dívida). Os mesmos
  botões continuam na barra de topo.

### 7.2 Adicionar desconto (livre)

**[Decisão]** Botão **Adicionar desconto** ao lado do anterior, mesmas regras de disponibilidade.
Cria um **desconto livre só desta encomenda** (não é uma promoção da loja):

- tipo: **valor fixo** ou **percentagem** **[Escolha]**, sobre o total dos produtos (não sobre os
  portes) **[Escolha]**; a percentagem é calculada **quando o desconto é criado** e guardada em euros
  (ex.: "10 % (5,00 €)"), não muda sozinha quando os produtos mudam **[Escolha]**;
- **motivo** obrigatório;
- aparece na tabela de promoções como linha "Manual" com o motivo, e no total "Total discount";
- pode ser removido (na tabela ou no recálculo) **[Escolha]**;
- a soma dos descontos livres nunca excede o desconto da encomenda; quando uma alteração o reduz, o excedente sai primeiro do ajuste manual anterior e depois dos descontos livres mais recentes, sem nunca aumentar nenhum **[Escolha]**;
- recalcula o total; histórico com valor e motivo.

### 7.3 Relação com a decisão 4.8

A 4.8 dizia "não há reavaliação de promoções". Passa a ser: **guardar produtos nunca reavalia**
(mantém o comportamento da 4.8), mas o lojista **pode** reavaliar com **Recalcular descontos**
enquanto a encomenda puder ser alterada. Atualizar a 4.8 no design.

### 7.4 Migração do desconto de encomenda

Hoje `orderDiscount` junta o desconto das promoções e os ajustes manuais feitos na modal Modify.
A parte que não vem das promoções gravadas migra para uma linha "Manual" com o motivo
"Ajuste manual anterior" **[Escolha]**, para a tabela de 7.1 os poder separar.

## 8. Faturação

- A faturação segue [`2026-11-14-invoicing-by-selection-design.md`](2026-11-14-invoicing-by-selection-design.md)
  (substitui as coberturas por pagamento). As linhas de portes faturam-se **individualmente, por
  id**: uma linha de fatura por linha de portes, cada uma com o seu IVA **[Decisão]**.
- Faturas emitidas nunca mudam. Um recálculo de descontos ou de portes depois de faturar só mexe
  no saldo; o que sobra é excedente reembolsável.
- Uma linha de portes **negativa** só baixa o valor dos portes e cria excedente; não entra em
  nenhuma fatura. A regularização fiscal é a nota de crédito, emitida só a pedido do lojista
  **[Decisão]**.
- Um desconto acrescentado depois de faturar reduz o total; o excedente segue para Reembolsar e a
  nota de crédito fica a pedido do lojista **[Decisão]**.

## 9. Histórico

Novas entradas (títulos traduzidos en/pt): produtos alterados, morada alterada, portes
recalculados, linha de portes editada, linha de portes acrescentada, descontos recalculados,
desconto livre acrescentado/removido, aviso aceso/apagado/dispensado. Cada uma com utilizador,
data e valores antes/depois. Sem dados pessoais além do que o histórico já guarda.

## 10. O que fica ao builder

- Forma exata das tabelas/campos novos (linhas de portes, avisos, desconto livre) e da migração.
- Rotas do admin e permissões (seguir `orders.manage`, `payments.manage`, `refunds.manage`).
- Layout das modais, dentro do estilo atual (EmptyNote, ColumnLabel, ToneBadge, alinhamentos).
- Como reaproveitar `orderModification` e o motor de promoções do checkout.
- Testes: o projeto usa vitest; cobrir as regras da secção 2, a regra 6.2, os avisos da secção 3 e a
  avaliação de 7.1.

## 11. Fora de âmbito

- E-mails automáticos ao comprador por estas alterações **[Decisão]**.
- Alterar a morada de faturação.
- Mudanças na API do storefront.
