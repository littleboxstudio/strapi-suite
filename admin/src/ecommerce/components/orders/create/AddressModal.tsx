import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Button, Modal } from '@strapi/design-system';
import { getTranslation } from '../../../../core/utils/getTranslation';
import { addressFormErrors } from '../../../utils/createOrder';
import type { AddressForm } from '../../../utils/orderForm';
import AddressFields from '../AddressFields';

type Props = {
  title: string;
  /** `shippingAddress` or `billingAddress`: the input names. */
  name: string;
  /** Billing also takes company and NIF. */
  billing?: boolean;
  initial: AddressForm;
  /** The server's errors of these fields (`city` → code). */
  errors?: Record<string, string>;
  codeText: (code: string) => string;
  onClose: () => void;
  onSave: (address: AddressForm) => void;
};

/** Create order's Add/Edit address: the address form; saving fills the section's table. */
const AddressModal = ({
  title,
  name,
  billing,
  initial,
  errors: initialErrors = {},
  codeText,
  onClose,
  onSave,
}: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });
  const [form, setForm] = useState<AddressForm>(initial);
  const [errors, setErrors] = useState<Record<string, string>>(initialErrors);

  const save = () => {
    const found = addressFormErrors(form);
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    onSave(form);
    onClose();
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <AddressFields
            name={name}
            billing={billing}
            value={form}
            onChange={(field, value) => {
              setForm((f) => ({ ...f, [field]: value }));
              setErrors(({ [field]: _gone, ...rest }) => rest);
            }}
            errorFor={(field) => (errors[field] ? codeText(errors[field]) : undefined)}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose}>
            {t('ecommerce.orders.shippingCharges.close')}
          </Button>
          <Button variant="secondary" onClick={save}>
            {t('ecommerce.orders.shippingCharges.save')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default AddressModal;
