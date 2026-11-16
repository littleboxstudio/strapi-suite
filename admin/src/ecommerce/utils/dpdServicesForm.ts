import type { DpdService, DpdServiceId, DpdServices, SettingsFieldError } from '../settingsTypes';
import {
  draftToManualMethodInput,
  manualMethodToDraft,
  type ManualMethodDraft,
} from './manualMethodForm';

export const DPD_SERVICE_IDS: readonly DpdServiceId[] = ['EXPRESS', 'PICKUP'];

/** The markets DPD Pickup serves: mainland Portugal and the islands. */
const PICKUP_MARKETS: readonly string[] = ['PT', 'PT-ISL'];

/** The store markets a service may have prices for: PICKUP only PT and PT-ISL. */
export function dpdServiceMarkets(id: DpdServiceId, markets: string[]): string[] {
  return id === 'PICKUP' ? markets.filter((m) => PICKUP_MARKETS.includes(m)) : markets;
}

/** Error code per path: `<ID>.name.<locale>`, `<ID>.tax`, `<ID>.rates.<market>.<i>.upTo|price`. */
export type DpdServicesErrors = Record<string, string>;

export function dpdServiceToDraft(
  service: DpdService,
  localeCodes: string[],
  uiLocale: string,
  markets: string[]
): ManualMethodDraft {
  return manualMethodToDraft({ ...service, id: 0, position: 0 }, localeCodes, uiLocale, markets);
}

/**
 * Validates one service like a manual method, except that no market is required: a service
 * without a rate table serves no market. Errors are keyed as in a manual method.
 */
export function draftToDpdService(
  draft: ManualMethodDraft,
  defaultLocale: string
): { service?: DpdService; errors: DpdServicesErrors } {
  const { input, errors } = draftToManualMethodInput(draft, defaultLocale, {
    marketsRequired: false,
  });
  if (!input) return { errors };
  return {
    errors,
    service: {
      active: !!input.active,
      name: input.name ?? {},
      tax: input.tax ?? 0,
      rates: input.rates ?? {},
    },
  };
}

export function activeServiceCount(services: Record<DpdServiceId, { active: boolean }>): number {
  return DPD_SERVICE_IDS.filter((id) => services[id].active).length;
}

/** A copy with one service switched on or off. */
export function withServiceActive(
  services: DpdServices,
  id: DpdServiceId,
  active: boolean
): DpdServices {
  return { ...services, [id]: { ...services[id], active } };
}

/**
 * Server errors keyed like the form errors (`services.EXPRESS.tax` → `EXPRESS.tax`); other paths
 * (`services`, `config.*`, `secrets.*`) are kept as they are. First error per path wins.
 */
export function dpdServicesErrorMap(errors: SettingsFieldError[]): DpdServicesErrors {
  const map: DpdServicesErrors = {};
  errors.forEach(({ path, code }) => {
    const key = path.startsWith('services.') ? path.slice('services.'.length) : path;
    if (!(key in map)) map[key] = code;
  });
  return map;
}
