import { useIntl } from 'react-intl';
import {
  Badge,
  Box,
  Button,
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
import {
  modifyLineDiscountEditable,
  modifyLineUnitPrice,
  type ModifyLineDraft,
} from '../../utils/modification';

type Props = {
  lines: ModifyLineDraft[];
  onQuantityChange: (key: string, quantity: number) => void;
  /** The typed manual discount percent of a line (spec 4.1). */
  onDiscountChange: (key: string, discount: string) => void;
  onRemove: (key: string) => void;
  onRestore: (key: string) => void;
  /** Translated error of a line, or undefined. */
  errorFor: (key: string) => string | undefined;
  /** Translated error of a line's discount field, or undefined. */
  discountErrorFor: (key: string) => string | undefined;
  disabled?: boolean;
};

/**
 * Lines of the modification draft: existing lines can be changed, removed (and restored); gifts are
 * read-only. A manual discount percent goes on lines with nothing shipped (spec 4.1).
 */
const ModifyLinesEditor = ({
  lines,
  onQuantityChange,
  onDiscountChange,
  onRemove,
  onRestore,
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
        {lines.map((line) => {
          const error = errorFor(line.key);
          const label = line.option ? `${line.name} — ${line.option}` : line.name;
          const validQuantity = Number.isSafeInteger(line.quantity) && line.quantity > 0;
          const editable = !line.isGift && !line.removed;
          const unitPrice = modifyLineUnitPrice(line);
          const discountError = discountErrorFor(line.key);
          return (
            <Tr key={line.key}>
              <Td style={PRODUCT_CELL}>
                <Flex direction="column" alignItems="flex-start" gap={1}>
                  <Typography
                    textColor={line.removed ? 'neutral500' : 'neutral800'}
                    fontWeight="semiBold"
                    style={line.removed ? { textDecoration: 'line-through' } : undefined}
                  >
                    {label}
                  </Typography>
                  <Typography variant="pi" textColor="neutral600">
                    {line.sku}
                    {line.stock !== null ? ` · ${t('ecommerce.orders.picker.stock', { count: line.stock })}` : ''}
                    {line.shipped > 0 ? ` · ${t('ecommerce.orders.modify.lines.shipped', { count: line.shipped })}` : ''}
                  </Typography>
                  <Flex gap={1}>
                    {line.isGift && <Badge size="S">{t('ecommerce.orders.detail.lines.gift')}</Badge>}
                    {line.orderLineId === undefined && (
                      <Badge size="S" variant="success">
                        {t('ecommerce.orders.modify.lines.new')}
                      </Badge>
                    )}
                    {line.removed && (
                      <Badge size="S" variant="danger">
                        {t('ecommerce.orders.modify.lines.removed')}
                      </Badge>
                    )}
                  </Flex>
                  {!editable && error && (
                    <Typography variant="pi" textColor="danger600">
                      {error}
                    </Typography>
                  )}
                </Flex>
              </Td>
              <Td style={FIT_CELL}>
                <Typography textColor="neutral800">{formatCents(unitPrice, uiLocale)}</Typography>
              </Td>
              <Td style={FIT_CELL}>
                {editable ? (
                  <Box style={{ width: 120 }}>
                    <Field.Root name={`lines.${line.key}.quantity`} error={error}>
                      <VisuallyHidden>
                        <Field.Label>{t('ecommerce.orders.lines.quantity')}</Field.Label>
                      </VisuallyHidden>
                      <QuantityInput
                        value={line.quantity}
                        disabled={disabled}
                        onChange={(quantity) => onQuantityChange(line.key, quantity)}
                      />
                      <Field.Error />
                    </Field.Root>
                  </Box>
                ) : (
                  <Typography textColor="neutral600">
                    {line.removed ? line.originalQuantity : line.quantity}
                  </Typography>
                )}
              </Td>
              <Td style={FIT_CELL}>
                <Box style={{ width: 80 }}>
                  <Field.Root name={`lines.${line.key}.discountPercent`} error={discountError}>
                    <VisuallyHidden>
                      <Field.Label>{t('ecommerce.orders.lines.discount')}</Field.Label>
                    </VisuallyHidden>
                    <DiscountPercentInput
                      value={line.discount}
                      disabled={disabled || !modifyLineDiscountEditable(line)}
                      onChange={(discount) => onDiscountChange(line.key, discount)}
                    />
                    <Field.Error />
                  </Field.Root>
                </Box>
              </Td>
              <Td style={FIT_CELL}>
                <Typography textColor={line.removed ? 'neutral500' : 'neutral800'}>
                  {formatCents(line.removed || !validQuantity ? 0 : unitPrice * line.quantity, uiLocale)}
                </Typography>
              </Td>
              <Td style={FIT_CELL}>
                <Flex justifyContent="flex-end">
                  {line.removed && (
                    <Button size="S" variant="tertiary" disabled={disabled} onClick={() => onRestore(line.key)}>
                      {t('ecommerce.orders.modify.lines.restore')}
                    </Button>
                  )}
                  {editable && (
                    <IconButton
                      label={
                        line.shipped > 0
                          ? t('ecommerce.orders.modify.lines.cannotRemove')
                          : t('ecommerce.orders.lines.remove')
                      }
                      variant="ghost"
                      disabled={disabled || line.shipped > 0}
                      onClick={() => onRemove(line.key)}
                    >
                      <Trash />
                    </IconButton>
                  )}
                </Flex>
              </Td>
            </Tr>
          );
        })}
      </Tbody>
    </Table>
  );
};

export default ModifyLinesEditor;
