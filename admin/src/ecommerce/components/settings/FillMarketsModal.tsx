import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Button, Flex, Modal, Typography } from '@strapi/design-system';
import { Plus } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import { ActionConfirmModal } from '../ActionConfirmModal';
import { BracketRows } from './BracketRows';
import {
  newBracketRows,
  validateBracketRows,
  type BracketDraft,
  type ManualMethodErrors,
} from '../../utils/manualMethodForm';

type Props = {
  /** How many markets the ranges will replace (shown in the warning). */
  marketCount: number;
  onClose: () => void;
  onApply: (rows: BracketDraft[]) => void;
};

/**
 * One table of weight ranges for every selected market. Mount it only while open. Applying asks
 * first: every market's current ranges are replaced.
 */
const FillMarketsModal = ({ marketCount, onClose, onApply }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const [rows, setRows] = useState<BracketDraft[]>(newBracketRows);
  const [errors, setErrors] = useState<ManualMethodErrors>({});
  const [confirming, setConfirming] = useState(false);

  const path = (i: number, field: keyof BracketDraft) => `fill.${i}.${field}`;

  const apply = () => {
    const result = validateBracketRows(rows, 'fill');
    setErrors(result.errors);
    if (Object.keys(result.errors).length === 0) setConfirming(true);
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.settings.manual.fillAll.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Typography variant="omega" textColor="neutral800">
              {t('ecommerce.settings.manual.fillAll.text')}
            </Typography>
            <Typography variant="pi" textColor="neutral600">
              {t('ecommerce.settings.manual.noLimit')}
            </Typography>
            <BracketRows
              rows={rows}
              label={t('ecommerce.settings.manual.fillAll.title')}
              errorText={(i, field) =>
                errors[path(i, field)]
                  ? t(`ecommerce.settings.errors.${errors[path(i, field)]}`)
                  : undefined
              }
              onChange={(i, field, text) => {
                setRows((current) =>
                  current.map((row, index) => (index === i ? { ...row, [field]: text } : row))
                );
                setErrors(({ [path(i, field)]: _removed, ...rest }) => rest);
              }}
              onRemove={(i) => {
                setRows((current) => current.filter((_, index) => index !== i));
                setErrors({});
              }}
            />
            <Flex>
              <Button
                variant="secondary"
                startIcon={<Plus />}
                onClick={() => {
                  setRows((current) => [...current, ...newBracketRows()]);
                  setErrors({});
                }}
              >
                {t('ecommerce.settings.manual.addRange')}
              </Button>
            </Flex>
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose}>
            {t('ecommerce.settings.cancel')}
          </Button>
          <Button onClick={apply}>{t('ecommerce.settings.manual.fillAll.apply')}</Button>
        </Modal.Footer>
      </Modal.Content>
      <ActionConfirmModal
        open={confirming}
        title={t('ecommerce.settings.manual.fillAll.confirmTitle')}
        text={t('ecommerce.settings.manual.fillAll.confirmText', { count: marketCount })}
        confirmLabel={t('ecommerce.settings.manual.fillAll.replace')}
        cancelLabel={t('ecommerce.settings.cancel')}
        confirmVariant="danger"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onApply(rows);
        }}
      />
    </Modal.Root>
  );
};

export { FillMarketsModal };
