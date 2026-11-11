import { useIntl } from 'react-intl';
import { Box, Divider, Flex, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { formatCents } from '../../utils/money';
import { sumPreviewTotals, type OrderLineDraft } from '../../utils/orderForm';

type Props = { lines: OrderLineDraft[]; shippingPrice: number | null };

/** Local preview only; the server computes the order's amounts when it is created. */
const TotalsPreview = ({ lines, shippingPrice }: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });
  const totals = sumPreviewTotals(lines, shippingPrice);

  const row = (label: string, value: string, strong = false) => (
    <Flex justifyContent="space-between" gap={4}>
      <Typography
        textColor={strong ? 'neutral800' : 'neutral600'}
        fontWeight={strong ? 'bold' : undefined}
      >
        {label}
      </Typography>
      <Typography textColor="neutral800" fontWeight={strong ? 'bold' : undefined}>
        {value}
      </Typography>
    </Flex>
  );

  return (
    <Flex direction="column" alignItems="stretch" gap={3}>
      {row(t('ecommerce.orders.totals.subtotal'), formatCents(totals.subtotal, uiLocale))}
      {row(
        t('ecommerce.orders.totals.shipping'),
        shippingPrice === null ? '—' : formatCents(totals.shipping, uiLocale)
      )}
      <Divider />
      {row(t('ecommerce.orders.totals.total'), formatCents(totals.total, uiLocale), true)}
      <Box>
        <Typography variant="pi" textColor="neutral500">
          {t('ecommerce.orders.totals.hint')}
        </Typography>
      </Box>
    </Flex>
  );
};

export default TotalsPreview;
