import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Box,
  Button,
  Field,
  Flex,
  Loader,
  Popover,
  Table,
  Tbody,
  Td,
  TextInput,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Search } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import SearchPromotionCatalog from '../../usecases/promotions/searchPromotionCatalog';
import { formatCents } from '../../utils/money';
import type { ProductTarget, PromotionCatalogResult, PromotionLabels } from '../../promotionTypes';

const SEARCH_DEBOUNCE_MS = 300;

type Props = {
  /** Field label (defaults to "Products"). */
  label?: string;
  target: ProductTarget;
  labels: PromotionLabels;
  onChange: (target: ProductTarget) => void;
  /** Names of what was just chosen, so the table can show them. */
  onLabels: (labels: PromotionLabels) => void;
  /** Gift variants: only "this variant" can be chosen. */
  variantsOnly?: boolean;
  /** Most entries that can be chosen (gift variants: 20). */
  max?: number;
  error?: string;
  /** Disables the controls (e.g. while saving) without hiding them. */
  disabled?: boolean;
  /** Hides the search and the remove buttons (no promotions.manage). */
  readOnly?: boolean;
};

/**
 * A catalogue search on top and the chosen products and variants in a table below it (each with
 * Remove). The search (`catalog-search`) opens a floating list whose results can be added as
 * "this variant" or "whole product"; it is disabled once `max` entries are chosen.
 */
