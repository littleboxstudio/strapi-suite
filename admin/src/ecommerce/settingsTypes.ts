// Mirrors of the server settings and e-mail template types (admin cannot import server code).

export type StoreSettings = {
  storeName: string;
  logo: { url: string; width: number; height: number } | null;
  brandColor: string;
  storefrontUrl: string | null;
  timezone: string;
  /** Countries where the store sells; shipping rates are set per market. */
  markets: string[];
  supportEmail: string | null;
  /**
   * Storefront (BFF) API; optional here so older payloads and fixtures still type-check.
   * Read-only: only the storefront token endpoints (generate/regenerate) set the token id.
   */
  storefrontApiTokenId?: number | null;
  checkoutSessionTtlHours?: number;
};

/** What PUT /store accepts: the logo and the storefront token have their own endpoints. */
export type StoreSettingsInput = Omit<StoreSettings, 'logo' | 'storefrontApiTokenId'>;

/** The storefront (BFF) API token as the admin sees it: never its value. */
export type StorefrontTokenView = {
  id: number;
  name: string;
  description: string | null;
  type: 'read-only' | 'full-access' | 'custom';
  createdAt: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
};

export type StorefrontTokenState = {
  token: StorefrontTokenView | null;
  /** A token id is stored but that token no longer exists. */
  missing: boolean;
};

/** Generate/regenerate result: `accessKey` is the plain token, shown this one time only. */
export type GeneratedStorefrontToken = StorefrontTokenState & {
  accessKey: string;
  /** Regenerate only: false when the previous token could not be deleted. */
  previousTokenDeleted?: boolean;
};

export type ProviderCategory = 'payment' | 'billing' | 'carrier' | 'email';

export type ProviderField = {
  key: string;
  /** `markets`: a list of upper-case country codes (`string[]`). */
  type: 'string' | 'secret' | 'boolean' | 'number' | 'select' | 'markets';
  required: boolean;
  default?: unknown;
  options?: string[];
  /** Extra validation for `string` fields (checked by the server). */
  format?: 'email' | 'path';
  /** Admin i18n key */
  label: string;
  /** Admin i18n key of a plain-text "how to find this value" explanation (paragraphs split by blank lines). */
  help?: string;
  /** `credentials`: step 1 of a two-step configure form; the other fields form step 2. */
  group?: 'credentials';
  /** Name of the lookup list (`GET /integrations/:id/lookups`) offered as options for this field. */
  lookup?: string;
};

export type LookupOption = { value: string; label: string };

/** Lists read from the provider with the saved credentials, keyed by lookup name. */
export type LookupResult = {
  lists: Record<string, LookupOption[]>;
  /** Lists the provider could not return: those fields fall back to a plain input. */
  failed: string[];
};

export type IntegrationView = {
  id: string;
  category: ProviderCategory;
  name: string;
  active: boolean;
  fields: ProviderField[];
  config: Record<string, unknown>;
  /** Masked values; null when not set or unreadable. */
  secrets: Record<string, string | null>;
  secretsStatus: 'ok' | 'unreadable' | 'none';
  encryptionKeyConfigured: boolean;
};

export type IntegrationInput = {
  config?: Record<string, unknown>;
  /** A blank or omitted secret keeps the stored value; null deletes a stored optional secret. */
  secrets?: Record<string, string | null>;
};

export type ConnectionResult = {
  ok: boolean;
  code?: 'INVALID_CREDENTIALS' | 'UNREACHABLE' | 'NOT_IMPLEMENTED' | 'MISSING_FIELDS';
  message?: string;
};

/** `upTo` in kg (at most 3 decimals; null = no upper limit, last bracket only); `price` in cents (VAT included). */
export type WeightBracket = { upTo: number | null; price: number };

export type MarketRates = Record<string, WeightBracket[]>;

export type ManualMethod = {
  id: number;
  name: Record<string, string>;
  /** Weight brackets per country (upper-case code); a country without one is not served. */
  rates: MarketRates;
  tax: number;
  active: boolean;
  position: number;
  /** False once an order used it: it can be disabled but not deleted. */
  deletable?: boolean;
};

export type ManualMethodInput = Partial<Omit<ManualMethod, 'id' | 'deletable'>>;

export type EmailTemplateType =
  | 'ORDER_CONFIRMATION'
  | 'PAYMENT_CONFIRMATION'
  | 'PAYMENT_INSTRUCTIONS'
  | 'SUPPLEMENTARY_PAYMENT'
  | 'PARTIAL_SHIPMENT'
  | 'FULL_SHIPMENT'
  | 'DELIVERY_CONFIRMATION'
  | 'CANCELLATION'
  | 'REFUND_STARTED'
  | 'REFUND_COMPLETED'
  | 'INVOICE_AVAILABLE'
  | 'CREDIT_NOTE_ISSUED'
  | 'STORE_CREDIT_ISSUED'
  | 'EMAIL_VERIFICATION';

export type EmailTemplateSummary = { type: EmailTemplateType; customLocales: string[] };

export type VariableDef = {
  path: string;
  description: string;
  kind: 'value' | 'list';
  itemFields?: string[];
};

export type TemplateContent = { subject: string; html: string };

export type EmailTemplateView = TemplateContent & {
  type: EmailTemplateType;
  locale: string;
  isCustom: boolean;
  version: number;
  variables: VariableDef[];
};

export type EmailTemplateVersionView = TemplateContent & {
  id: number;
  version: number;
  authorId: string | null;
  authorName: string | null;
  createdAt: string | null;
};

export type TemplateIssue = {
  code: 'UNKNOWN_VARIABLE' | 'UNSAFE_HTML' | 'SYNTAX';
  detail: string;
};

export type EmailPreview = TemplateContent & { issues: TemplateIssue[] };

/** Field error returned in `details.errors` by the settings endpoints. */
export type SettingsFieldError = {
  path: string;
  code:
    | 'required'
    | 'invalid_url'
    | 'invalid_color'
    | 'invalid_timezone'
    | 'invalid_country'
    | 'invalid_email'
    | 'out_of_range'
    | 'invalid_number'
    | 'invalid_option'
    | 'MARKET_IN_USE'
    | (string & {});
  /** Extra context, e.g. the method or provider name of `MARKET_IN_USE`. */
  detail?: string;
};

/** `details.code` of the secret and e-mail errors. */
export type SettingsErrorCode =
  | 'ENCRYPTION_KEY_MISSING'
  | 'SECRET_UNREADABLE'
  | 'EMAIL_NOT_CONFIGURED'
  | 'EMAIL_SEND_FAILED'
  | 'INVALID_IMAGE'
  | 'UPLOAD_FAILED'
  /** 409: generate was asked while a storefront token is configured. */
  | 'STOREFRONT_TOKEN_EXISTS';

/** Where Stripe must send its webhooks: `path` is relative to the Strapi origin. */
export type StripeWebhookInfo = { path: string; events: string[] };
