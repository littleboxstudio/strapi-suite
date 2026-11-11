import { useIntl } from 'react-intl';
import { Badge } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import {
  fulfillmentStatusBadge,
  orderStatusBadge,
  paymentStatusBadge,
  type StatusBadge,
} from '../../utils/statusBadges';
import type { FulfillmentStatus, OrderStatus, PaymentStatus } from '../../orderTypes';

const TranslatedBadge = ({ badge, status }: { badge: StatusBadge; status: string }) => {
  const { formatMessage } = useIntl();
  return (
    <Badge variant={badge.variant} size="S">
      {badge.labelKey ? formatMessage({ id: getTranslation(badge.labelKey) }) : status}
    </Badge>
  );
};

const OrderStatusBadge = ({ status }: { status: OrderStatus }) => (
  <TranslatedBadge badge={orderStatusBadge(status)} status={status} />
);

const PaymentStatusBadge = ({ status }: { status: PaymentStatus }) => (
  <TranslatedBadge badge={paymentStatusBadge(status)} status={status} />
);

const FulfillmentStatusBadge = ({ status }: { status: FulfillmentStatus }) => (
  <TranslatedBadge badge={fulfillmentStatusBadge(status)} status={status} />
);

export { OrderStatusBadge, PaymentStatusBadge, FulfillmentStatusBadge };
