# Módulo E-commerce — Documento de Desenho

Data: 2026-11-11
Estado: rascunho para aprovação

## 0. Como ler este documento

Os requisitos funcionais completos estão no documento de requisitos original, guardado em
`docs/superpowers/specs/2026-11-11-ecommerce-requirements.md` (o prompt original, sem alterações).
**Este documento não repete esses requisitos.** Regista o contexto e as decisões tomadas na
conversa de desenho, que **prevalecem sobre o documento de requisitos sempre que o contradizem**,
bem como a arquitetura escolhida.

Quando o documento de requisitos fala em módulos com a mesma numeração (por exemplo, "ponto 14"),
a referência é ao capítulo de Encomendas, salvo indicação contrária.

Marcação usada:
- **[Decisão]**: decidido pelo dono do produto durante a conversa.
- **[Escolha técnica]**: decidido por quem desenhou e passível de revisão.

---

## 1. Intenção e contexto

- O Strapi Suite (`@littlebox/strapi-suite`) é um plugin Strapi 5 gratuito com vários módulos
  (Menus, Atributos, Parâmetros, Slugs, Traduções, Templates). Este trabalho acrescenta um
  **novo módulo E-commerce simples**, distribuído também gratuitamente.
- **Primeiro uso real:** um cliente que já tem o plugin instalado vai fazer upgrade para a versão
  com e-commerce. O upgrade **não pode alterar o comportamento nem os dados dos módulos existentes.**
- O dono do produto vai testar tudo antes de lançar. É um único lançamento: as fases da secção 12
  são ordem de construção e não releases separadas.

### Objetivos
- Implementar os requisitos de Produtos, Encomendas, Clientes, Promoções, Configurações e API do
  Storefront com as alterações descritas abaixo.

### Não-objetivos (nesta versão)
- Contas de cliente, login, área reservada (como diz o documento de requisitos).
- Multi-tenant (ver 2.1).
- CAPTCHA, Key Vault.
- Moedas além do EUR.

### Anti-objetivos (falha mesmo que "funcione")
- Partir ou alterar o comportamento de qualquer módulo existente após o upgrade.
- Imagens de produto que possam ser apagadas ou alteradas fora do ecrã de Produtos.
- Duplicar cobranças, reembolsos, faturas, e-mails ou movimentos de stock.

---

## 2. Decisões transversais

### 2.1 Single tenant **[Decisão]**
Cada loja é uma instalação separada do Strapi. Não há entidade "loja" nem `storeId` nas tabelas.
Todas as regras de "isolamento por loja" do documento de requisitos ficam satisfeitas por pertencer
a esta instalação. As restantes regras de segurança (cifragem, mascaramento, autorização) mantêm-se.

### 2.2 Ativação do módulo **[Decisão]**
- Segue o padrão dos módulos existentes: há uma definição `module = 'ecommerce'`,
  `property = 'active'` em `ltb-st-app-setting`.
- **Vem desligado por defeito** após o upgrade. As rotas do e-commerce (admin e storefront)
  respondem 403 quando o módulo está desligado (`checkModuleIsActive`).

### 2.3 Não alterar o existente **[Decisão]**
As únicas alterações em ficheiros partilhados são aditivas:
- `HomePage.tsx`: novo `Card` "E-commerce" com o botão **"Manage"** (não "Settings").
- `checkModuleIsActive.ts`: novo mapeamento de URL para `ecommerce`.
- `config/index.ts`: novas UIDs.
- Registo de rotas, content-types, serviços e controllers: entradas novas.
- Traduções: ver 2.5.

O código do e-commerce vive nas suas próprias pastas (`server/src/**/ecommerce/`, `admin/src/ecommerce/`).

### 2.4 Proteção dos dados contra edição externa **[Decisão]**
Os dados do e-commerce **pertencem ao plugin**. Todas as content-types do e-commerce ficam com
`pluginOptions: { 'content-manager': { visible: false }, 'content-type-builder': { visible: false } }`,
para não poderem ser alteradas pelo Content Manager nem pelo Content-Type Builder.

### 2.5 Idiomas
- **Interface admin em inglês e português [Decisão].** Novo `pt.json`. As chaves que não existam em
  `pt` (módulos antigos) caem para o inglês **[Escolha técnica]**.
- **Idiomas de conteúdo** = os locales configurados em *Settings → Internationalization* do Strapi
  (`strapi.plugin('i18n').service('locales')`). O locale por defeito do Strapi é o idioma principal.

### 2.6 Nomes de campos **[Decisão]**
Todos os nomes de campos e atributos são em **inglês**.

### 2.7 Dinheiro **[Escolha técnica]**
- Apenas EUR.
- Valores guardados como **inteiros em cêntimos** (`amountCents`), nunca `float`.
- O IVA é calculado a partir de preços com IVA incluído (ver 3.3), com arredondamento ao cêntimo
  (half-up). Os arredondamentos de repartições acertam-se na última linha.

### 2.8 Ilustrações **[Decisão]**
Todas as ilustrações (estados vazios, etc.) são SVG **minimalistas, a preto e branco**, no estilo de
referência do dono do produto: traço desenhado à mão, áreas preenchidas a preto sólido, personagens
ou objetos simples e pequenos detalhes decorativos (estrelas, rabiscos). Sem cor nem gradientes.
O "preto" usa `currentColor` / tokens do tema para inverter no modo escuro do Strapi.

