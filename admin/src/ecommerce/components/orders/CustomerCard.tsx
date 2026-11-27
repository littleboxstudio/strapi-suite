import { Link as RouterLink } from 'react-router-dom';
import { useIntl } from 'react-intl';
import { Flex, Link, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { ToneBadge } from './StatusBadges';
import config from '../../../core/config';
import type { OrderCustomer } from '../../orderTypes';

/**
 * The customer recorded on the order (snapshot), in the page header: the name, which opens the
 * customer record when there is one, with the account type badge on its right, and the e-mail below it.
 */
const CustomerCard = ({ customer }: { customer: OrderCustomer }) => {
  const { formatMessage } = useIntl();
  const registered = customer.accountType === 'REGISTERED';
  const name =
    [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.email || '—';

  return (
    <Flex direction="column" alignItems="flex-end" gap={1}>
      <Flex gap={2} alignItems="center">
        {customer.id ? (
          <Link
            tag={RouterLink}
            to={`/plugins/${config.pluginId}/ecommerce/customers/${customer.id}`}
          >
            <Typography variant="omega" textColor="neutral800">
              {name}
            </Typography>
          </Link>
        ) : (
          <Typography variant="omega" textColor="neutral800">
            {name}
          </Typography>
        )}
        {customer.accountType && (
          <ToneBadge variant={registered ? 'primary' : 'neutral'}>
            {formatMessage({
              id: getTranslation(
                `ecommerce.customers.badges.${registered ? 'registered' : 'guest'}`
              ),
            })}
          </ToneBadge>
        )}
      </Flex>
      {customer.email && (
        <Typography variant="pi" textColor="neutral600">
          {customer.email}
        </Typography>
      )}
    </Flex>
  );
};

export default CustomerCard;
