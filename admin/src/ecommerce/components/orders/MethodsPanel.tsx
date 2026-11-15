import styled from 'styled-components';

/**
 * A list of methods on the left and the chosen method's fields on the right (Ship, Add / Edit
 * shipping charge).
 */
/** The delivery methods: the list on the left, the chosen method's fields on the right. */
export const MethodsPanel = styled.div`
  display: flex;
  border: 1px solid ${({ theme }) => theme.colors.neutral150};
  border-radius: ${({ theme }) => theme.borderRadius};
  overflow: hidden;
  background: ${({ theme }) => theme.colors.neutral0};
`;

export const MethodList = styled.div`
  display: flex;
  flex-direction: column;
  flex: 0 0 240px;
  max-width: 40%;
  /* The last item's bottom border sits under the panel's own when the list is the taller side. */
  margin-bottom: -1px;
`;

/** Unselected: darker and with the list's right border; the selected one joins the right pane. */
export const MethodItem = styled.button<{ $selected: boolean }>`
  all: unset;
  box-sizing: border-box;
  cursor: pointer;
  padding: ${({ theme }) => theme.spaces[4]};
  background: ${({ theme, $selected }) => ($selected ? theme.colors.neutral0 : theme.colors.neutral100)};
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
  border-right: 1px solid ${({ theme, $selected }) => ($selected ? 'transparent' : theme.colors.neutral150)};
  color: ${({ theme, $selected }) => ($selected ? theme.colors.neutral800 : theme.colors.neutral700)};
  font-size: 1.4rem;
  line-height: 1.43;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;

  &:hover {
    color: ${({ theme }) => theme.colors.neutral800};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: -2px;
  }
  &:disabled {
    cursor: default;
  }
`;

/** Fills the rest of the list's height with its right border. */
export const MethodListRest = styled.div`
  flex: 1;
  background: ${({ theme }) => theme.colors.neutral100};
  border-right: 1px solid ${({ theme }) => theme.colors.neutral150};
`;
