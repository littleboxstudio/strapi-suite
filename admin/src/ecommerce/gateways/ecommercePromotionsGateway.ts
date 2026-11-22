import HttpClient from '../../core/http/httpClient';
import Registry from '../../core/di/registry';
import config from '../../core/config';
import { objectToQueryString } from '../../core/utils/objectToQueryString';
import type { Paginated } from '../orderTypes';
import type {
  Promotion,
  PromotionCatalogResult,
  PromotionEditorContext,
  PromotionListItem,
  PromotionListParams,
  PromotionRedemption,
  PromotionSaveInput,
} from '../promotionTypes';

/** Promotions admin API (server routes admin-promotions) and the store credit list (admin-refunds). */
export default interface EcommercePromotionsGateway {
  // read: promotions.read
  fetchPromotions(params: PromotionListParams): Promise<Paginated<PromotionListItem>>;
  fetchPromotion(id: number): Promise<Promotion>;
  fetchEditorContext(): Promise<PromotionEditorContext>;
  fetchRedemptions(id: number, page?: number): Promise<Paginated<PromotionRedemption>>;
  // write: promotions.manage
  createPromotion(input: PromotionSaveInput): Promise<Promotion>;
  updatePromotion(id: number, input: PromotionSaveInput): Promise<Promotion>;
  deletePromotion(id: number): Promise<{ ok: true }>;
  searchCatalog(q: string, locale?: string): Promise<PromotionCatalogResult[]>;
  // Store credit: read with customers.read (the void action stays in the orders gateway)
}

export class EcommercePromotionsGatewayHttp implements EcommercePromotionsGateway {
  httpClient: HttpClient;

  constructor() {
    this.httpClient = Registry.getInstance().inject('httpClient');
  }

  private promotions = `/${config.pluginId}/admin/ecommerce/promotions`;

  async fetchPromotions(params: PromotionListParams): Promise<Paginated<PromotionListItem>> {
    return this.httpClient.get(`${this.promotions}${objectToQueryString(params)}`);
  }

  async fetchPromotion(id: number): Promise<Promotion> {
    return this.httpClient.get(`${this.promotions}/${id}`);
  }

  async fetchEditorContext(): Promise<PromotionEditorContext> {
    return this.httpClient.get(`${this.promotions}/context`);
  }

  async fetchRedemptions(id: number, page?: number): Promise<Paginated<PromotionRedemption>> {
    return this.httpClient.get(`${this.promotions}/${id}/redemptions${objectToQueryString({ page })}`);
  }

  async createPromotion(input: PromotionSaveInput): Promise<Promotion> {
    return this.httpClient.post(this.promotions, input);
  }

  async updatePromotion(id: number, input: PromotionSaveInput): Promise<Promotion> {
    return this.httpClient.put(`${this.promotions}/${id}`, input);
  }

  async deletePromotion(id: number): Promise<{ ok: true }> {
    return this.httpClient.delete(`${this.promotions}/${id}`);
  }

  async searchCatalog(q: string, locale?: string): Promise<PromotionCatalogResult[]> {
    return this.httpClient.get(`${this.promotions}/catalog-search${objectToQueryString({ q, locale })}`);
  }


}
