# Bean Culture — Square ordering app

A mobile-first self-order web app for Bean Culture cafe, deployed at
**app.beanculture.com.au** (Railway) and connected to Square. Customers browse a
live menu, order dine-in (with table) or takeaway, pay by card / Apple Pay /
Google Pay, sign in to see order history, and redeem Square loyalty points.

Everything menu-, stock-, hours-, loyalty-, customer- and order-related is
sourced live from **Square** so it stays in sync with the cafe's POS.

---

## Features

**Storefront (mobile-first)**
- Hero carousel with ad slides that link to a category or the account page.
- Menu = the child categories of the Square master category **"APP"/"APPs"**,
  with the "APP" prefix stripped. Only those curated categories show.
- Sticky category chips + live search across the menu.
- Item sheets with variations, modifier groups (single/multi, prices), notes.
- Live **sold-out** state from Square (per-location `sold_out` + `ecom_visibility`).
- Cart, and a checkout that **requires a name** (and a **table number** for dine-in).
- QR per table (`?table=12`) pre-fills dine-in + table; the customer still adds their name.
- Bean Culture **pastel-pink theme** + a per-device **theme customiser** (presets + custom colours), remembered on return.

**Accounts & loyalty**
- Passwordless sign-in: phone (+ name) → looked up/created as a Square customer, remembered on device.
- Account page shows **order history** (Square SearchOrders) and **loyalty balance**.
- Redeem loyalty reward tiers at checkout (e.g. **Free Coffee! = 10 Stars**); the discount is applied to the order and the card step is skipped if the total reaches $0.

**Operations**
- **Business hours** from the Square location → open/closed banner; ordering blocked when closed unless **pre-order** is enabled.
- **Test/comp code** (`COMP_COUPON_CODE`) to place $0 test orders.
- **Merchant portal** at `/admin`: store status, live category list, and an editor/exporter for theme/hero/announcement settings.

---

## Architecture

```
client/   Vite + React mobile storefront (theme engine, hero, menu, cart,
          checkout, account, theme picker, admin)
server/   Express API + Square integration; serves the built client
  lib/squareClient.js  core REST client + config
  lib/catalog.js       menu (APP children, prefix strip, sold-out, sync)
  lib/orders.js        create / pay / $0-complete / history
  lib/customers.js     passwordless phone identity
  lib/loyalty.js       program tiers, balance, redemption
  lib/hours.js         open/closed from Square business hours
  lib/settings.js      theme / hero / announcement (env-overridable)
```

API: `/api/config`, `/api/menu`, `/api/hours`, `/api/auth`, `/api/loyalty`,
`/api/history`, `/api/orders`, `/api/pay`, `/api/admin/overview`.

---

## Configuration

All configuration is via environment variables in Railway — see
`server/.env.example` for the full annotated list. Highlights:

- `SQUARE_PARENT_CATEGORY` (default `APPs`) — the master category whose children become the menu.
- `PREORDER_ENABLED` / `ORDERING_DISABLED` — hours behaviour.
- `COMP_COUPON_CODE` — test/comp code (remove before public launch).
- `ADMIN_PASSCODE` — protects `/admin`.
- `SETTINGS_JSON` — live theme/hero/announcement overrides (exported by `/admin`).

## Managing the app day-to-day

- **Menu, prices, sold-out, hours** → managed in **Square**; the app syncs automatically (≤45s).
- **Which categories appear** → put items under the **APP** master category in Square.
- **Theme / hero ads / announcement** → edit in `/admin`, copy the JSON, paste into the `SETTINGS_JSON` Railway variable to publish. (A live database-backed editor is the next upgrade.)

## Local dev

```bash
npm run install:all
npm run dev:server     # API on :8080 (create server/.env from the example first)
npm run dev:client     # client on :5173, proxying /api to :8080
```

## Deploy

Push to `main` → Railway auto-builds (`npm run build`) and deploys (`npm start`).
Custom domain `app.beanculture.com.au` is a CNAME to the Railway service
(Cloudflare proxy must be **DNS-only / grey cloud** so Railway can issue TLS).
