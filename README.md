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
grant insert on sales_dash.targets to dashboard_ro;            -- admin submits targets (once per month)
revoke update, delete on sales_dash.targets from dashboard_ro; -- so submitted targets can't be changed by the app

-- record of who submitted each month's targets and when
create table if not exists sales_dash.target_submissions (
  month        date primary key,
  submitted_by text not null,
  submitted_at timestamptz not null default now()
);
grant select, insert on sales_dash.target_submissions to dashboard_ro;

-- sales-person targets use the dashboard's roster (src/lib/roster.ts), which has people that are not in
-- sales_dash.sales_owners — drop the name check so every rostered person can get a target
alter table sales_dash.targets drop constraint if exists targets_sold_by_fkey;
```

Sales-person targets are stored in the same table (`center_id` null, `sold_by` = the roster name). They are
submitted together with the center targets, each center's people must add up to exactly the center target,
and they only appear in the dashboard's drill-down rows — they never change any center or total figure.

## Cross-branch 50/50 splits (setup, once)
When a client registered at one branch buys at another, the admin records the visiting branch's invoice on the
**50/50 Splits** tab; half of every payment line of that invoice moves from its seller to the chosen person at the
client's home branch. Splits are insert-only; cancelling stamps who/when/why and keeps the record.
```sql
create table if not exists sales_dash.invoice_splits (
  id            bigserial primary key,
  invoice_no    text not null,
  client_name   text,
  from_center   text not null,          -- Zenoti center of the invoice (snapshot)
  from_seller   text,                   -- seller(s) on the invoice (snapshot)
  to_center_id  text not null references sales_dash.centers(center_id),
  to_person     text not null,          -- roster name at the home branch
  share         numeric not null default 0.5 check (share = 0.5),
  invoice_total numeric not null,       -- amount paid when split (snapshot)
  note          text,
  created_by    text not null,
  created_at    timestamptz not null default now(),
  cancelled_by  text,
  cancelled_at  timestamptz,
  cancel_reason text
);
create unique index if not exists invoice_splits_active_uq on sales_dash.invoice_splits (invoice_no) where cancelled_at is null;
grant select, insert on sales_dash.invoice_splits to dashboard_ro;
grant usage on sequence sales_dash.invoice_splits_id_seq to dashboard_ro;
grant update (cancelled_by, cancelled_at, cancel_reason) on sales_dash.invoice_splits to dashboard_ro; -- cancel only
```
Until this table exists the tab shows "not set up" and the dashboard is unaffected. With no active splits every
figure is exactly what it was before this feature.

## Changing locked targets (owner only)
Targets are submitted once per month from the Targets page and are then locked. To change them, the owner edits
them in the Supabase SQL Editor, e.g.:
```sql
-- change one center
update sales_dash.targets t set target = 1000000
from sales_dash.centers c
where t.center_id = c.center_id and t.month = '2026-11-01' and c.zenoti_name = 'Ludhiana, Punjab';

-- change one sales person
update sales_dash.targets set target = 500000 where month = '2026-11-01' and sold_by = 'Vanita Pasbola - (VV)';

-- or reopen the whole month (centers AND people) so the admin can submit again
delete from sales_dash.targets where month = '2026-11-01';
delete from sales_dash.target_submissions where month = '2026-11-01';
```
The admin can only submit targets for the present month.
