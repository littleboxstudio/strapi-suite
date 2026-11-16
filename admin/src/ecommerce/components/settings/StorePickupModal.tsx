import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Box, Button, Flex, IconButton, Modal, Typography } from '@strapi/design-system';
import { Pencil, Trash } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import { NOTICE_BACKGROUND, NOTICE_TEXT } from '../orders/NoticeBar';
import { ActionConfirmModal } from '../ActionConfirmModal';
import { MarketRatesEditor, type RatesDraft } from './MarketRatesEditor';
import { MethodNameTaxFields } from './MethodNameTaxFields';
import { StoreModal } from './StoreModal';
import {
  STORE_FIELDS,
  draftToStorePickup,
  emptyStoreDraft,
  marketsWithoutStores,
  storePickupToDraft,
  storesOfRemovedMarkets,
  withoutMarketStores,
  withoutStoreErrors,
  type StoreDraft,
  type StoreField,
  type StorePickupDraft,
  type StorePickupErrors,
} from '../../utils/storePickupForm';
import type { ManualMethodDraft } from '../../utils/manualMethodForm';
import type { StorePickupConfig, StorePickupInput } from '../../settingsTypes';

/** Up to this many stores per market (as the server). */
const MAX_STORES = 100;

/** Mount it only while open: the draft is initialised once, from the props. */
type Props = {
  config: StorePickupConfig;
  locales: { code: string; name: string }[];
  defaultLocale: string;
  /** The store markets. */
  markets: string[];
  onClose: () => void;
  /** Saves the config. Resolves to the server errors (keyed like the draft), or null when saved. */
  onSave: (config: StorePickupInput) => Promise<StorePickupErrors | null>;
};

type EditingStore = { market: string; marketName: string; index: number | null; store: StoreDraft };

/** A removal that drops stores, waiting for confirmation: the stores it drops and the change. */
type PendingRemoval = { title: string; stores: StoreDraft[]; apply: () => void };

/**
 * The Store pickup configuration: the name per locale, the VAT rate, the rate table per market
 * and, inside each market, its stores. A market with rates and no store is not offered.
 */
