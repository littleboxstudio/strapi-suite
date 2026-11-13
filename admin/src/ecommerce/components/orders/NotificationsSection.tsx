import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import {
  Badge,
  Box,
  Button,
  Flex,
  Loader,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { ArrowClockwise } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchOrderNotifications from '../../usecases/orders/fetchOrderNotifications';
import ResendNotification from '../../usecases/orders/resendNotification';
import { apiErrorMessageId, notificationErrorParts } from '../../utils/orderDetail';
import type { NotificationView } from '../../orderTypes';
import OrderSection from './OrderSection';

type Props = {
  orderId: number;
  /** Changes whenever the order was reloaded: the list is fetched again. */
  refreshKey: number;
  /** `orders.manage`: resend. */
  canResend: boolean;
};

const COLUMNS = ['type', 'recipient', 'status', 'date', 'actions'] as const;

const STATUS_VARIANT: Record<string, 'success' | 'danger' | 'neutral'> = {
  SENT: 'success',
  FAILED: 'danger',
  SKIPPED: 'neutral',
};

/** E-mails of the order: type, recipient, status, date, and "Resend" for FAILED / SKIPPED ones. */
const NotificationsSection = ({ orderId, refreshKey, canResend }: Props) => {
  const { formatMessage, formatDate } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>, defaultMessage?: string) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);

  const [items, setItems] = useState<NotificationView[] | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState<number | null>(null);
  const request = useRef(0);

  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    try {
      const list = await new FetchOrderNotifications().execute(orderId);
      if (current !== request.current) return;
      setItems(list);
      setError(false);
    } catch {
      if (current === request.current) setError(true);
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const errorLabel = (code: string | null) =>
    t(`ecommerce.orders.notifications.errors.${code}`, undefined, t('ecommerce.orders.notifications.errors.unknown'));

  const resend = async (n: NotificationView) => {
    if (resending !== null) return;
    setResending(n.id);
    try {
      const result = await new ResendNotification().execute(n.id);
      if (result.status === 'SENT') {
        toggleNotification({ type: 'success', message: t('ecommerce.orders.notifications.resent') });
      } else if (result.status === 'SKIPPED') {
        toggleNotification({
          type: 'warning',
          message: t('ecommerce.orders.notifications.resendSkipped', { reason: errorLabel(result.error) }),
        });
      } else {
        toggleNotification({ type: 'danger', message: t('ecommerce.orders.notifications.resendFailed') });
      }
    } catch (err) {
      // EMAIL_NOT_CONFIGURED points to Settings → Email service.
      toggleNotification({
        type: 'danger',
        message: t(apiErrorMessageId(err, 'ecommerce.orders.notifications.resendError')),
      });
    } finally {
      setResending(null);
      load();
    }
  };

  const refresh = (
    <Button
      size="S"
      variant="tertiary"
      startIcon={<ArrowClockwise />}
      onClick={() => load()}
      loading={loading && !!items}
    >
      {t('ecommerce.orders.notifications.refresh')}
    </Button>
  );

  const content = () => {
    if (error && !items) {
      return <Typography textColor="danger600">{t('ecommerce.orders.notifications.loadError')}</Typography>;
    }
    if (!items) {
      return (
        <Flex justifyContent="center" padding={4}>
          <Loader small />
        </Flex>
      );
    }
    if (!items.length) {
      return (
        <Box padding={4} background="neutral100" hasRadius>
          <Typography variant="omega" textColor="neutral600">
            {t('ecommerce.orders.notifications.empty')}
          </Typography>
        </Box>
      );
    }
    return (
      <Table colCount={COLUMNS.length} rowCount={items.length + 1}>
        <Thead>
          <Tr>
            {COLUMNS.map((column) => (
              <Th key={column}>
                <Typography variant="sigma">{t(`ecommerce.orders.notifications.columns.${column}`)}</Typography>
              </Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {items.map((n) => {
            const when = n.sentAt ?? n.createdAt;
            const canRetry = canResend && (n.status === 'FAILED' || n.status === 'SKIPPED');
            return (
              <Tr key={n.id}>
                <Td>
                  <Typography textColor="neutral800">
                    {t(`ecommerce.settings.emailTemplates.types.${n.type}.name`, undefined, n.type)}
                  </Typography>
                </Td>
                <Td style={{ maxWidth: 220 }}>
                  <Typography textColor="neutral800" ellipsis>
                    {n.recipient || '—'}
                  </Typography>
                </Td>
                <Td>
                  <Flex direction="column" alignItems="flex-start" gap={1}>
                    <Badge variant={STATUS_VARIANT[n.status ?? ''] ?? 'neutral'} size="S">
                      {n.status ? t(`ecommerce.orders.notifications.statuses.${n.status}`, undefined, n.status) : '—'}
                    </Badge>
                    {n.status !== 'SENT' &&
                      (() => {
                        const parts = notificationErrorParts(n.error);
                        if (!parts) return null;
                        return (
                          <>
                            <Typography variant="pi" textColor="neutral600">
                              {errorLabel(parts.code)}
                            </Typography>
                            {parts.detail && (
                              <Typography variant="pi" textColor="neutral500" style={{ wordBreak: 'break-word' }}>
                                {parts.detail}
                              </Typography>
                            )}
                          </>
                        );
                      })()}
                  </Flex>
                </Td>
                <Td>
                  <Typography textColor="neutral800">
                    {when ? formatDate(when, { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                  </Typography>
                </Td>
                <Td>
                  {canRetry && (
                    <Flex justifyContent="flex-end">
                      <Button
                        size="S"
                        variant="secondary"
                        loading={resending === n.id}
                        disabled={resending !== null && resending !== n.id}
                        onClick={() => resend(n)}
                      >
                        {t('ecommerce.orders.notifications.resend')}
                      </Button>
                    </Flex>
                  )}
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>
    );
  };

  return (
    <OrderSection title={t('ecommerce.orders.notifications.title')} actions={refresh}>
      {content()}
    </OrderSection>
  );
};

export default NotificationsSection;
