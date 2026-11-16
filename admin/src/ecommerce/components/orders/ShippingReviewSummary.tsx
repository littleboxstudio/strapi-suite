import { useIntl } from 'react-intl';
import { Box, Flex, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { formatCents } from '../../utils/money';
import { reviewDifference } from '../../utils/orderEditing';
import type { ShippingReview } from '../../orderTypes';
import { NOTICE_BACKGROUND, NOTICE_TEXT } from './NoticeBar';
import { Tile, Tiles } from './SummaryTiles';

type Props = {
  review: ShippingReview;
  /** A quote other than the review's (a new charge: every charge plus the price typed). */
  quote?: number;
};

/**
 * Recalculate shipping's summary: what is charged and invoiced, the quote, and whether the
 * customer still has shipping to pay or is owed a refund (against what was paid). Informative.
 */
const ShippingReviewSummary = ({ review, quote }: Props) => {
  const { formatMessage, locale } = useIntl();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const money = (cents: number) => formatCents(cents, locale);
  const shown = quote ?? review.quote;
  const difference = reviewDifference(review, shown);

  const tile = (key: 'charged' | 'invoiced' | 'quote', value: number, warn = false) => (
    <Tile $tone={warn ? 'warning' : undefined}>
      <Typography variant="sigma" textColor="neutral600">
        {t(`ecommerce.orders.shippingCharges.${key}`)}
      </Typography>
      <Typography variant="beta" tag="p" textColor="neutral800" style={{ whiteSpace: 'nowrap' }}>
        {money(value)}
      </Typography>
    </Tile>
  );

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Tiles style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        {tile('charged', review.charged)}
        {tile('invoiced', review.invoiced)}
        {tile('quote', shown, difference !== 0)}
      </Tiles>
      {difference === 0 ? (
        <Typography variant="omega" textColor="neutral700">
          {t('ecommerce.orders.shippingCharges.unchanged')}
        </Typography>
      ) : (
        <Box padding={3} hasRadius style={{ background: NOTICE_BACKGROUND }}>
          <Typography variant="omega" style={{ color: NOTICE_TEXT }}>
            {t(
              difference > 0 ? 'ecommerce.orders.shippingCharges.review.under' : 'ecommerce.orders.shippingCharges.review.over',
              { amount: money(Math.abs(difference)) }
            )}
          </Typography>
        </Box>
      )}
    </Flex>
  );
};

export default ShippingReviewSummary;
