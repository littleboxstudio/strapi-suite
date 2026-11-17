import { useIntl } from 'react-intl';
import { Box, Flex, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { formatCents } from '../../utils/money';
import { pickupPointLines } from '../../utils/pickupPoints';
import type { PickupSelection, PickupStore, ShippingOption, ShippingQuote } from '../../orderTypes';
import EmptyNote from './EmptyNote';
import { MethodItem, MethodList, MethodListRest, MethodsPanel } from './MethodsPanel';
import NoticeBar from './NoticeBar';
import PickupPointPicker from './PickupPointPicker';

export const shippingOptionKey = (o: { providerId: string; serviceId: string }) => `${o.providerId}::${o.serviceId}`;

type Props = {
  /** The quoted options; null before Get shipping options. */
  quote: ShippingQuote | null;
  /** The price listed for an option (the order quote's for the method it priced). */
  priceOf?: (option: ShippingOption) => number;
  selected: ShippingOption | null;
  onSelect: (option: ShippingOption) => void;
  /** A translated error of the shipping choice (required, unavailable). */
  error?: string;
  /** Store pickup: the stores of the chosen option; null for DPD Pickup. */
  stores: PickupStore[] | null;
  pickup: PickupSelection | null;
  onPickup: (selection: PickupSelection | null) => void;
  /** The customer's postal code: where the DPD point search starts. */
  postalCode: string;
  /** A translated error of the pickup point. */
  pickupError?: string;
  disabled?: boolean;
};

/**
 * Create order's shipping, as the order's shipping-method choice: the methods with their price on
 * the left, the chosen one's pickup point or store on the right.
 */
const CreateShippingPanel = ({
  quote,
  priceOf = (o) => o.price,
  selected,
  onSelect,
  error,
  stores,
  pickup,
  onPickup,
  postalCode,
  pickupError,
  disabled,
}: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const money = (cents: number) => formatCents(cents, uiLocale);
  const selectedKey = selected ? shippingOptionKey(selected) : null;
  // A DPD point chosen before any search (a duplicated order's): named above the search.
  const keptPoint = !stores && pickup ? pickupPointLines(pickup.point) : null;

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      {quote && quote.failures.length > 0 && (
        <NoticeBar
          wrap
          text={t('ecommerce.orders.shipping.failures', {
            providers: quote.failures.map((f) => f.providerId).join(', '),
          })}
        />
      )}
      {error && (
        <Typography variant="omega" textColor="danger600" role="alert">
          {error}
        </Typography>
      )}
      {!quote && <EmptyNote>{t('ecommerce.orders.shipping.empty')}</EmptyNote>}
      {quote && quote.options.length === 0 && <EmptyNote>{t('ecommerce.orders.shipping.none')}</EmptyNote>}
      {quote && quote.options.length > 0 && (
        <MethodsPanel>
          <MethodList role="listbox" aria-label={t('ecommerce.orders.shipping.option')}>
            {quote.options.map((o) => {
              const key = shippingOptionKey(o);
              const isSelected = key === selectedKey;
              return (
                <MethodItem
                  key={key}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  $selected={isSelected}
                  disabled={disabled}
                  onClick={() => !isSelected && onSelect(o)}
                >
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>{o.name}</span>
                    <span style={{ whiteSpace: 'nowrap' }}>{money(priceOf(o))}</span>
                  </span>
                </MethodItem>
              );
            })}
            <MethodListRest />
          </MethodList>
          <Box flex="1" padding={5} minWidth={0}>
            {!selected ? (
              <Typography variant="omega" textColor="neutral600">
                {t('ecommerce.orders.shipping.choose')}
              </Typography>
            ) : (
              <Flex direction="column" alignItems="stretch" gap={4}>
                <Flex justifyContent="space-between" gap={4}>
                  <Typography fontWeight="semiBold" textColor="neutral800">
                    {selected.name}
                  </Typography>
                  <Typography fontWeight="semiBold" textColor="neutral800" style={{ whiteSpace: 'nowrap' }}>
                    {money(priceOf(selected))}
                  </Typography>
                </Flex>
                {selected.requiresPickupPoint && (
                  <Flex direction="column" alignItems="stretch" gap={2}>
                    <Typography variant="sigma" textColor="neutral600">
                      {t(stores ? 'ecommerce.orders.pickup.store.title' : 'ecommerce.orders.pickup.title')}
                    </Typography>
                    {keptPoint ? (
                      <Typography variant="pi" textColor="neutral800">
                        {t('ecommerce.orders.pickup.current', { name: keptPoint.name, id: pickup!.point.id })}
                        {` · ${keptPoint.address}, ${keptPoint.place}`}
                      </Typography>
                    ) : (
                      <Typography variant="pi" textColor="neutral600">
                        {t(stores ? 'ecommerce.orders.pickup.store.required' : 'ecommerce.orders.pickup.required')}
                      </Typography>
                    )}
                    <PickupPointPicker
                      stores={stores}
                      initialPostalCode={postalCode}
                      value={pickup}
                      onChange={onPickup}
                      disabled={disabled}
                      error={pickupError}
                    />
                  </Flex>
                )}
              </Flex>
            )}
          </Box>
        </MethodsPanel>
      )}
    </Flex>
  );
};

export default CreateShippingPanel;
