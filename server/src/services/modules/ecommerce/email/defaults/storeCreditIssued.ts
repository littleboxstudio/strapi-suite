import { button, callout, details, greeting, heading, layout, note, paragraph } from './layout';

export default {
  subject: 'You have received store credit - {{store.name}}',
  html: layout(
    'You have received {{credit.amount}} in store credit.',
    [
      heading('You have received store credit'),
      greeting(),
      paragraph(
        'We have issued <strong>{{credit.amount}}</strong> in store credit{{#if order.reference}} related to your order {{order.reference}}{{/if}}. You can use it on a future purchase at our store.'
      ),
      callout(
        'Your store credit code<br><span style="font-size:20px;line-height:28px;font-weight:700;letter-spacing:1px;color:#111827">{{credit.code}}</span>'
      ),
      details([
        { label: 'Credit amount', value: '{{credit.amount}}', strong: true },
        { label: 'Valid until', value: '{{credit.expiresAt}}', when: 'credit.expiresAt' },
      ]),
      `{{#if credit.conditions}}`,
      note('Conditions: {{credit.conditions}}'),
      `{{/if}}`,
      note('Store credit can only be used for purchases at our store. It is not a cash refund and cannot be exchanged for money.'),
      button('store.url', 'Shop now'),
    ].join('\n')
  ),
};
