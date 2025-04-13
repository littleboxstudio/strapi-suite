import { useEffect, useState } from 'react';
import { Button } from '@strapi/design-system';
import { Dialog } from '@strapi/design-system';
import { WarningCircle } from '@strapi/icons';

const DangerModal = ({ open, title, text, button }: any) => {
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
                <Button fullWidth variant="danger-light">
                  {button}
                </Button>
              </Dialog.Action>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Root>
      )}
    </>
  );
};

export default DangerModal;