### 2.9 Mascaramento de segredos **[Decisão]**
Usar o **mesmo formato já existente** no plugin (`maskSecret` em `services/app/setting.ts`):
3 primeiros caracteres + `********` + 4 últimos (ou `********` se o valor tiver 8 ou menos caracteres).
**Isto substitui** o formato "4 caracteres + `....`" do documento de requisitos.

### 2.10 Cifragem dos segredos **[Escolha técnica]**
- AES-256-GCM com `node:crypto`.
- A chave mestra vem da configuração global do servidor: config do plugin
  `ecommerce.encryptionKey`, tipicamente lida de `LTB_ECOMMERCE_ENCRYPTION_KEY`.
- Sem chave configurada, o ecrã de Configurações mostra um aviso e recusa guardar segredos.
  O resto do módulo continua a funcionar.
- Os segredos do e-commerce ficam numa content-type própria (ver 9). A chave de IA do módulo de
  Traduções **não é alterada**.

---

## 3. Produtos

### 3.1 Modelo **[Decisão]**

**`Product`** (informação comercial e descritiva)
| Campo | Notas |
|---|---|
| `id` | |
| `name` | obrigatório, traduzível |
| `slug` | gerado a partir de `name`, traduzível, único por locale |
| `shortDescription` | traduzível |
| `description` | obrigatório (no locale por defeito), texto rico, traduzível |
| `active` | boolean |
| `gallery` | imagens do produto (ver 3.4) |
| `createdAt`, `updatedAt` | |

**`ProductVariant`** (o que se vende, cobra, conta em stock e expede)
| Campo | Notas |
|---|---|
| `id` | |
| `product` | relação |
| `option` | texto livre ("Preto", "M"), obrigatório, traduzível |
| `sku` | obrigatório, **único na instalação** **[Escolha técnica]** |
| `price` | cêntimos, **IVA incluído** **[Decisão]** |
| `tax` | taxa de IVA em % **[Decisão: configurável por produto, guardada por variante]** |
| `stock` | inteiro ≥ 0 **[Escolha técnica, aceite]** |
| `weight` | kg, por defeito 0 |
| `width`, `height`, `depth` | cm, por defeito 0 |
| `active` | boolean |
| `gallery` | se estiver vazia, usa a do produto **[Decisão]** |
| `createdAt`, `updatedAt` | |

- **Todo o produto tem pelo menos uma variante [Decisão].** Não há "produto simples" com campos de
  venda no próprio produto. Uma caneca sem tamanhos tem uma variante única.
- Encomendas, stock, portes e faturas referem sempre a variante.
- Variante inativa: não aparece no storefront, mas continua visível nas encomendas antigas.
  Produto inativo esconde todas as suas variantes **[Escolha técnica, aceite]**.
- Eliminar: um produto ou uma variante que já esteja em alguma encomenda (em qualquer estado) não
  pode ser eliminado, só desativado. Sem encomendas, o botão "Delete" (produto) e o ícone da lixeira
  (variante) eliminam-no com confirmação, junto com as imagens no servidor. O estado é calculado a
  partir das linhas de encomenda (`productId`/`variantId`), sem campo próprio na BD
  **[Decisão, 2026-11-11]**.

### 3.2 Traduções **[Decisão]**
- Um produto é **um único registo**. Não se cria um produto por idioma (não usar documentos i18n do Strapi).
- `name`, `slug`, `shortDescription`, `description` e `option` têm um valor por locale configurado no Strapi.
- O locale por defeito é obrigatório. Os outros são opcionais e caem para o locale por defeito.
- O formulário tem um seletor de idioma e um botão **"Traduzir com IA"** que preenche os idiomas em
  falta a partir do locale por defeito, reutilizando o serviço `ai-translation` e a chave do módulo
  de Traduções. Sem chave configurada, o botão fica desativado com uma dica a explicar porquê.
- **[Escolha técnica]**: guardar as traduções numa tabela filha (`product-translation`,
  `variant-translation`) com `locale` e os campos traduzíveis, garantindo `slug` único por locale.

- **[Decisão]** O editor de `description` permite **apenas negrito, itálico e sublinhado**, mais nada:
  sem links, listas, títulos, imagens ou cores. O texto é guardado como HTML com uma *allow-list*
  estrita aplicada no servidor: `p`, `br`, `strong`, `em`, `u`, sem atributos. As quebras de
  parágrafo e de linha mantêm-se **[Escolha técnica]**. É devolvido ao storefront nesse HTML.

### 3.3 IVA
- Os preços introduzidos incluem IVA. Base tributável = `price × 100 / (100 + tax)`, arredondada ao cêntimo.
- A taxa de IVA dos portes vem do método de entrega e é configurável, com 23% por defeito
  **[Escolha técnica]**.

### 3.4 Imagens **[Decisão]**
- **Não usar a Biblioteca de Media do Strapi.** As imagens pertencem ao plugin e não podem ser
  alteradas por quem instala o plugin.
