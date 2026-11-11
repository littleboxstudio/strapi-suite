import { button, callout, greeting, heading, layout, note, paragraph } from './layout';

const CELL =
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;color:#374151;padding:10px 0;border-bottom:1px solid #e5e7eb";
const HEAD = `${CELL};font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px`;
const TOTAL = `${CELL};font-weight:700;color:#111827;border-bottom:0`;

const items = `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
  <tr>
    <th align="left" style="${HEAD}">Item</th>
    <th align="center" style="${HEAD}">Qty</th>
    <th align="right" style="${HEAD}">Total</th>
  </tr>
{{#each order.items}}
  <tr>
    <td style="${CELL}">{{this.name}}{{#if this.option}} <span style="color:#6b7280">({{this.option}})</span>{{/if}}<br><span style="font-size:12px;color:#6b7280">{{this.unitPrice}} each</span></td>
    <td align="center" style="${CELL}">{{this.quantity}}</td>
    <td align="right" style="${CELL};white-space:nowrap">{{this.total}}</td>
  </tr>
{{/each}}
  <tr>
    <td colspan="2" style="${CELL}">Subtotal</td>
    <td align="right" style="${CELL};white-space:nowrap">{{order.subtotal}}</td>
  </tr>
  <tr>
    <td colspan="2" style="${CELL}">Shipping</td>
    <td align="right" style="${CELL};white-space:nowrap">{{order.shipping}}</td>
  </tr>
{{#if order.promotions}}
  <tr>
    <td colspan="3" style="${HEAD}">Promotions applied</td>
  </tr>
{{#each order.promotions}}
  <tr>
    <td colspan="2" style="${CELL}">{{this.name}}</td>
    <td align="right" style="${CELL};white-space:nowrap">&minus;{{this.amount}}</td>
  </tr>
{{/each}}
{{/if}}
{{#if order.discount}}
  <tr>
    <td colspan="2" style="${CELL}">Discount</td>
    <td align="right" style="${CELL};white-space:nowrap">&minus;{{order.discount}}</td>
  </tr>
{{/if}}
  <tr>
    <td colspan="2" style="${TOTAL}">Total</td>
    <td align="right" style="${TOTAL};white-space:nowrap">{{order.total}}</td>
  </tr>
</table>`;

export default {
  subject: 'Order {{order.reference}} received - {{store.name}}',
  html: layout(
    'Thank you for your order {{order.reference}}.',
    [
      heading('Thank you for your order'),
      greeting(),
      paragraph(
        'We have received your order <strong>{{order.reference}}</strong>, placed on {{order.date}}. Here is a summary of what you ordered.'
      ),
      items,
      note('Payment status: {{order.paymentStatus}}'),
      `{{#if payment.link}}`,
      callout(
        'An amount of <strong>{{payment.amountDue}}</strong> is still due for this order. Please complete your payment as soon as possible.{{#if payment.expiresAt}} The payment link expires on <strong>{{payment.expiresAt}}</strong>.{{/if}}'
      ),
      button('payment.link', 'Pay now'),
      `{{/if}}`,
      paragraph('We will let you know as soon as your order ships.'),
    ].join('\n')
  ),
};
