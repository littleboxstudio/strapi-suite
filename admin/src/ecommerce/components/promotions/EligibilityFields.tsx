import { useIntl } from 'react-intl';
import { Field, Flex, Radio, Textarea } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { emailList, type PromotionErrors } from '../../utils/promotionForm';

type Props = {
  mode: 'ALL' | 'EMAILS';
  emails: string;
  onChange: (patch: { eligibilityMode?: 'ALL' | 'EMAILS'; emails?: string }) => void;
  errors: PromotionErrors;
  disabled?: boolean;
};

/** All customers, or a list of e-mails (one per line; `eligibility.emails.<i>` points at a line). */
const EligibilityFields = ({ mode, emails, onChange, errors, disabled }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const p = 'ecommerce.promotions.form';

  const lineError = Object.keys(errors).find((k) => /^eligibility\.emails\.\d+$/.test(k));
  const listError = errors['eligibility.emails'] ?? errors.eligibility;
  let error: string | undefined;
  if (listError === 'required') error = t(`${p}.emails.required`);
  else if (listError) error = t(`${p}.errors.${listError}`);
  else if (lineError) {
    const email = emailList(emails)[Number(lineError.split('.')[2])];
    error = email !== undefined ? t(`${p}.emails.invalidLine`, { email }) : t(`${p}.errors.${errors[lineError]}`);
  }

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Radio.Group
        value={mode}
        disabled={disabled}
        aria-label={t(`${p}.sections.eligibility`)}
        onValueChange={(value: string) => onChange({ eligibilityMode: value as 'ALL' | 'EMAILS' })}
      >
        <Radio.Item value="ALL">{t(`${p}.eligibility.ALL`)}</Radio.Item>
        <Radio.Item value="EMAILS">{t(`${p}.eligibility.EMAILS`)}</Radio.Item>
      </Radio.Group>
      {mode === 'EMAILS' && (
        <Field.Root name="eligibility.emails" required error={error} hint={t(`${p}.emails.hint`)}>
          <Field.Label>{t(`${p}.emails`)}</Field.Label>
          <Textarea
            value={emails}
            disabled={disabled}
            onChange={(e: any) => onChange({ emails: e.target.value })}
          />
          <Field.Error />
          <Field.Hint />
        </Field.Root>
      )}
    </Flex>
  );
};

export default EligibilityFields;