const TargetPicker = ({
  label,
  target,
  labels,
  onChange,
  onLabels,
  variantsOnly,
  max,
  error,
  disabled,
  readOnly,
}: Props) => {
  const { formatMessage, locale } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const [term, setTerm] = useState('');
  const [results, setResults] = useState<PromotionCatalogResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searched, setSearched] = useState(false);
  const [open, setOpen] = useState(false);
  const requestId = useRef(0);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = term.trim();
    if (!q) {
      requestId.current++;
      setResults([]);
      setLoading(false);
      setSearched(false);
      setSearchError(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      const current = ++requestId.current;
      setLoading(true);
      new SearchPromotionCatalog()
        .execute(q)
        .then((data) => {
          if (current !== requestId.current) return;
          setResults(data);
          setSearchError(false);
          setSearched(true);
          setLoading(false);
        })
        .catch(() => {
          if (current !== requestId.current) return;
          setSearchError(true);
          setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const count = target.productIds.length + target.variantIds.length;
  const full = max !== undefined && count >= max;
  const hasContent = loading || searchError || searched || results.length > 0;

  const variantName = (id: number) => {
    const v = labels.variants[id];
    if (!v) return t('ecommerce.promotions.form.target.unknownVariant', { id });
    return v.option ? `${v.name} — ${v.option}` : v.name;
  };
  const T = 'ecommerce.promotions.form.target';
  type Row = {
    key: string;
    name: string;
    sku: string | null;
    scope: 'product' | 'variant';
    remove: () => void;
  };
  const rows: Row[] = [
    ...target.productIds.map((id) => ({
      key: `p-${id}`,
      name: labels.products[id] ?? t(`${T}.unknownProduct`, { id }),
      sku: null,
      scope: 'product' as const,
      remove: () => onChange({ ...target, productIds: target.productIds.filter((x) => x !== id) }),
    })),
    ...target.variantIds.map((id) => ({
      key: `v-${id}`,
      name: variantName(id),
      sku: labels.variants[id]?.sku ?? null,
      scope: 'variant' as const,
      remove: () => onChange({ ...target, variantIds: target.variantIds.filter((x) => x !== id) }),
    })),
  ];

  const addVariant = (r: PromotionCatalogResult) => {
    if (target.variantIds.includes(r.variantId) || full) return;
    onLabels({
      products: labels.products,
      variants: {
        ...labels.variants,
        [r.variantId]: { name: r.name, option: r.option, sku: r.sku },
      },
    });
    onChange({ ...target, variantIds: [...target.variantIds, r.variantId] });
  };
  const addProduct = (r: PromotionCatalogResult) => {
    if (target.productIds.includes(r.productId) || full) return;
    onLabels({
      products: { ...labels.products, [r.productId]: r.name },
      variants: labels.variants,
    });
    onChange({ ...target, productIds: [...target.productIds, r.productId] });
  };

  return (
    <Field.Root name="target" error={error}>
      <Field.Label>{label ?? t('ecommerce.promotions.form.target.label')}</Field.Label>
      <Flex direction="column" alignItems="stretch" gap={2}>
        {!readOnly && (
          <Popover.Root open={open && !!term.trim() && hasContent} onOpenChange={setOpen}>
            <Popover.Anchor ref={anchorRef}>
              {/* 38px tall, as the other search bars. */}
              <TextInput
                aria-label={t('ecommerce.promotions.form.target.search')}
                startAction={<Search />}
                placeholder={t('ecommerce.promotions.form.target.placeholder')}
                value={term}
                disabled={disabled || full}
                autoComplete="off"
                aria-haspopup="listbox"
                aria-expanded={open && !!term.trim() && hasContent}
                style={{ height: 38 }}
                onChange={(e: any) => {
                  setTerm(e.target.value);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
              />
            </Popover.Anchor>
            <Popover.Content
              align="start"
              sideOffset={4}
              // Typing stays in the search field: the dropdown never takes the focus.
              onOpenAutoFocus={(e: Event) => e.preventDefault()}
              onInteractOutside={(e: any) => {
                if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
              }}
              style={{
                width: 'var(--radix-popover-trigger-width, var(--radix-popper-anchor-width))',
                minWidth: 320,
              }}
            >
              <Box style={{ maxHeight: 320, overflowY: 'auto' }} role="listbox">
                {loading && results.length === 0 && (
                  <Flex justifyContent="center" padding={3}>
                    <Loader small />
                  </Flex>
                )}
                {searchError && (
                  <Box padding={3}>
                    <Typography textColor="danger600">
                      {t('ecommerce.promotions.form.target.error')}
                    </Typography>
                  </Box>
                )}
                {!loading && searched && !searchError && results.length === 0 && (
                  <Box padding={3}>
                    <Typography variant="omega" textColor="neutral600">
                      {t('ecommerce.promotions.form.target.noResults')}
                    </Typography>
                  </Box>
                )}
                {results.map((r, i) => (
                  <Flex
                    key={r.variantId}
                    role="option"
                    aria-selected={false}
                    justifyContent="space-between"
                    alignItems="center"
                    gap={3}
                    paddingTop={2}
                    paddingBottom={2}
                    paddingLeft={3}
                    paddingRight={3}
                    // Strapi's row divider: 1px in the theme's border colour (light and dark).
                    borderColor="neutral150"
                    style={{
                      opacity: loading ? 0.5 : 1,
                      borderStyle: 'solid',
                      borderWidth: i > 0 ? '1px 0 0 0' : 0,
                    }}
                  >
                    <Flex
                      direction="column"
                      alignItems="flex-start"
                      style={{ minWidth: 0, flex: 1 }}
                    >
                      <Typography
                        textColor="neutral800"
                        fontWeight="semiBold"
                        style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}
                      >
                        {r.option ? `${r.name} — ${r.option}` : r.name}
                      </Typography>
                      <Typography variant="pi" textColor="neutral600">
                        {r.sku} · {formatCents(r.price, locale)}
                      </Typography>
                    </Flex>
                    <Flex gap={2} shrink={0}>
                      <Button
                        size="S"
                        variant="secondary"
                        disabled={disabled || full || target.variantIds.includes(r.variantId)}
                        onClick={() => addVariant(r)}
                      >
                        {t('ecommerce.promotions.form.target.thisVariant')}
                      </Button>
                      {!variantsOnly && (
                        <Button
                          size="S"
                          variant="tertiary"
                          disabled={disabled || full || target.productIds.includes(r.productId)}
                          onClick={() => addProduct(r)}
                        >
                          {t('ecommerce.promotions.form.target.wholeProduct')}
                        </Button>
                      )}
                    </Flex>
                  </Flex>
                ))}
              </Box>
            </Popover.Content>
          </Popover.Root>
        )}

        {count > 0 && (
          <Table colCount={(readOnly ? 2 : 3) + (variantsOnly ? 0 : 1)} rowCount={count + 1}>
            <Thead>
              <Tr>
                <Th>
                  <Typography variant="sigma">{t(`${T}.columns.name`)}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t(`${T}.columns.sku`)}</Typography>
                </Th>
                {!variantsOnly && (
                  <Th>
                    <Typography variant="sigma">{t(`${T}.columns.scope`)}</Typography>
                  </Th>
                )}
                {!readOnly && (
                  <Th>
                    <Flex justifyContent="flex-end" style={{ width: '100%' }}>
                      <Typography variant="sigma">{t(`${T}.columns.actions`)}</Typography>
                    </Flex>
                  </Th>
                )}
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((row) => (
                <Tr key={row.key}>
                  <Td style={{ whiteSpace: 'normal' }}>
                    <Typography textColor="neutral800" style={{ wordBreak: 'break-word' }}>
                      {row.name}
                    </Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">{row.sku ?? '—'}</Typography>
                  </Td>
                  {!variantsOnly && (
                    <Td>
                      <Typography textColor="neutral800">{t(`${T}.scope.${row.scope}`)}</Typography>
                    </Td>
                  )}
                  {!readOnly && (
                    <Td>
                      <Flex justifyContent="flex-end">
                        <Button
                          size="S"
                          variant="danger-light"
                          disabled={disabled}
                          aria-label={t(`${T}.remove`, { name: row.name })}
                          onClick={row.remove}
                        >
                          {t(`${T}.removeRow`)}
                        </Button>
                      </Flex>
                    </Td>
                  )}
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Flex>
      <Field.Error />
    </Field.Root>
  );
};

export default TargetPicker;
