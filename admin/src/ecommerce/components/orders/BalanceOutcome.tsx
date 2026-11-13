import { useIntl } from 'react-intl';
import { Button, Flex, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { formatCents } from '../../utils/money';
import { balanceActions } from '../../utils/orderEditing';
import type { OrderActionPermissions, ToolbarAction } from '../../utils/orderDetail';
import type { Order } from '../../orderTypes';

type Props = {
  order: Order;
  outcome: 'DUE' | 'REFUNDABLE';
  permissions: OrderActionPermissions;
  onAction: (action: ToolbarAction) => void;
};

/** Result step of an edit: what is now due or refundable, with the buttons to settle it. */
const BalanceOutcome = ({ order, outcome, permissions, onAction }: Props) => {
  const { formatMessage, locale } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const due = outcome === 'DUE';
  const amount = formatCents(due ? order.summary.due : order.summary.excess, locale);
  const actions = balanceActions(order, permissions);

  return (
    <Flex gap={3} alignItems="center" wrap="wrap">
      <Typography fontWeight="semiBold" textColor={due ? 'warning700' : 'success700'}>
        {t(due ? 'ecommerce.orders.balance.due' : 'ecommerce.orders.balance.refundable', { amount })}
      </Typography>
      {actions.map((action) => (
        <Button key={action} variant="secondary" size="S" onClick={() => onAction(action)}>
          {t(`ecommerce.orders.detail.actions.${action}`)}
        </Button>
      ))}
    </Flex>
  );
};

export default BalanceOutcome;
