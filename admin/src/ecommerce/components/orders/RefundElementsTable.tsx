import { useIntl } from 'react-intl';
import {
  Box,
  Checkbox,
  Field,
  Flex,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { formatCents } from '../../utils/money';
import { selectionKey, type RefundCreditSelection } from '../../utils/refundCreditNote';
import type { RefundCreditLineOption, RefundElementInvoice } from '../../orderTypes';
import ColumnLabel from '../ColumnLabel';
import QuantityInput from './QuantityInput';
import { FIT_CELL, PRODUCT_CELL } from './lineCells';

const COLUMNS = ['name', 'quantityLeft', 'unitValue', 'quantity', 'value'] as const;

type Props = {
  invoice: RefundElementInvoice;
  selection: RefundCreditSelection;
  /** Per element key: the server's error code for it, shown translated on its row. */
  errors?: Record<string, string>;
  /** Heading of the Quantity column (to refund / to credit). */
  quantityLabel: string;
  /** The value of `quantity` units of an element (the server's rule, or a stored value). */
  valueOf: (option: RefundCreditLineOption, quantity: number) => number;
  disabled?: boolean;
  /** The quantities are fixed: shown as text, not inputs. */
  readOnly?: boolean;
  /** Only the elements with a quantity chosen are listed. */
  selectedOnly?: boolean;
  onChoose: (invoiceId: number, index: number, quantity: number) => void;
};

/**
 * The invoiced elements of one invoice an INVOICED refund (or its credit note) may pick, under a
 * sigma title: whole units of products (an input), whole shipping lines (a checkbox).
 */
const RefundElementsTable = ({
  invoice,
  selection,
  errors = {},
  quantityLabel,
  valueOf,
  disabled,
  readOnly,
  selectedOnly,
  onChoose,
}: Props) => {
  const { formatMessage, locale } = useIntl();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const p = 'ecommerce.orders.refunds.creditNote';
  const money = (cents: number) => formatCents(cents, locale);
  const codeText = (code: string) =>
    formatMessage({
      id: getTranslation(`ecommerce.orders.errors.${code}`),
      defaultMessage: t('ecommerce.orders.errors.invalid'),
    });
  const lines = selectedOnly
    ? invoice.lines.filter((o) => (selection[selectionKey(invoice.invoiceId, o.index)] ?? 0) > 0)
    : invoice.lines;
  if (!lines.length) return null;

  return (
    <Flex direction="column" alignItems="stretch" gap={2}>
      <Typography variant="sigma" textColor="neutral600">
        {t(`${p}.invoice`, { number: invoice.number ?? `#${invoice.invoiceId}` })}
      </Typography>
      <Table colCount={COLUMNS.length} rowCount={lines.length + 1}>
        <Thead>
          <Tr>
            {COLUMNS.map((c) => (
              <Th key={c}>
                <ColumnLabel column={c}>{c === 'quantity' ? quantityLabel : t(`${p}.columns.${c}`)}</ColumnLabel>
              </Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {lines.map((option) => {
            const key = selectionKey(invoice.invoiceId, option.index);
            const quantity = selection[key] ?? 0;
            const tooMany = quantity > option.quantityLeft;
            const error = tooMany
              ? t('ecommerce.orders.invoices.issue.atMost', { max: option.quantityLeft })
              : errors[key]
                ? codeText(errors[key])
                : undefined;
            const name =
              option.kind === 'SHIPPING'
                ? t('ecommerce.orders.invoices.lines.shipping', { name: option.name })
                : option.name;
            const errorText = error && (
              <Typography variant="pi" textColor="danger600">
                {error}
              </Typography>
            );
            let input;
            if (readOnly) {
              input = (
                <Flex direction="column" alignItems="flex-start" gap={1}>
                  <Typography textColor="neutral800">{quantity}</Typography>
                  {errorText}
                </Flex>
              );
            } else if (option.kind === 'SHIPPING') {
              input = (
                <Flex direction="column" alignItems="flex-start" gap={1}>
                  <Checkbox
                    aria-label={name}
                    disabled={disabled}
                    checked={quantity > 0}
                    onCheckedChange={(checked: boolean | 'indeterminate') =>
                      onChoose(invoice.invoiceId, option.index, checked === true ? 1 : 0)
                    }
                  />
                  {errorText}
                </Flex>
              );
            } else {
              input = (
                <Box style={{ width: 120 }}>
                  <Field.Root name={key} error={error}>
                    <VisuallyHidden>
                      <Field.Label>{quantityLabel}</Field.Label>
                    </VisuallyHidden>
                    <QuantityInput
                      value={quantity}
                      disabled={disabled}
                      onChange={(q) => onChoose(invoice.invoiceId, option.index, q)}
                    />
                    <Field.Error />
                  </Field.Root>
                </Box>
              );
            }
            return (
              <Tr key={key}>
                <Td style={PRODUCT_CELL}>
                  <Typography textColor="neutral800">{name}</Typography>
                </Td>
                <Td style={FIT_CELL}>
                  <Typography textColor="neutral800">{option.quantityLeft}</Typography>
                </Td>
                <Td style={FIT_CELL}>
                  <Typography textColor="neutral800">{money(option.unitValue)}</Typography>
                </Td>
                <Td style={FIT_CELL}>{input}</Td>
                <Td style={FIT_CELL}>
                  <Typography textColor="neutral800">{money(valueOf(option, quantity))}</Typography>
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>
    </Flex>
  );
};

export default RefundElementsTable;
