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
  weight: number;
  width: number;
  height: number;
  depth: number;
  active: boolean;
  translations: Record<string, { option: string }>;
};

export type ProductInput = {
  active: boolean;
  translations: Record<
    string,
    { name: string; slug?: string; shortDescription?: string; description: string }
  >;
  variants: VariantInput[];
};

export type FieldError = {
  path: string;
  code: 'required' | 'min_variants' | 'duplicate_sku' | 'invalid_number' | 'out_of_range';
};

export type ImageRecord = {
  id: number;
  name: string;
  width: number;
  height: number;
  sizeBytes: number;
  url: string;
  position: number;
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

export type ProductDetail = Omit<ProductInput, 'variants'> & {
  id: number;
  images: ImageRecord[];
  variants: (VariantInput & { id: number; images: ImageRecord[] })[];
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
};
