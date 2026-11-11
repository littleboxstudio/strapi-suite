import { getFetchClient } from '@strapi/strapi/admin';
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
  CreateRefundInput,
  CreateShipmentInput,
  DeliveryInput,
  IssueStoreCreditInput,
  ManualPaymentInput,
  ModificationApplied,
  ModificationPreview,
  Order,
  OrderListItem,
  OrderListParams,
  OrderLocales,
  OrderModificationInput,
  NotificationView,
  Paginated,
  PaymentInstructionsInput,
  PaymentInstructionsResult,
  PaymentLink,
  PaymentView,
  RefundPreview,
  RefundView,
  RegisterReturnInput,
  ReturnRegistered,
  ShipmentView,
  TrackingInput,
  StoreCredit,
  StoreCreditPaymentInput,
  ShippingQuote,
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
  quoteShipping(input: ShippingQuoteInput): Promise<ShippingQuote>;
  searchVariants(q: string, locale?: string): Promise<VariantSearchResult[]>;
  addPayment(orderId: number, input: ManualPaymentInput): Promise<PaymentView>;
  cancelOrder(id: number): Promise<Order>;
  archiveOrder(id: number): Promise<Order>;
  previewModification(id: number, input: OrderModificationInput): Promise<ModificationPreview>;
  applyModification(id: number, input: ApplyModificationInput): Promise<ModificationApplied>;

  // Payment links and instructions (payments.manage), store credit payment (orders.manage)
  createPaymentLink(orderId: number): Promise<PaymentLink>;
  sendPaymentInstructions(
    orderId: number,
    input: PaymentInstructionsInput
  ): Promise<PaymentInstructionsResult>;
  addStoreCreditPayment(orderId: number, input: StoreCreditPaymentInput): Promise<PaymentView>;

  // Refunds (read: orders.read; write: refunds.manage)
  fetchRefundPreview(orderId: number): Promise<RefundPreview>;
  fetchRefunds(orderId: number): Promise<RefundView[]>;
  createRefund(orderId: number, input: CreateRefundInput): Promise<RefundView[]>;
  resumeRefund(refundId: number): Promise<RefundView>;
  refreshRefund(refundId: number): Promise<RefundView>;
  markRefundFailed(refundId: number, note?: string): Promise<RefundView>;

  // Notifications (read: orders.read; resend: orders.manage)
  fetchOrderNotifications(orderId: number): Promise<NotificationView[]>;
  resendNotification(notificationId: number): Promise<NotificationView>;

  // Store credit (read: customers.read; write: refunds.manage)
  fetchCustomerStoreCredits(customerId: number): Promise<StoreCredit[]>;
  issueStoreCredit(input: IssueStoreCreditInput): Promise<StoreCredit>;
  voidStoreCredit(id: number): Promise<StoreCredit>;

  // Shipments and returns (write: orders.manage; label: orders.read)
  createShipment(orderId: number, input: CreateShipmentInput): Promise<ShipmentView>;
  confirmDelivery(shipmentId: number, input: DeliveryInput): Promise<ShipmentView>;
  updateTracking(shipmentId: number, input: TrackingInput): Promise<ShipmentView>;
  refreshTracking(shipmentId: number): Promise<ShipmentView>;
  retryShipment(shipmentId: number): Promise<ShipmentView>;
  cancelShipment(shipmentId: number, reason?: string): Promise<ShipmentView>;
  /** The carrier label PDF; an error carries the API body (`response.data`) like the JSON calls. */
  fetchShipmentLabel(shipmentId: number): Promise<Blob>;
  registerReturn(orderId: number, input: RegisterReturnInput): Promise<ReturnRegistered>;
}

export class EcommerceOrdersGatewayHttp implements EcommerceOrdersGateway {
  httpClient: HttpClient;

  constructor() {
    this.httpClient = Registry.getInstance().inject('httpClient');
  }

  private customers = `/${config.pluginId}/admin/ecommerce/customers`;
  private orders = `/${config.pluginId}/admin/ecommerce/orders`;
  private base = `/${config.pluginId}/admin/ecommerce`;

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

