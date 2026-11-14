# Módulo DPD Portugal — Documento de Desenho

Estado: para aprovação (2026-11-14). Complementa `2026-11-11-ecommerce-design.md`
(4.16 mercados e escalões de peso, 9.2 contratos de fornecedor) e
`2026-11-13-order-editing-design.md` (portes e moradas da encomenda).

Marcas: **[Decisão]** foi pedido pelo utilizador; **[Escolha técnica]** é decisão minha, que o
utilizador pode rever; **[Construtor]** fica ao critério de quem implementa.

## 1. Intenção

A loja do cliente envia com a DPD Portugal e precisa de duas opções no checkout: entrega em casa
(DPD Express) e levantamento num ponto DPD (DPD Pickup). O módulo cria os envios e as etiquetas
na DPD a partir do admin e oferece ao site uma pesquisa de pontos Pickup, para que o frontend
nunca fale com a DPD.

### Objetivos
- Novo módulo **DPD Portugal** em Settings → Shipping: isolado, ativado e desativado como os outros
  transportadores **[Decisão]**.
- Dois serviços, **DPD Express** e **DPD Pickup**, cada um ativado ou desativado à parte
  **[Decisão]**.
- Preços definidos à mão, como nos métodos manuais: por mercado, com escalões de peso, **uma tabela
  para o Express e outra para o Pickup** **[Decisão]**. A DPD Portugal não tem API pública de
  cotação (pesquisa feita a 2026-11-14), por isso o preço não vem da DPD.
- Os preços aparecem onde já se cotam portes: `POST /cart/quote` do storefront, encomendas manuais,
  edição e recálculo de portes da encomenda **[Decisão]**.
- Endpoint público do storefront para pesquisar pontos Pickup, com o API token e a sessão dos
  outros endpoints; o nosso backend chama a DPD **[Decisão]**.
- No DPD Pickup, a **morada de entrega da encomenda passa a ser a do ponto**. A morada de faturação
  continua a do cliente **[Decisão]**.
- Criar o envio na DPD a partir do botão Ship, com a sub-conta certa, e obter código de seguimento e
  etiqueta PDF.

### Não-objetivos
- Cotação automática pela DPD (não existe API pública; revê-se se a DPD a fornecer).
- Estado da entrega e cancelamento na DPD: o exemplo não mostra API para isso. A entrega continua a
  ser confirmada à mão (4.2 do design principal).
- Pagamento à cobrança, serviço Predict, envios para fora de Portugal com regras especiais da DPD.

### Anti-objetivos
- Mudar o comportamento do Manual shipping, do CTT Expresso ou de qualquer módulo fora do e-commerce.
- Mostrar ou registar credenciais, chaves ou dados de clientes em logs.
- Uma encomenda DPD Pickup sem ponto escolhido, ou com um ponto que a DPD não devolveu.

## 2. O que se sabe da API da DPD

Retirado do projeto `gamezone` (só leitura). Não há documentação oficial disponível.

### 2.1 Autenticação e criação de envio (REST)
- `POST <endpoint de autenticação>` com JSON
  `{ username, password, client_id, client_secret, grant_type: "password" }`. Resposta:
  `{ status_code: 200, result: { access_token } }`. Um `status_code` diferente de 200 é falha.
- `POST <endpoint de expedição>` com `Authorization: Bearer <token>` e o corpo abaixo. Resposta:
  `result.num_guia[0]` (número de guia = código de seguimento) e `result.pdf_url` (etiqueta).
- Campos do corpo usados no exemplo (nomes exatos da DPD):
  - `sub_account.code`: **account home** para Express, **account shop** para Pickup.
  - `sender { name, mobile, mobile_code: "351", email, save: false }`.
  - `shipper { name, address, zip_code, location, country: { id: "PT" } }` (morada do remetente).
  - `recipient { name, save: false }`; `contact { name, mobile, mobile_code, email, save: false }`.
  - `address { country: { id, iso2 }, address, zip_code, location, save: false }`; o exemplo
    corta a morada em 2 × 32 caracteres e formata o código postal `NNNN-NNN`.
  - Pickup: `destinatario_usar_endereco_pickup: true`, `recipient_pickup_store.number: <PUDO_ID>`,
    `pickup_store_name`, `pickup_store_mobile`, `pickup_store_mobile_code`, `pickup_store_email`.
    Express: `destinatario_usar_endereco_pickup: false`, `recipient_pickup_store.number: ""`.
  - `encomenda_referencia`, `expedition_date` (`yyyy-MM-dd`), `encomenda_peso_envio` (kg, texto),
    `encomenda_num_volumes`, `opcoes_servico_enviar_a_cobranca: false`,
    `opcoes_servico_predict_para_entrega: false`, `etiqueta_formato: { id: 1 }`,
    `pdf_response: true`, `zpl_response: false`, `qr_response: false`,
    `etiqueta_enviar_etiqueta_por_email: false`.
