import type { DpdService, DpdServiceId, DpdServices, SettingsFieldError } from '../settingsTypes';
import {
  draftToManualMethodInput,
  manualMethodToDraft,
  type ManualMethodDraft,
} from './manualMethodForm';

export const DPD_SERVICE_IDS: readonly DpdServiceId[] = ['EXPRESS', 'PICKUP'];

/** Each service is edited like a manual shipping method (names, VAT, rates per market). */
export type DpdServicesForm = Record<DpdServiceId, ManualMethodDraft>;

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

/** Only markets that are still store markets are kept. */
export function dpdServicesToForm(
  services: DpdServices,
  localeCodes: string[],
  uiLocale: string,
  markets: string[]
): DpdServicesForm {
  return {
    EXPRESS: dpdServiceToDraft(services.EXPRESS, localeCodes, uiLocale, markets),
    PICKUP: dpdServiceToDraft(services.PICKUP, localeCodes, uiLocale, markets),
  };
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

/** Both services (the PUT replaces both), or the errors keyed `<ID>.<path>`. */
export function formToDpdServices(
  form: DpdServicesForm,
  defaultLocale: string
): { services?: DpdServices; errors: DpdServicesErrors } {
  const errors: DpdServicesErrors = {};
  const services: Partial<DpdServices> = {};
  DPD_SERVICE_IDS.forEach((id) => {
    const result = draftToDpdService(form[id], defaultLocale);
    Object.entries(result.errors).forEach(([path, code]) => {
      errors[`${id}.${path}`] = code;
    });
    if (result.service) services[id] = result.service;
  });
  if (Object.keys(errors).length) return { errors };
  return { errors, services: services as DpdServices };
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
