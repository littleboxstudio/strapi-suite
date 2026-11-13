import { useIntl } from 'react-intl';
import { Box, Flex, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { formatCents } from '../../utils/money';
import { historyEntryText, sortHistoryNewestFirst } from '../../utils/orderDetail';
import type { OrderHistoryItem } from '../../orderTypes';
import EmptyNote from './EmptyNote';

/** The order's history, newest first (requirement 6.2). */
const HistoryTimeline = ({ history }: { history: OrderHistoryItem[] }) => {
  const { formatMessage, formatDate, locale: uiLocale } = useIntl();
  const t = (id: string, values?: Record<string, string | number>, defaultMessage?: string) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const money = (cents: number) => formatCents(cents, uiLocale);

  if (!history.length) {
    return <EmptyNote>{t('ecommerce.orders.detail.history.empty')}</EmptyNote>;
  }

  const entries = sortHistoryNewestFirst(history);

  return (
    <Flex direction="column" alignItems="stretch" gap={0} tag="ol" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {entries.map((entry, index) => {
        const text = historyEntryText(entry, t, money);
        const last = index === entries.length - 1;
        return (
          <Flex key={entry.id} tag="li" gap={3} alignItems="stretch">
            {/* rail: dot and connecting line */}
            <Flex direction="column" alignItems="center" style={{ width: 12, flexShrink: 0 }}>
              <Box
                background="primary600"
                style={{ width: 10, height: 10, borderRadius: '50%', marginTop: 5, flexShrink: 0 }}
              />
              {!last && <Box background="neutral200" style={{ width: 2, flexGrow: 1, marginTop: 4 }} />}
            </Flex>
            <Flex direction="column" alignItems="flex-start" gap={1} paddingBottom={last ? 0 : 5} style={{ minWidth: 0 }}>
              <Flex gap={2} wrap="wrap" alignItems="baseline">
                <Typography textColor="neutral800" fontWeight="semiBold">
                  {text.title}
                </Typography>
                <Typography variant="pi" textColor="neutral600">
                  {formatDate(entry.createdAt, { dateStyle: 'medium', timeStyle: 'medium' })} · {text.actor}
                </Typography>
              </Flex>
              <Typography textColor="neutral700">{text.detail ?? text.description}</Typography>
              {text.change && (
                <Typography variant="pi" textColor="neutral700">
                  {t('ecommerce.orders.detail.history.change', text.change)}
                </Typography>
              )}
              {entry.operationId && (
                <Typography variant="pi" textColor="neutral500">
                  {t('ecommerce.orders.detail.history.operation', { id: entry.operationId })}
                </Typography>
              )}
            </Flex>
          </Flex>
        );
      })}
    </Flex>
  );
};

export default HistoryTimeline;
