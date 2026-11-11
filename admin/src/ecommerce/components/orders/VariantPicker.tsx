import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  Loader,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { Plus, Search } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import SearchOrderVariants from '../../usecases/orders/searchOrderVariants';
import { formatCents } from '../../utils/money';
import type { VariantSearchResult } from '../../orderTypes';

const SEARCH_DEBOUNCE_MS = 300;

type Props = {
  locale?: string;
  onAdd: (variant: VariantSearchResult) => void;
  disabled?: boolean;
};

/** Searches active variants by product name or SKU; variants without stock are listed but cannot be added. */
const VariantPicker = ({ locale, onAdd, disabled }: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const [term, setTerm] = useState('');
  const [results, setResults] = useState<VariantSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [searched, setSearched] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const q = term.trim();
    if (!q) {
      requestId.current++;
      setResults([]);
      setLoading(false);
      setSearched(false);
      setError(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      const current = ++requestId.current;
      setLoading(true);
      new SearchOrderVariants()
        .execute(q, locale || undefined)
        .then((data) => {
          if (current !== requestId.current) return;
          setResults(data);
          setError(false);
          setSearched(true);
          setLoading(false);
        })
        .catch(() => {
          if (current !== requestId.current) return;
          setError(true);
          setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term, locale]);

  return (
    <Flex direction="column" alignItems="stretch" gap={3}>
      <Field.Root name="variant-search">
        <Field.Label>{t('ecommerce.orders.picker.label')}</Field.Label>
        <TextInput
          startAction={<Search />}
          placeholder={t('ecommerce.orders.picker.placeholder')}
          value={term}
          disabled={disabled}
          onChange={(e: any) => setTerm(e.target.value)}
        />
      </Field.Root>

      {loading && (
        <Flex justifyContent="center" padding={2}>
          <Loader small />
        </Flex>
      )}

      {error && <Typography textColor="danger600">{t('ecommerce.orders.picker.error')}</Typography>}

      {!loading && searched && !error && results.length === 0 && (
        <Typography variant="omega" textColor="neutral600">
          {t('ecommerce.orders.picker.noResults')}
        </Typography>
      )}

      {results.length > 0 && (
        <Box
          borderColor="neutral200"
          hasRadius
          style={{ maxHeight: 280, overflowY: 'auto', opacity: loading ? 0.5 : 1 }}
        >
          {results.map((v, i) => {
            const outOfStock = v.stock <= 0;
            return (
              <Flex
                key={v.variantId}
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
                    {v.option ? `${v.name} — ${v.option}` : v.name}
                  </Typography>
                  <Typography variant="pi" textColor="neutral600">
                    {v.sku} · {formatCents(v.price, uiLocale)}
                  </Typography>
                </Flex>
                <Flex gap={3} alignItems="center" shrink={0}>
                  <Badge variant={outOfStock ? 'danger' : 'neutral'} size="S">
                    {outOfStock
                      ? t('ecommerce.orders.picker.outOfStock')
                      : t('ecommerce.orders.picker.stock', { count: v.stock })}
                  </Badge>
                  <Button
                    size="S"
                    variant="secondary"
                    startIcon={<Plus />}
                    disabled={disabled || outOfStock}
                    onClick={() => onAdd(v)}
                  >
                    {t('ecommerce.orders.picker.add')}
                  </Button>
                </Flex>
              </Flex>
            );
          })}
        </Box>
      )}
    </Flex>
  );
};

export default VariantPicker;
