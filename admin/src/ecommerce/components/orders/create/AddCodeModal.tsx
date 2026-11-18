import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Button,
  Checkbox,
  Field,
  Flex,
  Loader,
  Modal,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  TextInput,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Search } from '@strapi/icons';
import { getTranslation } from '../../../../core/utils/getTranslation';
import SearchPromotionCodes from '../../../usecases/orders/searchPromotionCodes';
import { formatCents } from '../../../utils/money';
import { promotionDisplayName, type PromotionLocales } from '../../../utils/orderDetail';
import { describeBenefit } from '../../../utils/promotionForm';
import { MAX_PROMOTION_CODES, type PromotionCodeSearchResult } from '../../../orderTypes';
import EmptyNote from '../EmptyNote';

const SEARCH_DEBOUNCE_MS = 250;

type Props = {
  /** The codes already on the order (checked and locked here). */
  codes: string[];
  locales: PromotionLocales;
  onClose: () => void;
  /** The codes checked, in the order they were checked. */
  onAdd: (codes: string[]) => void;
};

const cell = { verticalAlign: 'middle' } as const;
const WRAP = { whiteSpace: 'normal', overflowWrap: 'anywhere' } as const;

/**
 * Create order's Add code: a search of the running promotion codes from the first letter, the
 * matches in a table below, and several can be checked (up to the order's limit). The quote then
 * checks each one as it does today.
 */
const AddCodeModal = ({ codes, locales, onClose, onAdd }: Props) => {
  const { formatMessage, locale } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const money = (cents: number) => formatCents(cents, locale);

  const [term, setTerm] = useState('');
  const [results, setResults] = useState<PromotionCodeSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [searched, setSearched] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const requestId = useRef(0);
  const full = codes.length + picked.length >= MAX_PROMOTION_CODES;

  useEffect(() => {
    const q = term.trim();
    if (!q) {
      requestId.current++;
      setResults([]);
      setSearching(false);
      setSearched(false);
      setFailed(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      const current = ++requestId.current;
      setSearching(true);
      new SearchPromotionCodes()
        .execute(q)
        .then((found) => {
          if (current !== requestId.current) return;
          setResults(found);
          setFailed(false);
          setSearched(true);
          setSearching(false);
        })
        .catch(() => {
          if (current !== requestId.current) return;
          setFailed(true);
          setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const toggle = (code: string) =>
    setPicked((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]));

  const table = () => {
    if (!term.trim()) return null;
    if (failed) {
      return (
        <Typography variant="omega" textColor="danger600">
          {t('ecommerce.orders.new.codeSearchError')}
        </Typography>
      );
    }
    if (searching && !results.length) {
      return (
        <Flex justifyContent="center" padding={4}>
          <Loader small />
        </Flex>
      );
    }
    if (searched && !results.length)
      return <EmptyNote>{t('ecommerce.orders.new.codeSearchNone')}</EmptyNote>;
    return (
      <Table colCount={4} rowCount={results.length + 1} style={{ opacity: searching ? 0.5 : 1 }}>
        <Thead>
          <Tr>
            <Th style={{ width: 56 }}>
              <Typography variant="sigma">
                {t('ecommerce.orders.discounts.columns.select')}
              </Typography>
            </Th>
            <Th>
              <Typography variant="sigma">{t('ecommerce.orders.new.codeColumns.code')}</Typography>
            </Th>
            <Th>
              <Typography variant="sigma">
                {t('ecommerce.orders.promotions.columns.promotion')}
              </Typography>
            </Th>
            <Th>
              <Typography variant="sigma">
                {t('ecommerce.orders.promotions.columns.benefit')}
              </Typography>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {results.map((r) => {
            const added = codes.includes(r.code);
            const checked = added || picked.includes(r.code);
            const name = promotionDisplayName(r, locales.locale, locales.defaultLocale) ?? r.name;
            return (
              <Tr key={r.code}>
                <Td style={cell}>
                  <Checkbox
                    checked={checked}
                    disabled={added || (!checked && full)}
                    aria-label={r.code}
                    onCheckedChange={() => toggle(r.code)}
                  />
                </Td>
                <Td style={cell}>
                  <Typography textColor="neutral800" fontWeight="semiBold">
                    {r.code}
                  </Typography>
                </Td>
                <Td style={{ ...cell, ...WRAP }}>
                  <Flex direction="column" alignItems="flex-start" gap={1}>
                    <Typography textColor="neutral800">{name}</Typography>
                    {name !== r.name && (
                      <Typography variant="pi" textColor="neutral500">
                        {t('ecommerce.orders.promotions.internalName', { name: r.name })}
                      </Typography>
                    )}
                  </Flex>
                </Td>
                <Td style={{ ...cell, maxWidth: 320, ...WRAP }}>
                  <Flex direction="column" alignItems="flex-start" gap={1}>
                    {r.benefits.map((b, i) => (
                      <Typography key={i} textColor="neutral800" style={WRAP}>
                        {describeBenefit(b, money, t)}
                      </Typography>
                    ))}
                  </Flex>
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>
    );
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.orders.new.addCode')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Field.Root name="code-search">
              <Field.Label>{t('ecommerce.orders.new.codeSearch')}</Field.Label>
              <TextInput
                startAction={<Search />}
                value={term}
                autoComplete="off"
                autoFocus
                onChange={(e: any) => setTerm(e.target.value)}
              />
            </Field.Root>
            {table()}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose}>
            {t('ecommerce.orders.discounts.close')}
          </Button>
          <Button
            variant="secondary"
            disabled={!picked.length}
            onClick={() => {
              onAdd(picked);
              onClose();
            }}
          >
            {t('ecommerce.orders.new.addCodes', { count: picked.length })}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default AddCodeModal;
