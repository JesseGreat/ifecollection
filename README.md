# IfeCollection

IfeCollection is the sales and stock app for the IfeCollection clothing shop. It is made for phones first.

- **Sales staff** use their phone to find products, sell them, take Cash / Transfer / POS payments and share receipts on WhatsApp. They can only use the app between **8:00am and 8:00pm (Lagos time)**.
- **The admin (shop owner)** adds products and photos from the phone, restocks, voids sales, manages staff and sees the daily report. The admin can use the app at any time, on a phone or a PC.

Money is in naira (₦). All times are Lagos time (WAT). The app always uses the server's clock and never the phone's clock.

---

## What you need

| Thing | Cost | Why |
|---|---|---|
| A [Supabase](https://supabase.com) account | Free plan is enough | Database, logins and photo storage |
| A [Vercel](https://vercel.com) account | Free plan is enough | Puts the app on the internet |
| A [Cloudinary](https://cloudinary.com) account | Free plan is enough | Stores and serves the product photos |
| A [GitHub](https://github.com) account | Free | Vercel takes the code from here |
| [Node.js](https://nodejs.org) 20 or newer on a computer | Free | Only for setting up and running locally |

---

## 1. Create the Supabase project

1. Go to supabase.com → **New project**. Name it `ifecollection` and pick the region closest to Nigeria (for example **West EU (London)** or **Central EU (Frankfurt)**). Save the database password somewhere safe.
2. When it is ready, open **Project Settings → API** and copy:
   - **Project URL**
   - **anon / publishable key**
   - **service_role / secret key** (keep this secret!)
3. Open **Authentication → Sign In / Providers** and:
   - turn **OFF** "Allow new users to sign up" (only the admin creates accounts),
   - keep **Email** enabled, and turn **OFF** "Confirm email".

## 2. Run the database migrations

The files in `supabase/migrations/` create all the tables, security rules (RLS) and functions. Run them **in order**:

**Option A – no installs (easiest):** in Supabase open **SQL Editor → New query**. Paste the whole contents of each file below and press **Run**, one file at a time, in this order:

1. `20261107000001_schema.sql`
2. `20261107000002_security.sql`
3. `20261107000003_rpc.sql`
4. `20261107000004_storage.sql`
5. `20261108000005_cloudinary_images.sql`

**Option B – Supabase CLI:**

```bash
npx supabase login
npx supabase link --project-ref YOUR-PROJECT-REF
npx supabase db push
```

## 2b. Set up Cloudinary (product photos)

1. Sign up at cloudinary.com (the free plan is fine to start).
2. In the Cloudinary dashboard open **Settings → API Keys** and copy the **Cloud name**, **API Key** and **API Secret**.
3. Put them in `.env.local` (next step) and in Vercel as `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET`.

How it works: the phone makes each photo smaller first (max 1200px, about 200 KB). It then asks the IfeCollection server for a one-time, admin-only upload permission and sends the photo straight to Cloudinary. The secret never goes to the phone. Cloudinary makes the small list thumbnails itself and sends phones the lightest format they support (WebP/AVIF), so photos load fast on mobile data. Photos go in the `ifecollection/products` folder.

If you leave the Cloudinary values empty, photos are stored in Supabase Storage instead. Photos that were already saved keep working either way.

## 3. Set up the code on your computer

```bash
git clone <your-repo-url> ifecollection
cd ifecollection
npm install
cp .env.example .env.local      # then open .env.local and paste the values from steps 1 and 2b
```

## 4. Create the first admin

There is no sign-up page, so create the owner's account from the computer:

```bash
npm run create-admin -- --username ife --name "Ife Owner" --password "choose-a-strong-password"
```

The admin then logs in with the **username** (for example `ife`) and that password. Staff accounts are created inside the app (**More → Staff**).

**Optional demo data** (1 admin `ife`, 2 staff `amaka` and `tunde`, and 6 sample products with photos):

```bash
npm run seed
```

The demo passwords are printed on screen. Change them before using the app for real.

## 5. Run it on your computer

```bash
npm run dev
```

Open http://localhost:3000. To try it on your phone over the same Wi-Fi, open `http://<your-computer-ip>:3000`. Note that the camera and "install" features need **https**, so test those after deploying.

## 6. Put it on the internet (Vercel)

1. Push the code to a GitHub repository.
2. In Vercel: **Add New → Project**, then pick the repository.
3. Under **Environment Variables**, add the same values as in `.env.local`:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
4. Press **Deploy**. You will get a link like `https://ifecollection.vercel.app`.
5. In Supabase, open **Authentication → URL Configuration** and set **Site URL** to that link.

## 7. Install the app on a phone ("Add to Home Screen")

**Android (Chrome):** open the link → log in → tap the **⋮** menu → **Add to Home screen** (or **Install app**) → **Install**. The IfeCollection icon appears on the home screen and opens full screen like a normal app.

**iPhone (Safari):** open the link → tap **Share** (square with arrow) → **Add to Home Screen** → **Add**.

---

## How to use it

**Staff (phone):** **Sell** → search or tap a category → tap a product → choose colour and size → **Add to cart**. Tap the black cart bar → choose **Cash**, **Transfer** or **POS** (or "split" if the customer paid two ways) → **Complete sale**. On the receipt, tap **WhatsApp** or **Share** to send it to the customer. **My sales** shows your sales for today.

**Admin:**
- **Home**: today's totals (Cash / Transfer / POS), sales per staff, best sellers, low and out-of-stock items, voided sales. Pick other dates at the top. You can download a **CSV** or open a **printable report**.
- **Products**: **New product** → **Take photo** or **Gallery** (photos are made smaller on the phone before upload) → name, price, category → tap sizes and colours → type how many of each → **Save product**. Open a product to **Restock** or correct the count.
- **Sales**: every sale. Open one to **Void** it (a reason is required, and the items go back into stock).
- **More → Staff**: add staff, change passwords, turn accounts off or on.
- **More → Settings**: working hours, receipt details, categories.
- **More → Activity log**: logins, voids, stock changes and price changes.

### Working hours (staff)

- Staff can log in only between the opening and closing time in **Settings** (default 8:00am–8:00pm, Lagos time, every day).
- 10 minutes before closing a countdown appears. At closing time staff are logged out automatically and see *"IfeCollection is closed. You can log in from 8:00am."*
- The rule is checked by the **database** on every request, so changing the phone's clock does not help, and direct API calls also fail outside hours.

### Bad network

- The product list is saved on the phone, so it opens quickly on slow data.
- A sale needs internet. If there is none, the app says **"No internet – sale not saved"** and keeps the cart. Tap **Complete sale** again when you are back online. Every cart has a unique key, so a sale can never be saved twice, even if you tap twice or the network drops in the middle.

---

## For developers

- **Stack:** Next.js 16 (App Router, `src/proxy.ts` is Next 16's name for middleware) + TypeScript + Tailwind CSS 4, and Supabase (Postgres, Auth, Storage, RLS).
- **Design notes:** see [docs/DESIGN.md](docs/DESIGN.md) (schema, security model and screen layouts).
- **Security model:** all stock and sale writes go through `security definer` SQL functions (`create_sale`, `void_sale`, `restock_variant`, `adjust_stock`, `save_product`). Logged-in users have **no** insert/update/delete rights on `sales`, `sale_items`, `sale_payments`, `product_variants` or `stock_movements`. Working hours are enforced by `is_within_staff_hours()` inside RLS and every RPC, and checked again by `proxy.ts` through `session_status()`.

### Tests

```bash
npm run db:local          # start a throw-away Postgres on port 54329 (needs Postgres installed, no Docker)
npm test                  # unit tests + database tests (hours rule, sale RPC, permissions)

npm run e2e:binaries      # once: downloads Supabase Auth (GoTrue) + PostgREST binaries into .e2e/bin
npx playwright install chromium --only-shell
npm run test:e2e          # Playwright at phone size 360×740
```

The end-to-end tests run against a local stack (`scripts/e2e/stack.mjs`): the real Supabase Auth server, the real PostgREST, your local Postgres with these migrations, and a small gateway that stands in for Supabase's API gateway and Storage. It uses test-only keys. Cloudinary is faked inside the test: the browser's upload is intercepted and its signature checked with a test secret, so nothing reaches the real Cloudinary. No Docker is needed.

| Test file | What it checks |
|---|---|
| `tests/db/hours.test.ts` | before 8am, during hours, from 8pm, a session crossing 8pm, admin not restricted, phone/session time zone ignored |
| `tests/db/sale.test.ts` | overselling blocked, stock reduced and logged, duplicate submissions ignored (also when sent at the same time), DB prices only, split payments, voids |
| `tests/db/permissions.test.ts` | staff cannot edit/delete sales, change prices or stock, see other staff's sales or call admin functions |
| `tests/e2e/admin-product.spec.ts` | admin adds a product with photos on a phone: Cloudinary signed upload (signature checked), upload failure + retry, photos shrunk to ≤1200px, Cloudinary thumbnails; staff cannot get an upload signature |
| `tests/e2e/staff-sale.spec.ts` | staff makes a sale and gets a receipt; offline and lost-response retries never double-sell |
| `tests/e2e/working-hours.spec.ts` | countdown warning, automatic logout at closing time, no login before opening, app reopened after closing |
| `tests/e2e/layout.spec.ts` | every screen fits 360px, 390px and 1280px without sideways scrolling |
