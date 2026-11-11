import { Button, Dialog, Flex } from '@strapi/design-system';
import { WarningCircle } from '@strapi/icons';

type Props = {
  open: boolean;
  title: string;
  text: string;
  okLabel: string;
  onClose: () => void;
};

/** A message with a single OK button (e.g. an action that is not allowed). */
const NoticeModal = ({ open, title, text, okLabel, onClose }: Props) => (
  <Dialog.Root open={open} onOpenChange={(next: boolean) => !next && onClose()}>
    <Dialog.Content>
      <Dialog.Header>{title}</Dialog.Header>
      <Dialog.Body style={{ textAlign: 'center' }} icon={<WarningCircle fill="warning600" />}>
        {text}
      </Dialog.Body>
      <Dialog.Footer>
        <Flex style={{ width: '100%' }}>
          <Button fullWidth onClick={onClose}>
            {okLabel}
          </Button>
        </Flex>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
);

export { NoticeModal };
