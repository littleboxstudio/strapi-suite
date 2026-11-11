import { greeting, heading, layout, paragraph } from './layout';

export default {
  subject: 'Your order {{order.reference}} has been cancelled - {{store.name}}',
  html: layout(
    'Your order {{order.reference}} has been cancelled.',
    [
      heading('Your order has been cancelled'),
      greeting(),
      paragraph(
        'Your order <strong>{{order.reference}}</strong>, placed on {{order.date}}, has been cancelled{{#if order.cancelledAt}} on {{order.cancelledAt}}{{/if}}.'
      ),
      `{{#if order.amountPaid}}`,
      paragraph(
        'You paid {{order.amountPaid}} for this order. We will send you a separate e-mail with the details of any refund.'
      ),
      `{{/if}}`,
      paragraph('If you did not expect this or have any questions, please contact us.'),
    ].join('\n')
  ),
};
