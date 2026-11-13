import { details, greeting, heading, layout, note, paragraph } from './layout';

export default {
  subject: 'Credit note {{creditNote.number}} for order {{order.reference}} - {{store.name}}',
  html: layout(
    'Your credit note for order {{order.reference}} is attached.',
    [
      heading('Your credit note'),
      greeting(),
      paragraph(
        'We have issued a credit note for your order <strong>{{order.reference}}</strong>. It corrects invoice <strong>{{creditNote.invoiceNumber}}</strong> and is attached to this e-mail as a PDF file.'
      ),
      details([
        { label: 'Credit note number', value: '{{creditNote.number}}' },
        { label: 'Amount credited', value: '{{creditNote.amount}}' },
        { label: 'Invoice', value: '{{creditNote.invoiceNumber}}' },
        { label: 'Order', value: '{{order.reference}}' },
      ]),
      note('Please keep this e-mail for your records.'),
    ].join('\n')
  ),
};
