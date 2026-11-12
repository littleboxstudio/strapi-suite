import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** The element in the fixed top bar where a page puts its action buttons. */
const HeaderActionsContext = createContext<HTMLElement | null>(null);

const HeaderActionsProvider = HeaderActionsContext.Provider;

/**
 * Renders the page's action buttons (Save, Delete, ...) in the module's fixed top bar, so they stay
 * visible while the content scrolls. Renders nothing until the slot is mounted.
 */
const HeaderActions = ({ children }: { children: ReactNode }) => {
  const slot = useContext(HeaderActionsContext);
  return slot ? createPortal(children, slot) : null;
};

export { HeaderActions, HeaderActionsProvider };
