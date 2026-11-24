import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate } from 'react-router-dom';
import { useNotification } from '@strapi/strapi/admin';
import {
  Box,
  Button,
  Field,
  Flex,
  Loader,
  Searchbar,
  SearchForm,
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
import NoticeBar from '../../components/orders/NoticeBar';
import { ToneBadge } from '../../components/orders/StatusBadges';
import FetchCategoryTree from '../../usecases/organization/fetchCategoryTree';
import MoveCategory from '../../usecases/organization/moveCategory';
import DeleteCategory from '../../usecases/organization/deleteCategory';
import { flattenTree, parentOptions, pathLabel } from '../../utils/categoryTree';
import SearchFieldHeight from '../../components/SearchFieldHeight';
import { organizationErrorMessage } from '../../utils/organizationErrors';
import EmptySection from '../../illustrations/EmptySection';
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
  const [searchTerm, setSearchTerm] = useState('');
  /** Searching: the categories whose name or slug matches, flat, each with its full path. */
  const shown = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return rows.map((r) => ({ node: r.node, depth: r.depth, label: r.node.name }));
    return rows
      .filter((r) => r.node.name.toLowerCase().includes(q) || r.node.slug.toLowerCase().includes(q))
      .map((r) => ({ node: r.node, depth: 0, label: pathLabel(tree, r.node.id) }));
  }, [rows, tree, searchTerm]);

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
  const isEmpty = !loading && !error && rows.length === 0;

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

      {isEmpty ? (
        // As the collections list: illustration, message and the add button, centred.
        <Flex
          direction="column"
          alignItems="center"
          gap={3}
          padding={10}
          background="neutral0"
          shadow="tableShadow"
          hasRadius
        >
          <EmptySection />
          <Typography variant="omega" textColor="neutral600">
            {t(`${p}.empty`)}
          </Typography>
          <Button variant="secondary" onClick={create}>
            {t(`${p}.add`)}
          </Button>
        </Flex>
      ) : (
        <Box background="neutral0" shadow="tableShadow" hasRadius padding={6}>
          <Flex direction="column" alignItems="stretch" gap={5}>
            <Typography variant="delta" tag="h2">
              {t(`${p}.title`)}
            </Typography>

            {rows.length > 0 && (
              <SearchFieldHeight>
                <SearchForm onSubmit={(e: FormEvent) => e.preventDefault()}>
                  <Searchbar
                    name="searchbar"
                    value={searchTerm}
                    onClear={() => setSearchTerm('')}
                    onChange={(e: any) => setSearchTerm(e.target.value)}
                    clearLabel={t(`${p}.search.clear`)}
                    placeholder={t(`${p}.search.placeholder`)}
                  >
                    {t(`${p}.search.label`)}
                  </Searchbar>
                </SearchForm>
              </SearchFieldHeight>
            )}

            {error && <Typography textColor="danger600">{t('ecommerce.organization.loadError')}</Typography>}

            {loading && rows.length === 0 && !error && (
              <Flex justifyContent="center" padding={8}>
                <Loader />
              </Flex>
            )}

            {rows.length > 0 && shown.length === 0 && (
              <Flex justifyContent="center" padding={8}>
                <Typography variant="omega" textColor="neutral600">
                  {t(`${p}.noResults`)}
                </Typography>
              </Flex>
            )}

            {shown.length > 0 && (
              <Table colCount={5} rowCount={shown.length}>
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
                  {shown.map(({ node, depth, label }) => (
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
                              {label || `#${node.id}`}
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
      )}

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
