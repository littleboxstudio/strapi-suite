// Mirrors of the server types (admin cannot import server code).

export type VariantInput = {
  id?: number;
  sku: string;
  price: number;
  tax: number;
  /** Initial stock of a new variant; the server ignores it for existing ones. */
  stock: number;
  /** Signed manual adjustment for an existing variant (absent = none). */
  stockAdjustment?: number;
  /** Idempotency key minted when the adjustment is confirmed. */
  stockAdjustmentKey?: string;
  /** The stock the admin saw when setting a new value (the server refuses if it moved since). */
  stockExpected?: number;
  weight: number;
  width: number;
  height: number;
  depth: number;
  active: boolean;
  /** The "was" price in cents; when set it must be above `price`. Omitted = unchanged. */
  compareAtPrice?: number | null;
  translations: Record<string, { option: string }>;
};

export type ProductInput = {
  active: boolean;
  translations: Record<
    string,
    { name: string; slug?: string; shortDescription?: string; description: string }
  >;
  variants: VariantInput[];
  // Organization fields: omitted = unchanged on update (empty on create); null clears.
  categoryId?: number | null;
  productTypeId?: number | null;
  /** Used only when `productTypeId` is absent: reused by name or created. */
  productTypeName?: string | null;
  tagIds?: number[];
  /** Reused by name or created; merged with `tagIds`. */
  tagNames?: string[];
  /** The full set of MANUAL collections. */
  collectionIds?: number[];
};

export type ProductListFilters = {
  categoryId?: number;
  productTypeId?: number;
  tagId?: number;
  collectionId?: number;
};

export type FieldError = {
  path: string;
  code:
    | 'required'
    | 'min_variants'
    | 'duplicate_sku'
    | 'invalid_number'
    | 'out_of_range'
    | 'VARIANT_IN_ORDERS'
    | 'PRODUCT_IN_ORDERS'
    | 'STOCK_CHANGED'
    | 'compare_at_not_above_price'
    | 'too_long'
    | 'unknown'
    | 'automated_collection'
    | 'too_many';
};

export type ImageRecord = {
  id: number;
  name: string;
  width: number;
  height: number;
  sizeBytes: number;
  url: string;
  position: number;
  /** The gallery's cover (one per gallery): reordering never changes it. */
  cover: boolean;
};

export type ProductListItem = {
  id: number;
  name: string;
  thumbnailUrl: string | null;
  skus: string[];
  priceMin: number;
  priceMax: number;
  stockTotal: number;
  variantCount: number;
  hasNegativeStock: boolean;
  active: boolean;
};

export type ProductDetail = Omit<
  ProductInput,
  'variants' | 'categoryId' | 'productTypeId' | 'productTypeName' | 'tagIds' | 'tagNames' | 'collectionIds'
> & {
  id: number;
  images: ImageRecord[];
  /** False once the product is in any order: it can only be deactivated. */
  deletable: boolean;
  categoryId: number | null;
  /** Root first, names in the default locale. */
  categoryPath: { id: number; name: string }[];
  productTypeId: number | null;
  productTypeName: string | null;
  tags: { id: number; name: string }[];
  /** Manual and automated collections the product is in. */
  collections: { id: number; title: string; type: 'MANUAL' | 'AUTOMATED' }[];
  variants: (VariantInput & {
    id: number;
    images: ImageRecord[];
    deletable: boolean;
    compareAtPrice: number | null;
  })[];
};

export type EcommerceLocales = {
  defaultLocale: string;
  locales: { code: string; name: string }[];
  aiAvailable: boolean;
};

export type ProductListParams = { page?: number; search?: string; locale?: string };

export type ProductListResult = {
  results: ProductListItem[];
  pagination: Record<string, any>;
};

export type TranslateInput = {
  sourceLocale: string;
  targetLocales: string[];
  strings: Record<string, string>;
};

export type TranslateOutput = {
  translations: Record<string, Record<string, string>>;
  failed: any;
  /** Why strings failed: the AI provider's reasons (no secrets). */
  errors?: string[];
};
