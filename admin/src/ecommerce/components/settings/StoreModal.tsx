import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Button, Field, Grid, Modal, TextInput } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import {
  STORE_FIELDS,
  validateStoreDraft,
  type StoreDraft,
  type StoreField,
} from '../../utils/storePickupForm';

/** Mount it only while open: the draft is initialised once, from the props. */
type Props = {
  store: StoreDraft;
  /** True for a store not yet in the list. */
  isNew: boolean;
  /** The market's display name (in the title). */
  marketName: string;
  /** Errors of this store (from the last save), keyed by field. */
  initialErrors?: Partial<Record<StoreField, string>>;
  onClose: () => void;
  onSave: (store: StoreDraft) => void;
};

const COLUMNS: Record<StoreField, number> = {
  name: 12,
  address: 12,
  address2: 12,
  postalCode: 4,
  city: 8,
};

/** Adds or edits one store of a market. The store is saved with the module configuration. */
const StoreModal = ({ store, isNew, marketName, initialErrors, onClose, onSave }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const [draft, setDraft] = useState<StoreDraft>(store);
  const [errors, setErrors] = useState<Partial<Record<StoreField, string>>>(initialErrors ?? {});

  const errorText = (field: StoreField) => {
    const code = errors[field];
    if (!code) return undefined;
    return code === 'STORE_MARKET_MISMATCH'
      ? t('ecommerce.settings.errors.STORE_MARKET_MISMATCH', { market: marketName })
      : t(`ecommerce.settings.errors.${code}`);
  };

  const save = () => {
    const found = validateStoreDraft(draft);
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    onSave(draft);
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>
            {t(
              isNew
                ? 'ecommerce.settings.storePickup.store.addTitle'
                : 'ecommerce.settings.storePickup.store.editTitle',
              {
                market: marketName,
              }
            )}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Grid.Root gap={4}>
            {STORE_FIELDS.map((field) => (
              <Grid.Item
                key={field}
                col={COLUMNS[field]}
                s={12}
                direction="column"
                alignItems="stretch"
              >
                <Field.Root name={field} error={errorText(field)} required={field !== 'address2'}>
                  <Field.Label>
                    {t(`ecommerce.settings.storePickup.store.fields.${field}`)}
                  </Field.Label>
                  <TextInput
                    value={draft[field]}
                    onChange={(e: any) => {
                      const value = e.target.value;
                      setDraft((d) => ({ ...d, [field]: value }));
                      setErrors(({ [field]: _removed, ...rest }) => rest);
                    }}
                  />
                  <Field.Error />
                </Field.Root>
              </Grid.Item>
            ))}
          </Grid.Root>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose}>
            {t('ecommerce.settings.cancel')}
          </Button>
          <Button variant="secondary" onClick={save}>{t('ecommerce.settings.storePickup.store.done')}</Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export { StoreModal };
