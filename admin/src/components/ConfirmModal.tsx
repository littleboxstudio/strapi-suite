import { useEffect, useState } from 'react';
import { Button } from '@strapi/design-system';
import { Dialog } from '@strapi/design-system';
import { WarningCircle } from '@strapi/icons';
import { Flex } from '@strapi/design-system';

const ConfirmModal = ({ open, title, text, confirm, cancel }: any) => {
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    setHidden(!open);
  }, [open]);

  return (
    <>
      {!hidden && (
        <Dialog.Root defaultOpen={true}>
          <Dialog.Content>
            <Dialog.Header>{title}</Dialog.Header>
            <Dialog.Body style={{ textAlign: 'center' }} icon={<WarningCircle fill="danger600" />}>
              {text}
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.Action>
                <Flex style={{ width: '100%', gap: '10px' }}>
                  <Button
                    fullWidth
                    variant="tertiary"
                    onClick={() => {
                      cancel.action();
                    }}
                  >
                    {cancel.button}
                  </Button>
                  <Button
                    fullWidth
                    variant="danger"
                    onClick={() => {
                      confirm.action();
                    }}
                  >
                    {confirm.button}
                  </Button>
                </Flex>
              </Dialog.Action>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Root>
      )}
    </>
  );
};

export default ConfirmModal;
