import { useIntl } from 'react-intl';
import {
  Badge,
  Box,
  Flex,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { formatCents } from '../../utils/money';
import { formatShippedProgress, pendingLabel } from '../../utils/orderDetail';
import type { OrderLine } from '../../orderTypes';

const THUMBNAIL_SIZE = 40;
const COLUMNS = ['product', 'sku', 'unitPrice', 'quantity', 'shipped', 'total'] as const;

/**
 * The order's lines with the prices recorded on the order (requirements 4.1–4.3): "shipped /
 * ordered", units left to ship, units being shipped (PENDING at the carrier) and returned.
 */
const OrderLinesTable = ({ lines }: { lines: OrderLine[] }) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const money = (cents: number) => formatCents(cents, uiLocale);

  if (!lines.length) {
    return (
      <Box padding={4} background="neutral100" hasRadius>
        <Typography variant="omega" textColor="neutral600">
          {t('ecommerce.orders.detail.lines.empty')}
        </Typography>
      </Box>
    );
  }

  return (
    <Table colCount={COLUMNS.length + 1} rowCount={lines.length + 1}>
      <Thead>
        <Tr>
          <Th>
            <VisuallyHidden>{t('ecommerce.orders.detail.lines.photo')}</VisuallyHidden>
          </Th>
          {COLUMNS.map((column) => (
            <Th key={column}>
              <Typography variant="sigma">{t(`ecommerce.orders.detail.lines.${column}`)}</Typography>
            </Th>
          ))}
        </Tr>
      </Thead>
      <Tbody>
        {lines.map((line) => {
          const finalPrice = line.unitPrice - line.unitDiscount;
          const pending = pendingLabel(line.pending);
          return (
            <Tr key={line.id}>
              <Td>
                {line.imageUrl ? (
                  <img
                    src={line.imageUrl}
                    alt=""
                    width={THUMBNAIL_SIZE}
                    height={THUMBNAIL_SIZE}
                    style={{ objectFit: 'cover', borderRadius: '4px', display: 'block' }}
                  />
                ) : (
                  <Box
                    background="neutral150"
                    hasRadius
                    style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE }}
                  />
                )}
              </Td>
              <Td style={{ maxWidth: 320 }}>
                <Flex direction="column" alignItems="flex-start" gap={1}>
                  <Typography textColor="neutral800" fontWeight="semiBold" ellipsis>
                    {line.name}
                  </Typography>
                  {line.option && (
                    <Typography variant="pi" textColor="neutral600" ellipsis>
                      {line.option}
                    </Typography>
                  )}
                  {line.isGift && (
                    <Badge variant="success" size="S">
                      {t('ecommerce.orders.detail.lines.gift')}
                    </Badge>
                  )}
                </Flex>
              </Td>
              <Td>
                <Typography textColor="neutral800">{line.sku}</Typography>
              </Td>
              <Td>
                <Flex direction="column" alignItems="flex-start">
                  {line.unitDiscount > 0 && (
                    <Typography
                      variant="pi"
                      textColor="neutral500"
                      style={{ textDecoration: 'line-through' }}
                      aria-label={`${t('ecommerce.orders.detail.lines.originalPrice')}: ${money(line.unitPrice)}`}
                    >
                      {money(line.unitPrice)}
                    </Typography>
                  )}
                  <Typography textColor="neutral800">{money(finalPrice)}</Typography>
                </Flex>
              </Td>
              <Td>
                <Typography textColor="neutral800">{line.quantity}</Typography>
              </Td>
              <Td>
                <Flex direction="column" alignItems="flex-start">
                  <Typography textColor="neutral800">
                    {formatShippedProgress(line.quantity, line.shipped)}
                  </Typography>
                  {pending && (
                    <Typography variant="pi" textColor="warning600">
                      {t(pending.id, pending.values)}
                    </Typography>
                  )}
                  {line.reserved > line.shipped && (
                    <Typography variant="pi" textColor="neutral600">
                      {t('ecommerce.orders.detail.lines.inProgress', { count: line.reserved - line.shipped })}
                    </Typography>
                  )}
                  {line.returnedQuantity > 0 && (
                    <Typography variant="pi" textColor="neutral600">
                      {t('ecommerce.orders.detail.lines.returned', { count: line.returnedQuantity })}
                    </Typography>
                  )}
                </Flex>
              </Td>
              <Td>
                <Typography textColor="neutral800" fontWeight="semiBold">
                  {money(finalPrice * line.quantity)}
                </Typography>
              </Td>
            </Tr>
          );
        })}
      </Tbody>
    </Table>
  );
};

export default OrderLinesTable;
