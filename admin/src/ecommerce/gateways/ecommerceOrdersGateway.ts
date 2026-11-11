import HttpClient from '../../core/http/httpClient';
import Registry from '../../core/di/registry';
import config from '../../core/config';
import { objectToQueryString } from '../../core/utils/objectToQueryString';
import type {
  ApplyModificationInput,
  CreatedOrder,
  CreateOrderInput,
  Customer,
  CustomerInput,
  CustomerLastAddresses,
  CustomerListItem,
  CustomerListParams,
  CustomerOrderListItem,
  CustomerOrderListParams,
  ManualPaymentInput,
  ModificationApplied,
  ModificationPreview,
  Order,
  OrderListItem,
  OrderListParams,
  OrderLocales,
  OrderModificationInput,
  Paginated,
  PaymentView,
  ShippingOption,
  ShippingQuoteInput,
  VariantSearchResult,
} from '../orderTypes';

/** Customers and orders admin API (server routes admin-customers and admin-orders). */
export default interface EcommerceOrdersGateway {
  // Customers
  fetchCustomers(params: CustomerListParams): Promise<Paginated<CustomerListItem>>;
  fetchCustomer(id: number): Promise<Customer>;
  updateCustomer(id: number, input: CustomerInput): Promise<Customer>;
  fetchCustomerOrders(
    id: number,
    params: CustomerOrderListParams
  ): Promise<Paginated<CustomerOrderListItem>>;
  fetchCustomerLastAddresses(id: number): Promise<CustomerLastAddresses>;

  // Orders
  fetchOrders(params: OrderListParams): Promise<Paginated<OrderListItem>>;
  fetchOrder(id: number): Promise<Order>;
  createOrder(input: CreateOrderInput): Promise<CreatedOrder>;
  fetchOrderLocales(): Promise<OrderLocales>;
  quoteShipping(input: ShippingQuoteInput): Promise<ShippingOption[]>;
  searchVariants(q: string, locale?: string): Promise<VariantSearchResult[]>;
  addPayment(orderId: number, input: ManualPaymentInput): Promise<PaymentView>;
  cancelOrder(id: number): Promise<Order>;
  archiveOrder(id: number): Promise<Order>;
  previewModification(id: number, input: OrderModificationInput): Promise<ModificationPreview>;
  applyModification(id: number, input: ApplyModificationInput): Promise<ModificationApplied>;
}

export class EcommerceOrdersGatewayHttp implements EcommerceOrdersGateway {
  httpClient: HttpClient;

  constructor() {
    this.httpClient = Registry.getInstance().inject('httpClient');
  }

  private customers = `/${config.pluginId}/admin/ecommerce/customers`;
  private orders = `/${config.pluginId}/admin/ecommerce/orders`;

  async fetchCustomers(params: CustomerListParams): Promise<Paginated<CustomerListItem>> {
    return this.httpClient.get(`${this.customers}${objectToQueryString(params)}`);
  }

  async fetchCustomer(id: number): Promise<Customer> {
    return this.httpClient.get(`${this.customers}/${id}`);
  }

  async updateCustomer(id: number, input: CustomerInput): Promise<Customer> {
    return this.httpClient.put(`${this.customers}/${id}`, input);
  }

  async fetchCustomerOrders(
    id: number,
    params: CustomerOrderListParams
  ): Promise<Paginated<CustomerOrderListItem>> {
    return this.httpClient.get(`${this.customers}/${id}/orders${objectToQueryString(params)}`);
  }

  async fetchCustomerLastAddresses(id: number): Promise<CustomerLastAddresses> {
    return this.httpClient.get(`${this.customers}/${id}/last-addresses`);
  }

  async fetchOrders(params: OrderListParams): Promise<Paginated<OrderListItem>> {
    return this.httpClient.get(`${this.orders}${objectToQueryString(params)}`);
  }

  async fetchOrder(id: number): Promise<Order> {
    return this.httpClient.get(`${this.orders}/${id}`);
  }

  async createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
    return this.httpClient.post(this.orders, input);
  }

  async fetchOrderLocales(): Promise<OrderLocales> {
    return this.httpClient.get(`${this.orders}/locales`);
  }

  async quoteShipping(input: ShippingQuoteInput): Promise<ShippingOption[]> {
    return this.httpClient.post(`${this.orders}/shipping-quote`, input);
  }

  async searchVariants(q: string, locale?: string): Promise<VariantSearchResult[]> {
    return this.httpClient.get(`${this.orders}/variant-search${objectToQueryString({ q, locale })}`);
  }

  async addPayment(orderId: number, input: ManualPaymentInput): Promise<PaymentView> {
    return this.httpClient.post(`${this.orders}/${orderId}/payments`, input);
  }

  async cancelOrder(id: number): Promise<Order> {
    return this.httpClient.post(`${this.orders}/${id}/cancel`, {});
  }

  async archiveOrder(id: number): Promise<Order> {
    return this.httpClient.post(`${this.orders}/${id}/archive`, {});
  }

  async previewModification(id: number, input: OrderModificationInput): Promise<ModificationPreview> {
    return this.httpClient.post(`${this.orders}/${id}/modification/preview`, input);
  }

  async applyModification(id: number, input: ApplyModificationInput): Promise<ModificationApplied> {
    return this.httpClient.post(`${this.orders}/${id}/modification`, input);
  }
}
