import { button, greeting, heading, layout, paragraph } from './layout';

export default {
  subject: 'Your order {{order.reference}} has been delivered - {{store.name}}',
  html: layout(
    'Your order {{order.reference}} has been delivered.',
    [
      heading('Your order has been delivered'),
      greeting(),
      paragraph(
        'Your order <strong>{{order.reference}}</strong> was delivered{{#if delivery.date}} on {{delivery.date}}{{/if}}. We hope you enjoy it!'
      ),
      paragraph('If something is not right with your order, please get in touch and we will be happy to help.'),
      button('store.url', 'Visit our store'),
    ].join('\n')
  ),
};
