import HttpClient from '../../core/http/httpClient';
import Registry from '../../core/di/registry';
import config from '../../core/config';
import { objectToQueryString } from '../../core/utils/objectToQueryString';
import type {
  BulkProductsInput,
  CategoryDetail,
  CategoryInput,
  CategoryMoveInput,
  CategoryTreeNode,
  CollectionDetail,
  CollectionInput,
  CollectionListItem,
  CollectionListParams,
  CollectionPreviewInput,
  CollectionPreviewItem,
  CollectionProductItem,
  NamedInput,
  NamedListParams,
  NamedPage,
  Paginated,
} from '../organizationTypes';

/**
 * Product organization admin API: categories, product types, tags, vendors (routes
 * admin-organization) and collections plus bulk product actions (routes admin-collections).
 * Reads need products.read, changes products.manage.
 */
export default interface EcommerceOrganizationGateway {
  // categories
  fetchCategoryTree(locale?: string): Promise<CategoryTreeNode[]>;
  fetchCategory(id: number): Promise<CategoryDetail>;
  createCategory(input: CategoryInput): Promise<{ id: number }>;
  updateCategory(id: number, input: CategoryInput): Promise<void>;
  moveCategory(id: number, input: CategoryMoveInput): Promise<void>;
  deleteCategory(id: number): Promise<void>;
  // product types
  fetchProductTypes(params: NamedListParams): Promise<NamedPage>;
  createProductType(input: NamedInput): Promise<{ id: number }>;
  updateProductType(id: number, input: NamedInput): Promise<void>;
  deleteProductType(id: number): Promise<void>;
  // tags
  fetchTags(params: NamedListParams): Promise<NamedPage>;
  createTag(input: NamedInput): Promise<{ id: number }>;
  updateTag(id: number, input: NamedInput): Promise<void>;
  deleteTag(id: number): Promise<void>;
  // vendors (suggestions, at most 20)
  searchVendors(search?: string): Promise<string[]>;
  // collections
  fetchCollections(params: CollectionListParams): Promise<Paginated<CollectionListItem>>;
  fetchCollection(id: number): Promise<CollectionDetail>;
  createCollection(input: CollectionInput): Promise<{ id: number }>;
  updateCollection(id: number, input: CollectionInput): Promise<void>;
  deleteCollection(id: number): Promise<void>;
  fetchCollectionProducts(id: number, params: { page?: number; locale?: string }): Promise<Paginated<CollectionProductItem>>;
  addCollectionProducts(id: number, productIds: number[]): Promise<void>;
  removeCollectionProducts(id: number, productIds: number[]): Promise<void>;
  reorderCollectionProducts(id: number, productIds: number[]): Promise<void>;
  previewCollection(input: CollectionPreviewInput): Promise<Paginated<CollectionPreviewItem>>;
  recalculateCollection(id: number): Promise<{ added: number; removed: number }>;
  // bulk product actions
  bulkProducts(input: BulkProductsInput): Promise<{ updated: number }>;
}

export class EcommerceOrganizationGatewayHttp implements EcommerceOrganizationGateway {
  httpClient: HttpClient;

  constructor() {
    this.httpClient = Registry.getInstance().inject('httpClient');
  }

  private base = `/${config.pluginId}/admin/ecommerce`;

  // ---------------------------------------------------------------- categories

  async fetchCategoryTree(locale?: string): Promise<CategoryTreeNode[]> {
    return this.httpClient.get(`${this.base}/categories${objectToQueryString({ locale })}`);
  }

  async fetchCategory(id: number): Promise<CategoryDetail> {
    return this.httpClient.get(`${this.base}/categories/${id}`);
  }

  async createCategory(input: CategoryInput): Promise<{ id: number }> {
    return this.httpClient.post(`${this.base}/categories`, input);
  }

  async updateCategory(id: number, input: CategoryInput): Promise<void> {
    await this.httpClient.put(`${this.base}/categories/${id}`, input);
  }

  async moveCategory(id: number, input: CategoryMoveInput): Promise<void> {
    await this.httpClient.put(`${this.base}/categories/${id}/move`, input);
  }

