import { useIntl } from 'react-intl';
import { Flex, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { formatCents } from '../../utils/money';
import { paymentsOverview, type OverviewTile } from '../../utils/orderDetail';
import type { FinancialSummary, OrderTotals } from '../../orderTypes';
import { Tile, Tiles } from './SummaryTiles';

const NOTE_COLOR = { success: 'success600', warning: 'warning600', danger: 'danger600' } as const;

/** The order's money at a glance, above the payments table (replaces the separate summary card). */
const PaymentsOverview = ({ totals, summary }: { totals: OrderTotals; summary: FinancialSummary }) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });
  const money = (cents: number) => formatCents(cents, uiLocale);

  return (
    <Tiles>
      {paymentsOverview(totals, summary).map((tile) => (
        <Tile key={tile.key} $tone={tile.tone}>
          <Typography variant="sigma" textColor="neutral600">
            {t(`ecommerce.orders.detail.summary.${tile.key}`)}
          </Typography>
          <Typography
            variant="beta"
            tag="p"
            textColor="neutral800"
            style={{ whiteSpace: 'nowrap' }}
          >
            {money(tile.amount)}
          </Typography>
          {tile.notes.length > 0 && (
            <Flex direction="column" alignItems="flex-start" gap={1}>
              {tile.notes.map((note) => (
                <Typography key={note.key} variant="pi" textColor={note.tone ? NOTE_COLOR[note.tone] : 'neutral600'}>
                  {t(`ecommerce.orders.detail.summary.notes.${note.key}`)}
                  {note.amount !== undefined ? ` ${money(note.amount)}` : ''}
                </Typography>
              ))}
            </Flex>
          )}
        </Tile>
      ))}
    </Tiles>
  );
};

export default PaymentsOverview;