- O token não foi guardado entre pedidos no exemplo. **[Escolha técnica]** Pede-se um token por
  operação; sem cache.

### 2.2 Pontos Pickup (SOAP)
- WSDL `http://mypudo.pickup-services.com/mypudo/mypudo.asmx?wsdl`, operação `GetPudoList` com
  `{ zipCode, countrycode: "PRT", key, city: "?", carrier: "CHR", requestID: "DPD-PT" }`.
  `key` é uma chave própria, diferente das credenciais REST.
- Resposta: `GetPudoListResult.RESPONSE.ERROR` em caso de erro; senão
  `GetPudoListResult.RESPONSE.PUDO_ITEMS.PUDO_ITEM[]` com `PUDO_ID`, `NAME`, `ADDRESS1`,
  `ADDRESS2`, `STREETNUM`, `ZIPCODE`, `CITY` e
  `OPENING_HOURS_ITEMS.OPENING_HOURS_ITEM[] { DAY_ID, START_TM, END_TM }`.
- O exemplo só pesquisava Portugal continental (códigos postais começados por 9 eram recusados no
  frontend).

## 3. Configuração (Settings → Shipping → DPD Portugal)

### 3.1 Campos
| Campo | Tipo | Notas |
|---|---|---|
| Endpoint de autenticação | URL | obrigatório |
| Endpoint de expedição | URL | obrigatório |
| Client ID | texto | obrigatório |
| Client secret | segredo | obrigatório, cifrado e mascarado (2.9/2.10) |
| Utilizador | texto | obrigatório |
| Palavra-passe | segredo | obrigatório, cifrado e mascarado |
| Account home | texto | obrigatório com o Express ativo |
| Account shop | texto | obrigatório com o Pickup ativo |
| Endpoint de pontos Pickup | URL | por omissão o WSDL de 2.2 |
| Chave de pontos Pickup | segredo | obrigatória com o Pickup ativo |
| Remetente: nome, morada, código postal, cidade, telemóvel, e-mail | texto | obrigatórios; a loja não guarda morada própria **[Escolha técnica]** |

### 3.2 Serviços **[Decisão]**
- Cada serviço (Express, Pickup) tem: ativo sim/não, nome mostrado ao cliente por idioma (como os
  métodos manuais; por omissão "DPD Express" e "DPD Pickup"), taxa de IVA e tabela de preços.
- Tabela de preços igual à dos métodos manuais (4.16): por mercado da loja, escalões de peso com
  preço em cêntimos, IVA incluído. Um mercado sem tabela não tem esse serviço. Reutiliza o editor de
  escalões do Manual shipping.
- **Desativar os dois serviços desativa o módulo.** Ativar o módulo exige pelo menos um serviço
  ativo e a configuração completa para os serviços ativos. **[Escolha técnica]** A regra vive no
  servidor (a gravação acerta o `active` do módulo); o admin só a reflete.
- Os mercados servidos pelo módulo são os que têm tabela em algum serviço ativo (não há um campo
  "markets" à parte). **[Escolha técnica]** As tabelas e os serviços ficam na configuração do
  módulo (não numa tabela como a dos métodos manuais); `quote` e `servedCountries` em
  `shipping.ts` ganham um caso para os mercados vindos das tabelas, em vez de `config.markets`.

### 3.3 Testar ligação
O botão de teste pede um token (2.1). Se o Pickup estiver ativo, faz também uma pesquisa de pontos
com um código postal fixo (`1000-001`) e só verifica que não há erro.

## 4. Preços e disponibilidade

- Um adaptador de transportador `dpd-portugal` responde a `quote` a partir das tabelas guardadas,
  **sem chamar a DPD**: um `ShippingOption` por serviço ativo cujo mercado tem tabela e cujo peso
  cabe num escalão. `serviceId` é `EXPRESS` ou `PICKUP` **[Escolha técnica]**.
