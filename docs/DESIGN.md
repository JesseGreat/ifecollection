# IfeCollection – design

This is the plan the code follows. If the code and this file disagree, the code wins. Please fix this file when that happens.

## 1. Main decisions

| Topic | Decision |
|---|---|
| Money | Whole naira stored as `bigint` (₦12,500 → `12500`). No kobo, so there are no rounding problems. |
| Time | Every rule uses `now() at time zone 'Africa/Lagos'` in Postgres. The browser clock is only used to count down the seconds the server sent. |
| Logins | Staff log in with a **username** and password. Supabase Auth needs an email, so the app turns `amaka` into `amaka@staff.ifecollection.app` behind the scenes. There is no sign-up page. |
| Writes that touch stock | Only through `security definer` RPCs (`create_sale`, `void_sale`, `restock_variant`, `adjust_stock`, `save_product`). The `authenticated` role has **no** INSERT/UPDATE/DELETE grant on `product_variants`, `sales`, `sale_items`, `sale_payments` or `stock_movements`. |
| Working hours | `is_within_staff_hours()` is checked in Postgres in three places: (a) RLS on every table, (b) every RPC, (c) `session_status()`, which `proxy.ts` (the Next 16 name for middleware) calls on every page request. The client also re-checks when the app comes back from the background. |
| Idempotency | The cart gets a UUID `idempotency_key` when it is created. It is only replaced after a sale saves successfully. `create_sale` takes an advisory lock on (staff, key) and returns the existing sale if the key was already used. There is also a unique index on `(staff_id, idempotency_key)`. |

## 2. Schema

```
profiles          id(=auth.users.id) · username · full_name · role admin|staff · active · created_at
categories        id · name (unique) · sort_order · active
products          id · name · category_id → categories · price · description · archived · timestamps
product_images    id · product_id · provider cloudinary|supabase · path (Cloudinary URL or storage path)
                  · thumb_path (Supabase only) · external_id (Cloudinary public_id) · sort_order
product_variants  id · product_id · size · colour · sku · price_override · quantity ≥ 0
                  · low_stock_threshold (default 3) · active · unique(product_id,size,colour)
sales             id · receipt_no (IFE-YYMMDD-0001) · staff_id · customer_name · customer_phone
                  · total · status completed|voided · void_reason · voided_by · voided_at
                  · idempotency_key · created_at · unique(staff_id, idempotency_key)
sale_items        id · sale_id · variant_id · product_name · size · colour · unit_price · qty · line_total
sale_payments     id · sale_id · method cash|transfer|pos · amount · reference
stock_movements   id · variant_id · qty_change · quantity_after · reason initial|restock|sale|adjustment|void
                  · note · sale_id · actor_id · created_at
receipt_counters  day (Lagos date) · last_no
settings          id=1 · staff_open_time (08:00) · staff_close_time (20:00) · warn_minutes (10)
                  · store_phone · store_address · receipt_footer
audit_log         id · actor_id · action · entity · entity_id · details jsonb · created_at
```

Helper SQL functions: `lagos_now()`, `staff_hours_open_at(timestamptz)`, `is_within_staff_hours()`,
`is_admin()`, `can_use_app()`, `session_status()`, `dashboard_summary(from, to)`, `log_login()`.

### RLS summary

| Table | Staff (only during hours) | Admin |
|---|---|---|
| products / variants / images / categories | read active rows | read all, write via RPC or own policies |
| sales (+ items, payments) | read **own, today (Lagos)** | read all |
| sales writes | none, only `create_sale` | none, only `create_sale` / `void_sale` |
| stock_movements, audit_log | none | read |
| settings | read | read / update |
| profiles | read own | read all; account changes go through server actions with the service key |

## 3. Folders

```
supabase/migrations/   SQL: schema, RLS, RPCs, storage bucket
scripts/               create-admin.ts, seed.ts, make-icons.ts
src/proxy.ts           session refresh + working-hours gate on every request
src/lib/               supabase clients, money/time helpers, image compression, receipt image
src/app/login          login page + server action
src/app/(app)/         logged-in shell (bottom nav on phone, sidebar on PC)
   sell/               product grid → variant sheet → cart bar → checkout
   receipt/[id]/       receipt, share, print (+ admin void)
   my-sales/           staff: own sales today
   admin/              dashboard, products, sales, staff, settings, report (print)
src/app/api/           session status (for app resume), CSV export
public/                manifest icons, service worker
tests/db/              SQL tests run against real Postgres (hours, sale RPC, permissions)
tests/unit/            vitest: money, hours countdown
tests/e2e/             Playwright at 360×740
```

