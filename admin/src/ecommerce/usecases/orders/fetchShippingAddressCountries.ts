import Registry from '../../../core/di/registry';
import EcommerceOrdersGateway from '../../gateways/ecommerceOrdersGateway';

export default class FetchShippingAddressCountries {
  gateway: EcommerceOrdersGateway;

  constructor() {
    this.gateway = Registry.getInstance().inject('ecommerceOrdersGateway');
  }

  async execute(id: number): Promise<{ countries: string[] }> {
    return this.gateway.fetchShippingAddressCountries(id);
  }
}
