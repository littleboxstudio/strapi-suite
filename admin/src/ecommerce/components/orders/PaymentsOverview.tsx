import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { Flex, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { formatCents } from '../../utils/money';
import { paymentsOverview, type OverviewTile } from '../../utils/orderDetail';
import type { FinancialSummary, OrderTotals } from '../../orderTypes';

const Tiles = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;

  @media (max-width: 1100px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;

/** One figure: label, the amount large, and its small print. Paid carries a colour (owed or settled). */
const Tile = styled.div<{ $tone?: OverviewTile['tone'] }>`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-left: 4px solid
    ${({ theme, $tone }) =>
      $tone === 'warning'
        ? theme.colors.warning500
        : $tone === 'success'
          ? theme.colors.success500
          : theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.neutral100};
`;

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
