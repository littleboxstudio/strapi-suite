import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { Box, Button, Field, Flex, IconButton, Loader, TextInput, Typography } from '@strapi/design-system';
import { Cross, Search } from '@strapi/icons';
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
  /** Names of what was just chosen, so the chips can show them. */
  onLabels: (labels: PromotionLabels) => void;
  /** Gift variants: only "this variant" can be chosen. */
  variantsOnly?: boolean;
  /** Most entries that can be chosen (gift variants: 20). */
  max?: number;
  error?: string;
  disabled?: boolean;
};

/**
 * Chosen products and variants as removable chips, and a catalogue search (`catalog-search`)
 * whose results can be added as "this variant" or "whole product".
 */
const TargetPicker = ({ label, target, labels, onChange, onLabels, variantsOnly, max, error, disabled }: Props) => {
  const { formatMessage, locale } = useIntl();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);

  const [term, setTerm] = useState('');
  const [results, setResults] = useState<PromotionCatalogResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searched, setSearched] = useState(false);
  const requestId = useRef(0);

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

  const variantName = (id: number) => {
    const v = labels.variants[id];
    if (!v) return t('ecommerce.promotions.form.target.unknownVariant', { id });
    return v.option ? `${v.name} — ${v.option}` : v.name;
  };
  const productName = (id: number) =>
    t('ecommerce.promotions.form.target.product', {
      name: labels.products[id] ?? t('ecommerce.promotions.form.target.unknownProduct', { id }),
    });

  const addVariant = (r: PromotionCatalogResult) => {
    if (target.variantIds.includes(r.variantId) || full) return;
    onLabels({
      products: labels.products,
      variants: { ...labels.variants, [r.variantId]: { name: r.name, option: r.option, sku: r.sku } },
    });
    onChange({ ...target, variantIds: [...target.variantIds, r.variantId] });
  };
  const addProduct = (r: PromotionCatalogResult) => {
    if (target.productIds.includes(r.productId) || full) return;
    onLabels({ products: { ...labels.products, [r.productId]: r.name }, variants: labels.variants });
    onChange({ ...target, productIds: [...target.productIds, r.productId] });
  };

  const chip = (key: string, name: string, onRemove: () => void) => (
    <Flex
      key={key}
      gap={1}
      paddingLeft={2}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      background="neutral100"
      hasRadius
      borderColor="neutral200"
    >
      <Typography variant="pi" textColor="neutral800">
        {name}
      </Typography>
      {!disabled && (
        <IconButton
          size="XS"
          variant="ghost"
          label={t('ecommerce.promotions.form.target.remove', { name })}
          onClick={onRemove}
        >
          <Cross />
        </IconButton>
      )}
    </Flex>
  );

  return (
    <Field.Root name="target" error={error}>
      <Field.Label>{label ?? t('ecommerce.promotions.form.target.label')}</Field.Label>
      <Flex direction="column" alignItems="stretch" gap={2}>
        <Flex gap={2} wrap="wrap">
          {count === 0 && (
            <Typography variant="pi" textColor="neutral500">
              {t('ecommerce.promotions.form.target.empty')}
            </Typography>
          )}
          {target.productIds.map((id) =>
            chip(`p-${id}`, productName(id), () =>
              onChange({ ...target, productIds: target.productIds.filter((x) => x !== id) })
            )
          )}
          {target.variantIds.map((id) =>
            chip(`v-${id}`, variantName(id), () =>
              onChange({ ...target, variantIds: target.variantIds.filter((x) => x !== id) })
            )
          )}
        </Flex>

        {!disabled && !full && (
          <TextInput
            aria-label={t('ecommerce.promotions.form.target.search')}
            startAction={<Search />}
            placeholder={t('ecommerce.promotions.form.target.placeholder')}
            value={term}
            onChange={(e: any) => setTerm(e.target.value)}
          />
        )}

        {loading && (
          <Flex justifyContent="center" padding={2}>
            <Loader small />
          </Flex>
        )}
        {searchError && (
          <Typography variant="pi" textColor="danger600">
            {t('ecommerce.promotions.form.target.error')}
          </Typography>
        )}
        {!loading && searched && !searchError && results.length === 0 && (
          <Typography variant="pi" textColor="neutral600">
            {t('ecommerce.promotions.form.target.noResults')}
          </Typography>
        )}
        {!disabled && results.length > 0 && (
          <Box borderColor="neutral200" hasRadius style={{ maxHeight: 240, overflowY: 'auto' }}>
            {results.map((r, i) => (
              <Flex
                key={r.variantId}
                justifyContent="space-between"
                alignItems="center"
                gap={3}
                paddingTop={2}
                paddingBottom={2}
                paddingLeft={3}
                paddingRight={3}
                style={i > 0 ? { borderTop: '1px solid var(--strapi-neutral-150, #eaeaef)' } : {}}
              >
                <Flex direction="column" alignItems="flex-start" style={{ minWidth: 0 }}>
                  <Typography textColor="neutral800" fontWeight="semiBold" ellipsis>
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
                    disabled={full || target.variantIds.includes(r.variantId)}
                    onClick={() => addVariant(r)}
                  >
                    {t('ecommerce.promotions.form.target.thisVariant')}
                  </Button>
                  {!variantsOnly && (
                    <Button
                      size="S"
                      variant="tertiary"
                      disabled={full || target.productIds.includes(r.productId)}
                      onClick={() => addProduct(r)}
                    >
                      {t('ecommerce.promotions.form.target.wholeProduct')}
                    </Button>
                  )}
                </Flex>
              </Flex>
            ))}
          </Box>
        )}
      </Flex>
      <Field.Error />
    </Field.Root>
  );
};

export default TargetPicker;
