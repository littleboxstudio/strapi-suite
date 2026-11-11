import { Navigate, Route, Routes } from 'react-router-dom';
import { ErrorPage } from '../pages/ErrorPage';
import EcommerceLayout from './EcommerceLayout';
import EcommerceComingSoon from './components/EcommerceComingSoon';
import { ProductListPage } from './pages/ProductListPage';
import { ProductEditPage } from './pages/ProductEditPage';

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
      <Route path="settings" element={<EcommerceComingSoon />} />
      <Route path="*" element={<ErrorPage />} />
    </Routes>
  </EcommerceLayout>
);

export { EcommerceApp };
