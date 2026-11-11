import { details, greeting, heading, layout, note, paragraph } from './layout';

export default {
  subject: 'Invoice {{invoice.number}} for order {{order.reference}} - {{store.name}}',
  html: layout(
    'Your invoice for order {{order.reference}} is attached.',
    [
      heading('Your invoice'),
      greeting(),
      paragraph(
        'The invoice for your order <strong>{{order.reference}}</strong> is attached to this e-mail as a PDF file.'
      ),
      details([
        { label: 'Invoice number', value: '{{invoice.number}}' },
        { label: 'Order', value: '{{order.reference}}' },
        { label: 'Order date', value: '{{order.date}}' },
      ]),
      note('Please keep this e-mail for your records.'),
    ].join('\n')
  ),
};
