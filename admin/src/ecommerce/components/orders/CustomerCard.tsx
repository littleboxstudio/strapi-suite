import { useIntl } from 'react-intl';
import { Link as RouterLink } from 'react-router-dom';
import { Flex, Link, Typography } from '@strapi/design-system';
import config from '../../../core/config';
import { getTranslation } from '../../../core/utils/getTranslation';
import type { OrderCustomer } from '../../orderTypes';
import OrderSection from './OrderSection';

/** The customer data recorded on the order (snapshot), with a link to the customer record. */
const CustomerCard = ({ customer }: { customer: OrderCustomer }) => {
  const { formatMessage } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });
  const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ');

  return (
    <OrderSection
      title={t('ecommerce.orders.detail.customer.title')}
      actions={
        customer.id ? (
          <Link tag={RouterLink} to={`/plugins/${config.pluginId}/ecommerce/customers/${customer.id}`}>
            {t('ecommerce.orders.detail.customer.open')}
          </Link>
        ) : undefined
      }
    >
      <Flex direction="column" alignItems="flex-start" gap={1}>
        <Typography textColor="neutral800" fontWeight="semiBold">
          {name || '—'}
        </Typography>
        {customer.email && <Typography textColor="neutral700">{customer.email}</Typography>}
        {customer.phone && <Typography textColor="neutral700">{customer.phone}</Typography>}
      </Flex>
    </OrderSection>
  );
};

export default CustomerCard;
