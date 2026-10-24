# Catalog sizes and dimensions — audit

Scope: the 24 seed products in `src/features/storefront/catalog/catalogData.ts`.
**Everything below is DEMO data.** The catalog's names, prices and stock are
already placeholders; the dimensions were chosen to be realistic for each
product type, but **none is a verified manufacturer measurement** and all of
them are awaiting the client's real specifications.

## What was wrong

- One generic label scale (صغير / متوسط / كبير / كبير جدًا) was shared by rugs,
  carpets, curtains, cushions, blankets and accessories — labels with no
  dimensions at all.
- Several products offered 2–3 selectable "sizes" that changed nothing
  (same price, same stock, same SKU) — a selector that looked like a variant
  but was not one.
- Products where a size makes no sense (candle set, sofa cover) still carried
  one.

## Model used (unchanged — no schema change)

- `product.sizes` / `product.size`: **fixed specification** when it holds one
  value (shown as "المقاس" in the specifications table, no selector). Empty =
  dimension not set.
- `variantAxes: ['size']` + `variants[]`: **selectable sizes**, only where real
  variants exist. Cart lines carry the variant id/SKU/size as before.
- The `size` attribute values (Admin → السمات) now hold the dimension labels,
  with numeric `widthCm` / `lengthCm` where the value is a flat width × length.

## Per-product result

| ID | Product | Type | Before | After | Kind | Status |
|---|---|---|---|---|---|---|
| p01 | سجادة بوخارا معقودة يدويًا | rug | متوسط / كبير (selectable) | 160 × 230 سم | fixed spec | demo — awaiting confirmation |
| p02 | سجادة فارسية بميدالية زهرية | rug | صغير / متوسط / كبير (selectable) | 200 × 300 سم | fixed spec | demo — awaiting confirmation |
| p03 | سجادة هندسية مسطحة النسج | rug | صغير / متوسط / كبير (selectable) | 120 × 180 · 160 × 230 · 200 × 300 سم | **selectable variants** (inherit price/availability) | demo — per-size price and stock awaiting client |
| p04 | سجادة عتقية معاد صبغها | rug | متوسط / كبير (selectable) | 180 × 270 سم | fixed spec | demo — awaiting confirmation |
| p05 | سجادة جوت مضفورة طبيعية | rug | صغير / متوسط (selectable) | 120 × 180 سم | fixed spec | demo — awaiting confirmation |
| p06 | سجادة صلاة بملمس حريري | prayer rug | صغير | 70 × 110 سم | fixed spec | demo — awaiting confirmation |
| p07 | موكيت أكسمنستر | fitted carpet | كبير / كبير جدًا (selectable) | **not set** | — | selling model (roll width / per m²) unsupported and unknown |
| p08 | موكيت شاج مخملي | fitted carpet | متوسط / كبير / كبير جدًا (selectable) | **not set** | — | same as p07 |
| p09 | موكيت سيزال للممرات | runner | صغير / متوسط (selectable) | 80 × 300 سم | fixed spec | demo — awaiting confirmation |
| p10 | موكيت ويلتون كلاسيك | fitted carpet | كبير / كبير جدًا (selectable) | **not set** | — | same as p07 |
| p11 | ستارة كتان بقصة أنيقة | curtain | متوسط / كبير (selectable) | عرض 140 × ارتفاع 260 سم | fixed spec | demo — awaiting confirmation |
| p12 | ستارة مخمل عازلة للضوء | curtain | متوسط / كبير / كبير جدًا (selectable) | عرض 150 × ارتفاع 270 سم | fixed spec | demo — awaiting confirmation |
| p13 | ستارة فوال شفافة | curtain | متوسط / كبير (selectable) | عرض 300 × ارتفاع 260 سم | fixed spec | demo — awaiting confirmation |
| p14 | ستارة كتان مطرزة | curtain | متوسط / كبير (selectable) | عرض 140 × ارتفاع 250 سم | fixed spec | demo — awaiting confirmation |
| p15 | ستارة حريرية لغرف الاستقبال | curtain | كبير / كبير جدًا (selectable) | عرض 150 × ارتفاع 280 سم | fixed spec | demo — awaiting confirmation |
| p16 | غطاء أريكة مخملي | sofa cover | متوسط / كبير (selectable) | **not set** | — | sizes depend on sofa configuration; unknown |
| p17 | بطانية منسوجة يدويًا | throw | صغير | 130 × 170 سم | fixed spec | demo — awaiting confirmation |
| p18 | طقم أغطية وسائد (٤ قطع) | cushion covers | صغير | 45 × 45 سم (للغطاء الواحد) | fixed spec | demo — awaiting confirmation |
| p19 | لحاف سرير مبطّن | bedspread | كبير / كبير جدًا (selectable) | 230 × 250 سم | fixed spec | demo — awaiting confirmation |
| p20 | مصباح طاولة نحاسي | accessory | صغير | ارتفاع 45 سم | fixed spec | demo — awaiting confirmation |
| p21 | طقم مزهريتين خزفيتين | accessory | صغير | ارتفاع 28 و20 سم | fixed spec | demo — awaiting confirmation |
| p22 | معلقة حائط منسوجة | accessory | متوسط | 50 × 90 سم | fixed spec | demo — awaiting confirmation |
| p23 | مرآة بإطار منحوت | accessory | متوسط | 60 × 90 سم | fixed spec | demo — awaiting confirmation |
| p24 | طقم شموع معطرة (٣ قطع) | candle set | صغير | **not set** (set size is already in the title; candle dimensions unknown) | — | awaiting client |

Prices, discounts, availability, SKUs, slugs, titles and descriptions are
unchanged. The only new records are the three p03 variants
(`TYB-P03-120X180`, `-160X230`, `-200X300`).

## What the client must supply

- Real dimensions for every fixed-size product.
- For p03 (and any product that should offer several sizes): **per-size price
  and stock**. Until then the three p03 variants simply inherit the product
  price and availability (`price: null`, `stockQuantity: null`) — no invented
  numbers.
- For fitted carpets (p07, p08, p10): the selling model (roll width, price per
  m², cut-to-length). The checkout has no area/length pricing, so these stay
  purchasable as ordinary items with no size until that exists.
- Sofa cover (p16): the sofa configurations it fits.

## Saved data in browsers (nothing is wiped)

- **Saved catalog** (`taybah:catalog`): products already saved keep exactly
  their stored sizes/variants — the new seed values only apply to browsers with
  no saved catalog (or after an explicit reset).
- **Saved attributes** (`taybah:attributes`): the saved `size` attribute keeps
  every value, label, order and enabled state it has. It only **gains** any
  seeded size value it lacks (so seed products never show raw keys). Nothing is
  removed or overwritten.
- The four old generic values (small / medium / large / xl) stay in the
  registry, enabled, so catalogs saved before this audit still resolve their
  stored size keys. Disable them in Admin once no product uses them.

## Admin

- A product may now be saved with **no size** (dimension unknown); if a default
  size is set it must still be one of the selected sizes.
- Sizes, default size and the variant matrix are edited exactly as before.
