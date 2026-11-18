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
import { fieldErrors, hasAddress, sectionError } from '../../../utils/createOrder';
import { countryOptions } from '../../../utils/settingsForm';
import { emptyAddressForm, type AddressForm, type OrderErrorMap } from '../../../utils/orderForm';
import ColumnLabel from '../../ColumnLabel';
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

const COLUMNS = ['street', 'postalCode', 'city', 'country', 'actions'] as const;

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
  const extra = billing
    ? [value.company, value.nif ? `NIF ${value.nif}` : ''].filter((s) => s.trim())
    : [];
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
          <Table colCount={COLUMNS.length} rowCount={2}>
            <Thead>
              <Tr>
                {COLUMNS.map((c) => (
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
                <Td style={{ whiteSpace: 'normal' }}>
                  <Flex direction="column" alignItems="flex-start" gap={1}>
                    <Typography textColor="neutral800" fontWeight="semiBold">
                      {[value.line1, value.line2].filter((s) => s.trim()).join(', ') || '—'}
                    </Typography>
                    {(person || value.phone) && (
                      <Typography variant="pi" textColor="neutral600">
                        {[person, value.phone].filter((s) => s.trim()).join(' · ')}
                      </Typography>
                    )}
                    {extra.length > 0 && (
                      <Typography variant="pi" textColor="neutral600">
                        {extra.join(' · ')}
                      </Typography>
                    )}
                  </Flex>
                </Td>
                <Td>
                  <Typography textColor="neutral800">{value.postalCode || '—'}</Typography>
                </Td>
                <Td>
                  <Typography textColor="neutral800">{value.city || '—'}</Typography>
                </Td>
                <Td>
                  <Typography textColor="neutral800">{country || '—'}</Typography>
                </Td>
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
