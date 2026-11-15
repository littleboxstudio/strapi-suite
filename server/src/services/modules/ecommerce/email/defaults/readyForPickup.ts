import { callout, greeting, heading, itemList, layout, paragraph } from './layout';

export default {
  subject: 'Your order {{order.reference}} is ready for pickup - {{store.name}}',
  html: layout(
    'Your order {{order.reference}} is ready for pickup.',
    [
      heading('Your order is ready for pickup'),
      greeting(),
      `{{#if shipment.isPartial}}`,
      paragraph(
        'Part of your order <strong>{{order.reference}}</strong> is waiting for you at our store. The remaining items will follow separately.'
      ),
      `{{else}}`,
      paragraph('Your order <strong>{{order.reference}}</strong> is waiting for you at our store.'),
      `{{/if}}`,
      callout(
        `<strong>{{pickup.name}}</strong><br>{{pickup.address}}{{#if pickup.address2}}<br>{{pickup.address2}}{{/if}}<br>{{pickup.postalCode}} {{pickup.city}}`
      ),
      itemList('shipment.items', 'Ready for pickup'),
      `{{#if shipment.pendingItems}}`,
      itemList('shipment.pendingItems', 'Still to be shipped'),
      `{{/if}}`,
    ].join('\n')
  ),
};