- **[Escolha técnica]**: os ficheiros são enviados diretamente para o *provider* de upload
  configurado no Strapi (`strapi.plugin('upload').provider.upload`), seja disco local ou S3, **sem**
  criar registos em `plugin::upload.file`. Os metadados ficam numa content-type do plugin
  `ltb-st-module-ecommerce-image` (`name`, `width`, `height`, `sizeBytes`, `url`, `providerMeta`, dona).
- **Modal de upload com dois modos [Decisão]:**
  1. **Recortar**: o administrador indica largura × altura. A área de recorte fica presa a essa
     proporção, ele escolhe a zona e o resultado é redimensionado para o tamanho exato.
  2. **Redimensionar**: muda só o tamanho, sem recorte. A proporção fica bloqueada por defeito,
     com um cadeado para a desbloquear **[Escolha técnica, aceite]**.
- O processamento é feito no servidor com `sharp` (já dependência do Strapi): recebe o original e as
  coordenadas, recorta e/ou redimensiona, converte para **WebP com qualidade 80**, guarda só o
  resultado e **nunca persiste o original** **[Escolha técnica, aceite]**.
- Ao clicar numa imagem, abre uma modal com nome, dimensões, peso e o botão **Eliminar**.
  Eliminar pede confirmação e remove a imagem do produto e do provider.

### 3.5 Ecrãs
- **Lista:** colunas thumbnail, nome, SKU, preço, stock e Editar **[aceite]**. Mostra 50 por página,
  com paginação no servidor e pesquisa por `name` ou SKU das variantes. Quando está vazia,
  mostra uma ilustração e o botão "Criar o primeiro produto".
- **Formulário (aprovado no mockup v3):** cabeçalho com voltar, toggle `active` e Guardar. Tem secções:
  1. Informação: `name` (slug visível), `shortDescription`, `description` (texto rico), com
     seletor de idioma e "Traduzir com IA".
  2. Galeria.
  3. Variantes: tabela com thumbnail, `option`, `sku`, `price`, `tax`, `stock`, `active` e Editar.
     Quando está vazia, mostra uma ilustração e o botão "Adicionar variante". **Não se pode guardar sem pelo menos uma variante.**
- **Modal da variante:** `option`*, `active`, `sku`*, `stock`*, `price`*, `tax`*, `weight`,
  `width` × `height` × `depth`, `gallery` (vazia significa usar a do produto) e seletor de idioma para `option`.

### 3.6 Navegação
Card "E-commerce" → **Manage** → dashboard do e-commerce com menu lateral: Products, Orders,
Customers, Promotions, Settings (traduzidos).

---

## 4. Encomendas: alterações e decisões

Implementar o capítulo de Encomendas do documento de requisitos (pontos 1–17), com estas decisões:

### 4.1 Arquivamento **[Decisão]**
**Arquivar** só fica disponível (UI e backend) quando **todas** estas condições se verificam:
- `OrderStatus = OPEN`;
- `FulfillmentStatus = FULFILLED`;
- **todas as expedições têm a entrega confirmada**;
- o valor em dívida é zero;
- não há excedente por reembolsar (montante reembolsável = 0);
- não há pagamentos `PENDING` nem reembolsos `PENDING` ou `PROCESSING`.

Uma encomenda totalmente expedida que recebe produtos novos volta a `PARTIALLY_FULFILLED`, pelo que
**Arquivar** fica indisponível até esses produtos serem expedidos (4.17).

### 4.2 Confirmação manual de entrega **[Decisão]**
O administrador pode marcar uma expedição como **entregue manualmente**, com data. Fica registado
no histórico com o utilizador. Isto conta para "entrega confirmada" (arquivamento, e-mail de entrega).

### 4.3 Métodos de entrega manuais **[Decisão]**
Além dos plugins de transportadora (CTT Expresso), existe um fornecedor **Manual** de origem:
- o administrador cria vários métodos manuais (por exemplo, "Levantamento na loja" a 0 €,
  "Entrega própria" a 5 €), cada um com nome traduzível, preço fixo, taxa de IVA e `active`;
- não geram etiqueta; o código e o link de rastreio são opcionais no envio;
- entram no checkout como qualquer outra opção.

### 4.4 Faturação por seleção **[Decisão, atualizada em 2026-11-14]**
Detalhe e razões em [`2026-11-14-invoicing-by-selection-design.md`](2026-11-14-invoicing-by-selection-design.md),
que é a referência para esta secção.
- **O lojista escolhe o que faturar**, na modal "Gerar fatura" (botão de secção na encomenda; a
  ação por pagamento desaparece): **produtos com quantidades** (parte da quantidade pode ficar
  para outra fatura), **linhas de portes positivas** (cada uma individualmente, com o seu IVA) e
  **pagamentos inteiros**. Só se oferece o que ainda não foi faturado. A fatura só se emite quando
  o **total selecionado é igual ao total dos pagamentos, ao cêntimo**; o servidor valida de novo.
- **Excedente bloqueia:** se a encomenda tem valor pago a mais, a emissão fica bloqueada até se
  **Reembolsar**. Valor que sobra sem unidades por faturar fica para uma nota de crédito de
  **Correção** e nova fatura. Uma linha de portes negativa só baixa o valor dos portes e cria
  excedente; nunca se fatura.
