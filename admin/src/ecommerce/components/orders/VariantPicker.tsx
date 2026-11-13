import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  Loader,
  Popover,
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

/**
 * Searches active variants by product name or SKU; the results open in a dropdown under the field.
 * Variants without stock are listed but cannot be added.
 */
const VariantPicker = ({ locale, onAdd, disabled }: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const [term, setTerm] = useState('');
  const [results, setResults] = useState<VariantSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [searched, setSearched] = useState(false);
  /** The results dropdown; it opens while typing and closes on add, Escape or a click outside. */
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

  const add = (variant: VariantSearchResult) => {
    onAdd(variant);
    setOpen(false);
    setTerm('');
  };

  const hasContent = loading || error || searched || results.length > 0;

  return (
    <Popover.Root open={open && !!term.trim() && hasContent} onOpenChange={setOpen}>
      <Popover.Anchor ref={anchorRef}>
        <Field.Root name="variant-search">
          <Field.Label>{t('ecommerce.orders.picker.label')}</Field.Label>
          <TextInput
            startAction={<Search />}
            placeholder={t('ecommerce.orders.picker.placeholder')}
            value={term}
            disabled={disabled}
            autoComplete="off"
            aria-haspopup="listbox"
            aria-expanded={open && !!term.trim() && hasContent}
            onChange={(e: any) => {
              setTerm(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
          />
        </Field.Root>
      </Popover.Anchor>
      <Popover.Content
        align="start"
        sideOffset={4}
        // Typing stays in the search field: the dropdown never takes the focus.
        onOpenAutoFocus={(e: Event) => e.preventDefault()}
        onInteractOutside={(e: any) => {
          if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
        style={{ width: 'var(--radix-popover-trigger-width, var(--radix-popper-anchor-width))', minWidth: 320 }}
      >
        <Box style={{ maxHeight: 320, overflowY: 'auto' }} role="listbox">
          {loading && results.length === 0 && (
            <Flex justifyContent="center" padding={3}>
              <Loader small />
            </Flex>
          )}

          {error && (
            <Box padding={3}>
              <Typography textColor="danger600">{t('ecommerce.orders.picker.error')}</Typography>
            </Box>
          )}

          {!loading && searched && !error && results.length === 0 && (
            <Box padding={3}>
              <Typography variant="omega" textColor="neutral600">
                {t('ecommerce.orders.picker.noResults')}
              </Typography>
            </Box>
          )}

          {results.map((v, i) => {
            const outOfStock = v.stock <= 0;
            return (
              <Flex
                key={v.variantId}
                role="option"
                aria-disabled={disabled || outOfStock}
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
                    onClick={() => add(v)}
                  >
                    {t('ecommerce.orders.picker.add')}
                  </Button>
                </Flex>
              </Flex>
            );
          })}
        </Box>
      </Popover.Content>
    </Popover.Root>
  );
};

export default VariantPicker;
