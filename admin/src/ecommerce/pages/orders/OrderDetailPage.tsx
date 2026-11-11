import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate, useParams } from 'react-router-dom';
import { Flex, IconButton, Typography } from '@strapi/design-system';
import { ArrowLeft } from '@strapi/icons';
import config from '../../../core/config';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchOrder from '../../usecases/orders/fetchOrder';

/** Placeholder until the full order detail page lands. */
const OrderDetailPage = () => {
  const { formatMessage } = useIntl();
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const orderId = Number(params.id);
  const basePath = `/plugins/${config.pluginId}/ecommerce/orders`;
  const t = (id: string) => formatMessage({ id: getTranslation(id) });
  const [reference, setReference] = useState<number | null>(null);

  useEffect(() => {
    if (!Number.isInteger(orderId) || orderId < 1) return undefined;
    let cancelled = false;
    new FetchOrder()
      .execute(orderId)
      .then((order) => {
        if (!cancelled) setReference(order.reference);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Flex gap={3} alignItems="center">
        <IconButton label={t('ecommerce.orders.back')} onClick={() => navigate(basePath)}>
          <ArrowLeft />
        </IconButton>
        <Typography variant="beta" tag="h1">
          {t('ecommerce.orders.detail.title')} #{reference ?? ''}
        </Typography>
      </Flex>
      <Typography textColor="neutral600">{t('ecommerce.orders.detail.comingNext')}</Typography>
    </Flex>
  );
};

export { OrderDetailPage };
