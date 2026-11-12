import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { Flex, Loader, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchStoreSettings from '../../usecases/settings/fetchStoreSettings';
import { IntegrationsSection } from './IntegrationsSection';

/** Shipping tab: the carriers (the manual one holds its methods table). */
const ShippingSettings = ({ readOnly }: { readOnly: boolean }) => {
  const { formatMessage } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });

  const [markets, setMarkets] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    new FetchStoreSettings()
      .execute()
      .then((store) => {
        if (cancelled) return;
        setMarkets(store.markets ?? []);
        setLoaded(true);
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
  if (!loaded) {
    return (
      <Flex justifyContent="center" padding={8}>
        <Loader />
      </Flex>
    );
  }

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <IntegrationsSection category="carrier" readOnly={readOnly} markets={markets} />
    </Flex>
  );
};

export { ShippingSettings };