- **Dois conjuntos (produtos e portes) e a sua repartição [Escolha]:** os descontos de encomenda
  repartem-se proporcionalmente pelas linhas de produto, o desconto de portes pelas linhas de
  portes; a repartição é determinística e soma o total da encomenda ao cêntimo. Os valores já
  faturados ficam fixos; o que falta reparte-se pelas quantidades ainda por faturar.
- **Pagamentos pelo valor líquido [Escolha]:** valor pago − reembolsos desse pagamento (dinheiro e
  crédito em carteira, incluindo os ainda em curso), para a fatura poder sair logo após o reembolso.
- **Moloni:** um pagamento Moloni por pagamento escolhido; o método é procurado **pelo nome** e
  **criado automaticamente** se não existir (se falhar, nada é emitido). Artigos pela
  `reference = sku`, criados se não existirem **[Escolha técnica]**.
- **Notas de crédito por motivo [Decisão]**, sempre a pedido do administrador, nunca automáticas:
  - **Devolução:** credita as unidades devolvidas que já estavam faturadas (e, opcionalmente,
    portes da fatura); essas unidades não voltam a ficar por faturar;
  - **Correção:** anula a fatura inteira; quando emitida (`ISSUED`), liberta produtos, portes e
    pagamentos para se emitir a fatura certa.
- **Faturas antigas (por pagamento)** continuam válidas e leem-se como faturadas: as suas linhas
  e os pagamentos que cobriram deixam de estar disponíveis; nenhum documento é alterado.
- Faturas emitidas nunca mudam. Descontos ou portes recalculados depois de faturar só movem o
  saldo (valor em dívida ou excedente); a nota de crédito só é emitida a pedido do administrador
  **[Decisão, 2026-11-13]**. As regras fiscais detalhadas continuam fora de âmbito.

### 4.5 Devoluções **[Decisão]**
Nova ação **Registar devolução** no ecrã da encomenda, que não existia no documento de requisitos:
- disponível quando existem unidades enviadas e ainda não devolvidas (também em encomendas `FULFILLED`);
- o administrador escolhe as variantes e as quantidades, até ao que foi enviado menos o que já voltou;
- **por linha, escolhe se a unidade volta ao stock** (por exemplo, não volta se vier danificada);
- o valor efetivamente pago por essas unidades (preço com descontos de linha, mais a parte
  proporcional do desconto de encomenda) passa a ser **montante aprovado para reembolso**;
- **não executa reembolso**: o botão Reembolso passa a aparecer e usa o fluxo do ponto 15;
- não altera expedições nem `FulfillmentStatus` (as unidades foram enviadas);
- fica registada no histórico e nos movimentos de stock (`RETURN_RESTOCK` ou `RETURN_NO_RESTOCK`);
- o cancelamento posterior só repõe as quantidades ainda descontadas (calculadas pelos movimentos),
  sem repor duas vezes.

### 4.6 Stripe **[Escolha técnica, comunicada]**
- **Stripe Checkout Sessions** para o pagamento do checkout e para os links de pagamento
  complementar enviados por e-mail.
- A liquidação é confirmada por **webhook** (`checkout.session.completed`,
  `payment_intent.succeeded`, `charge.refunded`, `refund.updated`), com verificação de assinatura e
  processamento idempotente pelo `event.id`.
- Uma sessão ativa por montante em dívida. É reutilizada se for válida para o mesmo montante e
  expirada ou substituída se o montante mudar.
- Reembolsos através da API de Refunds sobre o `payment_intent` original, com `Idempotency-Key`.

### 4.7 Vale de crédito (código de compensação) **[Decisão]**
Substitui "código promocional de compensação" do documento de requisitos:
- É um **vale com saldo**, válido **só para o e-mail do cliente**, consumido em **várias compras**.
- Tem validade configurável na emissão, com 12 meses por defeito.
- **É um método de pagamento, não uma promoção.** No checkout ou na criação manual, o vale entra
  como `Payment` de método `STORE_CREDIT`, `COMPLETED` na hora, e consome o saldo. As faturas
  mostram os produtos ao preço real e o vale como forma de pagamento. O vale não participa nas
  regras de acumulação de promoções.
- Reembolsar um pagamento `STORE_CREDIT` devolve o valor ao saldo do vale e não em dinheiro.
- O saldo é um *ledger* (emissão, consumo, reposição, expiração), atómico e idempotente.
- A emissão a partir do Reembolso (modalidade "Código promocional") cria um vale e envia o e-mail.
  Continua a não contar como reembolso monetário.
- Admin: os vales aparecem em Promotions, num separador "Store credit", só para consulta e ajustes registados.

### 4.8 Promoções em encomendas editadas **[Decisão, atualizada em 2026-11-13]**
Define a política deixada em aberto no ponto 2.19 das Promoções:
- Guardar produtos **nunca reavalia** promoções: as regras das linhas mantêm-se (as linhas existentes
  mantêm o desconto por unidade e, se a quantidade baixar, o desconto baixa na mesma proporção; os
  produtos acrescentados entram sem promoção).
- **Recalcular descontos** existe sempre que a encomenda pode ser alterada (também depois de faturas
  ou expedições parciais). Considera as promoções automáticas e os códigos usados no checkout;
  o que se mantém mas deixa de ser válido **conserva o valor guardado**. Confirmar reserva ou liberta
  utilizações (ver 6).
