import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate } from 'react-router-dom';
import { useNotification } from '@strapi/strapi/admin';
import {
  Box,
  Button,
  Field,
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
import config from '../../../core/config';
import { getTranslation } from '../../../core/utils/getTranslation';
import ConfirmModal from '../../../components/ConfirmModal';
import { HeaderActions } from '../../components/HeaderActions';
import EmptyNote from '../../components/orders/EmptyNote';
import NoticeBar from '../../components/orders/NoticeBar';
import { ToneBadge } from '../../components/orders/StatusBadges';
import FetchCategoryTree from '../../usecases/organization/fetchCategoryTree';
import MoveCategory from '../../usecases/organization/moveCategory';
import DeleteCategory from '../../usecases/organization/deleteCategory';
import { flattenTree, parentOptions } from '../../utils/categoryTree';
import { organizationErrorMessage } from '../../utils/organizationErrors';
import { ParentCategorySelect } from '../../components/organization/ParentCategorySelect';
import type { CategoryTreeNode } from '../../organizationTypes';

/** Indentation per tree level, in px. */
const INDENT = 24;

const CategoryListPage = () => {
  const { formatMessage } = useIntl();
  const navigate = useNavigate();
  const { toggleNotification } = useNotification();
  const basePath = `/plugins/${config.pluginId}/ecommerce/categories`;
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const p = 'ecommerce.organization.categories';

  const [tree, setTree] = useState<CategoryTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  /** A refused delete or move: the server's reason. */
  const [notice, setNotice] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<CategoryTreeNode | null>(null);
  const [toMove, setToMove] = useState<CategoryTreeNode | null>(null);
  const [moveParent, setMoveParent] = useState<number | null>(null);
  const requestId = useRef(0);

  const load = useCallback(() => {
    const current = ++requestId.current;
    setLoading(true);
    new FetchCategoryTree()
      .execute()
      .then((roots) => {
        if (current !== requestId.current) return;
        setTree(Array.isArray(roots) ? roots : []);
        setError(false);
        setLoading(false);
      })
      .catch(() => {
        if (current !== requestId.current) return;
        setError(true);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => flattenTree(tree), [tree]);

  /** Shows the server's reason for a refusal, or a generic toast. */
  const showError = (err: unknown, fallback: string) => {
    const message = organizationErrorMessage(err);
    if (message) setNotice(t(message.id, message.values));
    else toggleNotification({ type: 'danger', message: t(fallback) });
  };

  const move = async (node: CategoryTreeNode, parentId: number | null, position: number) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await new MoveCategory().execute(node.id, { parentId, position });
      toggleNotification({ type: 'success', message: t(`${p}.moved`) });
      load();
    } catch (err) {
      showError(err, `${p}.moveError`);
    } finally {
      setBusy(false);
    }
  };

  const openMoveTo = (node: CategoryTreeNode) => {
    setMoveParent(node.parentId);
    setToMove(node);
  };

  /** "Move to…": last among the new parent's children. */
  const confirmMoveTo = async () => {
    const node = toMove;
    setToMove(null);
    if (!node) return;
    const parentId = moveParent;
    if (parentId === node.parentId) return;
    const siblings =
      parentId === null ? tree : (rows.find((r) => r.node.id === parentId)?.node.children ?? []);
    await move(node, parentId, siblings.length);
  };

  const remove = async () => {
    const node = toDelete;
    setToDelete(null);
    if (!node || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await new DeleteCategory().execute(node.id);
      toggleNotification({ type: 'success', message: t(`${p}.deleted`) });
      load();
    } catch (err) {
      showError(err, `${p}.deleteError`);
    } finally {
      setBusy(false);
    }
  };

  const create = () => navigate(`${basePath}/new`);

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <HeaderActions>
        <Button variant="secondary" onClick={create}>
          {t(`${p}.add`)}
        </Button>
      </HeaderActions>

      {notice && (
        <NoticeBar
          wrap
          text={notice}
          actions={
            <Button variant="tertiary" size="S" onClick={() => setNotice(null)}>
              {t('ecommerce.organization.close')}
            </Button>
          }
        />
      )}

      <Box background="neutral0" shadow="tableShadow" hasRadius padding={6}>
        <Flex direction="column" alignItems="stretch" gap={5}>
          <Typography variant="delta" tag="h2">
            {t(`${p}.title`)}
          </Typography>

          {error && <Typography textColor="danger600">{t('ecommerce.organization.loadError')}</Typography>}

          {loading && rows.length === 0 && !error && (
            <Flex justifyContent="center" padding={8}>
              <Loader />
            </Flex>
          )}

          {!loading && !error && rows.length === 0 && <EmptyNote>{t(`${p}.empty`)}</EmptyNote>}

          {rows.length > 0 && (
            <Table colCount={5} rowCount={rows.length}>
              <Thead>
                <Tr>
                  {(['name', 'slug', 'products', 'status'] as const).map((column) => (
                    <Th key={column}>
                      <Typography variant="sigma">{t(`${p}.table.${column}`)}</Typography>
                    </Th>
                  ))}
                  <Th>
                    <VisuallyHidden>{t(`${p}.table.actions`)}</VisuallyHidden>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {rows.map(({ node, depth }) => (
                  <Tr key={node.id} style={{ opacity: loading || busy ? 0.5 : 1 }}>
                    <Td>
                      <Box style={{ paddingLeft: depth * INDENT }}>
                        <Flex gap={2} alignItems="center">
                          {depth > 0 && (
                            <Typography textColor="neutral400" aria-hidden>
                              └
                            </Typography>
                          )}
                          <Typography textColor="neutral800" fontWeight={depth === 0 ? 'semiBold' : undefined}>
                            {node.name || `#${node.id}`}
                          </Typography>
                        </Flex>
                      </Box>
                    </Td>
                    <Td>
                      <Typography textColor="neutral600" style={{ fontFamily: 'monospace' }}>
                        {node.slug}
                      </Typography>
                    </Td>
                    <Td>
                      <Typography textColor="neutral800">{node.productCount}</Typography>
                    </Td>
                    <Td>
                      {node.active ? (
                        <ToneBadge variant="success">{t(`${p}.status.active`)}</ToneBadge>
                      ) : (
                        <ToneBadge>{t(`${p}.status.inactive`)}</ToneBadge>
                      )}
                    </Td>
                    <Td>
                      <Flex gap={2} justifyContent="flex-end">
                        <Button variant="secondary" size="S" onClick={() => navigate(`${basePath}/${node.id}`)}>
                          {t(`${p}.edit`)}
                        </Button>
                        <Button variant="secondary" size="S" disabled={busy} onClick={() => openMoveTo(node)}>
                          {t(`${p}.moveTo`)}
                        </Button>
                        <Button variant="danger-light" size="S" disabled={busy} onClick={() => setToDelete(node)}>
                          {t(`${p}.delete`)}
                        </Button>
                      </Flex>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </Flex>
      </Box>

      <ConfirmModal
        open={!!toDelete}
        title={t(`${p}.deleteTitle`)}
        text={t(`${p}.deleteText`, { name: toDelete?.name ?? '' })}
        confirm={{ variant: 'danger-light', button: t(`${p}.delete`), action: remove }}
        cancel={{ button: t('ecommerce.organization.cancel'), action: () => setToDelete(null) }}
      />

      {toMove && (
        <Modal.Root open onOpenChange={(next: boolean) => !next && setToMove(null)}>
          <Modal.Content>
            <Modal.Header>
              <Modal.Title>{t(`${p}.moveTitle`, { name: toMove.name })}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <Field.Root name="parentId" hint={t(`${p}.moveHint`)}>
                <Field.Label>{t('ecommerce.organization.category.parent')}</Field.Label>
                <ParentCategorySelect
                  value={moveParent}
                  options={parentOptions(tree, toMove.id)}
                  onChange={setMoveParent}
                />
                <Field.Hint />
              </Field.Root>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onClick={() => setToMove(null)}>
                {t('ecommerce.organization.cancel')}
              </Button>
              <Button variant="secondary" onClick={confirmMoveTo}>
                {t(`${p}.moveConfirm`)}
              </Button>
            </Modal.Footer>
          </Modal.Content>
        </Modal.Root>
      )}
    </Flex>
  );
};

export { CategoryListPage };
