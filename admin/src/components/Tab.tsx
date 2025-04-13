import { useState, createContext, useContext, ReactNode } from 'react';
import { Box, Typography } from '@strapi/design-system';
import styled, { useTheme } from 'styled-components';
import { Item } from 'src/components/menu/types';

interface TabContextType {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isDarkMode: boolean;
}

const TabContext = createContext<TabContextType | undefined>(undefined);

const useTabContext = () => {
  const context = useContext(TabContext);
  if (!context) {
    throw new Error('Tab components must be used within a Tab component');
  }
  return context;
};

const TabHeader = styled(Box)`
  display: flex;
  width: 100%;
  align-self: start;
  height: auto;
  border-radius: 4px;
  background-color: ${({ $dark }) => ($dark ? '#1a1a25' : '#f0f0fa')};
`;

const TabItem = styled(Box)`
  display: flex;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  padding: 0 15px;
  height: 40px;
  color: ${({ $value, $activeTab }) => ($value === $activeTab ? '#7b79ff' : '#666687')};
  border-bottom: ${({ $value, $activeTab }) =>
    $value === $activeTab ? '2px solid #7b79ff' : '2px solid transparent'};
`;

const TabBody = styled(Box)`
  display: flex;
  flex-direction: column;
  width: 100%;
  align-self: start;
  height: auto;
`;

interface TabComposition {
  Header: React.FC<TabHeaderProps>;
  Item: React.FC<TabItemProps>;
  Body: React.FC<TabBodyProps>;
}

interface TabProps {
  data?: Item;
  onChangeEvent?: (data: Item) => void;
  onCheckEvent?: (isValid: boolean) => void;
  children: ReactNode;
  defaultTab?: string;
}

interface TabItemProps {
  value: string;
  children: ReactNode;
  onClick?: () => void;
}

interface TabHeaderProps {
  children: ReactNode;
}

interface TabBodyProps {
  value: string;
  children: ReactNode;
}

export const Tab: React.FC<TabProps> & TabComposition = ({ children, defaultTab = 'link' }) => {
  const theme = useTheme();
  const [activeTab, setActiveTab] = useState(defaultTab);
  const isDarkMode = theme.colors.alternative100 === '#181826';
  return (
    <TabContext.Provider value={{ activeTab, setActiveTab, isDarkMode }}>
      {children}
    </TabContext.Provider>
  );
};

const TabItemContainer: React.FC<TabItemProps> = ({ value, children, onClick }) => {
  const { activeTab, setActiveTab } = useTabContext();
  const handleClick = () => {
    setActiveTab(value);
    if (onClick) onClick();
  };
  return (
    <TabItem $value={value} $activeTab={activeTab} onClick={handleClick}>
      <Typography variant="sigma">{children}</Typography>
    </TabItem>
  );
};

const TabHeaderContainer: React.FC<TabHeaderProps> = ({ children }) => {
  const { isDarkMode } = useTabContext();
  return <TabHeader $dark={isDarkMode}>{children}</TabHeader>;
};

const TabBodyContainer: React.FC<TabBodyProps> = ({ value, children }) => {
  const { activeTab } = useTabContext();
  if (value !== activeTab) {
    return null;
  }
  return <TabBody>{children}</TabBody>;
};

Tab.Header = TabHeaderContainer;
Tab.Item = TabItemContainer;
Tab.Body = TabBodyContainer;
