# Módulo Store pickup — Documento de Desenho

Estado: para aprovação (2026-11-15). Complementa `2026-11-11-ecommerce-design.md` (4.16 mercados e
escalões de peso) e `2026-11-14-dpd-portugal-design.md` (pontos Pickup, mercado `PT-ISL`).

Marcas: **[Decisão]** foi pedido pelo utilizador; **[Escolha técnica]** é decisão minha, que o
utilizador pode rever; **[Construtor]** fica ao critério de quem implementa.

## 1. Intenção

A loja quer oferecer levantamento numa das suas lojas físicas. O cliente escolhe a loja no
checkout; quando a encomenda está pronta, o admin faz Ship e o cliente recebe um e-mail a dizer que
a encomenda está à espera dele na loja X. Quando a levanta, o admin confirma a entrega, como hoje.

### Objetivos
- Novo módulo **Store pickup** em Settings → Shipping, isolado: ativa-se e desativa-se sem afetar o
  resto **[Decisão]**.
- Preços como no Manual shipping: por mercado, com escalões de peso **[Decisão]**.
- Uma lista de **lojas por mercado**, cada uma com nome e morada (como os pontos do DPD Pickup)
  **[Decisão]**.
- O frontend recebe as lojas disponíveis ao escolher o método, sem falar com mais ninguém e com a
  mesma segurança dos outros endpoints do storefront **[Decisão]**.
- No Ship, este método mostra a loja escolhida pelo cliente (selecionada), deixa o admin trocá-la, e
  avisa que o cliente vai receber uma notificação de que a encomenda está na loja X **[Decisão]**.
- O Ship deste método envia um **e-mail novo** ("Pronta para levantamento"), não o e-mail de envio
  com seguimento **[Decisão]**.

### Não-objetivos
- Horários das lojas, telefone, mapas, stock por loja, reserva de horário.
- Código de levantamento ou assinatura; a entrega continua confirmada à mão.

### Anti-objetivos
- Mudar o comportamento do Manual shipping, do CTT, da DPD ou de módulos fora do e-commerce.
- Uma encomenda Store pickup sem loja, ou com uma loja que não existe na configuração do mercado.
- Registar nomes, moradas, telefones ou e-mails de clientes em logs.

## 2. Configuração (Settings → Shipping → Store pickup)

- Um cartão de módulo como o da DPD, com ativar/desativar e um botão de configuração **[Escolha
  técnica]**. É um fornecedor `store-pickup` da categoria `carrier`, sem credenciais.
- Campos do método (os do Manual shipping, reutilizando `MethodNameTaxFields`): nome mostrado ao
  cliente por idioma (por omissão "Store pickup" / "Levantamento em loja"), taxa de IVA.
- **Mercados e preços:** o editor de escalões do Manual shipping (`MarketRatesEditor`), preço em
  cêntimos com IVA incluído; um escalão pode custar 0. Um mercado sem tabela não tem o método.
- **Lojas por mercado [Decisão]:** em cada mercado com tabela, uma lista de lojas com adicionar,
  editar e remover. Campos: nome (obrigatório), morada (obrigatória), morada 2 (opcional), código
  postal (obrigatório), cidade (obrigatória). O país é o do mercado (`PT` para `PT` e `PT-ISL`).
- Cada loja tem um **id estável** gerado ao criar (`st_` + aleatório) **[Escolha técnica]**: mudar o
  nome ou a morada não parte as encomendas, e o id é o que o frontend devolve.
- **Regras de gravação [Escolha técnica]**, no servidor: ativar exige pelo menos um mercado com
  tabela **e** pelo menos uma loja; um mercado com tabela e sem lojas não é oferecido (aviso no
  admin). Mercados que a loja deixou de vender ficam guardados mas não são oferecidos, como no
  Manual shipping.
- Tudo fica na configuração do módulo (como os serviços da DPD), não em tabelas novas.

## 3. Cotação

- Um adaptador `store-pickup` responde a `quote` a partir da configuração, sem chamadas externas:
  uma opção (`serviceId` `STORE`) quando o módulo está ativo, o mercado da morada (com a regra
  `PT-ISL`) tem tabela, o peso cabe num escalão e o mercado tem pelo menos uma loja.
