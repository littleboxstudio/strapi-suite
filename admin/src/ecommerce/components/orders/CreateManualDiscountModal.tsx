import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Button, Modal } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { manualDiscountDraftToInput } from '../../utils/orderEditing';
import type { ManualDiscountInput } from '../../orderTypes';
import { ManualDiscountFields, errorMap, type ErrorKey, type Kind } from './ManualDiscountModal';

type Props = {
  /** The subtotal a percentage applies to (the last quote's); null while there is none. */
  percentBase: number | null;
  onClose: () => void;
  /** The checked discount; the quote then prices it (an amount above what is left is refused there). */
  onAdd: (input: ManualDiscountInput) => void;
};

/** Create order's Add discount: the order's form, adding the discount to the draft. */
const CreateManualDiscountModal = ({ percentBase, onClose, onAdd }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });
  const [kind, setKind] = useState<Kind>('FIXED');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Partial<Record<ErrorKey, string>>>({});

  const add = () => {
    const draft = manualDiscountDraftToInput({ kind, value, reason });
    if (!draft.input) {
      setErrors(errorMap(draft.errors));
      return;
    }
    onAdd(draft.input);
    onClose();
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.orders.discounts.add')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <ManualDiscountFields
            kind={kind}
            value={value}
            reason={reason}
            errors={errors}
            percentBase={percentBase}
            onKind={(next) => {
              setKind(next);
              setErrors({});
            }}
            onValue={(next) => {
              setValue(next);
              setErrors(({ value: _v, form: _f, ...rest }) => rest);
            }}
            onReason={(next) => {
              setReason(next);
              setErrors(({ reason: _r, form: _f, ...rest }) => rest);
            }}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose}>
            {t('ecommerce.orders.discounts.close')}
          </Button>
          <Button variant="secondary" onClick={add}>
            {t('ecommerce.orders.discounts.save')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default CreateManualDiscountModal;
