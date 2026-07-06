import { Link } from 'react-router-dom';
import { Wordmark, Button, SparkMark } from '../components/ui';

export default function Landing() {
  return (
    <div className="min-h-screen">
      {/* Nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Wordmark />
        <div className="flex items-center gap-2">
          <Link to="/app/login"><Button variant="ghost">Get the app</Button></Link>
          <Link to="/dashboard/login"><Button variant="outline">For brands</Button></Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-14 text-center">
        <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
          <SparkMark size={14} /> Identity infrastructure for physical commerce
        </div>
        <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          One Identity. Every Store.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-slate-500">
          Shoppers identify once and connect to any brand with a single trusted identity.
          Brands onboard verified, consented customers — without replacing their CRM, POS or ERP.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link to="/dashboard/login"><Button>Start as a brand</Button></Link>
          <Link to="/app/login"><Button variant="outline">Continue with Spark</Button></Link>
        </div>
      </section>

      {/* Value tiles */}
      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-16 sm:grid-cols-3">
        {[
          { t: 'For shoppers', d: 'No forms. One consent, granular and revocable. Receipts & warranties in one wallet.' },
          { t: 'For brands', d: 'Every branch shows a branded QR. Verified members land straight in your primary CRM/POS.' },
          { t: 'For malls', d: 'Mall-wide identity: who’s shopping across your stores, with consent-first analytics.' },
        ].map((v) => (
          <div key={v.t} className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="mb-2 h-8 w-8 rounded-lg bg-spark/10 p-1.5"><SparkMark size={20} /></div>
            <h3 className="font-semibold text-ink">{v.t}</h3>
            <p className="mt-1 text-sm text-slate-500">{v.d}</p>
          </div>
        ))}
      </section>

      {/* How it works */}
      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-slate-400">How it works</h2>
          <div className="mt-8 grid gap-8 sm:grid-cols-3">
            {[
              ['1', 'Scan', 'The branch shows a branded QR at checkout.'],
              ['2', 'Consent', 'The shopper approves exactly the fields the brand asked for.'],
              ['3', 'Connected', 'The brand gets a verified member; the shopper gets one more brand in their app.'],
            ].map(([n, t, d]) => (
              <div key={n} className="text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-spark text-sm font-semibold text-white">{n}</div>
                <h3 className="mt-3 font-semibold text-ink">{t}</h3>
                <p className="mt-1 text-sm text-slate-500">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="mx-auto max-w-6xl px-6 py-12 text-center">
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm text-slate-500">
          <span>Consent-first</span><span className="text-slate-300">•</span>
          <span>One-click revoke</span><span className="text-slate-300">•</span>
          <span>No cross-brand data sharing</span><span className="text-slate-300">•</span>
          <span>KVKK / GDPR aligned</span>
        </div>
      </section>

      <footer className="border-t border-slate-200 py-8 text-center text-xs text-slate-400">
        © {new Date().getFullYear()} Spark Platform · Retail Identity Network
      </footer>
    </div>
  );
}
