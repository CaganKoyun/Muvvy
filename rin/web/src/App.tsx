import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { Spinner } from './components/ui';
import Landing from './pages/Landing';
import { DashboardLayout } from './layouts/DashboardLayout';
import { AppLayout } from './layouts/AppLayout';
import DashLogin from './pages/dashboard/Login';
import Signup from './pages/dashboard/Signup';
import AcceptInvite from './pages/dashboard/AcceptInvite';
import Team from './pages/dashboard/Team';
import Billing from './pages/dashboard/Billing';
import Overview from './pages/dashboard/Overview';
import Branches from './pages/dashboard/Branches';
import BrandConsent from './pages/dashboard/BrandConsent';
import QrGenerator from './pages/dashboard/QrGenerator';
import Customers from './pages/dashboard/Customers';
import Integrations from './pages/dashboard/Integrations';
import Campaigns from './pages/dashboard/Campaigns';
import Malls from './pages/dashboard/Malls';
import AppLogin from './pages/app/Login';
import Connected from './pages/app/Connected';
import Consent from './pages/app/Consent';
import Wallet from './pages/app/Wallet';
import Notifications from './pages/app/Notifications';
import Profile from './pages/app/Profile';

function Splash() {
  return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;
}
function RequireBrand({ children }: { children: JSX.Element }) {
  const { session, role, loading } = useAuth();
  if (loading) return <Splash />;
  if (!session) return <Navigate to="/dashboard/login" replace />;
  if (role !== 'brand') return <Navigate to="/app" replace />;
  return children;
}
function RequireConsumer({ children }: { children: JSX.Element }) {
  const { session, role, loading } = useAuth();
  if (loading) return <Splash />;
  if (!session) return <Navigate to="/app/login" replace />;
  if (role === 'brand') return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />

      <Route path="/dashboard/login" element={<DashLogin />} />
      <Route path="/dashboard/signup" element={<Signup />} />
      <Route path="/dashboard/accept" element={<AcceptInvite />} />
      <Route path="/dashboard" element={<RequireBrand><DashboardLayout /></RequireBrand>}>
        <Route index element={<Overview />} />
        <Route path="branches" element={<Branches />} />
        <Route path="brand" element={<BrandConsent />} />
        <Route path="qr" element={<QrGenerator />} />
        <Route path="customers" element={<Customers />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="campaigns" element={<Campaigns />} />
        <Route path="malls" element={<Malls />} />
        <Route path="team" element={<Team />} />
        <Route path="billing" element={<Billing />} />
      </Route>

      <Route path="/app/login" element={<AppLogin />} />
      <Route path="/app/consent/:token" element={<Consent />} />
      <Route path="/app" element={<RequireConsumer><AppLayout /></RequireConsumer>}>
        <Route index element={<Connected />} />
        <Route path="wallet" element={<Wallet />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="profile" element={<Profile />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
