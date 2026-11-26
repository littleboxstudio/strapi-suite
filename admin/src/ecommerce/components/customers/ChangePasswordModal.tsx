import { useState } from 'react';
import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { useNotification } from '@strapi/strapi/admin';
import { Button, Field, Flex, Modal, TextInput, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import SetCustomerPassword from '../../usecases/orders/setCustomerPassword';
import { extractFieldErrors } from '../../utils/productForm';
import { validateNewPassword, type PasswordIssue } from '../../utils/customerAccounts';

/** Single-line inputs are 38px tall, like the other fields of the module. */
const Inputs = styled.div`
  input {
    height: 38px;
  }
`;

type Props = { customerId: number; email: string; onClose: () => void };

/** Sets a registered customer's password (the server ends their sessions). */
const ChangePasswordModal = ({ customerId, email, onClose }: Props) => {
  const { formatMessage } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [issue, setIssue] = useState<PasswordIssue | 'not_allowed' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const issueText = (code: string) =>
    formatMessage({
      id: getTranslation(`ecommerce.customers.password.errors.${code}`),
      defaultMessage: t('ecommerce.customers.password.errors.invalid'),
    });

  const submit = async () => {
    if (saving) return;
    const local = validateNewPassword(password, confirm, email);
    setFormError(null);
    setIssue(local);
    if (local) return;
    setSaving(true);
    try {
      await new SetCustomerPassword().execute(customerId, password);
      toggleNotification({ type: 'success', message: t('ecommerce.customers.password.saved') });
      onClose();
    } catch (err) {
      const found = extractFieldErrors(err)?.find((e) => e.path === 'password');
      if (found) setIssue(found.code as PasswordIssue);
      else if ((err as any)?.response?.status === 503)
        setFormError(t('ecommerce.customers.password.errors.unavailable'));
      else setFormError(t('ecommerce.customers.password.errors.failed'));
    } finally {
      setSaving(false);
    }
  };

  const mismatch = issue === 'MISMATCH';
  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && !saving && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.customers.password.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Inputs>
            <Flex direction="column" alignItems="stretch" gap={5}>
              <Typography textColor="neutral600">{t('ecommerce.customers.password.intro')}</Typography>
              <Field.Root
                name="newPassword"
                required
                hint={t('ecommerce.customers.password.hint')}
                error={issue && !mismatch ? issueText(issue) : undefined}
              >
                <Field.Label>{t('ecommerce.customers.password.new')}</Field.Label>
                <TextInput
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e: any) => {
                    setPassword(e.target.value);
                    setIssue(null);
                  }}
                />
                <Field.Hint />
                <Field.Error />
              </Field.Root>
              <Field.Root
                name="confirmPassword"
                required
                error={mismatch ? issueText('MISMATCH') : undefined}
              >
                <Field.Label>{t('ecommerce.customers.password.confirm')}</Field.Label>
                <TextInput
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e: any) => {
                    setConfirm(e.target.value);
                    setIssue(null);
                  }}
                />
                <Field.Error />
              </Field.Root>
              {formError && <Typography textColor="danger600">{formError}</Typography>}
            </Flex>
          </Inputs>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose} disabled={saving}>
            {t('ecommerce.customers.password.cancel')}
          </Button>
          <Button variant="secondary" onClick={submit} loading={saving}>
            {t('ecommerce.customers.password.submit')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export { ChangePasswordModal };
