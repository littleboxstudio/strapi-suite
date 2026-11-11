import { button, details, greeting, heading, itemList, layout, paragraph } from './layout';

export default {
  subject: 'Your order {{order.reference}} is on its way - {{store.name}}',
  html: layout(
    'Your order {{order.reference}} has shipped.',
    [
      heading('Your order is on its way'),
      greeting(),
      paragraph('Your order <strong>{{order.reference}}</strong> has shipped and is on its way to you.'),
      itemList('shipment.items', 'In this shipment'),
      details([
        { label: 'Carrier', value: '{{shipment.carrier}}', when: 'shipment.carrier' },
        { label: 'Tracking code', value: '{{shipment.trackingCode}}', when: 'shipment.trackingCode' },
      ]),
      button('shipment.trackingUrl', 'Track your package'),
    ].join('\n')
  ),
};