- Entra automaticamente em `POST /cart/quote`, encomendas manuais, edição e recálculo de portes.

## 4. Lojas no storefront **[Decisão: o frontend tem de obter as lojas]**

**[Escolha técnica] As lojas vêm dentro da própria opção de portes**, em vez de um endpoint novo:

```json
{ "providerId": "store-pickup", "serviceId": "STORE", "name": "Levantamento em loja",
  "price": 0, "tax": 0, "requiresPickupPoint": true,
  "pickupPoints": [{ "id": "st_ab12cd", "name": "Loja Porto", "address": "Rua X 1",
                     "address2": null, "postalCode": "4000-001", "city": "Porto", "country": "PT" }] }
```

Porquê: a cotação já recebe a morada (e portanto o mercado), já está protegida pelo API token, pela
sessão de checkout e pelo limite de pedidos, e a lista é pequena. O frontend que já trata o DPD
Pickup só precisa de uma regra: **se a opção traz `pickupPoints`, mostra essa lista; se não traz,
pesquisa em `/shipping/pickup-points`** (DPD). O mesmo formato de ponto do DPD, sem
`openingHours`. Nenhum dado de cliente nem campo interno sai nesta lista.

- `GET /shipping/pickup-points` não muda (continua só DPD).
- `docs/ecommerce/storefront-api.md` documenta o campo e a regra.

## 5. Checkout e encomenda

- Com Store pickup, `POST /orders` exige `pickupPointId` (o mesmo campo do DPD). O servidor
  confirma-o contra as lojas do mercado da morada enviada, na configuração atual: em falta →
  `PICKUP_POINT_REQUIRED`; desconhecido → `PICKUP_POINT_INVALID`. `pickupPostalCode` é ignorado.
- Grava-se como no DPD Pickup **[Escolha técnica, para reutilizar tudo]**: a morada de entrega passa
  a ser a da loja (empresa = nome da loja), com o nome e o telefone do cliente; a morada do cliente
  fica em `pickupPoint.customerAddress`; a faturação continua a do cliente. Assim a ficha, a
  edição de portes e a troca de método já funcionam.
- `isPickupMethod` passa a reconhecer os dois métodos; o que é específico (pesquisar na DPD vs
  procurar na configuração) decide-se pelo fornecedor, num só sítio **[Construtor]**.
- No admin (encomenda manual, mudar o método de portes), escolher Store pickup mostra uma lista das
  lojas do mercado em vez da pesquisa por código postal.

## 6. Ship **[Decisão]**

- No modal Ship, com o método Store pickup selecionado: sem campos de seguimento nem volumes; mostra
  um seletor das lojas do mercado com a loja da encomenda selecionada, e a mensagem
  "O cliente vai receber uma notificação de que a encomenda se encontra em **{loja}**", que segue a
  loja escolhida. A confirmação do Ship repete a loja.
- Se o admin escolher outra loja, o Ship troca a loja da encomenda (morada de entrega e
  `pickupPoint`) no mesmo pedido, registando a mudança de morada como as outras edições
  **[Escolha técnica]**. O pedido Ship aceita `pickupPointId` opcional, só para este método.
- Uma loja que entretanto foi removida da configuração continua a aparecer no seletor como a da
  encomenda (é um instantâneo), para o admin decidir **[Escolha técnica]**.
- O envio fica `ACTIVE`, sem código de seguimento, e guarda o instantâneo da loja (`metadata.store`)
  **[Escolha técnica]**, para o e-mail e para o histórico mesmo que a configuração mude.
- Encomendas antigas: desativar o módulo só o tira das cotações e checkouts novos; uma encomenda que
  já tem Store pickup continua a poder ser expedida (como a regra 7 da DPD).

## 7. E-mail "Pronta para levantamento" **[Decisão]**

- Novo modelo `READY_FOR_PICKUP` ("Ready for pickup" / "Pronta para levantamento"), editável em
  Settings → Email templates como os outros, com default em inglês.
