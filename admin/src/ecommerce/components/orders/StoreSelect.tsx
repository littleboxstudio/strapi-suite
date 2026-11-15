import { useIntl } from 'react-intl';
import { Field, SingleSelect, SingleSelectOption, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { pickupPointLines } from '../../utils/pickupPoints';
import type { PickupStore } from '../../orderTypes';

type Props = {
  stores: PickupStore[];
  /** The chosen store's id, or null. */
  value: string | null;
  onChange: (store: PickupStore) => void;
  disabled?: boolean;
  /** A translated error (e.g. PICKUP_POINT_REQUIRED). */
  error?: string;
  hint?: string;
};

/** Store pickup (store pickup spec 6): choose one of the stores, by name and address. */
const StoreSelect = ({ stores, value, onChange, disabled = false, error, hint }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });

  if (!stores.length) {
    return (
      <Typography variant="omega" textColor={error ? 'danger600' : 'neutral600'}>
        {error ?? t('ecommerce.orders.pickup.store.none')}
      </Typography>
    );
  }

  return (
    <Field.Root name="pickupStore" required error={error} hint={hint}>
      <Field.Label>{t('ecommerce.orders.pickup.store.label')}</Field.Label>
      <SingleSelect
        value={value && stores.some((s) => s.id === value) ? value : null}
        disabled={disabled}
        hasError={!!error}
        placeholder={t('ecommerce.orders.pickup.store.placeholder')}
        onChange={(id: string | number) => {
          const store = stores.find((s) => s.id === String(id));
          if (store) onChange(store);
        }}
      >
        {stores.map((s) => {
          const lines = pickupPointLines(s);
          return (
            <SingleSelectOption key={s.id} value={s.id}>
              {`${lines.name} — ${lines.address}, ${lines.place}`}
            </SingleSelectOption>
          );
        })}
      </SingleSelect>
      <Field.Hint />
      <Field.Error />
    </Field.Root>
  );
};

export default StoreSelect;
