# Clinic-wise Sales Dashboard

Live version of the "Daily Report" Google Sheet, built on Zenoti data in Supabase (`sales_dash.collections`, synced every 30 min).

- Calculation rules (and the sheet bugs it reproduces): [SHEET_LOGIC.md](SHEET_LOGIC.md), [src/lib/compat.ts](src/lib/compat.ts)
- Engine: [src/lib/report.ts](src/lib/report.ts) — tests in `report.test.ts`
- Centers + default targets: [src/lib/centers.ts](src/lib/centers.ts) · Sales-owner roster: [src/lib/roster.ts](src/lib/roster.ts)
- Monthly targets edited by the admin are stored in `sales_dash.targets`; months without saved targets use the defaults.

## Logins
Two accounts, configured by environment variables (password hashes only):
- **Admin** (`ADMIN_EMAIL`) — views everything and can edit targets.
- **Viewer** (`VIEWER_EMAIL`) — view only.

Change a password: `node scripts/hash-password.cjs "new-password"` and put the output in `ADMIN_PASSWORD_HASH` / `VIEWER_PASSWORD_HASH`.

## Run locally
Requires Node.js 20+.
```
cp .env.example .env.local   # fill in the values
npm install
npm test
npm start                    # http://localhost:3000  (same as npm run dev)
```
Check against the sheet: `npx tsx scripts/reconcile.ts`

## Deploy (Vercel)
1. Import the GitHub repo in Vercel (framework: Next.js, no build settings needed).
2. Project → Settings → Environment Variables: add every variable from `.env.example`
   (`DATABASE_URL`, `AUTH_SECRET`, `ADMIN_*`, `VIEWER_*`, optional `SHEET_COMPAT`) with the values from your `.env.local`.
3. Deploy.

## Database permissions
The app's Postgres role needs:
```sql
grant usage on schema sales_dash to dashboard_ro;
grant select on all tables in schema sales_dash to dashboard_ro;
grant insert, update on sales_dash.targets to dashboard_ro;   -- admin target edits
```
