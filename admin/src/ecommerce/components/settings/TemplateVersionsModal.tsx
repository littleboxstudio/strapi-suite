import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import {
  Button,
  Flex,
  Loader,
  Modal,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import ConfirmModal from '../../../components/ConfirmModal';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchEmailTemplateVersions from '../../usecases/settings/fetchEmailTemplateVersions';
import RestoreEmailTemplateVersion from '../../usecases/settings/restoreEmailTemplateVersion';
import type {
  EmailTemplateType,
  EmailTemplateVersionView,
  EmailTemplateView,
} from '../../settingsTypes';

type Props = {
  type: EmailTemplateType;
  locale: string;
  readOnly: boolean;
  onClose: () => void;
  onRestored: (template: EmailTemplateView) => void;
};

const TemplateVersionsModal = ({ type, locale, readOnly, onClose, onRestored }: Props) => {
  const { formatMessage, formatDate } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const [versions, setVersions] = useState<EmailTemplateVersionView[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [confirm, setConfirm] = useState<EmailTemplateVersionView | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    new FetchEmailTemplateVersions()
      .execute(type, locale)
      .then((rows) => {
        if (!cancelled) setVersions(rows);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [type, locale]);

  const restore = async (version: EmailTemplateVersionView) => {
    setRestoring(version.id);
    try {
      const template = await new RestoreEmailTemplateVersion().execute(type, locale, version.id);
      toggleNotification({
        type: 'success',
        message: t('ecommerce.settings.emailTemplates.versions.restored', {
          version: version.version,
        }),
      });
      onRestored(template);
    } catch {
      toggleNotification({
        type: 'danger',
        message: t('ecommerce.settings.emailTemplates.versions.restoreError'),
      });
    } finally {
      setRestoring(null);
    }
  };

  const content = () => {
    if (loadError) {
      return <Typography textColor="danger600">{t('ecommerce.settings.loadError')}</Typography>;
    }
    if (!versions) {
      return (
        <Flex justifyContent="center" padding={6}>
          <Loader small />
        </Flex>
      );
    }
    if (versions.length === 0) {
      return (
        <Typography textColor="neutral600">
          {t('ecommerce.settings.emailTemplates.versions.empty')}
        </Typography>
      );
    }
    return (
      <Table colCount={4} rowCount={versions.length + 1}>
        <Thead>
          <Tr>
            {(['version', 'date', 'user'] as const).map((column) => (
              <Th key={column}>
                <Typography variant="sigma">
                  {t(`ecommerce.settings.emailTemplates.versions.table.${column}`)}
                </Typography>
              </Th>
            ))}
            <Th>
              <VisuallyHidden>
                {t('ecommerce.settings.emailTemplates.versions.table.actions')}
              </VisuallyHidden>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {versions.map((v) => (
            <Tr key={v.id}>
              <Td>
                <Typography textColor="neutral800">{`v${v.version}`}</Typography>
              </Td>
              <Td>
                <Typography textColor="neutral800">
                  {v.createdAt
                    ? formatDate(v.createdAt, { dateStyle: 'medium', timeStyle: 'short' })
                    : '—'}
                </Typography>
              </Td>
              <Td>
                <Typography textColor="neutral800">{v.authorName ?? '—'}</Typography>
              </Td>
              <Td>
                {!readOnly && (
                  <Flex justifyContent="flex-end">
                    <Button
                      size="S"
                      variant="secondary"
                      loading={restoring === v.id}
                      disabled={restoring !== null}
                      onClick={() => setConfirm(v)}
                    >
                      {t('ecommerce.settings.emailTemplates.versions.restore')}
                    </Button>
                  </Flex>
                )}
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    );
  };

  return (
    <>
      <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
        <Modal.Content>
          <Modal.Header>
            <Modal.Title>{t('ecommerce.settings.emailTemplates.versions.title')}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Flex direction="column" alignItems="stretch" gap={3}>
              <Typography variant="pi" textColor="neutral600">
                {t('ecommerce.settings.emailTemplates.versions.description')}
              </Typography>
              {content()}
            </Flex>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onClick={onClose}>
              {t('ecommerce.settings.emailTemplates.close')}
            </Button>
          </Modal.Footer>
        </Modal.Content>
      </Modal.Root>

      <ConfirmModal
        open={!!confirm}
        title={t('ecommerce.settings.emailTemplates.versions.restoreConfirm.title')}
        text={
          confirm
            ? t('ecommerce.settings.emailTemplates.versions.restoreConfirm.text', {
                version: confirm.version,
              })
            : ''
        }
        confirm={{
          button: t('ecommerce.settings.emailTemplates.versions.restore'),
          action: () => {
            if (confirm && !readOnly) restore(confirm);
            setConfirm(null);
          },
        }}
        cancel={{
          button: t('ecommerce.settings.cancel'),
          action: () => setConfirm(null),
        }}
      />
    </>
  );
};

export { TemplateVersionsModal };
