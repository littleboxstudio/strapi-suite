import { Fragment } from 'react';
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
import { Trash } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import { formatCents } from '../../utils/money';
import NoticeBar, { NOTICE_BACKGROUND, NOTICE_TEXT } from '../orders/NoticeBar';
import TargetPicker from './TargetPicker';
import {
  addScenario,
  addScenarioCondition,
  CONDITION_TYPES,
  conditionPath,
  describeConditions,
  markedParts,
  markValue,
  errorUnder,
  isScenarioTree,
  MAX_CONDITIONS,
  operatorsFor,
  removeScenario,
  removeScenarioCondition,
  scenarioConditionPath,
  scenariosOf,
  updateNode,
  type ConditionNode,
  type ConditionType,
  type GroupNode,
  type NodePath,
  type PromotionErrors,
} from '../../utils/promotionForm';
import type { PromotionLabels } from '../../promotionTypes';

type Props = {
  /** The whole tree, in the scenario shape (`toScenarioTree`): every edit returns a new tree. */
  tree: GroupNode;
  onChange: (tree: GroupNode) => void;
  labels: PromotionLabels;
  onLabels: (labels: PromotionLabels) => void;
  errors: PromotionErrors;
  /** The promotion has a Buy X Get Y benefit (its "Buy" requirement counts without conditions). */
  hasBuyXGetY?: boolean;
  /** Disables the controls (e.g. while saving) without hiding them. */
  disabled?: boolean;
  /** Hides the add/remove controls (no promotions.manage). */
  readOnly?: boolean;
};

const MATCHES = ['ANY', 'ALL', 'NONE'] as const;

/** The AND / OR word between two items. */
const Connector = ({ text }: { text: string }) => (
  <Flex justifyContent="center">
    <Box
      paddingLeft={3}
      paddingRight={3}
      paddingTop={1}
      paddingBottom={1}
      hasRadius
      background="neutral150"
    >
      <Typography variant="sigma" textColor="neutral700">
        {text}
      </Typography>
    </Box>
  </Flex>
);

const countConditions = (scenarios: ConditionNode[][]) =>
  scenarios.reduce((n, sc) => n + sc.length, 0);

/**
 * "Add scenario" (top right of the Conditions section): the first one, or another alternative;
 * each starts with one condition. Hidden for a tree that does not fit in scenarios.
 */
export const AddScenarioButton = ({
  tree,
  onChange,
  disabled,
}: {
  tree: GroupNode;
  onChange: (tree: GroupNode) => void;
  disabled?: boolean;
}) => {
  const { formatMessage } = useIntl();
  if (!isScenarioTree(tree)) return null;
  const full = countConditions(scenariosOf(tree)) >= MAX_CONDITIONS;
  return (
    <Button
      size="S"
      variant="secondary"
      disabled={disabled || full}
      onClick={() => onChange(addScenario(tree))}
    >
      {formatMessage({ id: getTranslation('ecommerce.promotions.form.conditions.addScenario') })}
    </Button>
  );
};

/**
 * The conditions as scenarios: the promotion applies when every condition (AND) of at least one
 * scenario (OR) holds. A plain sentence at the top says when it applies. Error paths mirror the
 * stored tree (`conditions.children.<i>…`).
 */
