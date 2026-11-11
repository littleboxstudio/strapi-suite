import { details, greeting, heading, layout, note, paragraph } from './layout';

export default {
  subject: 'Your refund for order {{order.reference}} has been completed - {{store.name}}',
  html: layout(
    'Your refund for order {{order.reference}} has been completed.',
    [
      heading('Your refund has been completed'),
      greeting(),
      paragraph(
        'We have completed a {{#if refund.isPartial}}partial {{/if}}refund for your order <strong>{{order.reference}}</strong>.'
      ),
      details([
        { label: 'Refund amount', value: '{{refund.amount}}', strong: true },
        { label: 'Refund method', value: '{{refund.method}}', when: 'refund.method' },
        { label: 'Reference', value: '{{refund.reference}}', when: 'refund.reference' },
        { label: 'Description', value: '{{refund.description}}', when: 'refund.description' },
      ]),
      note(
        'Depending on your bank or payment provider, it may take a few business days for the amount to appear on your statement.'
      ),
    ].join('\n')
  ),
};
