import { useMemo, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import {
  Box,
  Button,
  Flex,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { getTranslation } from '../../../../core/utils/getTranslation';
import { fieldErrors, hasAddress, postalCity, sectionError } from '../../../utils/createOrder';
import { countryOptions } from '../../../utils/settingsForm';
import { emptyAddressForm, type AddressForm, type OrderErrorMap } from '../../../utils/orderForm';
import ColumnLabel from '../../ColumnLabel';
import { FIT_CELL, PRODUCT_CELL } from '../lineCells';
import EmptyNote from '../EmptyNote';
import OrderSection from '../OrderSection';
import AddressModal from './AddressModal';
import SectionError from './SectionError';

type Props = {
  /** The form key: `shippingAddress` or `billingAddress` (its errors and input names). */
  name: 'shippingAddress' | 'billingAddress';
  title: string;
  /** Add button and modal title (Add shipping address, Add billing address). */
  addLabel: string;
  value: AddressForm;
  errors: OrderErrorMap;
  codeText: (code: string) => string;
  disabled?: boolean;
  onSave: (address: AddressForm) => void;
  onRemove: () => void;
  /** More buttons top right (Billing same as shipping). */
  extraActions?: ReactNode;
};

const SHIPPING_COLUMNS = ['name', 'street', 'postalCity', 'country', 'actions'] as const;
const BILLING_COLUMNS = ['name', 'street', 'postalCity', 'country', 'nif', 'actions'] as const;

/** Create order's shipping or billing address: one row (or the empty state), Add/Edit in a modal. */
const AddressSection = ({
  name,
  title,
  addLabel,
  value,
  errors,
  codeText,
  disabled,
  onSave,
  onRemove,
  extraActions,
}: Props) => {
  const { formatMessage, locale } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const [open, setOpen] = useState(false);
  const present = hasAddress(value);
  const billing = name === 'billingAddress';
  const countries = useMemo(() => countryOptions(locale), [locale]);

  const error = sectionError(errors, name);
  const errorText = !error
    ? null
    : !present
      ? t('ecommerce.orders.new.addressRequired')
      : error.field
        ? `${t(`ecommerce.orders.address.${error.field}`)}: ${codeText(error.code)}`
        : codeText(error.code);

  const person = [value.firstName, value.lastName].filter((s) => s.trim()).join(' ');
  const columns = billing ? BILLING_COLUMNS : SHIPPING_COLUMNS;
  // Name and street wrap to more lines when there is no room; the other columns fit their text.
  const wrap = { ...PRODUCT_CELL, maxWidth: 260 };
  const muted = (text: string) => (
    <Typography variant="pi" textColor="neutral600" style={{ whiteSpace: 'normal' }}>
      {text}
    </Typography>
  );
  const country =
    countries.find((c) => c.code === value.country.toUpperCase())?.name ?? value.country;

  return (
    <OrderSection
      title={title}
      actions={
        (!present || extraActions) && (
          <Flex gap={2} alignItems="center">
            {extraActions}
            {!present && (
              <Button
                size="S"
                variant="secondary"
                disabled={disabled}
                onClick={() => setOpen(true)}
              >
                {addLabel}
              </Button>
            )}
          </Flex>
        )
      }
    >
      <SectionError text={errorText} />
      {present ? (
        <Box style={{ overflowX: 'auto' }}>
          <Table colCount={columns.length} rowCount={2}>
            <Thead>
              <Tr>
                {columns.map((c) => (
                  <Th key={c}>
                    <ColumnLabel column={c}>
                      {t(`ecommerce.orders.new.addressColumns.${c}`)}
                    </ColumnLabel>
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              <Tr>
                <Td style={wrap}>
                  <Flex direction="column" alignItems="flex-start" gap={1}>
                    <Typography
                      textColor="neutral800"
                      fontWeight="semiBold"
                      style={{ whiteSpace: 'normal' }}
                    >
                      {person || '—'}
                    </Typography>
                    {billing && value.company.trim() && muted(value.company)}
                    {value.phone.trim() && muted(value.phone)}
                  </Flex>
                </Td>
                <Td style={wrap}>
                  <Typography textColor="neutral800" style={{ whiteSpace: 'normal' }}>
                    {[value.line1, value.line2].filter((s) => s.trim()).join(', ') || '—'}
                  </Typography>
                </Td>
                <Td style={FIT_CELL}>
                  <Typography textColor="neutral800">{postalCity(value)}</Typography>
                </Td>
                <Td style={FIT_CELL}>
                  <Typography textColor="neutral800">{country || '—'}</Typography>
                </Td>
                {billing && (
                  <Td style={FIT_CELL}>
                    <Typography textColor="neutral800">{value.nif.trim() || '—'}</Typography>
                  </Td>
                )}
                <Td>
                  <Flex justifyContent="flex-end" gap={2}>
                    <Button
                      size="S"
                      variant="tertiary"
                      disabled={disabled}
                      onClick={() => setOpen(true)}
                    >
                      {t('ecommerce.orders.shippingCharges.edit')}
                    </Button>
                    <Button size="S" variant="danger-light" disabled={disabled} onClick={onRemove}>
                      {t('ecommerce.orders.shippingCharges.remove')}
                    </Button>
                  </Flex>
                </Td>
              </Tr>
            </Tbody>
          </Table>
        </Box>
      ) : (
        <EmptyNote>{t('ecommerce.orders.new.addressEmpty')}</EmptyNote>
      )}
      {open && (
        <AddressModal
          title={present ? title : addLabel}
          name={name}
          billing={billing}
          initial={present ? value : emptyAddressForm()}
          errors={fieldErrors(errors, name)}
          codeText={codeText}
          onClose={() => setOpen(false)}
          onSave={onSave}
        />
      )}
    </OrderSection>
  );
};

export default AddressSection;