const ConditionsEditor = ({
  tree,
  onChange,
  labels,
  onLabels,
  errors,
  hasBuyXGetY,
  disabled,
  readOnly,
}: Props) => {
  const { formatMessage, locale } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const p = 'ecommerce.promotions.form.conditions';
  const errorText = (key: string | undefined, fallback?: string) =>
    key
      ? fallback && key === 'required'
        ? fallback
        : t(`ecommerce.promotions.form.errors.${key}`)
      : undefined;
  const money = (cents: number) => formatCents(cents, locale);

  const conditionRow = (node: ConditionNode, nodePath: NodePath, onRemove: () => void) => {
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
                  onChange={(value: string | number) =>
                    set({ type: String(value) as ConditionType })
                  }
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
                    onChange={(value: string | number) =>
                      set({ match: String(value) as ConditionNode['match'] })
                    }
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
            {[
              'SUBTOTAL',
              'PRODUCT_QUANTITY',
              'TOTAL_QUANTITY',
              'DISTINCT_PRODUCTS',
              'EMAIL',
            ].includes(node.type) && textField('value', money ? t(`${p}.amount`) : t(`${p}.value`))}
            {!readOnly && (
              <IconButton
                label={t(`${p}.remove`)}
                variant="ghost"
                disabled={disabled}
                onClick={onRemove}
              >
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
              error={errorText(
                errorUnder(errors, `${base}.target`),
                t('ecommerce.promotions.form.target.required')
              )}
              disabled={disabled}
              readOnly={readOnly}
            />
          )}
        </Flex>
      </Box>
    );
  };

  const sentence = (
    <Box padding={3} hasRadius background="neutral100">
      <Typography variant="omega" textColor="neutral800" fontWeight="semiBold">
        {markedParts(describeConditions(tree, money, t, labels, markValue)).map((part, i) =>
          part.value ? (
            // What the user filled in, in the notice colours.
            <Box
              key={i}
              tag="span"
              hasRadius
              paddingLeft={1}
              paddingRight={1}
              style={{ background: NOTICE_BACKGROUND, color: NOTICE_TEXT }}
            >
              {part.text}
            </Box>
          ) : (
            <Fragment key={i}>{part.text}</Fragment>
          )
        )}
      </Typography>
    </Box>
  );
  const treeError = errors.conditions ?? errors['conditions.operator'];
  const treeErrorText = treeError && (
    <Typography variant="omega" textColor="danger600" role="alert">
      {t(`ecommerce.promotions.form.errors.${treeError}`)}
    </Typography>
  );

  // A tree saved with another structure that cannot be rewritten as scenarios.
  if (!isScenarioTree(tree)) {
    return (
      <Flex direction="column" alignItems="stretch" gap={3}>
        {sentence}
        <NoticeBar
          wrap
          text={t(`${p}.complex`)}
          actions={
            !readOnly && (
              <Button
                size="S"
                variant="secondary"
                disabled={disabled}
                onClick={() => onChange({ ...tree, operator: 'AND', children: [] })}
              >
                {t(`${p}.startOver`)}
              </Button>
            )
          }
        />
        {treeErrorText}
      </Flex>
    );
  }

  const scenarios = scenariosOf(tree);
  const full = countConditions(scenarios) >= MAX_CONDITIONS;

  const conditionList = (conditions: ConditionNode[], scenario: number) =>
    conditions.map((node, i) => (
      <Fragment key={node.key}>
        {i > 0 && <Connector text={t(`${p}.and`)} />}
        {conditionRow(node, scenarioConditionPath(tree, scenario, i), () =>
          onChange(removeScenarioCondition(tree, scenario, i))
        )}
      </Fragment>
    ));

  const addConditionButton = (scenario: number) =>
    !readOnly && (
      <Button
        variant="secondary"
        size="S"
        disabled={disabled || full}
        onClick={() => onChange(addScenarioCondition(tree, scenario))}
      >
        {t(`${p}.add`)}
      </Button>
    );

  return (
    <Flex direction="column" alignItems="stretch" gap={3}>
      {scenarios.length === 0 ? (
        <NoticeBar
          wrap
          text={[t(`${p}.hint`), hasBuyXGetY ? t(`${p}.buyXGetYHint`) : '']
            .filter(Boolean)
            .join(' ')}
        />
      ) : (
        <NoticeBar wrap text={t(`${p}.scenariosHint`)} />
      )}

      {sentence}

      {scenarios.length > 0 && (
        <>
          {scenarios.map((conditions, s) => (
            <Fragment key={tree.children[s].key}>
              {s > 0 && <Connector text={t(`${p}.or`)} />}
              <Box
                padding={3}
                hasRadius
                borderColor={errors[conditionPath([s])] ? 'danger600' : 'primary200'}
                background="neutral100"
              >
                <Flex direction="column" alignItems="stretch" gap={3}>
                  <Flex justifyContent="space-between" alignItems="center" gap={3} wrap="wrap">
                    <Typography variant="delta" fontWeight="semiBold">
                      {t(`${p}.scenario`, { number: s + 1 })}
                      <Typography variant="omega" textColor="neutral600" fontWeight="regular">
                        {' — '}
                        {t(`${p}.scenarioAll`)}
                      </Typography>
                    </Typography>
                    {!readOnly && (
                      <Button
                        variant="danger-light"
                        size="S"
                        disabled={disabled}
                        onClick={() => onChange(removeScenario(tree, s))}
                      >
                        {t(`${p}.removeScenario`)}
                      </Button>
                    )}
                  </Flex>
                  {conditionList(conditions, s)}
                  {!readOnly && <Flex>{addConditionButton(s)}</Flex>}
                </Flex>
              </Box>
            </Fragment>
          ))}
        </>
      )}

      {!readOnly && full && (
        <Typography variant="pi" textColor="neutral600">
          {t(`${p}.limit`, { max: MAX_CONDITIONS })}
        </Typography>
      )}

      {treeErrorText}
    </Flex>
  );
};

export default ConditionsEditor;
