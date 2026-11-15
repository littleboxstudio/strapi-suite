import { button, details, greeting, heading, itemList, layout, paragraph } from './layout';

export default {
  subject: 'Tracking updated for your order {{order.reference}} - {{store.name}}',
  html: layout(
    'The tracking of your order {{order.reference}} was updated.',
    [
      heading('Your tracking was updated'),
      greeting(),
      paragraph(
        'The tracking information of a shipment of your order <strong>{{order.reference}}</strong> was updated.'
      ),
      itemList('shipment.items', 'In this shipment'),
      details([
        { label: 'Carrier', value: '{{shipment.carrier}}', when: 'shipment.carrier' },
        { label: 'Tracking code', value: '{{shipment.trackingCode}}', when: 'shipment.trackingCode' },
      ]),
      button('shipment.trackingUrl', 'Track your package'),
    ].join('\n')
  ),
};
