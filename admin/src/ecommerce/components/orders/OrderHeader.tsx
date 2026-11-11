import type { ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { Button, Flex, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { toolbarActions, type ToolbarAction } from '../../utils/orderDetail';
import type { Order } from '../../orderTypes';
import { FulfillmentStatusBadge, OrderStatusBadge, PaymentStatusBadge } from './StatusBadges';

type Props = {
  order: Order;
  /** Back button, rendered before the title. */
  back: ReactNode;
  /** Without `orders.manage` the action toolbar is hidden. */
  canManage: boolean;
  busy?: boolean;
  onAction: (action: ToolbarAction) => void;
};

const VARIANTS: Record<ToolbarAction, 'default' | 'secondary' | 'danger-light' | 'tertiary'> = {
  MODIFY: 'secondary',
  ADD_PAYMENT: 'default',
  CANCEL: 'danger-light',
  ARCHIVE: 'tertiary',
};

/** Reference, the three independent statuses, creation date and the available actions. */
const OrderHeader = ({ order, back, canManage, busy, onAction }: Props) => {
  const { formatMessage, formatDate } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const actions = canManage ? toolbarActions(order.availableActions) : [];

  return (
    <Flex justifyContent="space-between" alignItems="flex-start" gap={4} wrap="wrap">
      <Flex gap={3} alignItems="flex-start">
        {back}
        <Flex direction="column" alignItems="flex-start" gap={2}>
          <Typography variant="beta" tag="h1">
            {t('ecommerce.orders.detail.title')} #{order.reference}
          </Typography>
          <Flex gap={2} wrap="wrap">
            <OrderStatusBadge status={order.orderStatus} />
            <PaymentStatusBadge status={order.paymentStatus} />
            <FulfillmentStatusBadge status={order.fulfillmentStatus} />
          </Flex>
          <Typography variant="pi" textColor="neutral600">
            {t('ecommerce.orders.detail.createdAt', {
              date: formatDate(order.createdAt, { dateStyle: 'medium', timeStyle: 'short' }),
            })}
          </Typography>
        </Flex>
      </Flex>
      {actions.length > 0 && (
        <Flex gap={2} wrap="wrap">
          {actions.map((action) => (
            <Button
              key={action}
              variant={VARIANTS[action]}
              disabled={busy}
              onClick={() => onAction(action)}
            >
              {t(`ecommerce.orders.detail.actions.${action}`)}
            </Button>
          ))}
        </Flex>
      )}
    </Flex>
  );
};

export default OrderHeader;
