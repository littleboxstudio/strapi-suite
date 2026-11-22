/**
 * Product organization admin API shapes (server: services/modules/ecommerce/organization.ts and
 * collections.ts; routes admin-organization and admin-collections).
 */
import type { Paginated } from './orderTypes';

export type { Paginated };

/** One server validation issue; `detail` carries e.g. a collection title for IN_USE_BY_COLLECTIONS. */
export type OrganizationIssue = { path: string; code: string; detail?: string };

// ------------------------------------------------------------------ categories

export type CategoryTranslation = {
  name: string;
  slug: string;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
};

export type CategoryTranslationInput = {
  name: string;
  /** Empty or absent: kept (or generated from the name for a new translation). */
  slug?: string;
  description?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
};

export type CategoryInput = {
  parentId: number | null;
  active: boolean;
  image: string | null;
  translations: Record<string, CategoryTranslationInput>;
};

export type CategoryTreeNode = {
  id: number;
  parentId: number | null;
  position: number;
  active: boolean;
  name: string;
  slug: string;
  /** Products directly in this category (not its subcategories). */
  productCount: number;
  children: CategoryTreeNode[];
};

export type CategoryDetail = {
  id: number;
  parentId: number | null;
  position: number;
  active: boolean;
  image: string | null;
  translations: Record<string, CategoryTranslation>;
  productCount: number;
  childCount: number;
};

/** `position` among the new siblings (the category itself left out). */
export type CategoryMoveInput = { parentId: number | null; position: number };

// ------------------------------------------------------------------ product types and tags

export type NamedTranslations = Record<string, { name: string }>;

export type NamedInput = { translations: NamedTranslations };

export type NamedListItem = {
  id: number;
  name: string;
  translations: NamedTranslations;
  productCount: number;
};

export type NamedListParams = { page?: number; search?: string; locale?: string };

export type NamedPage = Paginated<NamedListItem>;

// ------------------------------------------------------------------ collections

export type CollectionType = 'MANUAL' | 'AUTOMATED';
export type CollectionMatch = 'ALL' | 'ANY';
export const COLLECTION_SORTS = [
  'MANUAL',
  'BEST_SELLING',
  'TITLE_ASC',
  'TITLE_DESC',
  'PRICE_ASC',
  'PRICE_DESC',
  'NEWEST',
  'OLDEST',
] as const;
export type CollectionSort = (typeof COLLECTION_SORTS)[number];
export type CollectionField =
  | 'TITLE'
  | 'CATEGORY'
  | 'PRODUCT_TYPE'
  | 'TAG'
  | 'VENDOR'
  | 'PRICE'
  | 'COMPARE_AT_PRICE'
  | 'INVENTORY';
export type CollectionOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte';
/** Prices in cents; CATEGORY / PRODUCT_TYPE / TAG values are ids. */
export type CollectionCondition = { field: CollectionField; operator: CollectionOperator; value: string | number };

export type CollectionTranslation = {
  title: string;
  handle: string;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
};

export type CollectionTranslationInput = {
  title: string;
  handle?: string;
  description?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
};

export type CollectionInput = {
  /** Fixed once created. */
  type: CollectionType;
  sortOrder?: CollectionSort;
  active: boolean;
  image: string | null;
  match?: CollectionMatch;
  conditions?: CollectionCondition[];
  translations: Record<string, CollectionTranslationInput>;
};

export type CollectionListItem = {
  id: number;
  title: string;
  handle: string;
  type: CollectionType;
  active: boolean;
  productCount: number;
};

export type CollectionListParams = { page?: number; search?: string; locale?: string };

export type CollectionDetail = {
  id: number;
  type: CollectionType;
  sortOrder: CollectionSort;
  active: boolean;
  image: string | null;
  match: CollectionMatch;
  conditions: CollectionCondition[];
  translations: Record<string, CollectionTranslation>;
  productCount: number;
};

export type CollectionProductItem = {
  productId: number;
  name: string;
  thumbnailUrl: string | null;
  position: number;
};

export type CollectionPreviewItem = { productId: number; name: string; thumbnailUrl: string | null };

export type CollectionPreviewInput = {
  match: CollectionMatch;
  conditions: CollectionCondition[];
  page?: number;
  locale?: string;
};

export type BulkProductAction =
  | 'addTag'
  | 'removeTag'
  | 'setCategory'
  | 'setProductType'
  | 'addToCollection'
  | 'removeFromCollection';

/** At most 100 product ids; `value` is the tag/category/type/collection id (null clears a category or type). */
export type BulkProductsInput = { productIds: number[]; action: BulkProductAction; value: number | null };
