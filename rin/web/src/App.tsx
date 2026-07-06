import { Navigate, Route, Routes } from 'react-router-dom';
import Landing from './pages/Landing';
import { DashboardLayout } from './layouts/DashboardLayout';
import { AppLayout } from './layouts/AppLayout';
import DashLogin from './pages/dashboard/Login';
import Overview from './pages/dashboard/Overview';
import Branches from './pages/dashboard/Branches';
import BrandConsent from './pages/dashboard/BrandConsent';
import QrGenerator from './pages/dashboard/QrGenerator';
import Customers from './pages/dashboard/Customers';
import Integrations from './pages/dashboard/Integrations';
import Campaigns from './pages/dashboard/Campaigns';
import AppLogin from './pages/app/Login';
import Connected from './pages/app/Connected';
import Consent from './pages/app/Consent';
import Wallet from './pages/app/Wallet';
import { auth } from './auth';

function RequireMerchant({ children }: { children: JSX.Element }) {
  return auth.merchantToken() ? children : <Navigate to="/dashboard/login" replace />;
}
function RequireConsumer({ children }: { children: JSX.Element }) {
  return auth.consumerToken() ? children : <Navigate to="/app/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />

      {/* Brand dashboard */}
      <Route path="/dashboard/login" element={<DashLogin />} />
      <Route
        path="/dashboard"
        element={
          <RequireMerchant>
            <DashboardLayout />
          </RequireMerchant>
        }
      >
        <Route index element={<Overview />} />
        <Route path="branches" element={<Branches />} />
        <Route path="brand" element={<BrandConsent />} />
        <Route path="qr" element={<QrGenerator />} />
        <Route path="customers" element={<Customers />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="campaigns" element={<Campaigns />} />
      </Route>

      {/* Consumer app */}
      <Route path="/app/login" element={<AppLogin />} />
      <Route path="/app/consent/:token" element={<Consent />} />
      <Route
        path="/app"
        element={
          <RequireConsumer>
            <AppLayout />
          </RequireConsumer>
        }
      >
        <Route index element={<Connected />} />
        <Route path="wallet" element={<Wallet />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
