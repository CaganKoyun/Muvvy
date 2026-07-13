# Spark RIN — Screen Map & Gap Analysis

The flow being built (the essence):
> Brand signs in → picks a **branch** → branch shows a **branded QR** → shopper scans →
> **branded consent screen** (brand logo + branch) → shopper approves → the brand is
> **added to the shopper's app**, and the brand **sees the new customer live in its
> dashboard** and the customer is **routed into the brand's primary tool** (CRM/POS/SaaS).

Three surfaces: **Landing** (public), **Brand Dashboard** (merchant), **Consumer App**.

---

## 1. Landing (public — corporate, minimal)
- Hero: "One Identity. Every Store." + one line, two CTAs (*For brands* / *Get the app*).
- 3 value tiles: Shoppers · Brands · Malls.
- How it works (3 steps: Scan → Consent → Connected).
- Trust strip: consent-first · one-click revoke · KVKK/GDPR.
- Minimal footer.

## 2. Brand Dashboard (auth: brand/merchant)
| # | Screen | Purpose |
|---|--------|---------|
| D1 | **Sign in** | client_id / client_secret → brand token |
| D2 | **Overview** | KPIs (new members, consent rate, avg checkout, branches) + **live recent customers** |
| D3 | **Branches (Şubeler)** | list / add branch (name, code, city); pick active branch |
| D4 | **Brand & Consent** | branding (logo, display name, primary color, post-consent redirect) + Consent Engine (requested scopes required/optional) |
| D5 | **Generate QR** | pick branch → create request → **branded QR** + live status → consented customer |
| D6 | **Customers** | grants list (member since, scopes) + detail (only consented fields) + revoked state |
| D7 | **Integrations** | catalog (Salesforce, HubSpot, SAP, Dynamics, NCR, Cloud POS, Custom REST…) → connect via **API key/URL** → mark **Primary solution** (where consented users are routed) → sync log |
| D8 | **Campaigns** | consent-safe send (targeted vs suppressed) |

## 3. Consumer App (auth: consumer)
| # | Screen | Purpose |
|---|--------|---------|
| A1 | **Continue with Spark** | email / social login |
| A2 | **Branded consent** | brand logo + branch + scopes (toggles; required locked) → approve / deny → **redirect to brand's solution** |
| A3 | **Connected brands** (Consent Center) | brands I joined (logo, status) → manage / **one-click revoke** |
| A4 | **Wallet** | receipts, warranties, coupons, cards, timeline |
| A5 | **Notifications** | campaigns, coupons, warranty reminders |
| A6 | **Profile & privacy** | my data + Transparency Center (audit) |

---

## Gaps vs current backend → what this iteration adds
1. **Brand branding** — `displayName`, `logoUrl`, `primaryColor`, `postConsentRedirectUrl` on the brand.
2. **Branch (şube)** — new entity under the brand; `branchId` on the identity request.
3. **Branded consent payload** — the consumer consent view returns brand branding + branch.
4. **Integrations: primary routing** — a connector can be flagged **primary**; on consent the customer is pushed there first and the shopper is handed a **redirect** to the brand's solution.
5. **Frontend** — none existed; build Landing + Dashboard + Consumer App (React + Vite + Tailwind), wired to the API.