const StorePickupModal = ({ config, locales, defaultLocale, markets, onClose, onSave }: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const t = (key: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(key) }, values);

  const [draft, setDraft] = useState<StorePickupDraft>(() =>
    storePickupToDraft(
      config,
      locales.map((l) => l.code),
      uiLocale,
      markets
    )
  );
  const [errors, setErrors] = useState<StorePickupErrors>({});
  const [errorRound, setErrorRound] = useState(0);
  const [locale, setLocale] = useState(defaultLocale);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<EditingStore | null>(null);
  const [removal, setRemoval] = useState<PendingRemoval | null>(null);

  const clearError = (path: string) =>
    setErrors((current) => {
      if (!(path in current)) return current;
      const { [path]: _removed, ...rest } = current;
      return rest;
    });

  const clearErrorsUnder = (prefix: string) =>
    setErrors((current) => {
      const keys = Object.keys(current).filter((k) => k === prefix || k.startsWith(`${prefix}.`));
      if (keys.length === 0) return current;
      const rest = { ...current };
      keys.forEach((k) => delete rest[k]);
      return rest;
    });

  const update = <K extends keyof ManualMethodDraft>(
    field: K,
    value: ManualMethodDraft[K],
    errorPath: string = field
  ) => {
    setDraft((d) => ({ ...d, [field]: value }));
    clearError(errorPath);
  };

  const showErrors = (map: StorePickupErrors) => {
    setErrors(map);
    setErrorRound((n) => n + 1);
    if (map[`name.${defaultLocale}`]) setLocale(defaultLocale);
  };

  const save = async () => {
    if (saving) return;
    const result = draftToStorePickup(draft, defaultLocale);
    if (!result.config) {
      showErrors(result.errors);
      return;
    }
    setSaving(true);
    try {
      const serverErrors = await onSave(result.config);
      if (serverErrors) showErrors(serverErrors);
    } finally {
      setSaving(false);
    }
  };

  const storeErrors = (market: string, index: number) => {
    const prefix = `stores.${market}.${index}.`;
    const found: Partial<Record<StoreField, string>> = {};
    STORE_FIELDS.forEach((field) => {
      if (errors[`${prefix}${field}`]) found[field] = errors[`${prefix}${field}`];
    });
    return found;
  };

  const setStores = (market: string, change: (stores: StoreDraft[]) => StoreDraft[]) =>
    setDraft((d) => ({ ...d, stores: { ...d.stores, [market]: change(d.stores[market] ?? []) } }));

  const saveStore = ({ market, index }: EditingStore, store: StoreDraft) => {
    if (index === null) {
      setStores(market, (list) => [...list, store]);
      clearError(`stores.${market}`);
    } else {
      setStores(market, (list) => list.map((s, i) => (i === index ? store : s)));
      clearErrorsUnder(`stores.${market}.${index}`);
    }
    setEditing(null);
  };

  const removeStore = (market: string, index: number) => {
    setStores(market, (list) => list.filter((_, i) => i !== index));
    // The indexes of the next stores change: their server errors no longer match.
    setErrors((current) => withoutStoreErrors(current, market));
  };

  /** Removing a store asks first: what was typed in it is lost. */
  const askRemoveStore = (market: string, index: number, store: StoreDraft) =>
    setRemoval({
      title: t('ecommerce.settings.storePickup.removeStore.title'),
      stores: [store],
      apply: () => removeStore(market, index),
    });

  /**
   * The rates editor's changes. One that deselects markets with stores asks first, then drops
   * those stores with the markets.
   */
  const changeRates = (change: (current: RatesDraft) => RatesDraft) => {
    const next = { ...draft, ...change(draft) };
    const lost = storesOfRemovedMarkets(draft, next.markets);
    const apply = () => {
      const dropped = [...new Set(lost.map((r) => r.market))];
      setDraft((d) => withoutMarketStores({ ...d, ...change(d) }, dropped));
      setErrors((current) => dropped.reduce((acc, m) => withoutStoreErrors(acc, m), current));
    };
    if (!lost.length) {
      setDraft((d) => ({ ...d, ...change(d) }));
      return;
    }
    setRemoval({
      title: t('ecommerce.settings.storePickup.removeMarket.title'),
      stores: lost.map((r) => r.store),
      apply,
    });
  };

  /** Selected markets with rates and no store: not offered (warned in their card). */
  const unserved = marketsWithoutStores(draft);

  const marketStores = (market: string, marketName: string) => {
    const stores = draft.stores[market] ?? [];
    const listError = errors[`stores.${market}`];
    return (
      <Flex direction="column" alignItems="stretch" gap={2} paddingTop={2}>
        <Flex justifyContent="space-between" alignItems="center" gap={2}>
          <Typography variant="sigma" textColor="neutral600" tag="h4">
            {t('ecommerce.settings.storePickup.stores.title')}
          </Typography>
          <Button
            variant="secondary"
            size="S"
            disabled={stores.length >= MAX_STORES}
            aria-label={`${t('ecommerce.settings.storePickup.stores.add')}: ${marketName}`}
            onClick={() =>
              setEditing({ market, marketName, index: null, store: emptyStoreDraft() })
            }
          >
            {t('ecommerce.settings.storePickup.stores.add')}
          </Button>
        </Flex>
        {unserved.includes(market) ? (
          <Box padding={3} hasRadius style={{ background: NOTICE_BACKGROUND }}>
            <Typography variant="omega" style={{ color: NOTICE_TEXT }}>
              {t('ecommerce.settings.storePickup.noStores')}
            </Typography>
          </Box>
        ) : (
          <Flex direction="column" alignItems="stretch" gap={1}>
            {stores.map((store, index) => {
              const invalid = Object.keys(storeErrors(market, index)).length > 0;
              const line = [store.address, store.address2].filter((v) => v.trim()).join(', ');
              return (
                <Box
                  key={store.key}
                  background="neutral0"
                  hasRadius
                  borderColor={invalid ? 'danger600' : 'neutral200'}
                  paddingTop={2}
                  paddingBottom={2}
                  paddingLeft={3}
                  paddingRight={2}
                >
                  <Flex justifyContent="space-between" alignItems="center" gap={2}>
                    <Flex
                      direction="column"
                      alignItems="flex-start"
                      gap={0}
                      style={{ minWidth: 0 }}
                    >
                      <Typography variant="omega" fontWeight="bold" textColor="neutral800">
                        {store.name}
                      </Typography>
                      <Typography variant="pi" textColor="neutral600">
                        {`${line} · ${store.postalCode} ${store.city}`}
                      </Typography>
                      {invalid && (
                        <Typography variant="pi" textColor="danger600" role="alert">
                          {t('ecommerce.settings.storePickup.stores.invalid')}
                        </Typography>
                      )}
                    </Flex>
                    <Flex gap={1} shrink={0}>
                      <IconButton
                        label={`${t('ecommerce.settings.storePickup.stores.edit')}: ${store.name}`}
                        variant="ghost"
                        onClick={() => setEditing({ market, marketName, index, store })}
                      >
                        <Pencil />
                      </IconButton>
                      <IconButton
                        label={`${t('ecommerce.settings.storePickup.stores.remove')}: ${store.name}`}
                        variant="ghost"
                        onClick={() => askRemoveStore(market, index, store)}
                      >
                        <Trash />
                      </IconButton>
                    </Flex>
                  </Flex>
                </Box>
              );
            })}
          </Flex>
        )}
        {listError && (
          <Typography variant="pi" textColor="danger600" role="alert">
            {t(`ecommerce.settings.errors.${listError}`)}
          </Typography>
        )}
      </Flex>
    );
  };

  return (
    <>
      <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
        <Modal.Content>
          <Modal.Header>
            <Modal.Title>{t('ecommerce.settings.storePickup.title')}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Flex direction="column" alignItems="stretch" gap={5}>
              <MethodNameTaxFields
                locales={locales}
                defaultLocale={defaultLocale}
                locale={locale}
                onLocaleChange={setLocale}
                draft={draft}
                errors={errors}
                update={update}
              />
              <MarketRatesEditor
                markets={markets}
                value={draft}
                onChange={changeRates}
                errors={errors}
                errorRound={errorRound}
                clearError={clearError}
                clearErrorsUnder={clearErrorsUnder}
                required={false}
                emptyText={t('ecommerce.settings.storePickup.noMarketsSelected')}
                marketFooter={marketStores}
              />
            </Flex>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onClick={onClose}>
              {t('ecommerce.settings.cancel')}
            </Button>
            <Button variant="secondary" onClick={save} loading={saving} disabled={markets.length === 0}>
              {t('ecommerce.settings.save')}
            </Button>
          </Modal.Footer>
        </Modal.Content>
      </Modal.Root>
      {/* Outside the configuration dialog, so it opens on top with its own overlay. */}
      {editing && (
        <StoreModal
          store={editing.store}
          isNew={editing.index === null}
          marketName={editing.marketName}
          initialErrors={
            editing.index === null ? undefined : storeErrors(editing.market, editing.index)
          }
          onClose={() => setEditing(null)}
          onSave={(store) => saveStore(editing, store)}
        />
      )}
      {/* Outside the configuration dialog too, for the same reason. */}
      <ActionConfirmModal
        open={removal !== null}
        title={removal?.title ?? ''}
        text={
          <Flex direction="column" gap={2}>
            <Typography>
              {t('ecommerce.settings.storePickup.removeStores.text', { count: removal?.stores.length ?? 0 })}
            </Typography>
            {removal?.stores.map((store) => (
              <Typography key={store.key} fontWeight="bold">
                {[store.name, store.city].filter((v) => v.trim()).join(' · ')}
              </Typography>
            ))}
          </Flex>
        }
        confirmLabel={t('ecommerce.settings.storePickup.removeStores.confirm')}
        cancelLabel={t('ecommerce.settings.cancel')}
        onConfirm={() => {
          removal?.apply();
          setRemoval(null);
        }}
        onCancel={() => setRemoval(null)}
      />
    </>
  );
};

export { StorePickupModal };
