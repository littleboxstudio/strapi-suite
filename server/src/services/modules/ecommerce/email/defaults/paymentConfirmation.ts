import { details, greeting, heading, layout, paragraph } from './layout';

export default {
  subject: 'Payment received for order {{order.reference}} - {{store.name}}',
  html: layout(
    'We have received your payment for order {{order.reference}}.',
    [
      heading('Payment received'),
      greeting(),
      paragraph('We have received your payment for order <strong>{{order.reference}}</strong>. Thank you!'),
      details([
        { label: 'Order', value: '{{order.reference}}' },
        { label: 'Payment method', value: '{{payment.method}}' },
        { label: 'Amount paid', value: '{{payment.amount}}', strong: true },
        { label: 'Amount still due', value: '{{payment.amountDue}}', when: 'payment.amountDue' },
      ]),
      `{{#if payment.amountDue}}`,
      paragraph('We will send you instructions for the remaining amount separately.'),
      `{{else}}`,
      paragraph('Your order is now being prepared. We will let you know as soon as it ships.'),
      `{{/if}}`,
    ].join('\n')
  ),
};