  async quoteShipping(input: ShippingQuoteInput): Promise<ShippingQuote> {
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

  async createPaymentLink(orderId: number): Promise<PaymentLink> {
    return this.httpClient.post(`${this.orders}/${orderId}/payment-link`, {});
  }

  async sendPaymentInstructions(
    orderId: number,
    input: PaymentInstructionsInput
  ): Promise<PaymentInstructionsResult> {
    return this.httpClient.post(`${this.orders}/${orderId}/payment-instructions`, input);
  }

  async addStoreCreditPayment(orderId: number, input: StoreCreditPaymentInput): Promise<PaymentView> {
    return this.httpClient.post(`${this.orders}/${orderId}/store-credit-payment`, input);
  }

  async fetchRefundPreview(orderId: number): Promise<RefundPreview> {
    return this.httpClient.get(`${this.orders}/${orderId}/refunds/preview`);
  }

  async fetchRefunds(orderId: number): Promise<RefundView[]> {
    return this.httpClient.get(`${this.orders}/${orderId}/refunds`);
  }

  async createRefund(orderId: number, input: CreateRefundInput): Promise<RefundView[]> {
    return this.httpClient.post(`${this.orders}/${orderId}/refunds`, input);
  }

  async resumeRefund(refundId: number): Promise<RefundView> {
    return this.httpClient.post(`${this.base}/refunds/${refundId}/resume`, {});
  }

  async refreshRefund(refundId: number): Promise<RefundView> {
    return this.httpClient.post(`${this.base}/refunds/${refundId}/refresh`, {});
  }

  async markRefundFailed(refundId: number, note?: string): Promise<RefundView> {
    return this.httpClient.post(`${this.base}/refunds/${refundId}/mark-failed`, note ? { note } : {});
  }

  async fetchOrderNotifications(orderId: number): Promise<NotificationView[]> {
    return this.httpClient.get(`${this.orders}/${orderId}/notifications`);
  }

  async resendNotification(notificationId: number): Promise<NotificationView> {
    return this.httpClient.post(`${this.base}/notifications/${notificationId}/resend`, {});
  }

  async fetchCustomerStoreCredits(customerId: number): Promise<StoreCredit[]> {
    return this.httpClient.get(`${this.customers}/${customerId}/store-credits`);
  }

  async issueStoreCredit(input: IssueStoreCreditInput): Promise<StoreCredit> {
    return this.httpClient.post(`${this.base}/store-credits`, input);
  }

  async voidStoreCredit(id: number): Promise<StoreCredit> {
    return this.httpClient.post(`${this.base}/store-credits/${id}/void`, {});
  }

  async createShipment(orderId: number, input: CreateShipmentInput): Promise<ShipmentView> {
    return this.httpClient.post(`${this.orders}/${orderId}/shipments`, input);
  }

  async confirmDelivery(shipmentId: number, input: DeliveryInput): Promise<ShipmentView> {
    return this.httpClient.post(`${this.base}/shipments/${shipmentId}/deliver`, input);
  }

  async updateTracking(shipmentId: number, input: TrackingInput): Promise<ShipmentView> {
    return this.httpClient.post(`${this.base}/shipments/${shipmentId}/tracking`, input);
  }

  async refreshTracking(shipmentId: number): Promise<ShipmentView> {
    return this.httpClient.post(`${this.base}/shipments/${shipmentId}/refresh-tracking`, {});
  }

  async retryShipment(shipmentId: number): Promise<ShipmentView> {
    return this.httpClient.post(`${this.base}/shipments/${shipmentId}/retry`, {});
  }

  async cancelShipment(shipmentId: number, reason?: string): Promise<ShipmentView> {
    return this.httpClient.post(`${this.base}/shipments/${shipmentId}/cancel`, reason ? { reason } : {});
  }

  async fetchShipmentLabel(shipmentId: number): Promise<Blob> {
    const { get } = getFetchClient();
    // Error statuses come back as a blob too (401 still throws, so the session can refresh):
    // their JSON body is read so the caller sees the error code.
    const res = await get(`/${config.pluginId}/admin/ecommerce/shipments/${shipmentId}/label`, {
      responseType: 'blob',
      validateStatus: (status: number) => status !== 401,
    });
    const status = res.status ?? 200;
    if (status >= 400) {
      let data: unknown = null;
      try {
        data = JSON.parse(await res.data.text());
      } catch {
        data = null;
      }
      throw Object.assign(new Error('Label request failed'), { status, response: { data } });
    }
    return res.data;
  }

  async registerReturn(orderId: number, input: RegisterReturnInput): Promise<ReturnRegistered> {
    return this.httpClient.post(`${this.orders}/${orderId}/returns`, input);
  }
}
