import { useState } from 'react';
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
import { fieldErrors, hasCustomer, localeName, sectionError } from '../../../utils/createOrder';
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
  defaultLocale: string | null;
  errors: OrderErrorMap;
  codeText: (code: string) => string;
  disabled?: boolean;
  /** The customer, whether one was picked in the search, and the order's language. */
  onSave: (customer: Customer, customerId: number | null, locale: string, blocked?: boolean) => void;
  onRemove: () => void;
};

const COLUMNS = ['name', 'email', 'phone', 'locale', 'actions'] as const;

/** Create order's customer: one row with the order's language (or the empty state), Add/Edit in a modal. */
const CustomerSection = ({
  customer,
  locale,
  locales,
  defaultLocale,
  errors,
  codeText,
  disabled,
  onSave,
  onRemove,
}: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const [open, setOpen] = useState(false);
  const present = hasCustomer(customer);

  const error = sectionError(errors, 'customer') ?? sectionError(errors, 'locale');
  const errorText = !error
    ? null
    : !present
      ? t('ecommerce.orders.new.customerRequired')
      : error.path === 'locale'
        ? `${t('ecommerce.orders.new.locale')}: ${codeText(error.code)}`
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
                  <Typography textColor="neutral800">{localeName(locale, locales)}</Typography>
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
      {open && (
        <CustomerModal
          initial={customer}
          errors={fieldErrors(errors, 'customer')}
          codeText={codeText}
          locale={locale}
          locales={locales}
          defaultLocale={defaultLocale}
          localeError={errors.locale ? codeText(errors.locale) : undefined}
          onClose={() => setOpen(false)}
          onSave={onSave}
        />
      )}
    </OrderSection>
  );
};

export default CustomerSection;
