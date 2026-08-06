# Bean Culture — Square ordering app

A self-order web app for Bean Culture cafe, connected to Square. Customers scan a
QR at their table, order and pay in the browser, and the order lands on your Square
POS / KDS **already tagged dine-in + table number, or takeaway** — so staff never
have to guess who's eating in, who's taking away, or where they're sitting.

Deployed as a single service at `app.beanculture.com.au`.

---

## Why this exists (the Square gotcha)

Square's Orders API has **no native dine-in or table-number field**. Publicly it only
supports `PICKUP`, `SHIPMENT`, `DELIVERY`, plus a restricted-beta `IN_STORE` type. So a
naive ordering app produces a kitchen ticket that literally can't say "table 12".

This app forces that information onto the fields Square **does** surface on the ticket/KDS:

- **`ticket_name`** on the order → shows large on the KDS ticket, e.g. `T12 DINE-IN` or `TAKEAWAY Shaun`.
- **Fulfillment `note`** and **order `note`** → `DINE-IN · Table 12` as a second surface.
- **Correct fulfillment type** → `PICKUP` for takeaway (works on every account today);
  `IN_STORE` for dine-in *if* you're accepted into Square's beta (env-switchable, see below).

Because the menu is pulled live from your **Square Catalog**, every ordered line item
references a real catalog item in a real category. That means Square's own **kitchen
routing** does the work — you configure it once in the KDS app (food → kitchen screen,
coffee → barista screen, selected categories → printer). No routing code lives here.

---

## Architecture

```
client/   Vite + React storefront (menu, cart, dine-in/table, checkout)
server/   Express API + Square REST integration; also serves the built client
```

Single Railway service, single domain. In production Express serves `client/dist`.

API endpoints:

| Method | Path          | Purpose                                                        |
|--------|---------------|----------------------------------------------------------------|
| GET    | `/api/config` | Public Square app id + location + environment (for the browser)|
| GET    | `/api/menu`   | Live menu from Square Catalog (60s cache)                      |
| POST   | `/api/orders` | Create the Square order with dine-in/table on `ticket_name`   |
| POST   | `/api/pay`    | Charge the order total via the Web Payments SDK token          |

---

## 1. Create a Square Developer app (get credentials)

1. Go to https://developer.squareup.com/apps and sign in with the Bean Culture Square login.
2. **+ Create app** → name it "Bean Culture Ordering".
3. Open the app → **Credentials**. You need three values:
   - **Application ID** (production starts with `sq0idp-...`) → `SQUARE_APPLICATION_ID`
   - **Access token** (production, the secret one) → `SQUARE_ACCESS_TOKEN`
   - **Location ID** — from **Locations** in the app, or Square Dashboard → Account & Settings → Locations → `SQUARE_LOCATION_ID`

> Test first with the **Sandbox** tab (fake cards, no real money): set `SQUARE_ENV=sandbox`
> and use the sandbox Application ID / Access Token / Location ID. Flip to production when happy.

---

## 2. Environment variables

Set these in Railway → your service → **Variables** (see `server/.env.example`):

```
SQUARE_ENV=production            # or 'sandbox' while testing
SQUARE_ACCESS_TOKEN=<secret>     # treat like a password — never commit it
SQUARE_APPLICATION_ID=sq0idp-... 
SQUARE_LOCATION_ID=<location id>
SQUARE_CURRENCY=AUD
SQUARE_DINEIN_FULFILLMENT=PICKUP # switch to IN_STORE only if accepted into the beta
```

---

## 3. Run locally

```bash
npm run install:all
# terminal 1 — API on :8080 (create server/.env from server/.env.example first)
npm run dev:server
# terminal 2 — client on :5173, proxying /api to :8080
npm run dev:client
```

Open http://localhost:5173?table=12 to simulate scanning table 12's QR code.

---

## 4. Deploy to Railway

1. Push this repo to GitHub, then in Railway **New Project → Deploy from GitHub repo**
   (or `railway up` with the CLI). `railway.json` sets build = `npm run build`, start = `npm start`.
2. Add the environment variables from step 2.
3. Railway gives the service a URL — confirm it loads and the menu appears.

### Custom domain `app.beanculture.com.au`

1. Railway → service → **Settings → Networking → Custom Domain** → enter `app.beanculture.com.au`.
2. Railway shows a **CNAME target** (e.g. `xxxx.up.railway.app`).
3. In your DNS host, add a **CNAME** record: `app` → that Railway target. Wait for it to verify (HTTPS is automatic).

---

## 5. Configure Square KDS routing (the kitchen/coffee/printer split)

This is done in Square, not in code — and it's what sends food to the kitchen screen,
coffee to the machine, and prints selected categories.

1. In the **Square KDS** app on each screen: **Settings → Items & categories** → assign
   which catalog categories that screen shows. Kitchen screen = food categories; the
   coffee-machine screen = drinks/coffee categories.
2. **Settings → Routing → Source & Fulfillment** → optionally filter a station to only
   Dine-In or only Pickup/To-Go orders.
3. **Kitchen printer**: Square Dashboard → **Devices → Printers** → create a printer
   profile, tick **In-person / online orders**, and select the categories that should
   auto-print. (Requires a Square-compatible printer.)

Because orders arrive with real catalog items, all of the above "just works" on them.

---

## 6. Apple Pay & Google Pay

- **Google Pay** works once the app is on HTTPS (Railway domain) with no extra setup.
- **Apple Pay** additionally needs domain verification: Square Developer app →
  **Apple Pay** → register `app.beanculture.com.au`, download the association file, and
  host it at `https://app.beanculture.com.au/.well-known/apple-developer-merchantid-domain-association`.
  Until that's done the app quietly hides the Apple Pay button and card payment still works.

---

## 7. Dine-in fulfillment beta (optional, later)

To have dine-in orders use Square's dedicated `IN_STORE` fulfillment type instead of
`PICKUP`, apply for the beta (Square Developer forums → "IN_STORE fulfillment") and, once
accepted, set `SQUARE_DINEIN_FULFILLMENT=IN_STORE`. Not required — the `ticket_name` +
note approach already makes dine-in and table unmistakable on the ticket.

---

## Go-live checklist

- [ ] Sandbox tested end-to-end (order → pay with test card → appears on KDS)
- [ ] Production credentials set in Railway, `SQUARE_ENV=production`
- [ ] `app.beanculture.com.au` CNAME verified, HTTPS live
- [ ] KDS routing configured (kitchen / coffee / printer categories)
- [ ] Apple Pay domain verified (optional)
- [ ] Printed QR codes per table linking to `https://app.beanculture.com.au?table=<N>`
