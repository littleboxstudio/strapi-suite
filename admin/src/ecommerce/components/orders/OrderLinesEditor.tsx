import { useIntl } from 'react-intl';
import {
  Box,
  Field,
  Flex,
  IconButton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { Trash } from '@strapi/icons';
import QuantityInput from './QuantityInput';
import DiscountPercentInput from './DiscountPercentInput';
import { FIT_CELL, PRODUCT_CELL } from './lineCells';
import { getTranslation } from '../../../core/utils/getTranslation';
import { formatCents } from '../../utils/money';
import { lineSubtotal, lineUnitNet, type OrderLineDraft } from '../../utils/orderForm';

type Props = {
  lines: OrderLineDraft[];
  onQuantityChange: (index: number, quantity: number) => void;
  /** The typed manual discount percent of line `index` (spec 4.1). */
  onDiscountChange: (index: number, discount: string) => void;
  onRemove: (index: number) => void;
  /** Translated error of line `index` (quantity or variant), or undefined. */
  errorFor: (index: number) => string | undefined;
  /** Translated error of line `index`'s discount, or undefined. */
  discountErrorFor: (index: number) => string | undefined;
  disabled?: boolean;
};

const OrderLinesEditor = ({
  lines,
  onQuantityChange,
  onDiscountChange,
  onRemove,
  errorFor,
  discountErrorFor,
  disabled,
}: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  if (!lines.length) {
    return (
      <Box padding={4} background="neutral100" hasRadius>
        <Typography variant="omega" textColor="neutral600">
          {t('ecommerce.orders.lines.empty')}
        </Typography>
      </Box>
    );
  }

  return (
    <Table colCount={6} rowCount={lines.length}>
      <Thead>
        <Tr>
          {(['product', 'unitPrice', 'quantity', 'discount', 'subtotal'] as const).map((column) => (
            <Th key={column}>
              <Typography variant="sigma">{t(`ecommerce.orders.lines.${column}`)}</Typography>
            </Th>
          ))}
          <Th>
            <VisuallyHidden>{t('ecommerce.orders.table.actions')}</VisuallyHidden>
          </Th>
        </Tr>
      </Thead>
      <Tbody>
        {lines.map((line, index) => {
          const error = errorFor(index);
          const discountError = discountErrorFor(index);
          return (
            <Tr key={line.variantId}>
              <Td style={PRODUCT_CELL}>
                <Flex direction="column" alignItems="flex-start">
                  <Typography textColor="neutral800" fontWeight="semiBold">
                    {line.option ? `${line.name} — ${line.option}` : line.name}
                  </Typography>
                  <Typography variant="pi" textColor="neutral600">
                    {line.sku} · {t('ecommerce.orders.picker.stock', { count: line.stock })}
                  </Typography>
                </Flex>
              </Td>
              <Td style={FIT_CELL}>
                <Typography textColor="neutral800">{formatCents(lineUnitNet(line), uiLocale)}</Typography>
              </Td>
              <Td style={FIT_CELL}>
                <Box style={{ width: 120 }}>
                  <Field.Root name={`lines.${index}.quantity`} error={error}>
                    <VisuallyHidden>
                      <Field.Label>{t('ecommerce.orders.lines.quantity')}</Field.Label>
                    </VisuallyHidden>
                    <QuantityInput
                        value={line.quantity}
                        disabled={disabled}
                        onChange={(quantity) => onQuantityChange(index, quantity)}
                      />
                    <Field.Error />
                  </Field.Root>
                </Box>
              </Td>
              <Td style={FIT_CELL}>
                <Box style={{ width: 80 }}>
                  <Field.Root name={`lines.${index}.discountPercent`} error={discountError}>
                    <VisuallyHidden>
                      <Field.Label>{t('ecommerce.orders.lines.discount')}</Field.Label>
                    </VisuallyHidden>
                    <DiscountPercentInput
                      value={line.discount ?? ''}
                      disabled={disabled}
                      onChange={(discount) => onDiscountChange(index, discount)}
                    />
                    <Field.Error />
                  </Field.Root>
                </Box>
              </Td>
              <Td style={FIT_CELL}>
                <Typography textColor="neutral800">
                  {formatCents(lineSubtotal(line), uiLocale)}
                </Typography>
              </Td>
              <Td style={FIT_CELL}>
                <Box style={{ textAlign: 'right' }}>
                  <IconButton
                    label={t('ecommerce.orders.lines.remove')}
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => onRemove(index)}
                  >
                    <Trash />
                  </IconButton>
                </Box>
              </Td>
            </Tr>
          );
        })}
      </Tbody>
    </Table>
  );
};

export default OrderLinesEditor;
