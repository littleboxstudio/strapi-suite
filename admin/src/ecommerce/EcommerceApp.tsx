import { Navigate, Route, Routes } from 'react-router-dom';
import { ErrorPage } from '../pages/ErrorPage';
import EcommerceLayout from './EcommerceLayout';
import EcommerceComingSoon from './components/EcommerceComingSoon';
import { ProductListPage } from './pages/ProductListPage';
import { ProductEditPage } from './pages/ProductEditPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { EmailTemplateEditorPage } from './pages/settings/EmailTemplateEditorPage';

const EcommerceApp = () => (
  <EcommerceLayout>
    <Routes>
      <Route index element={<Navigate to="products" replace />} />
      <Route path="products" element={<ProductListPage />} />
      <Route path="products/new" element={<ProductEditPage />} />
      <Route path="products/:id" element={<ProductEditPage />} />
      <Route path="orders" element={<EcommerceComingSoon />} />
      <Route path="customers" element={<EcommerceComingSoon />} />
      <Route path="promotions" element={<EcommerceComingSoon />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="settings/:section" element={<SettingsPage />} />
      <Route path="settings/email-templates/:type/:locale" element={<EmailTemplateEditorPage />} />
      <Route path="*" element={<ErrorPage />} />
    </Routes>
  </EcommerceLayout>
);

export { EcommerceApp };
