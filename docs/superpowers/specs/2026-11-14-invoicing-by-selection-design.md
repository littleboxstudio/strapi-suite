# Faturação por seleção: design

Data: 2026-11-14. Módulo E-commerce do `@littlebox/strapi-suite` (servidor e admin).
Substitui a faturação **por pagamento** (decisão 4.4 do design do e-commerce,
`docs/superpowers/specs/2026-11-11-ecommerce-design.md`) e o botão "Gerar fatura total". Tem
precedência sobre qualquer texto anterior que a contradiga (4.4, 4.12, §8 de
`2026-11-13-order-editing-design.md`, plano 10).

Marcas: **[Decisão]** decidido pelo dono do produto; **[Escolha]** decidido por quem escreveu.

## 1. Intenção

O lojista quer emitir uma fatura escolhendo **o que** fatura (produtos e quantidades, linhas de
portes) e **com que pagamentos**, podendo juntar vários pagamentos numa só fatura (ex.: 3 ou 4
pagamentos → 1 fatura) ou faturar em partes. A fatura corresponde sempre ao que o cliente pagou
de facto.

**Regra principal [Decisão]:** a obrigação fiscal **não depende da expedição**. Faturar não exige
envios; enviar não exige faturar.

**Anti-objetivos:**
- faturar o mesmo produto/quantidade, portes ou pagamento duas vezes;
- emitir uma fatura cujo total não seja igual à soma dos pagamentos escolhidos;
- mudar faturas já emitidas;
- tocar no contrato da API do storefront.

## 2. O que muda no ecrã

- **Pagamentos:** a ação "Gerar fatura" desaparece da tabela de pagamentos **[Decisão]**. O badge
  de estado da fatura por pagamento também deixa de fazer sentido (um pagamento pode estar numa
  fatura com outros); a coluna Actions segue a regra existente (escondida se nenhuma linha tiver
  ação) **[Escolha]**.
- **Invoices:** o botão "Gerar fatura total" desaparece; passa a existir **"Gerar fatura"**
  (mesmo estilo dos outros botões de secção), que abre a modal de seleção **[Decisão]**. Mostra-se
  enquanto houver algo por faturar e pagamentos disponíveis, com a permissão de faturação atual
  (`invoicing.manage`) **[Escolha]**.

## 3. Modal "Gerar fatura"

Três listas, cada uma só com o que **ainda não foi faturado** **[Decisão]**:

1. **Produtos:** uma linha por linha de encomenda com quantidade por faturar > 0: produto, preço
   líquido unitário (ver §4), quantidade por faturar e um campo "Quantidade a faturar"
   (0..por faturar; pode faturar-se parte e deixar o resto para outra fatura **[Decisão]**).
   Ofertas (gift) entram como as outras linhas, a valor 0 se o seu preço líquido for 0
   **[Escolha]**.
2. **Portes:** uma linha por linha de portes **positiva** ainda não faturada (pode haver várias,
   por alterações depois de enviada **[Decisão]**), com o valor líquido (§4); escolhe-se inteira
   (marcar/desmarcar) **[Escolha]**. Linhas de portes negativas nunca se faturam (geram excedente,
   §6) **[Escolha, mantém o plano 10]**.
3. **Pagamentos:** pagamentos `COMPLETED` ainda não faturados, cada um pelo **valor líquido** =
   valor pago − reembolsos já feitos desse pagamento (dinheiro **e** crédito na carteira contam
   como reembolso **[Decisão]**). Escolhe-se o pagamento inteiro **[Decisão]**.

Por baixo: **Total selecionado** (produtos + portes) e **Total dos pagamentos**. O botão
**Gerar** só fica ativo quando os dois são iguais (ao cêntimo) e ambos > 0 **[Decisão]**; caso
contrário mostra a diferença.

**Excedente por resolver:** se a encomenda tiver valor pago a mais (excess > 0), a modal mostra
"Há X pagos a mais. Faça o reembolso antes de faturar." com um botão **Reembolsar** (abre o fluxo
existente) e a emissão fica bloqueada **[Decisão]**. Depois do reembolso o pagamento passa a valer
o líquido e a fatura sai com esse valor (ex.: pago 100, encomenda 90, reembolso 10 → fatura 90
com um pagamento de 90).

O servidor valida tudo de novo (o que está disponível, quantidades, igualdade dos totais,
excedente) e recusa com códigos próprios; a modal é só ajuda.

## 4. Valores das linhas

- Produto: preço líquido por unidade = preço − desconto de linha (promoção de produto ou % manual).
- Descontos sobre a encomenda (promoções de encomenda, descontos livres) repartem-se
  **proporcionalmente** pelas linhas de produto; o desconto de portes reparte-se pelas linhas de
  portes **[Decisão]**. O valor mostrado e faturado de cada linha já inclui a sua parte.
- A repartição é determinística e a soma de todas as partes (faturadas + por faturar) é igual ao
  total da encomenda ao cêntimo; o arredondamento acerta-se de forma estável (ex.: maior resto)
  **[Escolha; o método exato fica ao builder]**.
- Faturar parte da quantidade de uma linha fatura `quantidade × valor unitário líquido` com o
  arredondamento acertado na última fatura dessa linha **[Escolha]**.
