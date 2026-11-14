import { getFetchClient } from '@strapi/strapi/admin';
import HttpClient from '../../core/http/httpClient';
import Registry from '../../core/di/registry';
import config from '../../core/config';
import { objectToQueryString } from '../../core/utils/objectToQueryString';
import type {
  Address,
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
  CreditNoteInput,
  CreditNoteOptions,
  DiscountRecalculation,
  EditResult,
  DeliveryInput,
  InvoiceSelectionView,
  InvoiceView,
  IssueInvoiceSelectionInput,
  IssueStoreCreditInput,
  LinesInput,
  LinesPreview,
  ManualDiscountInput,
  ManualPaymentInput,
  Order,
  OrderListItem,
  OrderListParams,
  OrderLocales,
  OrderQuote,
  OrderQuoteInput,
  NotificationView,
  Paginated,
  PaymentInstructionsInput,
  PaymentInstructionsResult,
  PaymentView,
  RefundPreview,
  RefundView,
  RegisterReturnInput,
  ReturnRegistered,
  ReviewFlagCode,
  ShipmentView,
  ShippingLineInput,
  ShippingRecalculationInput,
  ShippingRecalculationPreview,
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
  /** Prices a cart with promotions (`POST orders/quote`, orders.manage); writes nothing. */
  quote(input: OrderQuoteInput): Promise<OrderQuote>;
  searchVariants(q: string, locale?: string): Promise<VariantSearchResult[]>;
  addPayment(orderId: number, input: ManualPaymentInput): Promise<PaymentView>;
  cancelOrder(id: number): Promise<Order>;
  archiveOrder(id: number): Promise<Order>;

  // Order editing by section (orders.manage). Every write carries an `operationId` (8-64
  // characters): a repeated id replays the first outcome, for another edit it is a 409.
  previewLines(id: number, input: LinesInput): Promise<LinesPreview>;
  applyLines(id: number, input: LinesInput & { operationId: string }): Promise<EditResult>;
  fetchShippingAddressCountries(id: number): Promise<{ countries: string[] }>;
  updateShippingAddress(
    id: number,
    input: { address: Address; operationId: string }
  ): Promise<EditResult>;
  updateBillingAddress(
    id: number,
    input: { address: Address; operationId: string }
  ): Promise<EditResult>;
  /** Quotes the order's pending units at its current address. */
  fetchShippingOptions(id: number): Promise<ShippingQuote>;
  previewShippingRecalculation(
    id: number,
    input?: ShippingRecalculationInput
  ): Promise<ShippingRecalculationPreview>;
  recalculateShipping(
    id: number,
    input: ShippingRecalculationInput & { operationId: string }
  ): Promise<EditResult>;
  editShippingLine(
    id: number,
    lineId: number,
    input: ShippingLineInput & { operationId: string }
  ): Promise<EditResult>;
  addShippingLine(id: number, input: ShippingLineInput & { operationId: string }): Promise<EditResult>;
  /** Without a `selection` the initial one (applied promotions still valid) is priced. */
  previewDiscounts(id: number, input: { selection?: string[] }): Promise<DiscountRecalculation>;
  applyDiscounts(id: number, input: { selection: string[]; operationId: string }): Promise<EditResult>;
  addManualDiscount(id: number, input: ManualDiscountInput & { operationId: string }): Promise<EditResult>;
  removeManualDiscount(id: number, discountId: number, input: { operationId: string }): Promise<EditResult>;
  dismissReviewFlag(id: number, code: ReviewFlagCode, input: { operationId: string }): Promise<EditResult>;

  // Payment links and instructions (payments.manage), store credit payment (orders.manage)
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

  // Invoices and credit notes (read: orders.read; write: invoicing.manage)
  fetchInvoiceSelection(orderId: number): Promise<InvoiceSelectionView>;
  issueInvoice(orderId: number, input: IssueInvoiceSelectionInput): Promise<InvoiceView>;
  /** Looks the document up at the provider by its reference, or (`markFailed`) gives it up. */
  reconcileInvoice(invoiceId: number, markFailed: boolean): Promise<InvoiceView>;
  /** The invoice PDF from its provider; an error carries the API body like the JSON calls. */
  fetchInvoicePdf(invoiceId: number): Promise<Blob>;
  fetchCreditNotePreview(invoiceId: number): Promise<CreditNoteOptions>;
  issueCreditNote(invoiceId: number, input: CreditNoteInput): Promise<InvoiceView>;
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

  async quote(input: OrderQuoteInput): Promise<OrderQuote> {
    return this.httpClient.post(`${this.orders}/quote`, input);
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

  async previewLines(id: number, input: LinesInput): Promise<LinesPreview> {
    return this.httpClient.post(`${this.orders}/${id}/lines/preview`, input);
  }

  async applyLines(id: number, input: LinesInput & { operationId: string }): Promise<EditResult> {
    return this.httpClient.post(`${this.orders}/${id}/lines`, input);
  }

  async fetchShippingAddressCountries(id: number): Promise<{ countries: string[] }> {
    return this.httpClient.get(`${this.orders}/${id}/shipping-address/countries`);
  }

  async updateShippingAddress(
    id: number,
    input: { address: Address; operationId: string }
  ): Promise<EditResult> {
    return this.httpClient.put(`${this.orders}/${id}/shipping-address`, input);
  }

  async updateBillingAddress(
    id: number,
    input: { address: Address; operationId: string }
  ): Promise<EditResult> {
    return this.httpClient.put(`${this.orders}/${id}/billing-address`, input);
  }

  async fetchShippingOptions(id: number): Promise<ShippingQuote> {
    return this.httpClient.get(`${this.orders}/${id}/shipping-options`);
  }

  async previewShippingRecalculation(
    id: number,
    input: ShippingRecalculationInput = {}
  ): Promise<ShippingRecalculationPreview> {
    return this.httpClient.post(`${this.orders}/${id}/shipping/recalculate/preview`, input);
  }

  async recalculateShipping(
    id: number,
    input: ShippingRecalculationInput & { operationId: string }
  ): Promise<EditResult> {
    return this.httpClient.post(`${this.orders}/${id}/shipping/recalculate`, input);
  }

  async editShippingLine(
    id: number,
    lineId: number,
    input: ShippingLineInput & { operationId: string }
  ): Promise<EditResult> {
    return this.httpClient.put(`${this.orders}/${id}/shipping-lines/${lineId}`, input);
  }

  async addShippingLine(id: number, input: ShippingLineInput & { operationId: string }): Promise<EditResult> {
    return this.httpClient.post(`${this.orders}/${id}/shipping-lines`, input);
  }

  async previewDiscounts(id: number, input: { selection?: string[] }): Promise<DiscountRecalculation> {
    return this.httpClient.post(`${this.orders}/${id}/discounts/preview`, input);
  }

  async applyDiscounts(
    id: number,
    input: { selection: string[]; operationId: string }
  ): Promise<EditResult> {
    return this.httpClient.post(`${this.orders}/${id}/discounts`, input);
  }

  async addManualDiscount(id: number, input: ManualDiscountInput & { operationId: string }): Promise<EditResult> {
    return this.httpClient.post(`${this.orders}/${id}/manual-discounts`, input);
  }

  async removeManualDiscount(
    id: number,
    discountId: number,
    input: { operationId: string }
  ): Promise<EditResult> {
    return this.httpClient.post(`${this.orders}/${id}/manual-discounts/${discountId}/remove`, input);
  }

  async dismissReviewFlag(
    id: number,
    code: ReviewFlagCode,
    input: { operationId: string }
  ): Promise<EditResult> {
    return this.httpClient.post(`${this.orders}/${id}/review-flags/${code}/dismiss`, input);
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

  /**
   * A binary download through the admin fetch client (the token goes in the Authorization header,
   * never in the URL). Error statuses come back as a blob too (401 still throws, so the session
   * can refresh): their JSON body is read so the caller sees the error code.
   */
  private async fetchBlob(url: string): Promise<Blob> {
    const { get } = getFetchClient();
    const res = await get(url, {
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
      throw Object.assign(new Error('Download failed'), { status, response: { data } });
    }
    return res.data;
  }

  async fetchShipmentLabel(shipmentId: number): Promise<Blob> {
    return this.fetchBlob(`${this.base}/shipments/${shipmentId}/label`);
  }

  async registerReturn(orderId: number, input: RegisterReturnInput): Promise<ReturnRegistered> {
    return this.httpClient.post(`${this.orders}/${orderId}/returns`, input);
  }

  async fetchInvoiceSelection(orderId: number): Promise<InvoiceSelectionView> {
    return this.httpClient.get(`${this.orders}/${orderId}/invoice-selection`);
  }

  async issueInvoice(orderId: number, input: IssueInvoiceSelectionInput): Promise<InvoiceView> {
    return this.httpClient.post(`${this.orders}/${orderId}/invoices`, input);
  }

  async reconcileInvoice(invoiceId: number, markFailed: boolean): Promise<InvoiceView> {
    return this.httpClient.post(`${this.base}/invoices/${invoiceId}/reconcile`, markFailed ? { markFailed: true } : {});
  }

  async fetchInvoicePdf(invoiceId: number): Promise<Blob> {
    return this.fetchBlob(`${this.base}/invoices/${invoiceId}/pdf`);
  }

  async fetchCreditNotePreview(invoiceId: number): Promise<CreditNoteOptions> {
    return this.httpClient.get(`${this.base}/invoices/${invoiceId}/credit-note/preview`);
  }

  async issueCreditNote(invoiceId: number, input: CreditNoteInput): Promise<InvoiceView> {
    return this.httpClient.post(`${this.base}/invoices/${invoiceId}/credit-note`, input);
  }
}
