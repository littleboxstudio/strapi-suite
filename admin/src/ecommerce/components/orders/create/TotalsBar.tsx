import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { Box, Flex, Typography } from '@strapi/design-system';
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

/**
 * Stays at the top of the page while it scrolls. The wrapper is painted with the page background
 * (the design system's `neutral100`, light and dark), so content scrolls under it cleanly.
 */
// The page's scroll container has a 32px top padding, and `top` counts from inside it: -32 makes
// the bar start at the very top of the scroll area, so nothing shows above it.
const STICKY = { position: 'sticky', top: -32, zIndex: 3 } as const;

type Props = {
  tiles: CreateTotalsTile[];
  /** Under the tiles: being calculated, the quote's error, or what is still missing. */
  note?: { text: string; color: string } | null;
};

/** Create order's totals: the order detail's summary tiles, with no container and no title. */
/** Height of the admin's top bar over the scroll area: the bar is stuck once it reaches it. */
const TOP_BAR = 60;

const TotalsBar = ({ tiles, note }: Props) => {
  const { formatMessage, locale } = useIntl();
  // A 1px marker just above the bar: once it scrolls out of sight the bar is stuck, and it
  // shrinks (smaller labels, amounts and spacing) to take as little room as possible.
  const marker = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = marker.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), {
      rootMargin: `-${TOP_BAR}px 0px 0px 0px`,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <div ref={marker} aria-hidden style={{ height: 1, marginBottom: -1 }} />
      <Box
        background="neutral100"
        paddingTop={stuck ? 2 : 3}
        paddingBottom={stuck ? 2 : 3}
        style={STICKY}
      >
        <Flex direction="column" alignItems="stretch" gap={stuck ? 1 : 2}>
          <Tiles $columns={tiles.length}>
            {tiles.map((tile) => (
              <Tile key={tile.key} $compact={stuck}>
                <Typography
                  variant="sigma"
                  textColor="neutral600"
                  style={stuck ? { fontSize: '1rem', lineHeight: 1.2 } : undefined}
                >
                  {formatMessage({ id: getTranslation(LABEL[tile.key]) })}
                </Typography>
                <Typography
                  variant={stuck ? 'omega' : 'beta'}
                  fontWeight={stuck ? 'bold' : undefined}
                  tag="p"
                  textColor="neutral800"
                  style={{ whiteSpace: 'nowrap', ...(stuck ? { lineHeight: 1.3 } : {}) }}
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
      </Box>
    </>
  );
};

export default TotalsBar;
