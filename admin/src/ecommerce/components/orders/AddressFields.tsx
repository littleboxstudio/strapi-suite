import { useMemo } from 'react';
import { useIntl } from 'react-intl';
import { Field, Grid, SingleSelect, SingleSelectOption, TextInput } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { countryOptions } from '../../utils/settingsForm';
import type { AddressForm } from '../../utils/orderForm';

type AddressField = keyof AddressForm;

const REQUIRED = new Set<AddressField>(['firstName', 'lastName', 'line1', 'postalCode', 'city', 'country']);

const SHIPPING_FIELDS: AddressField[] = [
  'firstName',
  'lastName',
  'line1',
  'line2',
  'postalCode',
  'city',
  'country',
  'phone',
];

const BILLING_FIELDS: AddressField[] = [
  'firstName',
  'lastName',
  'company',
  'nif',
  'line1',
  'line2',
  'postalCode',
  'city',
  'country',
  'phone',
];

type Props = {
  /** Unique per form, used for the input names (`shippingAddress`, `billingAddress`). */
  name: string;
  value: AddressForm;
  onChange: (field: AddressField, value: string) => void;
  /** Translated error of a field, or undefined. */
  errorFor: (field: AddressField) => string | undefined;
  /** Billing addresses also take `company` and `nif`. */
  billing?: boolean;
  disabled?: boolean;
};

const AddressFields = ({ name, value, onChange, errorFor, billing = false, disabled }: Props) => {
  const { formatMessage, locale } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });
  const countries = useMemo(() => countryOptions(locale), [locale]);
  const fields = billing ? BILLING_FIELDS : SHIPPING_FIELDS;

  return (
    <Grid.Root gap={4}>
      {fields.map((field) => (
        <Grid.Item key={field} col={6} s={12} direction="column" alignItems="stretch">
          <Field.Root
            name={`${name}.${field}`}
            required={REQUIRED.has(field)}
            error={errorFor(field)}
          >
            <Field.Label>{t(`ecommerce.orders.address.${field}`)}</Field.Label>
            {field === 'country' ? (
              <SingleSelect
                value={value.country || null}
                disabled={disabled}
                hasError={!!errorFor('country')}
                placeholder={t('ecommerce.orders.address.countryPlaceholder')}
                onChange={(v: string | number) => onChange('country', String(v))}
              >
                {countries.map((c) => (
                  <SingleSelectOption key={c.code} value={c.code}>
                    {c.name}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
            ) : (
              <TextInput
                type={field === 'phone' ? 'tel' : 'text'}
                value={value[field]}
                disabled={disabled}
                onChange={(e: any) => onChange(field, e.target.value)}
              />
            )}
            <Field.Error />
          </Field.Root>
        </Grid.Item>
      ))}
    </Grid.Root>
  );
};

export type { AddressField };
export default AddressFields;