- Enviado no Ship de um envio Store pickup **em vez** de `PARTIAL_SHIPMENT`/`FULL_SHIPMENT`. Tem os
  artigos desse envio, a encomenda e a loja (nome, morada, código postal, cidade), e diz se é parcial.
- `TRACKING_UPDATED` nunca sai para este método (não tem seguimento).
- A entrega (o cliente levantou) usa o `DELIVERY_CONFIRMATION` que já existe.

## 8. Isolamento
- Com o módulo desativado, nada muda: não há opção na cotação, o checkout recusa o método como
  recusa qualquer outro indisponível, e as outras partes ignoram o fornecedor.
- O código específico vive num definition + adaptador + domínio próprios; os pontos comuns (pickup
  na encomenda, Ship, notificações) ganham um caso, sem alterar o comportamento dos outros métodos.

## 9. Testes
- Unitários: cotação por mercado/peso/lojas, regras de gravação, `pickupPoints` na opção, validação
  da loja no checkout (em falta, desconhecida, de outro mercado), troca de loja no Ship, escolha do
  modelo de e-mail (`READY_FOR_PICKUP` vs envio normal), encomenda antiga com o módulo desligado.
- Verificação no Strapi de teste: configurar o módulo, ver o modal Ship (sem expedir).

## 10. Ao critério do construtor
- Disposição do modal de configuração (lojas dentro de cada mercado, ou uma tabela com coluna
  mercado), seguindo o estilo dos modais da DPD e do Manual shipping.
- Onde vive o caso "lista de lojas vs pesquisa DPD" no servidor e no admin.

## 11. Decisões depois da leitura de um construtor **[Escolha técnica]**

1. **Ship sem transportador.** O Ship de Store pickup é um terceiro caminho (`STORE_PICKUP`), ao lado
   de `MANUAL` e `CARRIER`. Não chama ninguém e não tem etiqueta, seguimento nem cancelamento no
   transportador. Cancelar é só mudar o estado.
2. **Funções separadas.** `isPickupMethod` passa a querer dizer "a encomenda tem uma loja ou um ponto
   guardado". Há também `isDpdPickup` e `isStorePickup`. Cada sítio onde hoje se usa
   `isPickupMethod` é revisto: o pedido à DPD, a pesquisa de pontos, a regra que exige um ponto e a
   edição de portes. Uma encomenda Store pickup nunca vai à DPD.
3. **A lista de lojas passa pela cotação.** `pickOption` (`shipping.ts`) deixa passar `pickupPoints`,
   só para `store-pickup`. Cada ponto é validado e só leva os campos públicos, até 100 lojas.
4. **Cada loja pertence a um só mercado.** Uma loja que sirva `PT` e `PT-ISL` regista-se em cada um.
   Ao gravar, confirma-se que o código postal da loja cai no mercado dela, para o mercado da morada
   ser o da loja.
5. **O escalão de peso só decide o preço.** Não há limite de peso por loja.
6. **Mercado da encomenda.** Depois do checkout, a morada de entrega é a da loja, que fica no mesmo
   mercado (ponto 4). O recálculo e a edição de portes continuam a usar a morada de entrega, sem mudar
   nada.
7. **Trocar de loja no Ship.** Só se pode escolher uma loja do mesmo mercado. O preço dos portes não
   muda.
8. **O e-mail sai sempre.** O Ship de Store pickup envia sempre o e-mail; não há opção para não
   notificar.
9. **Escolha do e-mail.** O evento do envio leva a indicação de Store pickup, que decide entre
   `READY_FOR_PICKUP` e os e-mails de envio. Cada envio parcial manda o seu e-mail. O modelo novo é
   registado em `catalog.ts`, nos defaults, no editor de modelos, em `SHIPMENT_TEMPLATES` e no
   carregamento do envio em `notifications.ts`.
10. **E-mail da entrega.** Reutiliza-se o `DELIVERY_CONFIRMATION`, que é editável.
11. **Ativar e apagar lojas.** O cartão funciona como o da DPD, e o servidor recusa ativar sem um
    mercado com tabela e uma loja. Apagar uma loja não mexe nas encomendas, que guardam a sua cópia.