- Entra automaticamente em `POST /cart/quote`, nas encomendas manuais e no recálculo e edição de
  portes, porque todos usam `EcommerceShippingService.quote`.
- O `ShippingOption` ganha um indicador opcional `requiresPickupPoint: true` no Pickup, para o
  frontend e o admin saberem que têm de pedir um ponto **[Escolha técnica]**.

## 5. Pontos Pickup

### 5.1 Endpoint do storefront **[Decisão]**
- `GET /storefront/shipping/pickup-points?postalCode=NNNN-NNN&country=PT` (mesmo API token, sessão
  de checkout e limite de pedidos dos outros endpoints do storefront).
- Devolve `{ points: [{ id, name, address, address2, postalCode, city, country, openingHours:
  [{ day: 1..7, from: "HH:MM", to: "HH:MM" }] }] }`, já normalizado: o frontend não vê o formato da
  DPD.
- Erros com código estável: `PICKUP_NOT_AVAILABLE` (módulo ou serviço Pickup inativo, ou país sem
  tabela), `INVALID_POSTAL_CODE`, `PICKUP_SEARCH_FAILED` (a DPD falhou ou demorou). Uma pesquisa
  sem resultados devolve `points: []`, não é erro.
- **[Escolha técnica]** Cache em memória por código postal durante 10 minutos, para a validação do
  checkout (5.2) não depender de uma segunda resposta da DPD.

### 5.2 Checkout **[Decisão]**
- Com o DPD Pickup escolhido, o checkout exige `pickupPointId`. O servidor confirma-o com uma
  pesquisa pelo código postal do ponto (ou a cache) e recusa um ponto desconhecido com
  `PICKUP_POINT_INVALID`.
- A **morada de entrega** gravada é a do ponto: empresa = nome do ponto, morada, código postal,
  cidade e país do ponto; nome e telefone = os do cliente (a DPD usa-os para avisar). A
  `billingAddress` enviada mantém-se; sem ela, usa-se a morada que o cliente enviou como entrega
  (não a do ponto) **[Escolha técnica]**, porque a fatura nunca deve sair com a morada da loja
  parceira.
- A encomenda guarda o ponto: `pickupPoint { id, name }` junto da linha de portes, para o envio e
  para o admin.
- O checkout já aceita `shippingAddress` e `billingAddress` em separado; não muda.
- **[Escolha técnica]** A morada que o cliente enviou como entrega fica guardada junto do ponto
  (`pickupPoint.customerAddress`), para poder ser reposta.
- **[Escolha técnica]** Se a pesquisa de validação falhar ou demorar (sem cache), o checkout é
  recusado com `PICKUP_SEARCH_FAILED`, que o frontend pode repetir; nunca se aceita um ponto não
  confirmado.

### 5.3 Admin
- Na ficha da encomenda, a secção Shipments and deliveries mostra o ponto Pickup (nome e ID) junto
  da morada de entrega.
- Escolher DPD Pickup no admin (encomenda manual, mudar o método dos portes) abre uma pesquisa de
  pontos por código postal, que usa o mesmo serviço do servidor, e aplica a morada do ponto da mesma
  forma **[Escolha técnica]**.
- Com Pickup, a morada de entrega não é editável à mão; muda-se escolhendo outro ponto
  **[Escolha técnica]**.
- **[Escolha técnica]** Mudar os portes de Pickup para outro método limpa o ponto e repõe
  `pickupPoint.customerAddress` como morada de entrega (o admin pode editá-la a seguir).

## 6. Envios

- O botão Ship, para portes DPD, pede o **número de volumes** (por omissão 1) e cria o envio com a
  sub-conta do serviço, o peso real dos produtos enviados em kg (mínimo 0,1) e a data de hoje.
- **[Escolha técnica]** O contrato `CarrierShipmentRequest` ganha campos opcionais
  `pickupPoint?: { id: string; name: string }`, `parcels?: number` e `weightGrams?: number`; o
  pedido de Ship aceita `parcels`. O CTT ignora-os. O peso é a soma dos pesos (gramas) das
  unidades enviadas, como em `orderWeightGrams`.
- **[Escolha técnica]** Nomes e moradas mais longos que os limites da DPD são cortados como no
  exemplo (morada em 2 × 32 caracteres), nunca recusados.
- `ourReference` (`LB-SHP-<id>`) vai em `encomenda_referencia`, para identificar repetições. O
  exemplo não mostra deduplicação do lado da DPD; um erro de rede depois do envio fica como
  "incerto", como nos outros transportadores, e não é repetido automaticamente.
