// Mirrors of the server settings and e-mail template types (admin cannot import server code).

export type StoreSettings = {
  storeName: string;
  logo: { url: string; width: number; height: number } | null;
  brandColor: string;
  storefrontUrl: string | null;
  timezone: string;
  /** Countries where the store sells; shipping zones group them. */
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
  /** `zones`: a list of shipping zone ids (`number[]`). */
  type: 'string' | 'secret' | 'boolean' | 'number' | 'select' | 'zones';
  required: boolean;
  default?: unknown;
  options?: string[];
  /** Extra validation for `string` fields (checked by the server). */
  format?: 'email' | 'path';
  /** Admin i18n key */
  label: string;
};

export type IntegrationView = {
  id: string;
  category: ProviderCategory;
  name: string;
  active: boolean;
  verified: boolean;
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

export type ManualMethod = {
  id: number;
  name: Record<string, string>;
  /** Price in cents (VAT included) per shipping zone id; a zone without one does not offer it. */
  rates: Record<string, number>;
  tax: number;
  active: boolean;
  position: number;
};

export type ManualMethodInput = Partial<Omit<ManualMethod, 'id'>>;

/** A group of market countries that share the shipping prices of each method. */
export type ShippingZone = { id: number; name: string; countries: string[]; position: number };

export type ShippingZoneInput = { name?: string; countries?: string[]; position?: number };

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
  /** Extra context, e.g. the zone name of `MARKET_IN_USE` and `ZONE_COUNTRY_CONFLICT`. */
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
