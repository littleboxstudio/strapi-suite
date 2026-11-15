import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Box, Button, Field, Flex, Loader, TextInput, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import SearchPickupPoints from '../../usecases/orders/searchPickupPoints';
import {
  formatOpeningHours,
  normalizePickupPostalCode,
  pickupPointLines,
  pickupSearchErrorCode,
  storeSelection,
  weekdayName,
} from '../../utils/pickupPoints';
import type { PickupPoint, PickupSelection, PickupStore } from '../../orderTypes';
import StoreSelect from './StoreSelect';

type Props = {
  /** The postal code the search starts with (the customer's). */
  initialPostalCode?: string;
  value: PickupSelection | null;
  onChange: (selection: PickupSelection | null) => void;
  disabled?: boolean;
  /** A translated error of the request that used the point (e.g. PICKUP_POINT_REQUIRED). */
  error?: string;
  /** Store pickup: choose one of these stores instead of searching DPD points. */
  stores?: PickupStore[] | null;
  /** Store pickup: a hint under the store select. */
  hint?: string;
};

/**
 * DPD Pickup (spec 5.3): search the pickup points by postal code (the same server search as the
 * storefront), then choose one. Each point shows its name, address, postal code and city, and
 * compact opening hours. With `stores` (Store pickup), a select of those stores instead.
 */
const PickupPointPicker = ({ stores, hint, ...props }: Props) =>
  stores ? (
    <StoreSelect
      stores={stores}
      hint={hint}
      value={props.value?.point.id ?? null}
      onChange={(store) => props.onChange(storeSelection(store))}
      disabled={props.disabled}
      error={props.error}
    />
  ) : (
    <DpdPointSearch {...props} />
  );

const DpdPointSearch = ({ initialPostalCode = '', value, onChange, disabled = false, error }: Props) => {
  const { formatMessage, locale } = useIntl();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const codeText = (code: string) =>
    formatMessage({
      id: getTranslation(`ecommerce.orders.errors.${code}`),
      defaultMessage: t('ecommerce.orders.errors.PICKUP_SEARCH_FAILED'),
    });

  const [postalCode, setPostalCode] = useState(initialPostalCode);
  const [points, setPoints] = useState<PickupPoint[] | null>(null);
  // The postal code of the shown list: the one sent with the chosen point.
  const [searchedCode, setSearchedCode] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const search = async () => {
    if (searching || disabled) return;
    const code = normalizePickupPostalCode(postalCode);
    if (!code) {
      setSearchError('INVALID_POSTAL_CODE');
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const found = await new SearchPickupPoints().execute(code);
      setPoints(found);
      setSearchedCode(code);
      setPostalCode(code);
    } catch (err) {
      setPoints(null);
      setSearchError(pickupSearchErrorCode(err));
    } finally {
      setSearching(false);
    }
  };

  const busy = disabled || searching;
  const dayName = (day: number) => weekdayName(day, locale);

  return (
    <Flex direction="column" alignItems="stretch" gap={3}>
      <Flex gap={2} alignItems="flex-start">
        <Box style={{ flex: 1 }}>
          <Field.Root
            name="pickupPostalCode"
            hint={t('ecommerce.orders.pickup.postalCodeHint')}
            error={searchError ? codeText(searchError) : undefined}
          >
            <Field.Label>{t('ecommerce.orders.pickup.postalCode')}</Field.Label>
            <TextInput
              value={postalCode}
              placeholder="0000-000"
              disabled={busy}
              inputMode="numeric"
              onChange={(e: any) => {
                setPostalCode(e.target.value);
                setSearchError(null);
              }}
              onKeyDown={(e: any) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  search();
                }
              }}
            />
            <Field.Hint />
            <Field.Error />
          </Field.Root>
        </Box>
        {/* Level with the input, below its label. */}
        <Box paddingTop={6}>
          {/* size L: as tall as the input. */}
          <Button variant="secondary" size="L" onClick={search} loading={searching} disabled={busy}>
            {t('ecommerce.orders.pickup.search')}
          </Button>
        </Box>
      </Flex>

      {searching && (
        <Flex justifyContent="center" padding={2}>
          <Loader small />
        </Flex>
      )}

      {!searching && points && points.length === 0 && (
        <Typography variant="omega" textColor="neutral600">
          {t('ecommerce.orders.pickup.none')}
        </Typography>
      )}

      {!searching && points && points.length > 0 && (
        <Flex
          direction="column"
          alignItems="stretch"
          gap={2}
          tag="ul"
          style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 320, overflowY: 'auto' }}
        >
          {points.map((p) => {
            const lines = pickupPointLines(p);
            const hours = formatOpeningHours(p.openingHours, dayName);
            const chosen = value?.point.id === p.id;
            return (
              <Box
                key={p.id}
                tag="li"
                padding={3}
                hasRadius
                borderColor={chosen ? 'primary600' : 'neutral200'}
                background={chosen ? 'primary100' : 'neutral0'}
              >
                <Flex justifyContent="space-between" alignItems="flex-start" gap={3}>
                  <Flex direction="column" alignItems="flex-start" gap={1} style={{ minWidth: 0 }}>
                    <Typography fontWeight="semiBold">{lines.name}</Typography>
                    <Typography variant="pi" textColor="neutral700">
                      {lines.address}
                    </Typography>
                    <Typography variant="pi" textColor="neutral700">
                      {lines.place}
                    </Typography>
                    {hours.length > 0 && (
                      <Typography variant="pi" textColor="neutral600">
                        {t('ecommerce.orders.pickup.hours')}: {hours.join(' · ')}
                      </Typography>
                    )}
                  </Flex>
                  <Button
                    size="S"
                    variant={chosen ? 'success-light' : 'tertiary'}
                    disabled={busy}
                    aria-pressed={chosen}
                    onClick={() => onChange(chosen ? null : { point: p, postalCode: searchedCode })}
                  >
                    {t(chosen ? 'ecommerce.orders.pickup.chosen' : 'ecommerce.orders.pickup.choose')}
                  </Button>
                </Flex>
              </Box>
            );
          })}
        </Flex>
      )}

      {error && (
        <Typography variant="omega" textColor="danger600">
          {error}
        </Typography>
      )}
    </Flex>
  );
};

export default PickupPointPicker;
