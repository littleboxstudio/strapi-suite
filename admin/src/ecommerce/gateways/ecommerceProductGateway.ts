import HttpClient from '../../core/http/httpClient';
import Registry from '../../core/di/registry';
import config from '../../core/config';
import { objectToQueryString } from '../../core/utils/objectToQueryString';
import type {
  EcommerceLocales,
  ImageRecord,
  ProductDetail,
  ProductInput,
  ProductListParams,
  ProductListResult,
  TranslateInput,
  TranslateOutput,
} from '../types';

export default interface EcommerceProductGateway {
  fetchLocales(): Promise<EcommerceLocales>;
  fetchProducts(params: ProductListParams): Promise<ProductListResult>;
  fetchProduct(id: number): Promise<ProductDetail>;
  createProduct(input: ProductInput): Promise<{ id: number }>;
  updateProduct(id: number, input: ProductInput): Promise<void>;
  deleteProduct(id: number): Promise<void>;
  setProductActive(id: number, active: boolean): Promise<{ active: boolean }>;
  uploadImage(form: FormData): Promise<ImageRecord>;
  deleteImage(id: number): Promise<void>;
  translate(input: TranslateInput): Promise<TranslateOutput>;
}

export class EcommerceProductGatewayHttp implements EcommerceProductGateway {
  httpClient: HttpClient;

  constructor() {
    this.httpClient = Registry.getInstance().inject('httpClient');
  }

  private base = `/${config.pluginId}/admin/ecommerce`;

  async fetchLocales(): Promise<EcommerceLocales> {
    return this.httpClient.get(`${this.base}/locales`);
  }

  async fetchProducts(params: ProductListParams): Promise<ProductListResult> {
    return this.httpClient.get(`${this.base}/products${objectToQueryString(params)}`);
  }

  async fetchProduct(id: number): Promise<ProductDetail> {
    return this.httpClient.get(`${this.base}/products/${id}`);
  }

  async createProduct(input: ProductInput): Promise<{ id: number }> {
    return this.httpClient.post(`${this.base}/products`, input);
  }

  async updateProduct(id: number, input: ProductInput): Promise<void> {
    await this.httpClient.put(`${this.base}/products/${id}`, input);
  }

  async setProductActive(id: number, active: boolean): Promise<{ active: boolean }> {
    return this.httpClient.put(`${this.base}/products/${id}/active`, { active });
  }

  async deleteProduct(id: number): Promise<void> {
    await this.httpClient.delete(`${this.base}/products/${id}`);
  }

  async uploadImage(form: FormData): Promise<ImageRecord> {
    return this.httpClient.post(`${this.base}/images`, form);
  }

  async deleteImage(id: number): Promise<void> {
    await this.httpClient.delete(`${this.base}/images/${id}`);
  }

  async translate(input: TranslateInput): Promise<TranslateOutput> {
    return this.httpClient.post(`${this.base}/products/translate`, input);
  }
}
