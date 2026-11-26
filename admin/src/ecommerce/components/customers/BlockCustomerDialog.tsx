import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { Button, Dialog, Field, Flex, Textarea, Typography } from '@strapi/design-system';
import { WarningCircle } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';

export const BLOCK_NOTE_MAX = 1000;

type Props = {
  open: boolean;
  busy?: boolean;
  onConfirm: (note: string | null) => void;
  onCancel: () => void;
};

/** Danger confirmation to block a customer: lists the consequences and takes an internal note. */
const BlockCustomerDialog = ({ open, busy = false, onConfirm, onCancel }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) setNote('');
  }, [open]);

  const consequences = [
    'noLogin',
    'noRegister',
    'noRecovery',
    'noOrders',
    'sessionsEnded',
  ] as const;

  return (
    <Dialog.Root open={open} onOpenChange={(next: boolean) => !next && !busy && onCancel()}>
      <Dialog.Content>
        <Dialog.Header>{t('ecommerce.customers.block.title')}</Dialog.Header>
        <Dialog.Body icon={<WarningCircle fill="danger600" />}>
          <Flex direction="column" alignItems="stretch" gap={4} style={{ textAlign: 'left' }}>
            <Typography>{t('ecommerce.customers.block.intro')}</Typography>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {consequences.map((key) => (
                <li key={key}>
                  <Typography>{t(`ecommerce.customers.block.consequences.${key}`)}</Typography>
                </li>
              ))}
            </ul>
            <Field.Root name="blockNote" hint={t('ecommerce.customers.block.noteHint')}>
              <Field.Label>{t('ecommerce.customers.block.note')}</Field.Label>
              <Textarea
                value={note}
                maxLength={BLOCK_NOTE_MAX}
                onChange={(e: any) => setNote(e.target.value)}
              />
              <Field.Hint />
            </Field.Root>
          </Flex>
        </Dialog.Body>
        <Dialog.Footer>
          <Flex style={{ width: '100%', gap: '10px' }}>
            <Button fullWidth variant="tertiary" onClick={onCancel} disabled={busy}>
              {t('ecommerce.customers.block.cancel')}
            </Button>
            <Button
              fullWidth
              variant="danger-light"
              loading={busy}
              onClick={() => onConfirm(note.trim() || null)}
            >
              {t('ecommerce.customers.block.confirm')}
            </Button>
          </Flex>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
};

export { BlockCustomerDialog };
