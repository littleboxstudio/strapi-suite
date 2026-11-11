import { useIntl } from 'react-intl';
import {
  Box,
  Button,
  Field,
  Flex,
  IconButton,
  SingleSelect,
  SingleSelectOption,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { Plus, Trash } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import TargetPicker from './TargetPicker';
import {
  addCondition,
  addGroup,
  canAddGroup,
  CONDITION_TYPES,
  conditionPath,
  errorUnder,
  operatorsFor,
  removeNode,
  updateNode,
  type ConditionNode,
  type ConditionType,
  type GroupNode,
  type NodePath,
  type PromotionErrors,
} from '../../utils/promotionForm';
import type { PromotionLabels } from '../../promotionTypes';

type Props = {
  /** The whole tree: every edit returns a new tree. */
  tree: GroupNode;
  /** The group this editor shows (`[]` = the root). */
  path?: NodePath;
  onChange: (tree: GroupNode) => void;
  labels: PromotionLabels;
  onLabels: (labels: PromotionLabels) => void;
  errors: PromotionErrors;
  disabled?: boolean;
};

const MATCHES = ['ANY', 'ALL', 'NONE'] as const;
const LEVEL_BACKGROUND = ['neutral0', 'neutral100', 'neutral0'] as const;

/** Visual AND/OR condition tree, up to 3 levels; error paths mirror `conditions.children.<i>…`. */
const ConditionGroupEditor = ({ tree, path = [], onChange, labels, onLabels, errors, disabled }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const p = 'ecommerce.promotions.form.conditions';
  const errorText = (key: string | undefined, fallback?: string) =>
    key ? (fallback && key === 'required' ? fallback : t(`ecommerce.promotions.form.errors.${key}`)) : undefined;

  let group: GroupNode = tree;
  for (const i of path) group = group.children[i] as GroupNode;
  const isRoot = path.length === 0;
  // too_deep / too_many land on `conditions`; a malformed group on its own path.
  const groupError = errors[conditionPath(path)] ?? errors[`${conditionPath(path)}.operator`];

  const conditionRow = (node: ConditionNode, nodePath: NodePath) => {
    const base = conditionPath(nodePath);
    const set = (patch: Partial<ConditionNode>) => onChange(updateNode(tree, nodePath, patch));
    const operators = operatorsFor(node.type);
    const money = node.type === 'SUBTOTAL';
    const textField = (field: 'value' | 'min' | 'max', label: string) => (
      <Box style={{ minWidth: 140, flex: '1 1 140px' }}>
        <Field.Root name={`${base}.${field}`} error={errorText(errors[`${base}.${field}`])}>
          <Field.Label>{label}</Field.Label>
          <TextInput
            value={node[field]}
            disabled={disabled}
            inputMode={node.type === 'EMAIL' ? 'email' : 'decimal'}
            onChange={(e: any) => set({ [field]: e.target.value } as Partial<ConditionNode>)}
          />
          <Field.Error />
        </Field.Root>
      </Box>
    );

    return (
      <Box key={node.key} padding={3} hasRadius borderColor="neutral200" background="neutral0">
        <Flex direction="column" alignItems="stretch" gap={3}>
          <Flex gap={3} alignItems="flex-end" wrap="wrap">
            <Box style={{ minWidth: 200, flex: '2 1 200px' }}>
              <Field.Root name={`${base}.type`} error={errorText(errors[`${base}.type`])}>
                <Field.Label>{t(`${p}.type`)}</Field.Label>
                <SingleSelect
                  value={node.type}
                  disabled={disabled}
                  onChange={(value: string | number) => set({ type: String(value) as ConditionType })}
                >
                  {CONDITION_TYPES.map((type) => (
                    <SingleSelectOption key={type} value={type}>
                      {t(`${p}.types.${type}`)}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
                <Field.Error />
              </Field.Root>
            </Box>
            {operators.length > 0 && (
              <Box style={{ minWidth: 160, flex: '1 1 160px' }}>
                <Field.Root name={`${base}.operator`} error={errorText(errors[`${base}.operator`])}>
                  <Field.Label>{t(`${p}.operator`)}</Field.Label>
                  <SingleSelect
                    value={node.operator}
                    disabled={disabled}
                    onChange={(value: string | number) => set({ operator: String(value) })}
                  >
                    {operators.map((op) => (
                      <SingleSelectOption key={op} value={op}>
                        {t(`${p}.operators.${op}`)}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                  <Field.Error />
                </Field.Root>
              </Box>
            )}
            {node.type === 'CART_CONTAINS' && (
              <Box style={{ minWidth: 160, flex: '1 1 160px' }}>
                <Field.Root name={`${base}.match`} error={errorText(errors[`${base}.match`])}>
                  <Field.Label>{t(`${p}.match`)}</Field.Label>
                  <SingleSelect
                    value={node.match}
                    disabled={disabled}
                    onChange={(value: string | number) => set({ match: String(value) as ConditionNode['match'] })}
                  >
                    {MATCHES.map((m) => (
                      <SingleSelectOption key={m} value={m}>
                        {t(`${p}.matches.${m}`)}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                  <Field.Error />
                </Field.Root>
              </Box>
            )}
            {node.type === 'SUBTOTAL_BETWEEN' && (
              <>
                {textField('min', t(`${p}.min`))}
                {textField('max', t(`${p}.max`))}
              </>
            )}
            {['SUBTOTAL', 'PRODUCT_QUANTITY', 'TOTAL_QUANTITY', 'DISTINCT_PRODUCTS', 'EMAIL'].includes(node.type) &&
              textField('value', money ? t(`${p}.amount`) : t(`${p}.value`))}
            {!disabled && (
              <IconButton label={t(`${p}.remove`)} variant="ghost" onClick={() => onChange(removeNode(tree, nodePath) ?? tree)}>
                <Trash />
              </IconButton>
            )}
          </Flex>
          {errors[base] && (
            <Typography variant="pi" textColor="danger600" role="alert">
              {errorText(errors[base])}
            </Typography>
          )}
          {(node.type === 'SUBTOTAL' || node.type === 'SUBTOTAL_BETWEEN') && (
            <Typography variant="pi" textColor="neutral600">
              {t(`${p}.subtotalHint`)}
            </Typography>
          )}
          {(node.type === 'CART_CONTAINS' || node.type === 'PRODUCT_QUANTITY') && (
            <TargetPicker
              target={node.target}
              labels={labels}
              onLabels={onLabels}
              onChange={(target) => set({ target })}
              error={errorText(errorUnder(errors, `${base}.target`), t('ecommerce.promotions.form.target.required'))}
              disabled={disabled}
            />
          )}
        </Flex>
      </Box>
    );
  };

  return (
    <Box
      padding={isRoot ? 0 : 3}
      hasRadius
      borderColor={isRoot ? undefined : 'primary200'}
      background={isRoot ? undefined : LEVEL_BACKGROUND[path.length % LEVEL_BACKGROUND.length]}
    >
      <Flex direction="column" alignItems="stretch" gap={3}>
        <Flex justifyContent="space-between" alignItems="flex-end" gap={3} wrap="wrap">
          <Box style={{ minWidth: 220 }}>
            <Field.Root name={`${conditionPath(path)}.operator`}>
              <Field.Label>{t(`${p}.join`)}</Field.Label>
              <SingleSelect
                value={group.operator}
                disabled={disabled}
                onChange={(value: string | number) =>
                  onChange(updateNode(tree, path, { operator: String(value) as 'AND' | 'OR' }))
                }
              >
                <SingleSelectOption value="AND">{t(`${p}.AND`)}</SingleSelectOption>
                <SingleSelectOption value="OR">{t(`${p}.OR`)}</SingleSelectOption>
              </SingleSelect>
            </Field.Root>
          </Box>
          {!isRoot && !disabled && (
            <Button
              variant="danger-light"
              size="S"
              startIcon={<Trash />}
              onClick={() => onChange(removeNode(tree, path) ?? tree)}
            >
              {t(`${p}.removeGroup`)}
            </Button>
          )}
        </Flex>

        {groupError && (
          <Typography variant="omega" textColor="danger600" role="alert">
            {t(`ecommerce.promotions.form.errors.${groupError}`)}
          </Typography>
        )}

        {group.children.length === 0 && (
          <Typography variant="pi" textColor="neutral600">
            {isRoot ? t(`${p}.hint`) : t(`${p}.empty`)}
          </Typography>
        )}

        {group.children.map((child, i) =>
          child.type === 'GROUP' ? (
            <ConditionGroupEditor
              key={child.key}
              tree={tree}
              path={[...path, i]}
              onChange={onChange}
              labels={labels}
              onLabels={onLabels}
              errors={errors}
              disabled={disabled}
            />
          ) : (
            conditionRow(child, [...path, i])
          )
        )}

        {!disabled && (
          <Flex gap={2} wrap="wrap" alignItems="center">
            <Button variant="secondary" size="S" startIcon={<Plus />} onClick={() => onChange(addCondition(tree, path))}>
              {t(`${p}.add`)}
            </Button>
            <Button
              variant="tertiary"
              size="S"
              startIcon={<Plus />}
              disabled={!canAddGroup(path)}
              onClick={() => onChange(addGroup(tree, path) ?? tree)}
            >
              {t(`${p}.addGroup`)}
            </Button>
            {!canAddGroup(path) && (
              <Typography variant="pi" textColor="neutral600">
                {t(`${p}.maxDepth`)}
              </Typography>
            )}
          </Flex>
        )}
      </Flex>
    </Box>
  );
};

export default ConditionGroupEditor;
