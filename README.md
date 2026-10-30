# Mie Sukses Creative Marketplace

Local MVP: React, TypeScript, Vite, Express, PostgreSQL sessions, and PostgreSQL 18. The payment flow is simulated; demo listings and artwork are synthetic and do not claim real reviews or transactions.

## Prerequisites

- Node.js 20+ and npm.
- Local PostgreSQL 18 with database `mie_sukses_marketplace` and role `marketplace_app` already created.
- Network access to the npm registry for the first `npm.cmd install`.

## Configure and start

In PowerShell from this directory:

```powershell
npm.cmd install
Copy-Item .env.example .env
```

Edit `.env` locally. Set `DATABASE_URL` to the local database and `SESSION_SECRET` to a random value of at least 32 characters (generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`). Never commit `.env`.

If the `marketplace_app` role has no password set, use a local PostgreSQL administrator and `psql` to run `\password marketplace_app` interactively, then put that password in the local `.env` connection URL. The application never prints it. The migration and seed commands refuse to run unless `current_database()` is exactly `mie_sukses_marketplace`.

```powershell
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run dev
```

Open <http://127.0.0.1:5173>. Seed creates four synthetic public listings and local demo images. The demo seller accounts have random, undisclosed passwords; provision an administrator and review seller applications to exercise authenticated seller flows.

## Commands

- `npm.cmd run dev` — frontend and API on `127.0.0.1`.
- `npm.cmd run build` — production frontend and backend builds.
- `npm.cmd test` — policy tests.
- `npm.cmd run db:migrate` — apply unapplied SQL migrations in a transaction after verifying the local target.
- `npm.cmd run db:seed` — repeatable demo seed (does not reset existing data).
- `npm.cmd run admin:create` — interactively create/promote an administrator; password input is masked.
- `npm.cmd start` — serve the production build and API on the configured port.

## Configuration

- `DATABASE_URL`: local `marketplace_app` PostgreSQL connection string.
- `SESSION_SECRET`: random session signing secret, minimum 32 characters.
- `PORT`: API port, default `3000`.
- `WEB_ORIGIN`: allowed browser origin, default `http://127.0.0.1:5173`.
- `UPLOAD_DIR`: local media directory, default `./storage`.
- `NODE_ENV`: set `production` for production cookie flags and static frontend serving.

## MVP policies and limitations

- Payment confirmation moves all orders in a checkout batch from `pending` to `paid`. Freelancers accept or reject only paid orders (rejection requires a reason), then move accepted orders to `in_progress` and submit work. Customers may cancel unpaid `pending` orders directly or cancel `paid` orders for an atomic simulated refund. Cancellation is unavailable after Freelancer acceptance. Complaint filing is limited to `work_submitted`.
- A rejected seller application does not grant a role; a later application is allowed. A unique index allows only one pending application per user.
- Deactivation is deferred: behavior with existing orders and session revocation is not implemented.
- Checkout requires buyer email, phone, a project brief, and a payment method. The first `(buyer, key)` use defines that logical attempt and is replayed after cart clearing; a deliberate new checkout uses a new UUID. Checkout writes the batch, order/contact snapshots, payment record, initial events, and cart clearing in one transaction.
- Bank transfer, e-wallet, and QRIS are simulations only. Bank and destination values are clearly marked demo values. E-wallet confirmation accepts only the fixed local demo PIN `123456`; never enter a real PIN, OTP, or account secret. QRIS displays a transaction-specific, non-scannable demo pattern. Confirmation changes local records only; no external payment or transfer occurs. Earnings are credited only for tracked simulated payments. Historical untracked orders receive no fabricated earnings.
- Service images and order deliverables use local `UPLOAD_DIR` storage. Each upload is capped at 12 MB and gets a generated UUID filename. Local disk can be lost with the machine or deployment filesystem; production needs private durable storage with equivalent per-order authorization.
- Withdrawals are local simulations, require at least Rp50,000, debit the user's available wallet balance atomically, and complete without Admin approval; they do not represent a bank transfer.
- Demo seller credentials are deliberately not exposed. The normal registration flow creates buyer accounts; use the admin CLI and application review to establish a seller.
- Rate limiting, email verification, and account deactivation are not implemented. Refunds and complaints are recorded as simulated local settlement outcomes; external payment providers are not integrated.
