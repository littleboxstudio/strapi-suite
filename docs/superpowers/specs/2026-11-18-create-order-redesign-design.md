# Create order — redesign v2 (sections like the order detail)

Status: approved by the store owner (2026-11-18, request in chat plus answers to two questions).
Supersedes the "Create order: redesign" part of `2026-11-17-duplicate-order-design.md`. The
duplicate rules there still apply, adapted below.

## Layout
- **Totals** sit at the top, outside any section container, with no title. They are the detail's
  summary tiles: Products, Shipping, Discounts, Total. The tile row is **sticky** and stays
  visible while the page scrolls.
- The sections below are styled like the order detail sections: a title row, with the actions on
  the right.

## Customer
- **A table**, even with a single row: name, e-mail, phone, plus Edit and Remove.
- **Empty state:** "No customer yet" / "Nenhum customer ainda", shown in a darker rectangle, like the detail's empty states.
- **Add customer** (top right) opens a modal. The modal has:
  - a search bar at the top, by e-mail or name, with matching customers in a dropdown as the user types (reusing the existing customer search);
  - the form below it: first name, last name, e-mail, phone.

  Picking an existing customer fills in the customer.
- **Picking an existing customer** also fills Shipping address and Billing address from the
  customer's last addresses, when they exist (the existing "last addresses" use case). It never
  opens a form. A customer with no stored billing address leaves Billing empty.
- Edit opens the same modal with the data filled in.

## Shipping address
- **A table**: street, postal code, city, country, plus Edit and Remove. Empty state: "No address selected" / "Nenhum endereço selecionado".
- **Add shipping address** (top right, shown when the table is empty) opens a modal with the address form. Edit opens the same modal filled in.

## Billing address
- It follows the same system as Shipping address. It is **never** assumed to be the same as shipping.
- **Buttons, top right:** **Add billing address** (shown when empty) and **Billing same as shipping**. The second copies the shipping address into the billing table; Edit can change it afterwards.
- The company and NIF fields stay in the billing form, as today.

## Products
- **Unchanged**, except that the "Add products" label above the search is removed.
- **Gift lines appear inside the products table**, exactly as in the detail's Products table: the PROMOTIONAL GIFT badge, the struck price, "Free gift". The separate "GIFT 2 × …" line outside the table is removed.

## Shipping
- **A table of shipping lines**, like the detail's shipping section: name, amount, plus Edit and Remove. Several lines are allowed.
- **Add shipping** (top right) opens a modal like the detail's Add shipping:
  - it lists the carrier methods quoted for the cart (gifts included), with the price as a suggestion;
  - the amount can be changed, as in the detail;
  - methods that need one also have the pickup point or store picker.
- **The first line is the order's delivery method**: the one stored as `shippingMethod` and shown as ORIGINAL in Ship. Removing the first line promotes the next one.
- **Server:** create accepts `shippingLines: [{ providerId, serviceId, amount, pickupPointId?, pickupPostalCode? }]`. The first entry is the delivery method, and all of them are stored as the order's shipping lines, with origin CREATE. The existing single `shipping` input stays accepted, for the storefront and for compatibility. Shipping promotions (for example free shipping) apply to the total shipping as on the order.

## Promotions and discounts
- **A table exactly like the detail's** (the shared DiscountsTable): the selected promotions, the manual discounts and the applied codes, then the total discount. Empty state: a message in a dark rectangle.
- **No promotion codes input.** Codes are handled only through the buttons below.
- **Buttons, top right:**
  - **Add discount** opens the existing manual discount modal.
  - **Apply discount** opens a modal listing the automatic promotions that are available and applicable to this cart, as the detail's Recalculate discounts does. The admin selects some and confirms, and only the selected ones are applied.
  - **Add code** opens a modal with a search bar at the top. From the first letter typed, it lists the matching active promotion codes in a table below. The admin selects codes and confirms, and they are applied (validated by the quote as today).
- **Owner's rule: nothing is applied by itself.** The create quote applies only the promotions the admin selected and the codes they added. Automatic promotions are not auto-applied on Create order. On a duplicate, the original order's promotions are pre-selected, if they are still applicable.
- Gifts: a selected GIFT promotion adds its gift line inside the products table, with the existing gift choice when there are options.
- **Server:**
  - quote and create accept `promotionIds?: number[]`, the only automatic promotions to evaluate;
  - when it is absent, behaviour is as today (storefront);
  - an endpoint lists the applicable automatic promotions for a cart, the same evaluation as the detail's recalculate preview;
  - an endpoint searches active promotion codes by prefix or substring, behind orders.manage, returning code, promotion name and benefit, with no customer data.

## Unchanged
Idempotency, `expectedTotal`/TOTAL_CHANGED, stock, the locale field, the duplicate's
pre-fill (now into the tables), the customer page pre-fill (`?customerId`), and manual discounts.