- Alterar os portes **mantém o desconto de portes em euros**, limitado ao valor bruto dos portes, e
  marca a encomenda com `DISCOUNTS_REVIEW`. Isto substitui "a promoção de portes deixa de se aplicar".
- O ajuste manual passa a ser o **desconto livre** (fixo ou percentual, com motivo), descrito em
  4.17 e na especificação de edição por secções.
- Se uma condição deixar de se cumprir (por exemplo, um mínimo), **o desconto não se perde**.
  Os **avisos persistentes** (`SHIPPING_REVIEW`, `DISCOUNTS_REVIEW`, guardados na encomenda e
  visíveis até serem resolvidos) substituem o "aviso no resumo da modificação".

### 4.9 Idioma da encomenda
- A encomenda guarda o `locale` com que foi criada: o storefront envia-o, e nas encomendas manuais
  o administrador escolhe, com o locale por defeito como predefinição **[Escolha técnica]**.
- As linhas da encomenda guardam a **fotografia** do nome do produto e do `option` nesse locale, além
  do SKU, do preço e da taxa (não mudam se o catálogo mudar).

### 4.10 Cálculo do PaymentStatus (prioridade determinística) **[Escolha técnica]**
Com `paid` = liquidados, `refunded` = reembolsos monetários concluídos e reembolsos de vale,
`net = paid − refunded` e `total` = total atual:
1. `refunded > 0` e `net ≤ 0` → `REFUNDED`
2. `refunded > 0`, `total > 0` e `net ≥ total` → `PAID` (só foi devolvido o excedente: o que fica
   cobre a encomenda) **[Decisão, 2026-11-14]**
3. `refunded > 0` → `PARTIALLY_REFUNDED`
4. `paid = 0` → `PENDING`
5. `net < total` → `PARTIALLY_PAID`
6. caso contrário → `PAID`

O dashboard mostra sempre também os saldos detalhados (ponto 9.3).

### 4.11 Referência da encomenda **[Escolha técnica]**
Sequencial e legível (`#1001`, `#1002`…), única, gerada em transação. O identificador público do
storefront é um ID opaco separado (ver 8).

---

### 4.12 Devolução reduz o total atual **[Escolha técnica]**
Registar uma devolução reduz a quantidade efetiva da linha (`quantity − returnedQuantity`) e,
portanto, o **total atual** da encomenda, pelo valor efetivamente pago dessas unidades.
Consequências:
- o excedente (`net > total`) passa a ser o montante reembolsável;
- depois do reembolso, a dívida e o excedente voltam a zero e a encomenda pode ser arquivada (4.1);
- "Adicionar pagamento" não aparece por engano;
- a quantidade enviada e o `FulfillmentStatus` não mudam;
- a nota de crédito de **Devolução** credita as unidades devolvidas que já tinham sido faturadas;
  unidades devolvidas antes de faturar simplesmente não se faturam (2026-11-14). É emitida a pedido
  do administrador, pelo mecanismo de 4.4.

### 4.13 Links nos e-mails e no Stripe **[Escolha técnica]**
- Definições: `storefrontUrl` e caminhos configuráveis para sucesso, cancelamento e "pagar encomenda".
- **[Decisão]** O link de pagamento nos e-mails é **diretamente o URL da Checkout Session do
  Stripe**. Nunca aponta para o backend ou backoffice. A sessão é criada no momento do envio, com a
  validade máxima do Stripe (24 h).
- O e-mail informa que **o link expira** e pede que o pagamento seja feito o mais breve possível,
  mostrando a data e hora de expiração.
- Se o cliente não pagar a tempo, o administrador gera um link novo no backoffice
  ("Enviar instruções de pagamento" → Stripe). Isso expira a sessão anterior ainda aberta e cria
  uma nova para o valor em dívida atual. Não há regeneração automática.
- **[Decisão]** O e-mail "Fatura disponível" leva o **PDF da fatura em anexo**. Não tem botão nem
  link de download (substitui 11.10 e 13.11). O download por URL existe só no admin, protegido pela
  sessão de administrador.
- **[Decisão, 2026-11-13]** Há um 14.º e-mail, "Nota de crédito emitida" (`CREDIT_NOTE_ISSUED`),
  enviado quando uma nota de crédito fica emitida, com o **PDF da nota de crédito em anexo**, tal
  como a fatura. Variáveis: `creditNote.number`, `creditNote.amount` e `creditNote.invoiceNumber`
  (a fatura que corrige). O modelo é editável como os outros.
- **[Decisão] Regra geral:** nenhum e-mail, nem nenhuma resposta da API ao storefront, contém URLs
  do backend ou backoffice do Strapi. Os URLs permitidos nos e-mails são o `storefrontUrl` e o
  Stripe.
- O link seguro de acesso à encomenda (ponto 2.14 das APIs) **não** é implementado nesta versão.

### 4.14 Métodos de pagamento Stripe **[Escolha técnica]**
São usados os métodos ativos na conta Stripe (*automatic payment methods*), o que inclui Multibanco
e MB WAY se o cliente os tiver ativos. Os eventos `checkout.session.async_payment_succeeded` e
`checkout.session.async_payment_failed` também são tratados: o pagamento fica `PENDING` até à
confirmação.

