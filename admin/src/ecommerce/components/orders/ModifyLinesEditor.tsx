import { useIntl } from 'react-intl';
import {
  Badge,
  Box,
  Button,
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
import type { ModifyLineDraft } from '../../utils/modification';

type Props = {
  lines: ModifyLineDraft[];
  onQuantityChange: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
  onRestore: (key: string) => void;
  /** Translated error of a line, or undefined. */
  errorFor: (key: string) => string | undefined;
  disabled?: boolean;
};

/** Lines of the modification draft: existing lines can be changed, removed (and restored); gifts are read-only. */
const ModifyLinesEditor = ({ lines, onQuantityChange, onRemove, onRestore, errorFor, disabled }: Props) => {
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
        {lines.map((line) => {
          const error = errorFor(line.key);
          const label = line.option ? `${line.name} — ${line.option}` : line.name;
          const validQuantity = Number.isSafeInteger(line.quantity) && line.quantity > 0;
          const editable = !line.isGift && !line.removed;
          return (
            <Tr key={line.key}>
              <Td style={{ maxWidth: 320 }}>
                <Flex direction="column" alignItems="flex-start" gap={1}>
                  <Typography
                    textColor={line.removed ? 'neutral500' : 'neutral800'}
                    fontWeight="semiBold"
                    ellipsis
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
              <Td>
                <Typography textColor="neutral800">{formatCents(line.unitPrice, uiLocale)}</Typography>
              </Td>
              <Td>
                {editable ? (
                  <Box style={{ width: 120 }}>
                    <Field.Root name={`lines.${line.key}.quantity`} error={error}>
                      <VisuallyHidden>
                        <Field.Label>{t('ecommerce.orders.lines.quantity')}</Field.Label>
                      </VisuallyHidden>
                      <NumberInput
                        size="S"
                        value={line.quantity}
                        minimum={Math.max(1, line.shipped)}
                        step={1}
                        disabled={disabled}
                        onValueChange={(value: number | undefined) => onQuantityChange(line.key, value ?? 0)}
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
              <Td>
                <Typography textColor={line.removed ? 'neutral500' : 'neutral800'}>
                  {formatCents(line.removed || !validQuantity ? 0 : line.unitPrice * line.quantity, uiLocale)}
                </Typography>
              </Td>
              <Td>
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
