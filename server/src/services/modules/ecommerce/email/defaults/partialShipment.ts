import { button, details, greeting, heading, itemList, layout, paragraph } from './layout';

export default {
  subject: 'Part of your order {{order.reference}} has shipped - {{store.name}}',
  html: layout(
    'Part of your order {{order.reference}} is on its way.',
    [
      heading('Part of your order has shipped'),
      greeting(),
      paragraph(
        'Good news: part of your order <strong>{{order.reference}}</strong> is on its way. The remaining items will follow in a separate shipment.'
      ),
      itemList('shipment.items', 'In this shipment'),
      details([
        { label: 'Carrier', value: '{{shipment.carrier}}', when: 'shipment.carrier' },
        { label: 'Tracking code', value: '{{shipment.trackingCode}}', when: 'shipment.trackingCode' },
      ]),
      button('shipment.trackingUrl', 'Track your package'),
      `{{#if shipment.pendingItems}}`,
      itemList('shipment.pendingItems', 'Still to be shipped'),
      `{{/if}}`,
      paragraph('We will let you know as soon as the remaining items ship.'),
    ].join('\n')
  ),
};