  async deleteCategory(id: number): Promise<void> {
    await this.httpClient.delete(`${this.base}/categories/${id}`);
  }

  // ---------------------------------------------------------------- product types

  async fetchProductTypes(params: NamedListParams): Promise<NamedPage> {
    return this.httpClient.get(`${this.base}/product-types${objectToQueryString(params)}`);
  }

  async createProductType(input: NamedInput): Promise<{ id: number }> {
    return this.httpClient.post(`${this.base}/product-types`, input);
  }

  async updateProductType(id: number, input: NamedInput): Promise<void> {
    await this.httpClient.put(`${this.base}/product-types/${id}`, input);
  }

  async deleteProductType(id: number): Promise<void> {
    await this.httpClient.delete(`${this.base}/product-types/${id}`);
  }

  // ---------------------------------------------------------------- tags

  async fetchTags(params: NamedListParams): Promise<NamedPage> {
    return this.httpClient.get(`${this.base}/tags${objectToQueryString(params)}`);
  }

  async createTag(input: NamedInput): Promise<{ id: number }> {
    return this.httpClient.post(`${this.base}/tags`, input);
  }

  async updateTag(id: number, input: NamedInput): Promise<void> {
    await this.httpClient.put(`${this.base}/tags/${id}`, input);
  }

  async deleteTag(id: number): Promise<void> {
    await this.httpClient.delete(`${this.base}/tags/${id}`);
  }

  // ---------------------------------------------------------------- vendors

  async searchVendors(search?: string): Promise<string[]> {
    return this.httpClient.get(`${this.base}/vendors${objectToQueryString({ search })}`);
  }

  // ---------------------------------------------------------------- collections

  async fetchCollections(params: CollectionListParams): Promise<Paginated<CollectionListItem>> {
    return this.httpClient.get(`${this.base}/collections${objectToQueryString(params)}`);
  }

  async fetchCollection(id: number): Promise<CollectionDetail> {
    return this.httpClient.get(`${this.base}/collections/${id}`);
  }

  async createCollection(input: CollectionInput): Promise<{ id: number }> {
    return this.httpClient.post(`${this.base}/collections`, input);
  }

  async updateCollection(id: number, input: CollectionInput): Promise<void> {
    await this.httpClient.put(`${this.base}/collections/${id}`, input);
  }

  async deleteCollection(id: number): Promise<void> {
    await this.httpClient.delete(`${this.base}/collections/${id}`);
  }

  async fetchCollectionProducts(
    id: number,
    params: { page?: number; locale?: string }
  ): Promise<Paginated<CollectionProductItem>> {
    return this.httpClient.get(`${this.base}/collections/${id}/products${objectToQueryString(params)}`);
  }

  async addCollectionProducts(id: number, productIds: number[]): Promise<void> {
    await this.httpClient.post(`${this.base}/collections/${id}/products`, { productIds });
  }

  /**
   * Through the bulk action: the admin fetch client sends no body with DELETE, so
   * `DELETE /collections/:id/products` cannot carry the ids. Same rules (manual collection only).
   */
  async removeCollectionProducts(id: number, productIds: number[]): Promise<void> {
    if (!productIds.length) return;
    await this.bulkProducts({ productIds, action: 'removeFromCollection', value: id });
  }

  async reorderCollectionProducts(id: number, productIds: number[]): Promise<void> {
    await this.httpClient.put(`${this.base}/collections/${id}/products/order`, { productIds });
  }

  async previewCollection(input: CollectionPreviewInput): Promise<Paginated<CollectionPreviewItem>> {
    return this.httpClient.post(`${this.base}/collections/preview`, input);
  }

  async recalculateCollection(id: number): Promise<{ added: number; removed: number }> {
    return this.httpClient.post(`${this.base}/collections/${id}/recalculate`, {});
  }

  // ---------------------------------------------------------------- bulk

  async bulkProducts(input: BulkProductsInput): Promise<{ updated: number }> {
    return this.httpClient.post(`${this.base}/products/bulk`, input);
  }
}