### 4.15 Moloni: parâmetros fiscais configuráveis **[Escolha técnica]**
O tipo de documento (fatura-recibo FR ou fatura FT seguida de recibo), a série, o motivo de isenção
para linhas a 0% e o tratamento de clientes fora de Portugal são **definições do plugin Moloni**.
Os valores por defeito são FR, a série por defeito do Moloni e nenhum motivo de isenção (a emissão
falha com uma mensagem clara se existirem linhas a 0% sem motivo configurado). O contabilista da
loja escolhe os valores.

### 4.16 Mercados e métodos de envio por mercado com escalões de peso **[Decisão, 2026-11-12]**
Substitui as zonas de envio (removidas). A elegibilidade dos métodos é definida em dois níveis:
- **Mercados:** a definição da loja `markets` lista os países a que a loja vende. Valida as moradas
  no checkout e nas encomendas do admin. Retirar um país dos mercados enquanto um método ou uma
  transportadora o usa é recusado (`MARKET_IN_USE`, com os nomes dos métodos).
- **Métodos manuais por mercado:** cada método escolhe os mercados que serve e, por mercado,
  define escalões de peso `{ upTo: kg | null, price: cêntimos }`. Decisões:
  - o escalão tem só limite superior; o limite superior é inclusivo e o limite inferior (o `upTo` do
    escalão anterior) é exclusivo — um peso igual ao limite fica no escalão desse limite; o primeiro
    escalão começa em 0; `null` significa sem limite, apenas no último escalão;
  - o peso da encomenda é a soma de `peso da variante × quantidade`;
  - um peso acima do último escalão torna o método indisponível para essa encomenda (não é erro:
    o método deixa de ser oferecido).
- **Transportadoras via API (por exemplo, o CTT):** escolhem os mercados que servem; o preço vem
  da cotação da API (a reavaliar quando chegar a documentação da API do CTT).

O contrato da API da loja não muda.

Portes grátis acima de um valor fazem-se com Promoções.

### 4.17 Edição da encomenda por secções **[Decisão, 2026-11-13]**
Substitui o fluxo único de modificação do requisito 16 e o botão **Modificar**, removidos (modal e
endpoints incluídos). Cada secção da encomenda é editada por si:
- **Produtos:** adicionar, alterar e remover linhas; cada correção indica a linha que corrige e só as linhas originais são editáveis;
  uma encomenda totalmente expedida aceita produtos novos (4.1).
- **Portes:** os portes são linhas (`CHECKOUT`, `RECALCULATION`, `EDIT`, `MANUAL`). Regra: **substitui-se
  só sem expedições e sem fatura emitida; caso contrário acrescenta-se a diferença**.
- **Descontos:** Recalcular descontos (4.8) e descontos livres fixos ou percentuais com motivo; a soma
  dos livres fica limitada ao desconto da encomenda (primeiro os antigos, depois os mais recentes).
- **Avisos persistentes** `SHIPPING_REVIEW` e `DISCOUNTS_REVIEW` na encomenda.
- Nenhuma edição envia e-mails, reembolsa ou emite notas de crédito automaticamente.

Detalhe completo em `docs/superpowers/specs/2026-11-13-order-editing-design.md`.

## 5. Clientes
Implementar o capítulo 17 com esta simplificação **[Decisão]**:
- Normalização do e-mail: `trim` + minúsculas, sem regras de fornecedor.
- Na criação da encomenda: procura um cliente com esse `emailNormalized`. Se existir, atribui-lhe a
  encomenda. Se não existir, cria-o. Pessoas diferentes com o mesmo e-mail ficam no mesmo cliente,
  o que não é problema porque não há área de cliente.
- **Sem mecanismo de concorrência** (substitui 17.5 e 17.22): não há índice único nem tratamento de
  corridas. Um duplicado raro, criado por dois checkouts simultâneos, é aceitável. A procura usa o
  cliente mais antigo com esse e-mail.
- A edição do e-mail no admin continua a validar que não existe outro cliente com o mesmo e-mail
  (verificação simples).

## 6. Promoções
Implementar os capítulos 1–3 de Promoções tal como estão, com:
- **Vale de crédito** fora do motor de promoções (ver 4.7).
- Política de edição de encomendas (ver 4.8).
- Nome visível ao cliente (no checkout e nos e-mails) traduzível por locale **[Escolha técnica]**.
- Fuso horário da loja: definição `ecommerce.timezone`, por defeito `Europe/Lisbon` **[Escolha técnica]**.
- Limite técnico da procura de combinações: configurável, por defeito 12 promoções elegíveis em
  procura exaustiva. Acima disso, usa uma estratégia gulosa por benefício decrescente, assinalada
  no resultado como "não exaustiva" **[Escolha técnica]**.

