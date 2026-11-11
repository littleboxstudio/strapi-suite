import { Navigate, Route, Routes } from 'react-router-dom';
import { ErrorPage } from '../pages/ErrorPage';
import EcommerceLayout from './EcommerceLayout';
import EcommerceComingSoon from './components/EcommerceComingSoon';
import { ProductListPage } from './pages/ProductListPage';
import { ProductEditPage } from './pages/ProductEditPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { EmailTemplateEditorPage } from './pages/settings/EmailTemplateEditorPage';
import { CustomerListPage } from './pages/customers/CustomerListPage';
import { CustomerDetailPage } from './pages/customers/CustomerDetailPage';
import { OrderListPage } from './pages/orders/OrderListPage';
import { OrderCreatePage } from './pages/orders/OrderCreatePage';
import { OrderDetailPage } from './pages/orders/OrderDetailPage';
import { PromotionListPage } from './pages/promotions/PromotionListPage';
import { StoreCreditListPage } from './pages/promotions/StoreCreditListPage';

const EcommerceApp = () => (
  <EcommerceLayout>
    <Routes>
      <Route index element={<Navigate to="products" replace />} />
      <Route path="products" element={<ProductListPage />} />
      <Route path="products/new" element={<ProductEditPage />} />
      <Route path="products/:id" element={<ProductEditPage />} />
      <Route path="orders" element={<OrderListPage />} />
      <Route path="orders/new" element={<OrderCreatePage />} />
      <Route path="orders/:id" element={<OrderDetailPage />} />
      <Route path="customers" element={<CustomerListPage />} />
      <Route path="customers/:id" element={<CustomerDetailPage />} />
      <Route path="promotions" element={<PromotionListPage />} />
      <Route path="promotions/store-credits" element={<StoreCreditListPage />} />
      {/* The promotion editor arrives with Task 12. */}
      <Route path="promotions/new" element={<EcommerceComingSoon />} />
      <Route path="promotions/:id" element={<EcommerceComingSoon />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="settings/:section" element={<SettingsPage />} />
      <Route path="settings/email-templates/:type/:locale" element={<EmailTemplateEditorPage />} />
      <Route path="*" element={<ErrorPage />} />
    </Routes>
  </EcommerceLayout>
);

export { EcommerceApp };
