import { useIntl } from 'react-intl';
import {
  Box,
  Field,
  Flex,
  IconButton,
  NumberInput,
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
import { getTranslation } from '../../../core/utils/getTranslation';
import { formatCents } from '../../utils/money';
import { lineSubtotal, type OrderLineDraft } from '../../utils/orderForm';

type Props = {
  lines: OrderLineDraft[];
  onQuantityChange: (index: number, quantity: number) => void;
  onRemove: (index: number) => void;
  /** Translated error of line `index` (quantity or variant), or undefined. */
  errorFor: (index: number) => string | undefined;
  disabled?: boolean;
};

const OrderLinesEditor = ({ lines, onQuantityChange, onRemove, errorFor, disabled }: Props) => {
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
    <Table colCount={5} rowCount={lines.length}>
      <Thead>
        <Tr>
          {(['product', 'unitPrice', 'quantity', 'subtotal'] as const).map((column) => (
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
          return (
            <Tr key={line.variantId}>
              <Td style={{ maxWidth: 320 }}>
                <Flex direction="column" alignItems="flex-start">
                  <Typography textColor="neutral800" fontWeight="semiBold" ellipsis>
                    {line.option ? `${line.name} — ${line.option}` : line.name}
                  </Typography>
                  <Typography variant="pi" textColor="neutral600">
                    {line.sku} · {t('ecommerce.orders.picker.stock', { count: line.stock })}
                  </Typography>
                </Flex>
              </Td>
              <Td>
                <Typography textColor="neutral800">{formatCents(line.unitPrice, uiLocale)}</Typography>
              </Td>
              <Td>
                <Box style={{ width: 120 }}>
                  <Field.Root name={`lines.${index}.quantity`} error={error}>
                    <VisuallyHidden>
                      <Field.Label>{t('ecommerce.orders.lines.quantity')}</Field.Label>
                    </VisuallyHidden>
                    <NumberInput
                      size="S"
                      value={line.quantity}
                      minimum={1}
                      step={1}
                      disabled={disabled}
                      onValueChange={(value: number | undefined) =>
                        onQuantityChange(index, value ?? 0)
                      }
                    />
                    <Field.Error />
                  </Field.Root>
                </Box>
              </Td>
              <Td>
                <Typography textColor="neutral800">
                  {formatCents(lineSubtotal(line), uiLocale)}
                </Typography>
              </Td>
              <Td>
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