## 7. Configurações
Implementar o capítulo de Configurações tal como está, com:
- Mascaramento conforme 2.9 e cifragem conforme 2.10.
- **Moloni:** implementado a partir da documentação pública da API, **sem testes reais** até haver
  credenciais. Sem marca de "não verificado" no admin: cada loja configura e testa a sua conta Moloni **[Decisão, 2026-11-11]**.
  Configuração em 2 passos: (1) Developer ID, Client Secret, utilizador e palavra-passe, guardados
  e verificados com `companies/getAll`; (2) empresa, série, métodos de pagamento, categoria,
  unidade e motivo de isenção escolhidos de listas lidas da API do Moloni
  (`GET /integrations/:id/lookups`). Uma lista que falhe passa a campo de ID manual; os motivos de
  isenção usam a lista de códigos da AT se o Moloni não a devolver. Mudar de empresa limpa os
  campos que dependem dela **[Decisão, 2026-11-11]**.
- **CTT Expresso:** só a **estrutura**. O plugin regista-se no contrato comum, tem o formulário de
  credenciais e o teste de ligação, mas os métodos de API ficam por implementar (erro claro
  `NOT_IMPLEMENTED`) até o dono do produto fornecer a documentação e as credenciais **[Decisão]**.
- **Fornecedor Manual** de entregas (ver 4.3) na secção Métodos de entrega.
- **Modelos de e-mail:** de origem em **inglês** **[Decisão]**. Cada modelo pode ter uma tradução
  (assunto e HTML) por cada locale configurado no Strapi. Envia no locale da encomenda, ou no locale
  por defeito quando não há tradução **[Escolha técnica, aceite]**.
- Motor de templates: substituição de variáveis `{{path}}` com *escape* HTML, sem lógica executável
  (sem Handlebars ou eval) **[Escolha técnica]**. A pré-visualização corre num `iframe` com `sandbox`.

## 8. API do Storefront e sessões anónimas
Implementar os capítulos 1 e 2 de APIs com esta adaptação **[Decisão: o storefront é Next.js com BFF]**.
O browser nunca fala diretamente com o Strapi. Só o BFF (servidor Next.js) conhece o URL do Strapi.
Por isso **[Escolha técnica, consequência da decisão]**:
- **Autenticação do BFF:** as rotas do storefront exigem um **API token do Strapi**, reutilizando a
  policy `check-api-token` existente, para identificar o BFF como chamador confiável. O caminho fica
  sob o *namespace* do plugin (`/api/littlebox-strapi-suite/storefront/...`), a não ser que o Strapi
  permita `/api/storefront` sem conflito.
- **Sessão anónima:** o Strapi gera o token aleatório e guarda só o hash. Devolve o token ao BFF no
  corpo da resposta. O BFF guarda-o no seu próprio cookie `HttpOnly`/`Secure`/`SameSite` para o
  browser e reenvia-o ao Strapi no cabeçalho `X-Checkout-Session`. Os requisitos de cookie do
  ponto 2.4 aplicam-se ao cookie do BFF, que fica documentado como responsabilidade do frontend.
- **CORS e CSRF:** não há CORS no Strapi, porque não recebe pedidos do browser. A proteção CSRF fica
  no BFF e fica documentada.
- **Rate limiting:** em memória, por sessão e pelo IP do cliente que o BFF envia em
  `X-Forwarded-For`, só aceite em pedidos com o API token válido. Chega para uma instância.
- O vale de crédito é aplicado no checkout como pagamento (campo próprio, não "código promocional").

## 9. Arquitetura

### 9.1 Organização
```
server/src/
  content-types/modules/ecommerce/*      # schemas (todas ocultas no CM/CTB)
  services/modules/ecommerce/
    domain/                              # regras puras, sem I/O: cálculos, estados, ações, promoções
    catalog/ customers/ orders/ payments/ stock/ fulfillment/ billing/ refunds/ promotions/
    notifications/ settings/ secrets/ images/ storefront/
    providers/                           # registo + contratos
      billing/moloni/
      carriers/ctt-expresso/ carriers/manual/
      payments/stripe/
      email/resend/
  controllers/modules/ecommerce/*        # validação + autorização + encaminhamento, sem regras
  routes/  (admin-api + content-api)
admin/src/ecommerce/                     # páginas, componentes, gateways (seguir core/ existente)
```

### 9.2 Princípios
- O **domínio puro** (estados, ações disponíveis, totais, repartições fiscais, motor de promoções)
  é composto por funções TypeScript sem Strapi, testadas com Vitest.
- **Contratos de fornecedor** (`BillingProvider`, `CarrierProvider`, `PaymentProvider`, `EmailProvider`)
  com um registo central. Os módulos de negócio só conhecem os contratos.
- **Stock [Decisão: sem mecanismo de concorrência]:** um único serviço altera o stock. Primeiro
  valida a disponibilidade (leitura simples) e depois desconta com um incremento relativo
  (`stock = stock - n`), para não perder atualizações. **Se dois pedidos simultâneos venderem a
  última unidade, o stock pode ficar negativo.** Isso resolve-se à mão; a lista de produtos assinala
  stock negativo. Isto substitui as exigências de atomicidade e concorrência dos pontos 14.2 e 14.11.
  Mantém-se o *ledger* de movimentos com `operationKey` único, para que repetições da mesma operação
  (duplo clique, retries, webhooks repetidos) não descontem nem reponham duas vezes.
