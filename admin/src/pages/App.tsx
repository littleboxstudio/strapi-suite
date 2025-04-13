import { Routes, Route } from 'react-router-dom';
import { SettingsProvider } from '../contexts/settings';
import { ErrorPage } from './ErrorPage';
import { HomePage } from './HomePage';
import { SlugSettingsPage } from './SlugSettingsPage';
import { AttributeSettingsPage } from './AttributeSettingsPage';
import { MenuSettingsPage } from './MenuSettingsPage';
import { MenuSettingsEditPage } from './MenuSettingsEditPage';
import { ParameterSettingsPage } from './ParameterSettingsPage';
import { TranslationSettingsPage } from './TranslationSettingsPage';
import { TemplateSettingsPage } from './TemplateSettingsPage';

const App = () => {
  return (
    <SettingsProvider>
      <Routes>
        <Route index element={<HomePage />} />
        <Route path="slug" element={<SlugSettingsPage />} />
        <Route path="attribute" element={<AttributeSettingsPage />} />
        <Route path="menu" element={<MenuSettingsPage />} />
        <Route path="menu/:documentId" element={<MenuSettingsEditPage />} />
        <Route path="parameter" element={<ParameterSettingsPage />} />
        <Route path="translation" element={<TranslationSettingsPage />} />
        <Route path="template" element={<TemplateSettingsPage />} />
        <Route path="*" element={<ErrorPage />} />
      </Routes>
    </SettingsProvider>
  );
};

export default App;
