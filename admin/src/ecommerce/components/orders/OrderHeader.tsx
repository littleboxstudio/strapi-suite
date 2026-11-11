import type { ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { Button, Flex, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import {
  allowedToolbarActions,
  modifyBlockedByShipment,
  type OrderActionPermissions,
  type ToolbarAction,
} from '../../utils/orderDetail';
import type { Order } from '../../orderTypes';
import { FulfillmentStatusBadge, OrderStatusBadge, PaymentStatusBadge } from './StatusBadges';

type Props = {
  order: Order;
  /** Back button, rendered before the title. */
  back: ReactNode;
  /** Each action is hidden without its permission (orders, payments or refunds manage). */
  permissions: OrderActionPermissions;
  busy?: boolean;
  onAction: (action: ToolbarAction) => void;
};

const VARIANTS: Record<ToolbarAction, 'default' | 'secondary' | 'danger-light' | 'tertiary'> = {
  SHIP: 'default',
  MODIFY: 'secondary',
  ADD_PAYMENT: 'default',
  SEND_PAYMENT_INSTRUCTIONS: 'secondary',
  REFUND: 'secondary',
  REGISTER_RETURN: 'secondary',
  CANCEL: 'danger-light',
  ARCHIVE: 'tertiary',
};

/** Reference, the three independent statuses, creation date and the available actions. */
const OrderHeader = ({ order, back, permissions, busy, onAction }: Props) => {
  const { formatMessage, formatDate } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const actions = allowedToolbarActions(order.availableActions, permissions);
  // MODIFY is left out while a carrier shipment is pending: say why to whoever could modify.
  const modifyBlocked = permissions.canManage && modifyBlockedByShipment(order);

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
      {(actions.length > 0 || modifyBlocked) && (
        <Flex direction="column" alignItems="flex-end" gap={2}>
          {actions.length > 0 && (
            <Flex gap={2} wrap="wrap" justifyContent="flex-end">
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
          {modifyBlocked && (
            <Typography variant="pi" textColor="warning600" style={{ maxWidth: 420, textAlign: 'right' }}>
              {t('ecommerce.orders.errors.SHIPMENT_PENDING')}
            </Typography>
          )}
        </Flex>
      )}
    </Flex>
  );
};

export default OrderHeader;
