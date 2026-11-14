import { useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import {
  Badge,
  Box,
  Button,
  Flex,
  IconButton,
  Loader,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { Pencil } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import { ActionConfirmModal } from '../ActionConfirmModal';
import FetchDpdServices from '../../usecases/settings/fetchDpdServices';
import SaveDpdServices from '../../usecases/settings/saveDpdServices';
import FetchSettingsLocales from '../../usecases/settings/fetchSettingsLocales';
import { DpdServiceModal } from './DpdServiceModal';
import { extractFieldErrors } from '../../utils/productForm';
import { marketOptions } from '../../utils/settingsForm';
import {
  DPD_SERVICE_IDS,
  activeServiceCount,
  dpdServicesErrorMap,
  withServiceActive,
} from '../../utils/dpdServicesForm';
import type { ManualMethodErrors } from '../../utils/manualMethodForm';
import type { EcommerceLocales } from '../../types';
import type { DpdService, DpdServiceId, DpdServices } from '../../settingsTypes';

type Props = {
  readOnly: boolean;
  /** The store markets. */
  markets: string[];
  /** Whether the DPD Portugal integration is active (the server turns it off with no service). */
  integrationActive: boolean;
  onIntegrationActiveChange: (active: boolean) => void;
};

const FIELD_LABEL = 'ecommerce.settings.providers.dpd-portugal.fields';

/**
 * The DPD Portugal services (Express, Pickup), shown inside the DPD Portugal card like the manual
 * shipping methods. Every save sends both services.
 */
const DpdServicesSection = ({
  readOnly,
  markets,
  integrationActive,
  onIntegrationActiveChange,
}: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const [services, setServices] = useState<DpdServices | null>(null);
  const [locales, setLocales] = useState<EcommerceLocales | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<DpdServiceId | null>(null);
  const [toggling, setToggling] = useState<DpdServiceId | null>(null);
  const [confirmDisable, setConfirmDisable] = useState<DpdServiceId | null>(null);

  const islandsName = t('ecommerce.settings.markets.names.PT-ISL');
  const countries = useMemo(() => marketOptions(uiLocale, islandsName), [uiLocale, islandsName]);
  const marketName = (code: string) => countries.find((c) => c.code === code)?.name ?? code;

  useEffect(() => {
    let cancelled = false;
    // Needs the products read permission; without it the services stay read-only.
    new FetchSettingsLocales()
      .execute()
      .then((info) => {
        if (!cancelled) setLocales(info);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    new FetchDpdServices()
      .execute()
      .then((stored) => {
        if (!cancelled) setServices(stored);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [markets]);

  const serviceLabel = (id: DpdServiceId) => t(`ecommerce.settings.dpdServices.services.${id}`);

  /**
   * Saves both services. Resolves to null when saved, or to the errors of service `id` (keyed
   * like its draft) after telling the user what is wrong.
   */
  const persist = async (
    next: DpdServices,
    id: DpdServiceId
  ): Promise<ManualMethodErrors | null> => {
    try {
      const result = await new SaveDpdServices().execute(next);
      setServices(result.services);
      if (result.active !== integrationActive) onIntegrationActiveChange(result.active);
      if (integrationActive && !result.active) {
        toggleNotification({
          type: 'warning',
          message: t('ecommerce.settings.dpdServices.deactivated'),
        });
      }
      return null;
    } catch (err) {
      const fieldErrors = extractFieldErrors(err);
      if (!fieldErrors) {
        toggleNotification({ type: 'danger', message: t('ecommerce.settings.saveError') });
        return {};
      }
      const map = dpdServicesErrorMap(fieldErrors);
      // An active integration refuses services its configuration cannot serve yet.
      const missingFields = Object.keys(map)
        .filter((path) => path.startsWith('config.') || path.startsWith('secrets.'))
        .map((path) => t(`${FIELD_LABEL}.${path.split('.')[1]}`));
      if (missingFields.length) {
        toggleNotification({
          type: 'warning',
          message: t('ecommerce.settings.dpdServices.configIncomplete', {
            fields: missingFields.join(', '),
          }),
        });
      } else if (map.services) {
        toggleNotification({
          type: 'warning',
          message: t(`ecommerce.settings.errors.${map.services}`),
        });
      } else {
        toggleNotification({ type: 'warning', message: t('ecommerce.settings.errors.fix') });
      }
      const prefix = `${id}.`;
      return Object.fromEntries(
        Object.entries(map)
          .filter(([path]) => path.startsWith(prefix))
          .map(([path, code]) => [path.slice(prefix.length), code])
      );
    }
  };

  const saveService = async (id: DpdServiceId, service: DpdService) => {
    if (!services) return {};
    const errors = await persist({ ...services, [id]: service }, id);
    if (!errors) {
      setEditing(null);
      toggleNotification({ type: 'success', message: t('ecommerce.settings.saved') });
    }
    return errors;
  };

  const setServiceActive = async (id: DpdServiceId, active: boolean) => {
    if (!services || toggling) return;
    setToggling(id);
    try {
      const wasActive = integrationActive;
      const next = withServiceActive(services, id, active);
      const errors = await persist(next, id);
      // When the integration was turned off, `persist` already said so.
      if (!errors && !(wasActive && activeServiceCount(next) === 0)) {
        toggleNotification({
          type: 'success',
          message: t(
            active
              ? 'ecommerce.settings.dpdServices.enabledNotice'
              : 'ecommerce.settings.dpdServices.disabledNotice'
          ),
        });
      }
    } finally {
      setToggling(null);
    }
  };

  const canEdit = !readOnly && locales !== null;

  const nameOf = (service: DpdService) =>
    (locales && service.name[locales.defaultLocale]) ||
    Object.values(service.name).find((n) => n) ||
    '';

  const content = () => {
    if (loadError) {
      return <Typography textColor="danger600">{t('ecommerce.settings.loadError')}</Typography>;
    }
    if (!services) {
      return (
        <Flex justifyContent="center" padding={6}>
          <Loader small />
        </Flex>
      );
    }
    return (
      <Table colCount={6} rowCount={DPD_SERVICE_IDS.length + 1}>
        <Thead>
          <Tr>
            {(['service', 'name', 'markets', 'tax', 'active'] as const).map((column) => (
              <Th key={column}>
                <Typography variant="sigma">
                  {t(`ecommerce.settings.dpdServices.table.${column}`)}
                </Typography>
              </Th>
            ))}
            <Th>
              <VisuallyHidden>{t('ecommerce.settings.dpdServices.table.actions')}</VisuallyHidden>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {DPD_SERVICE_IDS.map((id) => {
            const service = services[id];
            const served = markets.filter((code) => service.rates[code]);
            return (
              <Tr key={id}>
                <Td>
                  <Typography textColor="neutral800" fontWeight="bold">
                    {serviceLabel(id)}
                  </Typography>
                </Td>
                <Td>
                  <Typography textColor="neutral800">{nameOf(service)}</Typography>
                </Td>
                <Td>
                  <Typography textColor={served.length ? 'neutral800' : 'neutral500'}>
                    {served.length
                      ? served.map(marketName).join(', ')
                      : t('ecommerce.settings.dpdServices.noMarkets')}
                  </Typography>
                </Td>
                <Td>
                  <Typography textColor="neutral800">{`${service.tax}%`}</Typography>
                </Td>
                <Td>
                  {service.active ? (
                    <Badge backgroundColor="success100" textColor="success700">
                      {t('ecommerce.settings.integrations.active')}
                    </Badge>
                  ) : (
                    <Badge>{t('ecommerce.settings.integrations.inactive')}</Badge>
                  )}
                </Td>
                <Td>
                  {!readOnly && (
                    <Flex gap={1} justifyContent="flex-end">
                      <Button
                        size="S"
                        variant={service.active ? 'danger-light' : 'success-light'}
                        loading={toggling === id}
                        disabled={toggling !== null && toggling !== id}
                        onClick={() =>
                          service.active ? setConfirmDisable(id) : setServiceActive(id, true)
                        }
                      >
                        {t(
                          service.active
                            ? 'ecommerce.settings.dpdServices.disable'
                            : 'ecommerce.settings.dpdServices.enable'
                        )}
                      </Button>
                      {canEdit && (
                        <IconButton
                          label={`${t('ecommerce.settings.dpdServices.edit')}: ${serviceLabel(id)}`}
                          variant="ghost"
                          onClick={() => setEditing(id)}
                        >
                          <Pencil />
                        </IconButton>
                      )}
                    </Flex>
                  )}
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>
    );
  };

  /** Turning off the last active service of an active integration deactivates it. */
  const disablesIntegration =
    !!confirmDisable &&
    !!services &&
    integrationActive &&
    activeServiceCount(withServiceActive(services, confirmDisable, false)) === 0;

  return (
    <Box>
      <Flex direction="column" alignItems="stretch" gap={3}>
        <Flex direction="column" alignItems="flex-start" gap={1}>
          <Typography variant="sigma" textColor="neutral600" tag="h3">
            {t('ecommerce.settings.dpdServices.title')}
          </Typography>
          <Typography variant="pi" textColor="neutral600">
            {t('ecommerce.settings.dpdServices.hint')}
          </Typography>
        </Flex>
        {content()}
      </Flex>

      {editing && services && locales && canEdit && (
        <DpdServiceModal
          id={editing}
          service={services[editing]}
          locales={locales.locales}
          defaultLocale={locales.defaultLocale}
          markets={markets}
          onClose={() => setEditing(null)}
          onSave={(service) => saveService(editing, service)}
        />
      )}

      <ActionConfirmModal
        open={!!confirmDisable}
        title={t('ecommerce.settings.dpdServices.disableConfirm.title')}
        text={
          confirmDisable
            ? t(
                disablesIntegration
                  ? 'ecommerce.settings.dpdServices.deactivateConfirm.text'
                  : 'ecommerce.settings.dpdServices.disableConfirm.text',
                { service: serviceLabel(confirmDisable) }
              )
            : ''
        }
        confirmLabel={t('ecommerce.settings.dpdServices.disable')}
        cancelLabel={t('ecommerce.settings.cancel')}
        confirmVariant="danger"
        onCancel={() => setConfirmDisable(null)}
        onConfirm={() => {
          const id = confirmDisable;
          setConfirmDisable(null);
          if (id) setServiceActive(id, false);
        }}
      />
    </Box>
  );
};

export { DpdServicesSection };