- Cada linha mantém a sua taxa de IVA; os portes, a taxa da sua linha de portes.
- **A fatura mostra os descontos [Decisão, 2026-11-14]:** cada linha guarda também o seu valor
  antes de descontos (`grossTotal`: preço unitário × quantidade nos produtos; valor da linha de
  portes nos portes). No Moloni a linha vai com o preço antes de descontos e o desconto em
  percentagem (`discount`, 2 casas decimais), que junta o desconto da linha e a sua parte dos
  descontos sobre a encomenda. A percentagem só é usada se der os mesmos cêntimos que o preço já
  descontado, por linha e no total do documento; senão a linha (ou, se for o total a falhar, o
  documento inteiro) sai como antes, com o preço já descontado e sem percentagem. As notas de
  crédito levam a mesma percentagem da linha creditada (o `grossTotal` escala com o valor).
  Faturas antigas sem `grossTotal` não mostram desconto **[Escolha]**.

## 5. Moloni: métodos de pagamento

- A fatura leva **um pagamento por pagamento escolhido**, com o seu valor líquido e o seu método
  **[Decisão]**.
- O método é procurado no Moloni (`paymentMethods/getAll`) pelo **nome**, sem distinguir
  maiúsculas e ignorando espaços nas pontas; se não existir, é **criado automaticamente**
  (`paymentMethods/insert`) antes de emitir **[Decisão]**.
- O nome é o que aparece na tabela de pagamentos **[Escolha]**: "Stripe" para pagamentos Stripe;
  o nome dado ao método manual (ex.: "MB WAY", "Transferência bancária"); "Crédito em carteira"
  para o vale. A configuração atual do método por omissão fica como fallback quando o nome estiver
  vazio **[Escolha]**.
- O tipo de documento (FR, ou FT + recibo) continua a vir das configurações do Moloni.
- Os nomes dos métodos, as descrições e os dados do cliente **nunca** vão para os logs.

## 6. Notas de crédito

Ao emitir uma nota de crédito sobre uma fatura, o lojista escolhe o **motivo** **[Decisão]**:

- **Devolução:** as unidades creditadas saíram da venda; **não** voltam a ficar por faturar.
- **Correção:** a fatura estava errada (NIF, quantidade, produto…); os produtos, portes e
  pagamentos creditados **voltam a ficar disponíveis** para se emitir a fatura correta.

O resto do fluxo de notas de crédito mantém-se (só a pedido do lojista, nunca automática).

## 7. Faturas antigas

As faturas emitidas antes desta mudança (por pagamento) continuam válidas e contam como
"já faturado": as suas linhas de produto e portes e os pagamentos que cobriram deixam de estar
disponíveis **[Escolha]**. A forma de derivar isso dos dados antigos fica ao builder, sem alterar
os documentos emitidos.

## 7.1 Regras de contas (resolvidas pelo builder check) **[Escolha]**

1. **Notas de crédito.**
   - **Correção** anula a fatura **inteira**: todos os seus produtos, portes e pagamentos voltam a
     ficar disponíveis (prática habitual: anular e reemitir).
   - **Devolução** credita **unidades devolvidas** de linhas já faturadas (até ao devolvido e ainda
     não creditado) e, opcionalmente, linhas de portes dessa fatura; parte de uma devolução
     registada (§4.5 do design do e-commerce). Valores = os valores faturados dessas unidades.
2. **Quantidade por faturar** de uma linha =
   `(quantidade − devolvidas) − (faturadas − creditadas por devolução − creditadas por correção)`,
   nunca abaixo de 0. Unidades devolvidas antes de faturar simplesmente não se faturam; unidades
   devolvidas depois de faturadas pedem uma nota de crédito de Devolução (até lá a encomenda tem
   excedente/valor a regularizar).
3. **Repartição dos descontos depois de faturar em partes:** os valores já faturados ficam
   **fixos**. O que falta = total atual da encomenda − total líquido faturado, repartido
   proporcionalmente pelas quantidades ainda por faturar (produtos) e pelas linhas de portes por
   faturar. Se o que falta for ≤ 0, não há nada por faturar e a diferença negativa aparece como
   excedente (reembolso + nota de crédito, a pedido).
4. **Faturas antigas (por pagamento):** o módulo ainda não está em produção, por isso só existem
   em dados de teste. Contam como faturadas: unidades = `floor(valor faturado da linha / valor
   líquido unitário)`; portes: toda a linha de portes CHECKOUT conta como faturada se uma fatura
   antiga incluiu portes; pagamentos cobertos contam como faturados. Nenhum documento é alterado.
5. **Valor líquido de um pagamento** = valor − reembolsos `COMPLETED`, `PROCESSING` e `PENDING`
   desse pagamento (incluindo crédito na carteira), para a fatura poder sair logo depois do passo
   Reembolsar. Reembolsar um pagamento já faturado continua possível e pede nota de crédito, como
   hoje.
6. **Métodos no Moloni:** Stripe → sempre "Stripe"; vale → se `storeCreditPaymentMethodId` estiver
   configurado usa-o (lojas já configuradas), senão procura/cria "Crédito em carteira"; manual →
   o nome do método (vazio → `paymentMethodId` configurado, como hoje). Se `paymentMethods/insert`
   falhar, a emissão **falha antes** de criar qualquer documento (nada fica meio emitido).
7. **Excedente que bloqueia a fatura** = saldo atual da encomenda: pago − reembolsado − total atual
   > 0 (um só cálculo, o do resumo financeiro).

## 8. Fora de âmbito

- Faturar sem pagamento (a regra exige pagamentos que somem o total).
- Faturar parte de um pagamento.
- Alterar a API do storefront.
- E-mails automáticos (o e-mail "Fatura disponível" continua como hoje, ao emitir).