## 4. Phone screens (360px)

```
 SELL (staff home)                CHECKOUT                       RECEIPT
┌─────────────────────────┐   ┌─────────────────────────┐   ┌─────────────────────────┐
│ IfeCollection   ⏱ Amaka │   │ ← Cart (3)              │   │      IfeCollection      │
│ [🔍 Search name / SKU ] │   │ Red gown · M     −1+ ₦… │   │ IFE-261107-0004         │
│ [All][Gowns][Ankara]... │   │ Shirt · L        −2+ ₦… │   │ 07 Nov 2026 14:32       │
│ ┌─────┐ ┌─────┐         │   │ Total        ₦37,500    │   │ 1 × Red gown M  ₦12,500 │
│ │photo│ │photo│         │   │ Customer name (opt)     │   │ ...                     │
│ │₦12.5k│ │₦8k  │         │   │ Customer phone (opt)    │   │ TOTAL         ₦37,500   │
│ └─────┘ └─────┘         │   │ ┌──────┬────────┬─────┐ │   │ Paid: Cash              │
│   ... 2-column grid ... │   │ │ CASH │TRANSFER│ POS │ │   │ Served by Amaka         │
│┌───────────────────────┐│   │ └──────┴────────┴─────┘ │   │ [Share WhatsApp] [Print]│
││ 3 items  ₦37,500  ▶   ││   │ Split payment ▸         │   │ [ New sale ]            │
│└───────────────────────┘│   │ [   COMPLETE SALE     ]  │   └─────────────────────────┘
│ [Sell] [My sales] [Out] │   └─────────────────────────┘
└─────────────────────────┘
 Tapping a product opens a bottom sheet: colour chips → size chips (out-of-stock chips greyed)
 → qty −/+ (limited to stock) → sticky [Add to cart].

 ADMIN DASHBOARD                  PRODUCT FORM
┌─────────────────────────┐   ┌─────────────────────────┐
│ Today ▾  [from]–[to]    │   │ [📷 Take photo][🖼 Gallery]│
│ ┌──────────┐┌─────────┐ │   │ [img ▓▓▓▓ 80%][img ✓]   │
│ │Total ₦…  ││Sales 14 │ │   │ Name, Category, Price   │
│ ├──────────┤├─────────┤ │   │ Sizes: [S][M][L][XL][+] │
│ │Cash ₦…   ││Transfer │ │   │ Colours: [Red][+ add]   │
│ │POS ₦…    ││         │ │   │ Qty grid   S  M  L      │
│ └──────────┘└─────────┘ │   │      Red  [2][4][1]     │
│ ▸ By staff              │   │      Blue [0][3][2]     │
│ ▸ Best sellers          │   │ [     SAVE PRODUCT    ] │
│ ▸ Low / out of stock    │   └─────────────────────────┘
│ ▸ Voided sales          │
│ [CSV] [Print]           │   Bottom nav (admin): Home · Sell · Products · Sales · More
│ [Home][Sell][Prod][…]   │   PC (≥1024px): left sidebar, tables instead of cards.
└─────────────────────────┘
```

## 5. Working-hours flow

1. Login: password check, then `session_status()`. If the user is staff and the shop is closed, they are signed out with "IfeCollection is closed. You can log in from 8:00am." The attempt is written to the audit log.
2. Every page request: `proxy.ts` calls `session_status()`. If the shop is closed for this staff user, it signs them out and redirects to `/login?closed=1`.
3. In the app: the server sends `seconds_until_close`. A banner with a countdown appears 10 minutes before closing (19:50), and at 0 the app signs out and goes to the login page. When the app comes back from the background (`visibilitychange`) it asks `/api/session` again.
4. Direct API calls (for example with curl and a stolen token) fail too. RLS returns no rows and the RPCs raise `STORE_CLOSED`.
