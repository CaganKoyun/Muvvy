import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Wordmark, Button } from '../components/ui';
import { auth } from '../auth';

const nav = [
  { to: '/dashboard', label: 'Overview', end: true },
  { to: '/dashboard/branches', label: 'Branches' },
  { to: '/dashboard/brand', label: 'Brand & Consent' },
  { to: '/dashboard/qr', label: 'Generate QR' },
  { to: '/dashboard/customers', label: 'Customers' },
  { to: '/dashboard/integrations', label: 'Integrations' },
  { to: '/dashboard/campaigns', label: 'Campaigns' },
];

export function DashboardLayout() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white p-4 md:flex">
        <div className="px-2 py-2">
          <Wordmark />
          <div className="mt-1 pl-9 text-xs font-medium text-slate-400">Brand Dashboard</div>
        </div>
        <nav className="mt-4 space-y-1">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive ? 'bg-spark/10 text-spark' : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto">
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              auth.clearMerchant();
              navigate('/dashboard/login');
            }}
          >
            Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden p-6 md:p-8">
        <div className="mx-auto max-w-5xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
