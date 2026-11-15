import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import {
  Badge,
  Box,
  Button,
  Flex,
  Loader,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Cog } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchStorePickup from '../../usecases/settings/fetchStorePickup';
import SaveStorePickup from '../../usecases/settings/saveStorePickup';
import FetchSettingsLocales from '../../usecases/settings/fetchSettingsLocales';
import { NOTICE_BACKGROUND, NOTICE_TEXT } from '../orders/NoticeBar';
import { StorePickupModal } from './StorePickupModal';
import { extractFieldErrors } from '../../utils/productForm';
import { marketOptions } from '../../utils/settingsForm';
import {
  storePickupErrorMap,
  storePickupSummary,
  type StorePickupErrors,
} from '../../utils/storePickupForm';
import type { EcommerceLocales } from '../../types';
import type { StorePickupConfig, StorePickupInput } from '../../settingsTypes';

type Props = {
  readOnly: boolean;
  /** The store markets. */
  markets: string[];
  /** Whether the Store pickup integration is active (the server turns it off with no served market). */
  integrationActive: boolean;
  onIntegrationActiveChange: (active: boolean) => void;
  /** The Enable/Disable button of the card, shown next to Configure. */
  toggle?: ReactNode;
};

/**
 * The Store pickup module inside its card: Enable/Disable and Configure, and the markets with a
 * rate table with their number of stores (a market without a store is not offered).
 */
const StorePickupSection = ({
  readOnly,
  markets,
  integrationActive,
  onIntegrationActiveChange,
  toggle,
}: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const [config, setConfig] = useState<StorePickupConfig | null>(null);
  const [locales, setLocales] = useState<EcommerceLocales | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState(false);

  const islandsName = t('ecommerce.settings.markets.names.PT-ISL');
  const countries = useMemo(() => marketOptions(uiLocale, islandsName), [uiLocale, islandsName]);
  const countryName = (code: string) => countries.find((c) => c.code === code)?.name ?? code;

  useEffect(() => {
    let cancelled = false;
    // Needs the products read permission; without it the configuration stays read-only.
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
    new FetchStorePickup()
      .execute()
      .then((stored) => {
        if (!cancelled) setConfig(stored);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [markets]);

  /** Resolves to null when saved, or to the errors (keyed like the draft) after telling the user. */
  const save = async (input: StorePickupInput): Promise<StorePickupErrors | null> => {
    try {
      const result = await new SaveStorePickup().execute(input);
      setConfig(result.config);
      setEditing(false);
      if (result.active !== integrationActive) onIntegrationActiveChange(result.active);
      toggleNotification(
        integrationActive && !result.active
          ? { type: 'warning', message: t('ecommerce.settings.storePickup.deactivated') }
          : { type: 'success', message: t('ecommerce.settings.saved') }
      );
      return null;
    } catch (err) {
      const fieldErrors = extractFieldErrors(err);
      if (!fieldErrors) {
        toggleNotification({ type: 'danger', message: t('ecommerce.settings.saveError') });
        return {};
      }
      toggleNotification({ type: 'warning', message: t('ecommerce.settings.errors.fix') });
      return storePickupErrorMap(fieldErrors);
    }
  };

  const canEdit = !readOnly && locales !== null && config !== null;

  const summary = () => {
    if (loadError) {
      return <Typography textColor="danger600">{t('ecommerce.settings.loadError')}</Typography>;
    }
    if (!config) {
      return (
        <Flex justifyContent="center" padding={6}>
          <Loader small />
        </Flex>
      );
    }
    const rows = storePickupSummary(config, markets);
    if (rows.length === 0) return null;
    return (
      <Table colCount={3} rowCount={rows.length + 1}>
        <Thead>
          <Tr>
            {(['market', 'stores', 'status'] as const).map((column) => (
              <Th key={column}>
                <Typography variant="sigma">
                  {t(`ecommerce.settings.storePickup.table.${column}`)}
                </Typography>
              </Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {rows.map(({ market, stores }) => (
            <Tr key={market}>
              <Td>
                <Typography textColor="neutral800" fontWeight="bold">
                  {countryName(market)}
                </Typography>
              </Td>
              <Td>
                <Typography textColor="neutral800">{stores}</Typography>
              </Td>
              <Td>
                {stores > 0 ? (
                  <Badge backgroundColor="success100" textColor="success700">
                    {t('ecommerce.settings.storePickup.offered')}
                  </Badge>
                ) : (
                  <Box
                    tag="span"
                    hasRadius
                    paddingLeft={2}
                    paddingRight={2}
                    paddingTop={1}
                    paddingBottom={1}
                    style={{ background: NOTICE_BACKGROUND, display: 'inline-block' }}
                  >
                    <Typography variant="pi" fontWeight="bold" style={{ color: NOTICE_TEXT }}>
                      {t('ecommerce.settings.storePickup.noStores')}
                    </Typography>
                  </Box>
                )}
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    );
  };

  return (
    <Box>
      <Flex direction="column" alignItems="stretch" gap={4}>
        {(toggle || !readOnly) && (
          <Flex gap={2} alignItems="center" wrap="wrap">
            {toggle}
            {!readOnly && (
              <Button
                variant="secondary"
                startIcon={<Cog />}
                disabled={!canEdit}
                onClick={() => setEditing(true)}
              >
                {t('ecommerce.settings.storePickup.configure')}
              </Button>
            )}
          </Flex>
        )}
        {summary()}
      </Flex>

      {editing && config && locales && canEdit && (
        <StorePickupModal
          config={config}
          locales={locales.locales}
          defaultLocale={locales.defaultLocale}
          markets={markets}
          onClose={() => setEditing(false)}
          onSave={save}
        />
      )}
    </Box>
  );
};

export { StorePickupSection };
