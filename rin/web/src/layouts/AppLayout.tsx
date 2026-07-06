import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Wordmark, Button } from '../components/ui';
import { auth } from '../auth';

const tabs = [
  { to: '/app', label: 'Brands', end: true },
  { to: '/app/wallet', label: 'Wallet' },
];

export function AppLayout() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <Wordmark />
        <Button
          variant="ghost"
          onClick={() => {
            auth.clearConsumer();
            navigate('/app/login');
          }}
        >
          Sign out
        </Button>
      </header>
      <main className="flex-1 overflow-y-auto p-4">
        <Outlet />
      </main>
      <nav className="flex border-t border-slate-100">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `flex-1 py-3 text-center text-sm font-medium ${isActive ? 'text-spark' : 'text-slate-400'}`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
