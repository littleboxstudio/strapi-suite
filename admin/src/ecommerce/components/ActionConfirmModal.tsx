import { Button, Dialog, Flex } from '@strapi/design-system';
import { WarningCircle } from '@strapi/icons';

type Props = {
  open: boolean;
  title: string;
  text: string;
  confirmLabel: string;
  cancelLabel: string;
  /** `danger` for destructive actions (disable), `default` otherwise (enable). */
  confirmVariant?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
};

/** Confirmation dialog whose confirm button style follows the action. */
const ActionConfirmModal = ({
  open,
  title,
  text,
  confirmLabel,
  cancelLabel,
  confirmVariant = 'danger',
  onConfirm,
  onCancel,
}: Props) => (
  <Dialog.Root open={open} onOpenChange={(next: boolean) => !next && onCancel()}>
    <Dialog.Content>
      <Dialog.Header>{title}</Dialog.Header>
      <Dialog.Body
        style={{ textAlign: 'center' }}
        icon={<WarningCircle fill={confirmVariant === 'danger' ? 'danger600' : 'primary600'} />}
      >
        {text}
      </Dialog.Body>
      <Dialog.Footer>
        <Flex style={{ width: '100%', gap: '10px' }}>
          <Button fullWidth variant="tertiary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button fullWidth variant={confirmVariant} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </Flex>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
);

export { ActionConfirmModal };
