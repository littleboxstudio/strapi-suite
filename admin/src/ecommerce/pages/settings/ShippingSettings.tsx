import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { Flex, Loader, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchStoreSettings from '../../usecases/settings/fetchStoreSettings';
import FetchShippingZones from '../../usecases/settings/fetchShippingZones';
import { ShippingZonesSection } from '../../components/settings/ShippingZonesSection';
import { IntegrationsSection } from './IntegrationsSection';
import type { ShippingZone } from '../../settingsTypes';

/** Shipping tab: the zones, then the carriers (the manual one holds its methods table). */
const ShippingSettings = ({ readOnly }: { readOnly: boolean }) => {
  const { formatMessage } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });

  const [markets, setMarkets] = useState<string[]>([]);
  const [zones, setZones] = useState<ShippingZone[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([new FetchStoreSettings().execute(), new FetchShippingZones().execute()])
      .then(([store, list]) => {
        if (cancelled) return;
        setMarkets(store.markets ?? []);
        setZones(list);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    return <Typography textColor="danger600">{t('ecommerce.settings.loadError')}</Typography>;
  }
  if (!zones) {
    return (
      <Flex justifyContent="center" padding={8}>
        <Loader />
      </Flex>
    );
  }

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <ShippingZonesSection zones={zones} markets={markets} readOnly={readOnly} onChange={setZones} />
      <IntegrationsSection category="carrier" readOnly={readOnly} zones={zones} />
    </Flex>
  );
};

export { ShippingSettings };
