import { button, callout, details, greeting, heading, layout, note, paragraph } from './layout';

export default {
  subject: 'Payment details for order {{order.reference}} - {{store.name}}',
  html: layout(
    'Please complete the payment for order {{order.reference}}.',
    [
      heading('Complete your payment'),
      greeting(),
      paragraph(
        'To process your order <strong>{{order.reference}}</strong>, please complete the payment below as soon as possible.'
      ),
      details([
        { label: 'Order', value: '{{order.reference}}' },
        { label: 'Payment method', value: '{{payment.method}}', when: 'payment.method' },
        { label: 'Amount due', value: '{{payment.amountDue}}', strong: true },
      ]),
      `{{#if payment.instructions}}`,
      callout('{{payment.instructions}}'),
      `{{/if}}`,
      button('payment.link', 'Pay {{payment.amountDue}}'),
      `{{#if payment.expiresAt}}`,
      paragraph(
        '<strong>This payment link expires on {{payment.expiresAt}}.</strong> Please pay as soon as possible so we can process your order without delay.'
      ),
      `{{/if}}`,
      note('If you have already paid, please ignore this message.'),
    ].join('\n')
  ),
};