- Guarda-se o número de guia como código de seguimento e
  `https://tracking.dpd.pt/track-and-trace?reference=<guia>` como link.
- **Etiqueta:** a DPD devolve um URL. **[Construtor]** Descarregar o PDF na criação e guardá-lo, ou
  guardar o URL e descarregar quando se pede a etiqueta; o admin usa a ação de etiqueta que já
  existe. O URL nunca chega ao browser.
- **Cancelar:** sem API na DPD; cancelar um envio DPD só o anula do nosso lado e o admin avisa que
  tem de o anular também no portal da DPD.
- **Seguimento:** sem chamadas à DPD; a entrega é confirmada à mão.

## 7. Encomendas antigas com um serviço desligado **[Decisão]**

Desligar um serviço (ou os dois, o que desativa o módulo) só deixa de o **oferecer** em cotações e
checkouts novos. Uma encomenda que já tem portes DPD Express ou DPD Pickup continua a poder ser
expedida pela DPD, com a sub-conta do serviço guardado nos portes, desde que as credenciais
estejam preenchidas. **[Escolha técnica]** O caminho de criação de envio deixa de exigir o módulo
ativo para a DPD (exige só a configuração das credenciais); a cotação continua a exigi-lo.

## 8. Mercado "Portugal - Ilhas" **[Decisão]**

- A lista de mercados (Settings → General → Markets) ganha uma entrada **Portugal - Ilhas**
  (Açores e Madeira), além dos países. Código estável `PT-ISL` **[Escolha técnica]**. O placeholder
  do seletor passa de "Choose a country" para **"Choose a market"** ("Escolha um mercado").
- O país das moradas continua a ser `PT`. O **mercado** de uma morada passa a ser calculado:
  `PT` com código postal começado por `9` → `PT-ISL`; tudo o resto → o próprio país.
- **[Escolha técnica, para não mudar o que existe]** A separação só se aplica quando a loja tem o
  mercado `PT-ISL` ativo. Sem ele, as ilhas continuam a usar o mercado `PT`, como hoje: as tabelas
  existentes (Manual shipping) e o CTT não mudam de comportamento em lojas que não o ativem.
- Com `PT-ISL` ativo, todos os sítios que escolhem preços ou disponibilidade por mercado usam o
  mercado calculado: cotação de portes (manual, CTT, DPD), `servedCountries`, checkout e encomendas
  manuais. Os editores de tabelas por mercado (Manual shipping e DPD) mostram `PT-ISL` como
  qualquer outro mercado. O CTT só serve `PT-ISL` se esse mercado estiver nos seus mercados.
- O IVA, a faturação (Moloni) e as moradas guardadas continuam a usar o país `PT`; o mercado só
  decide portes e disponibilidade.
- Na DPD, a pesquisa de pontos Pickup e o envio funcionam também para códigos postais `9xxx`; a
  disponibilidade nas ilhas decide-se pela tabela `PT-ISL` de cada serviço.

## 9. Erros e registos
- Códigos estáveis para o admin: `DPD_AUTH_FAILED`, `DPD_SHIPMENT_FAILED`, `PICKUP_SEARCH_FAILED`,
  `PICKUP_POINT_INVALID`, `PICKUP_POINT_REQUIRED`, `SHIPPING_METHOD_REQUIRED`.
- Logs: só o código e o ID da encomenda. Nunca credenciais, tokens, chave, nomes, moradas, telefones
  ou e-mails.

## 10. Testes
- Unitários: preço por serviço e mercado, regra de ativação dos serviços, montagem do corpo do envio
  (Express e Pickup), normalização da resposta de pontos, validação do ponto no checkout, cálculo do
  mercado (`PT` + `9xxx` com e sem `PT-ISL` ativo), envio de encomenda antiga com o serviço
  desligado.
- O HTTP e o SOAP são substituídos por duplos nos testes; nenhum teste chama a DPD.
- Verificação manual no Strapi de teste com credenciais de teste, se o utilizador as tiver.

## 11. Ao critério do construtor
- Cliente SOAP: biblioteca `soap` ou pedido XML à mão; a escolha deve manter o plugin leve.
- Onde guardar o ponto Pickup (campo na encomenda ou na linha de portes) e a etiqueta.
- Disposição da página de configuração, seguindo as do Manual shipping e do CTT.
