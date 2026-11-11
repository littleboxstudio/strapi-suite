export const SETTINGS_SECTIONS = [
  'general',
  'storefront',
  'payments',
  'billing',
  'shipping',
  'email-service',
  'email-templates',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
