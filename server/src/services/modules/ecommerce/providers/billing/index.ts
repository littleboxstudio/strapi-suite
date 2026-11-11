import { moloniProvider } from './moloni/provider';
import type { BillingProvider } from './types';

/** Built-in billing providers, keyed by provider id (as `registry.ts` does for definitions). */
const builtIns = (): BillingProvider[] => [moloniProvider];

let providers = new Map<string, BillingProvider>(builtIns().map((p) => [p.id, p]));

export function getBillingProvider(id: string): BillingProvider | undefined {
  return providers.get(id);
}

export function registerBillingProvider(provider: BillingProvider): void {
  if (providers.has(provider.id)) {
    throw new Error(`Billing provider "${provider.id}" is already registered`);
  }
  providers.set(provider.id, provider);
}

/** Test helper: restores the built-in providers. */
export function __resetBillingProvidersForTests(): void {
  providers = new Map(builtIns().map((p) => [p.id, p]));
}

export type { BillingProvider, InvoiceDraft, IssuedDocument } from './types';
