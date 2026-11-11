import { details, greeting, heading, layout, note, paragraph } from './layout';

export default {
  subject: 'Your refund for order {{order.reference}} is being processed - {{store.name}}',
  html: layout(
    'We have started processing your refund for order {{order.reference}}.',
    [
      heading('Your refund is being processed'),
      greeting(),
      paragraph(
        'We have started processing a {{#if refund.isPartial}}partial {{/if}}refund for your order <strong>{{order.reference}}</strong>.'
      ),
      details([
        { label: 'Refund amount', value: '{{refund.amount}}', strong: true },
        { label: 'Refund method', value: '{{refund.method}}', when: 'refund.method' },
        { label: 'Reference', value: '{{refund.reference}}', when: 'refund.reference' },
        { label: 'Description', value: '{{refund.description}}', when: 'refund.description' },
      ]),
      paragraph(
        'Depending on your bank or payment provider, it may take a few business days for the refund to reach you. We will let you know when it has been completed.'
      ),
      note('You do not need to do anything else.'),
    ].join('\n')
  ),
};
