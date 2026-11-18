import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { Flex, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../../core/utils/getTranslation';
import { formatCents } from '../../../utils/money';
import type { CreateTotalsTile } from '../../../utils/orderForm';
import { Tile, Tiles } from '../SummaryTiles';

const LABEL: Record<CreateTotalsTile['key'], string> = {
  products: 'ecommerce.orders.new.products',
  shipping: 'ecommerce.orders.detail.summary.shipping',
  discounts: 'ecommerce.orders.detail.summary.discounts',
  total: 'ecommerce.orders.totals.total',
};

/** Stays at the top of the page while it scrolls; the page background hides what passes below. */
const Sticky = styled.div`
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 8px 0;
  background: ${({ theme }) => theme.colors.neutral100};
`;

type Props = {
  tiles: CreateTotalsTile[];
  /** Under the tiles: being calculated, the quote's error, or what is still missing. */
  note?: { text: string; color: string } | null;
};

/** Create order's totals: the order detail's summary tiles, with no container and no title. */
const TotalsBar = ({ tiles, note }: Props) => {
  const { formatMessage, locale } = useIntl();
  return (
    <Sticky>
      <Flex direction="column" alignItems="stretch" gap={2}>
        <Tiles $columns={tiles.length}>
          {tiles.map((tile) => (
            <Tile key={tile.key}>
              <Typography variant="sigma" textColor="neutral600">
                {formatMessage({ id: getTranslation(LABEL[tile.key]) })}
              </Typography>
              <Typography
                variant="beta"
                tag="p"
                textColor="neutral800"
                style={{ whiteSpace: 'nowrap' }}
              >
                {tile.amount === null ? '—' : formatCents(tile.amount, locale)}
              </Typography>
            </Tile>
          ))}
        </Tiles>
        {note && (
          <Typography variant="pi" textColor={note.color}>
            {note.text}
          </Typography>
        )}
      </Flex>
    </Sticky>
  );
};

export default TotalsBar;
