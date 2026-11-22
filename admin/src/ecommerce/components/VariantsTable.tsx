import { useState } from 'react';
import { useIntl } from 'react-intl';
import styled from 'styled-components';
import {
  Box,
  Button,
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
import { Pencil, Trash } from '@strapi/icons';
import ConfirmModal from '../../components/ConfirmModal';
import { NoticeModal } from './NoticeModal';
import { getTranslation } from '../../core/utils/getTranslation';
import EmptyVariants from '../illustrations/EmptyVariants';
import { formatCents } from '../utils/money';
import { hasErrorsUnder, type ErrorMap, type FormVariant } from '../utils/productForm';
import { ToneBadge } from './orders/StatusBadges';
import { coverImage } from '../utils/gallery';

type Props = {
  variants: FormVariant[];
  locale: string;
  defaultLocale: string;
  errors: ErrorMap;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  /** Disables add/edit/remove (e.g. while an AI translation is writing into the form). */
  disabled?: boolean;
};

const THUMBNAIL_SIZE = 36;

const VariantRow = styled(Tr)<{ $invalid: boolean }>`
  box-shadow: ${({ theme, $invalid }) =>
    $invalid ? `inset 3px 0 0 ${theme.colors.danger600}` : 'none'};
`;

const VariantsTable = ({
  variants,
  locale,
  defaultLocale,
  errors,
  onAdd,
  onEdit,
  onRemove,
  disabled = false,
}: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const [confirmIndex, setConfirmIndex] = useState<number | null>(null);
  /** A saved variant that is in some order: it can only be deactivated. */
  const [blockedOpen, setBlockedOpen] = useState(false);

  if (variants.length === 0) {
    return (
      <Flex direction="column" alignItems="center" gap={3} padding={8}>
        <EmptyVariants />
        <Typography variant="omega" textColor="neutral600">
          {t('ecommerce.product.variants.empty')}
        </Typography>
        <Button variant="secondary" onClick={onAdd} disabled={disabled}>
          {t('ecommerce.product.variants.add')}
        </Button>
      </Flex>
    );
  }

  const optionLabel = (v: FormVariant) => {
    const option = v.translations[locale]?.option;
    if (option) return <Typography textColor="neutral800">{option}</Typography>;
    // Falls back to the default locale, like the storefront does.
    return (
      <Typography textColor="neutral500" fontStyle="italic">
        {v.translations[defaultLocale]?.option ?? ''}
      </Typography>
    );
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={3}>
      <Table colCount={8} rowCount={variants.length}>
        <Thead>
          <Tr>
            <Th>
              <VisuallyHidden>{t('ecommerce.product.variants.table.image')}</VisuallyHidden>
            </Th>
            <Th>
              <Typography variant="sigma">
                {t('ecommerce.product.variants.table.option')}
              </Typography>
            </Th>
            <Th>
              <Typography variant="sigma">{t('ecommerce.product.variants.table.sku')}</Typography>
            </Th>
            <Th>
              <Typography variant="sigma">{t('ecommerce.product.variants.table.price')}</Typography>
            </Th>
            <Th>
              <Typography variant="sigma">{t('ecommerce.product.variants.table.tax')}</Typography>
            </Th>
            <Th>
              <Typography variant="sigma">{t('ecommerce.product.variants.table.stock')}</Typography>
            </Th>
            <Th>
              <Typography variant="sigma">
                {t('ecommerce.product.variants.table.active')}
              </Typography>
            </Th>
            <Th>
              <VisuallyHidden>{t('ecommerce.product.variants.table.actions')}</VisuallyHidden>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {variants.map((v, index) => {
            const invalid = hasErrorsUnder(errors, `variants.${index}`);
            return (
              <VariantRow key={v.key} $invalid={invalid} aria-invalid={invalid || undefined}>
                <Td>
                  {coverImage(v.images) ? (
                    <img
                      src={coverImage(v.images)!.url}
                      alt=""
                      width={THUMBNAIL_SIZE}
                      height={THUMBNAIL_SIZE}
                      style={{ objectFit: 'cover', borderRadius: '4px', display: 'block' }}
                    />
                  ) : (
                    <Box
                      background="neutral150"
                      hasRadius
                      style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE }}
                    />
                  )}
                </Td>
                <Td>{optionLabel(v)}</Td>
                <Td>
                  <Typography
                    textColor={errors[`variants.${index}.sku`] ? 'danger600' : 'neutral800'}
                  >
                    {v.sku}
                  </Typography>
                </Td>
                <Td>
                  <Flex gap={2} alignItems="baseline">
                    <Typography textColor="neutral800">{formatCents(v.price, uiLocale)}</Typography>
                    {v.compareAtPrice != null && (
                      <Typography
                        variant="pi"
                        textColor={
                          errors[`variants.${index}.compareAtPrice`] ? 'danger600' : 'neutral500'
                        }
                        title={t('ecommerce.product.variant.compareAtPrice')}
                        style={{ textDecoration: 'line-through' }}
                      >
                        {formatCents(v.compareAtPrice, uiLocale)}
                      </Typography>
                    )}
                  </Flex>
                </Td>
                <Td>
                  <Typography textColor="neutral800">{`${v.tax}%`}</Typography>
                </Td>
                <Td>
                  <Typography textColor={v.stock < 0 ? 'danger600' : 'neutral800'}>
                    {v.stock}
                  </Typography>
                  {v.stockAdjustment ? (
                    <Typography variant="pi" textColor="neutral600">
                      {` (${v.stockAdjustment > 0 ? '+' : ''}${v.stockAdjustment})`}
                    </Typography>
                  ) : null}
                </Td>
                <Td>
                  {v.active ? (
                    <ToneBadge variant="success">
                      {t('ecommerce.product.variants.active')}
                    </ToneBadge>
                  ) : (
                    <ToneBadge>{t('ecommerce.product.variants.inactive')}</ToneBadge>
                  )}
                </Td>
                <Td>
                  <Flex gap={1} justifyContent="flex-end">
                    <IconButton
                      label={t('ecommerce.product.variants.edit')}
                      variant="ghost"
                      onClick={() => onEdit(index)}
                      disabled={disabled}
                    >
                      <Pencil />
                    </IconButton>
                    <IconButton
                      label={t('ecommerce.product.variants.remove')}
                      variant="ghost"
                      onClick={() =>
                        v.deletable === false ? setBlockedOpen(true) : setConfirmIndex(index)
                      }
                      disabled={disabled}
                    >
                      <Trash />
                    </IconButton>
                  </Flex>
                </Td>
              </VariantRow>
            );
          })}
        </Tbody>
      </Table>
      <Flex justifyContent="flex-start">
        <Button variant="secondary" onClick={onAdd} disabled={disabled}>
          {t('ecommerce.product.variants.add')}
        </Button>
      </Flex>
      <NoticeModal
        open={blockedOpen}
        title={t('ecommerce.product.variants.removeBlocked.title')}
        text={t('ecommerce.product.variants.removeBlocked.text')}
        okLabel={t('ecommerce.product.ok')}
        onClose={() => setBlockedOpen(false)}
      />
      <ConfirmModal
        open={confirmIndex !== null}
        title={t('ecommerce.product.variants.removeConfirm.title')}
        text={t('ecommerce.product.variants.removeConfirm.text')}
        confirm={{
          variant: 'danger-light',
          button: t('ecommerce.product.variants.remove'),
          action: () => {
            if (confirmIndex !== null && !disabled) onRemove(confirmIndex);
            setConfirmIndex(null);
          },
        }}
        cancel={{
          button: t('ecommerce.product.variants.removeConfirm.cancel'),
          action: () => setConfirmIndex(null),
        }}
      />
    </Flex>
  );
};

export { VariantsTable };
