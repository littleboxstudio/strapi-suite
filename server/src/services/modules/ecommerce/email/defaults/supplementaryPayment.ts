import { button, callout, details, greeting, heading, layout, note, paragraph } from './layout';

export default {
  subject: 'Additional payment needed for order {{order.reference}} - {{store.name}}',
  html: layout(
    'An additional payment is needed for order {{order.reference}}.',
    [
      heading('Additional payment needed'),
      greeting(),
      paragraph(
        'Your order <strong>{{order.reference}}</strong> has been updated and an additional amount is now due. Please complete this payment as soon as possible so we can continue processing your order.'
      ),
      details([
        { label: 'Order', value: '{{order.reference}}' },
        { label: 'Payment method', value: '{{payment.method}}', when: 'payment.method' },
        { label: 'Additional amount due', value: '{{payment.amountDue}}', strong: true },
      ]),
      `{{#if payment.instructions}}`,
      callout('{{payment.instructions}}'),
      `{{/if}}`,
      button('payment.link', 'Pay {{payment.amountDue}}'),
      `{{#if payment.expiresAt}}`,
      paragraph(
        '<strong>This payment link expires on {{payment.expiresAt}}.</strong> Please pay as soon as possible to avoid delays.'
      ),
      `{{/if}}`,
      note('If you have any questions about this payment, just reply to this e-mail or contact our support.'),
    ].join('\n')
  ),
};