- **Promoções e vales: capacidade estrita [Decisão].** Ao contrário do stock, os limites de
  utilização das promoções (global e por cliente) e o saldo dos vales de crédito **nunca podem ser
  ultrapassados**.
  - No momento em que a encomenda é registada, verifica-se se cada desconto ou vale ainda pode ser
    aplicado. Se puder, a capacidade é consumida.
  - **[Escolha técnica]** O consumo é feito com um `UPDATE` condicional portável
    (`... SET used = used + 1 WHERE id = ? AND used < limit`; para vales,
    `... SET balance = balance - x WHERE id = ? AND balance >= x`). O limite por cliente usa um
    contador por promoção e cliente, com o mesmo padrão. Se a atualização não afetar nenhuma linha,
    a capacidade esgotou-se: a encomenda **não é criada** e o stock não é descontado. Tudo isto corre
    na mesma transação da criação da encomenda.
  - **[Decisão]** A API devolve um **erro** ao frontend: HTTP 409 com um código estável
    (`PROMOTION_UNAVAILABLE` ou `STORE_CREDIT_INSUFFICIENT`), o identificador ou código da promoção
    ou do vale afetado e uma mensagem. O frontend decide o que mostrar e pode pedir uma nova cotação.
    A mesma regra aplica-se à criação manual no admin, onde o erro é mostrado no formulário.
  - **Cancelamento devolve a capacidade:** a utilização da promoção é libertada e o valor consumido
    volta ao saldo do vale. É idempotente e fica registado no histórico.
  - No vale, a devolução de saldo no cancelamento é registada como um **reembolso `COMPLETED` do
    pagamento `STORE_CREDIT`**, para que o `PaymentStatus` a reflita e a modal de Reembolso não volte
    a oferecer esse valor. Nunca se devolve o mesmo saldo duas vezes **[Escolha técnica]**.
  - O reembolso de um pagamento `STORE_CREDIT` devolve saldo ao vale (4.7). Guardar produtos não
    consome nem liberta utilizações de promoção; **confirmar Recalcular descontos reserva ou liberta
    utilizações** (4.8) **[Decisão, 2026-11-13]**.
- **Idempotência:** chaves únicas (`idempotencyKey` / `operationKey` / `externalEventId`) em
  pagamentos, reembolsos, faturas, expedições, notificações e movimentos.
- **Eventos e notificações [Decisão: sem cron]:** o evento de domínio é gravado na mesma transação
  da operação, com chave única por evento e tipo. O e-mail é enviado **de imediato, logo após o
  commit**. Se o envio falhar, a notificação fica `FAILED` no histórico, com o erro, e o
  administrador tem o botão **Reenviar**. Não há worker nem cron. Um evento nunca gera dois envios
  com sucesso.
- **Bases de dados [Decisão]:** tem de funcionar em todas as bases de dados suportadas pelo Strapi
  (SQLite, Postgres, MySQL/MariaDB). O primeiro cliente usa MariaDB. Só se usa a Query Engine do
  Strapi ou knex portável, sem SQL específico de um motor. A referência da encomenda usa a última
  referência + 1, com índice único e uma nova tentativa em caso de colisão.
- **Instâncias [Escolha técnica]:** assume-se uma instância do Strapi. O rate limiting em memória
  fica documentado como válido só nesse cenário.
- **Encomendas não pagas [Decisão]:** mantém-se a regra dos requisitos: sem cancelamento automático,
  também nas encomendas criadas pelo storefront.
- **Histórico:** uma tabela `order-history` só de inserção, com os campos do ponto 6.2.
- **Orçamento de mudanças nos ficheiros partilhados:** só as alterações aditivas de 2.3.
- **Permissões [Escolha técnica]:** registar ações RBAC do Strapi por área (Products, Orders, Customers,
  Promotions, Settings) e para ações sensíveis (Refunds, Invoicing, Settings secrets). Cada rota do
  e-commerce tem a policy correspondente e o admin esconde o que o utilizador não pode fazer.
  O Super Admin tem tudo por defeito. As rotas dos módulos existentes não mudam.

## 10. Testes
- Unitários (Vitest) em todo o domínio puro: os cenários listados nos critérios de aceitação de
  Encomendas, Promoções (2.24) e Stock.
- Integração com SQLite em memória para idempotência (movimentos de stock, webhooks, pagamentos e
  reembolsos repetidos), quando o setup de testes do projeto o permitir. Não há testes de
  concorrência, por decisão.
- Fornecedores externos testados com *mocks* do contrato.

## 11. Fora de âmbito / deixado para depois
- Integração real do CTT (aguarda documentação e credenciais).
- Testes reais do Moloni (aguarda credenciais).
- Regras fiscais detalhadas de regularização além da emissão da nota de crédito.

## 12. Ordem de construção (um só lançamento)
1. Base: ativação do módulo, card, layout e menu, segredos e cifragem, imagens, i18n de conteúdo.
2. Produtos.
3. Configurações: definições, fornecedores (Stripe, Resend, Moloni, CTT-estrutura, Manual), modelos de e-mail.
4. Clientes e núcleo de Encomendas: estados, stock, criação manual, histórico, pagamentos manuais.
5. Stripe, Expedições, Devoluções, Reembolsos, Vale de crédito, Faturação, Notificações.
6. Promoções (motor e admin) e integração com encomendas.
7. API do Storefront e sessões anónimas.
