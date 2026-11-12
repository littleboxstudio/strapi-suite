import { useIntl } from 'react-intl';
import styled, { useTheme } from 'styled-components';
import { getTranslation } from '../../../core/utils/getTranslation';
import {
  BADGE_COLORS,
  fulfillmentStatusBadge,
  isDarkColor,
  orderStatusBadge,
  paymentStatusBadge,
  type BadgeColors,
  type StatusBadge,
} from '../../utils/statusBadges';
import type { FulfillmentStatus, OrderStatus, PaymentStatus } from '../../orderTypes';

/** Same shape as the design system's small Badge, with readable colours. */
const Pill = styled.span<{ $colors: BadgeColors }>`
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border: 1px solid ${({ $colors }) => $colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ $colors }) => $colors.background};
  color: ${({ $colors }) => $colors.text};
  font-size: 1.1rem;
  font-weight: 600;
  line-height: 1.6rem;
  text-transform: uppercase;
  white-space: nowrap;
`;

const TranslatedBadge = ({ badge, status }: { badge: StatusBadge; status: string }) => {
  const { formatMessage } = useIntl();
  const theme = useTheme();
  const palette = BADGE_COLORS[isDarkColor(theme?.colors?.neutral0) ? 'dark' : 'light'];
  return (
    <Pill $colors={palette[badge.variant]}>
      {badge.labelKey ? formatMessage({ id: getTranslation(badge.labelKey) }) : status}
    </Pill>
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
