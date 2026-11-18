import { useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Box,
  Button,
  Field,
  Flex,
  Grid,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { getTranslation } from '../../../../core/utils/getTranslation';
import { fieldErrors, hasCustomer, sectionError } from '../../../utils/createOrder';
import type { OrderErrorMap, OrderForm } from '../../../utils/orderForm';
import type { OrderLocales } from '../../../orderTypes';
import ColumnLabel from '../../ColumnLabel';
import EmptyNote from '../EmptyNote';
import OrderSection from '../OrderSection';
import CustomerModal from './CustomerModal';
import SectionError from './SectionError';

type Customer = OrderForm['customer'];

type Props = {
  customer: Customer;
  locale: string;
  locales: OrderLocales['locales'];
  errors: OrderErrorMap;
  codeText: (code: string) => string;
  disabled?: boolean;
  onSave: (customer: Customer, customerId: number | null) => void;
  onRemove: () => void;
  onLocale: (locale: string) => void;
};

const COLUMNS = ['name', 'email', 'phone', 'actions'] as const;

/** Create order's customer: one row (or the empty state), Add/Edit in a modal, and the language. */
const CustomerSection = ({
  customer,
  locale,
  locales,
  errors,
  codeText,
  disabled,
  onSave,
  onRemove,
  onLocale,
}: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const [open, setOpen] = useState(false);
  const present = hasCustomer(customer);

  const error = sectionError(errors, 'customer');
  const errorText = !error
    ? null
    : !present
      ? t('ecommerce.orders.new.customerRequired')
      : error.field
        ? `${t(`ecommerce.customers.fields.${error.field}`)}: ${codeText(error.code)}`
        : codeText(error.code);
  const name = [customer.firstName, customer.lastName].filter((s) => s.trim()).join(' ');

  return (
    <OrderSection
      title={t('ecommerce.orders.new.customer')}
      actions={
        !present ? (
          <Button size="S" variant="secondary" disabled={disabled} onClick={() => setOpen(true)}>
            {t('ecommerce.orders.new.customerAdd')}
          </Button>
        ) : undefined
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
                      {t(`ecommerce.orders.new.customerColumns.${c}`)}
                    </ColumnLabel>
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              <Tr>
                <Td>
                  <Typography textColor="neutral800" fontWeight="semiBold">
                    {name || '—'}
                  </Typography>
                </Td>
                <Td>
                  <Typography textColor="neutral800">{customer.email || '—'}</Typography>
                </Td>
                <Td>
                  <Typography textColor="neutral800">{customer.phone || '—'}</Typography>
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
        <EmptyNote>{t('ecommerce.orders.new.customerEmpty')}</EmptyNote>
      )}
      <Grid.Root gap={5}>
        <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
          <Field.Root
            name="locale"
            required
            error={errors.locale ? codeText(errors.locale) : undefined}
          >
            <Field.Label>{t('ecommerce.orders.new.locale')}</Field.Label>
            <SingleSelect
              value={locale || null}
              disabled={disabled}
              hasError={!!errors.locale}
              onChange={(value: string | number) => onLocale(String(value))}
            >
              {locales.map((l) => (
                <SingleSelectOption key={l.code} value={l.code}>
                  {l.name}
                </SingleSelectOption>
              ))}
            </SingleSelect>
            <Field.Error />
          </Field.Root>
        </Grid.Item>
      </Grid.Root>
      {open && (
        <CustomerModal
          initial={customer}
          errors={fieldErrors(errors, 'customer')}
          codeText={codeText}
          onClose={() => setOpen(false)}
          onSave={onSave}
        />
      )}
    </OrderSection>
  );
};

export default CustomerSection;
