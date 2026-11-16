import { callout, details, greeting, heading, layout, note, paragraph, button } from './layout';

export default {
  subject: 'Your store credit was updated - {{store.name}}',
  html: layout(
    'Your store credit now has {{credit.balance}} of {{credit.amount}} available.',
    [
      heading('Your store credit was updated'),
      greeting(),
      paragraph(
        'Your store credit has been updated. You now have <strong>{{credit.balance}} of {{credit.amount}}</strong> available to use on a future purchase at our store.'
      ),
      callout(
        'Your store credit code<br><span style="font-size:20px;line-height:28px;font-weight:700;letter-spacing:1px;color:#111827">{{credit.code}}</span>'
      ),
      details([
        { label: 'Available', value: '{{credit.balance}} of {{credit.amount}}', strong: true },
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
