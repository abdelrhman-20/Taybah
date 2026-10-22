# Premium Design Direction — Research & Proposal

**Status:** Research only. No visual changes have been made to the application. This document exists to be reviewed and to have ONE direction approved before any redesign implementation begins, per the project's phased plan.

**Methodology note (read before anything else):** This research combines two kinds of evidence, kept clearly separate throughout:
1. **Verified, in-repo evidence** — read directly from this codebase's actual source files (catalog data, brand copy, design tokens). Cited by file path.
2. **External reference research** — gathered via text-based web search only. **No live browser session or screenshot tool was available in this session**, so no screenshots are included and no claim is made to have visually inspected any external site's current live design. Findings below are drawn from search-engine result summaries, third-party design teardowns/reviews, and official brand copy as surfaced by search — each sourced with a link. Where a search returned thin or unreliable results, that is stated explicitly rather than filled in from general impression.

---

## Part 1 — What Taybah Actually Is (In-Repo Findings)

This is derived entirely from reading the repository — `src/features/storefront/catalog/catalogData.ts`, `src/features/storefront/home/homeStore.ts`, `src/features/storefront/pages/AboutPage.tsx`, and `src/styles/globals.css`.

### Product catalog (24 seeded products, 5 categories, 3 collections)

| Category | Arabic | Example products | Price range (EGP) |
|---|---|---|---|
| `rugs` | سجاد | Bokhara Hand-Knotted Rug, Persian Floral Medallion Rug, Modern Geometric Flatweave Rug, Vintage Overdyed Rug, Jute Braided Natural Rug, Silk-Touch Prayer Rug | 1,480 – 12,450 |
| `carpets` | موكيت | Axminster Patterned Carpet, Plush Shag Carpet, Sisal Runner Carpet, Wilton Classic Carpet | 1,950 – 8,200 |
| `curtains` | ستائر | Tailored Linen Curtain, Velvet Blackout Curtain, Sheer Voile Panel, Embroidered Linen Drape, Silk-Blend Formal Curtain | 640 – 3,150 |
| `furnishings` | مفروشات | Velvet Sofa Cover, Handwoven Throw Blanket, Cushion Cover Set, Quilted Bedspread | 540 – 1,690 |
| `accessories` | إكسسوارات المنزل | Brass Table Lamp, Ceramic Vase Duo, Woven Wall Hanging, Mirror with Carved Frame, Scented Candle Trio | 380 – 2,450 |

**Three curated collections, each with its own stated personality** (`catalogData.ts:92-126`):
- **Diwan (ديوان)** — "a rhythm of geometric motifs and earthen tones — heritage pattern with clean contemporary lines."
- **Heritage (التراث)** — "pieces carrying the memory of the craft — classic medallions and inherited motifs."
- **Atelier (أتيليه)** — "clean lines and natural materials for contemporary homes — calm without ornament."

**Material/color vocabulary** (`catalogData.ts:132-168`): wool, wool-blend, cotton, linen, velvet, silk-blend, natural-fiber (jute/sisal), ceramic, metal, wood; colors are warm and earthen — burgundy, ivory, sand, charcoal, navy, sage, terracotta, antique gold. This is a **warm, textural, craft-material palette**, not a cool/synthetic one.

**Overall positioning this data supports:** Taybah is a curated home-textiles-and-decor retailer — rugs and carpets as the anchor category, curtains and soft furnishings as the natural extension, and a small accessories tail (lighting, ceramics, mirrors, candles) that rounds out a room rather than competing with the textiles for attention. Price range (EGP 380–12,450, i.e., roughly $8–$255 at typical rates) places it in **accessible-premium / mid-to-upper home decor**, not ultra-luxury couture-rug territory.

### Brand voice, in the brand's own words

`AboutPage.tsx:11-29` states Taybah's stated values directly:
- **"الأصالة" (Authenticity)** — "We choose materials and techniques that honor the craft and its history."
- **"الجودة أولًا" (Quality first)** — "Every piece passes material, weave, and finish checks before listing."
- **"الهدوء البصري" (Visual calm)** — "We favor pieces that beautify a home without crowding it."
- **"الشفافية" (Transparency)** — "Clear prices, honest descriptions, precisely written specifications."

And its stated differentiators: a **curated** selection ("instead of an endless catalog"), **Arabic-first** design ("designed in Arabic, not translated into it"), and **documented sizes/materials** for confident purchasing.

The homepage hero copy (`homeStore.ts:86-93`) reads: *"طيبة — حِرفة أصيلة"* ("Taybah — authentic craft") / *"حيث تلتقي الحِرفة بالفخامة"* ("Where craft meets luxury"). This is the brand's own chosen tagline, and it directly supports a **heritage-craft-meets-premium** positioning rather than either a pure-minimalist or a maximalist-luxury one.

### Current implementation baseline

`src/styles/globals.css:3-19` — the existing (functional-scaffolding-stage) design tokens:
- Colors: `--color-porcelain: #F7F5F0` (warm cream background), `--color-burgundy: #681D20`, `--color-gold: #B58A43`, `--color-espresso: #29221E` (near-black warm text), `--color-taupe: #D8CFC1`.
- Type: `--font-sans` is a plain system-font stack; `--font-display` is `Georgia, 'Times New Roman', Times, serif` — **a Latin-only serif that has no Arabic glyphs at all**. Since the UI is Arabic-only, every "display" heading in Arabic is silently falling back to the browser's default Arabic font, not an intentional typographic choice. **This is the single most important finding for the typography section below: there is currently no deliberate Arabic typeface in this project at all.**

### Limitation of the mock data (explicitly flagged, as instructed)

This catalog is explicitly documented in the source itself as placeholder: `catalogData.ts:1-6` — *"TEMPORARY PRESENTATION DATA... Product names, prices, attributes, and availability are invented for UI purposes."* Photography is `picsum.photos` placeholder imagery with fixed seeds, not real product photography. The 24 SKUs, their exact prices, and their descriptions are **invented for development purposes, not Taybah's real/final catalog**. The research and directions below are built on the *category mix and stated brand voice* (rugs/carpets/curtains/furnishings/home accessories, heritage-craft positioning, three named collections), which are real product/structural decisions already encoded in the app — but the specific SKUs, images, and prices should not be treated as the real catalog when the premium redesign is eventually implemented against real content.

---

## Part 2 — External Reference Research

**How this research was done:** text-based web search queries against brand names and design-review/teardown sources. No live site was opened or screenshotted. Each point below is attributed to a specific search result.

### 1. The Rug Company — [ecomm.design teardown](https://ecomm.design/site/the-rug-company/)
A dedicated handmade-rug retailer at the ultra-premium end ($2,400–$40,000+ per rug, per the teardown).
- **Worth learning:** restrained, editorial typography (near-black on warm off-white — notably similar to Taybah's own existing espresso-on-porcelain palette); photography carries the whole design rather than UI chrome; a "by lead time" filter that separates in-stock / made-to-order / bespoke, which is a trust-building pattern for handmade goods where not everything ships immediately.
- **Fits Taybah:** the warm-neutral-background + near-black-text editorial restraint, and the instinct to let rug/textile photography do the work rather than heavy UI decoration.
- **Should not copy:** the price point and "bespoke commission" framing — Taybah's catalog is ready-to-ship curated pieces at a much more accessible price band, not made-to-order luxury commissions. Copying that framing would misrepresent the actual product.
- **Adaptation:** keep the warm-neutral/near-black palette instinct (Taybah already has this in `espresso`/`porcelain`), keep photography-first product pages, but skip the "trade channel" and "bespoke lead-time" apparatus entirely.

### 2. Nordic Knots — [reviews](https://www.interiorinsider.com/article/is-nordic-knots-worth-it) / [opumo](https://opumo.com/magazine/nordic-knots-review)
Positioned (per review commentary) "above mainstream brands like West Elm but below ultra-luxury names like The Rug Company" — i.e., the same accessible-premium tier Taybah's price range actually occupies.
- **Worth learning:** a sample-ordering flow (order a physical swatch before committing to a large rug purchase) and a clearly stated return policy — both are trust mechanisms for buying a textured, tactile product online without touching it first.
- **Fits Taybah:** the "accessible premium, not ultra-luxury" tier is the *right comparison class* for Taybah's actual prices — this should anchor expectations more than The Rug Company does.
- **Should not copy:** nothing structurally; reviews flagged inconsistent customer-service responsiveness as a brand-operations issue, not a design pattern — irrelevant here.
- **Adaptation:** a sample/swatch-order concept is worth flagging as a *possible future feature*, not a visual-design direction — out of scope for this redesign-research task, noted only as an idea.

### 3. Jaipur Living — [jaipurliving.com structure, via search](https://www.jaipurliving.com/llms.txt) / [trade-press coverage of an earlier redesign](https://www.hfndigital.com/industry-news/zoom-feature-quick-ship-program-part-of-jaipurs-newly-re-designed-website)
A handmade-rug brand whose own tagline is *"Foster inspiration with handmade rugs beautifully crafted by artisans around the world"* — craft-storytelling positioning very close to Taybah's own "حِرفة أصيلة" (authentic craft) language.
- **Worth learning:** an "inspiration" section organized by seasonal style themes (per the dated trade-press piece) and per-product care instructions directly on the product page — both reinforce a craft-education angle rather than pure retail.
- **Fits Taybah:** the artisan-storytelling angle maps almost exactly onto Taybah's stated "authenticity" value and its three named, personality-driven collections (Diwan/Heritage/Atelier).
- **Should not copy:** a full seasonal-trends content hub is a content-operations commitment beyond this phase's scope.
- **Adaptation:** let each of Taybah's three *existing* collections (not a new trends system) carry its own short editorial framing on its collection page — already partially done in `collections` data, but not yet given real visual weight on the storefront.

### 4. Anthropologie Home — [Limely homeware roundup](https://www.limely.co.uk/blog/top-homeware-website-designs), [Photoroom's product-page review](https://www.photoroom.com/100-best-product-pages/home/anthropologie-home)
Ranked #1 in one independent roundup; praised for fast load times, strong filtering, and "artistic but cohesive" photography where materials/finishes remain easy to evaluate despite the styled, lifestyle-forward shots.
- **Worth learning:** the discipline of styled/lifestyle photography that still keeps the *product itself* (texture, material, true color) legible — a real risk for any textile brand leaning into mood photography.
- **Fits Taybah:** directly relevant, since rugs/curtains are exactly the kind of product where lifestyle styling can accidentally obscure the texture and color accuracy a buyer needs to trust.
- **Should not copy:** Anthropologie's broader maximalist, eclectic merchandising mix (housewares + clothing + gifts) — Taybang's catalog is narrower and more curated by design (per its own stated "curated, not endless" differentiator).
- **Adaptation:** every product card and gallery should pair one true-to-color, evenly-lit product shot with one or two styled lifestyle shots — never only the styled version.

### 5. Soho Home — [third-party retailer listings, via search](https://www.withflitch.com/retailers/soho-home)
Could not find a direct review of Soho Home's own site design; results were limited to third-party resale listings. **Explicitly flagged as thin evidence** — the one usable finding is that its product pages pair a price, a description, and a "stylist note" (per Flitch's listing format), which is a lightweight, low-risk pattern (a short curatorial sentence alongside the spec table) worth considering regardless.

### 6. The Conran Shop — [search results](https://www.conranshop.co.uk/), including a **Kuwait-localized storefront** ([theconranshop.com.kw](https://theconranshop.com.kw/pages/about-us))
Tagline: *"Iconic designs and future classics."* Positioned as a curated, design-literate home store rather than a big-box retailer.
- **Worth learning:** the existence of a dedicated **Gulf-region localized storefront** for a premium Western home brand is itself useful evidence — it confirms there's market precedent for a premium, curated home-goods experience built specifically for an Arabic-speaking regional audience, which is exactly Taybah's own position (Arabic-first, not translated).
- **Fits Taybah:** validates that "curated, not endless catalog" (Taybah's own stated differentiator) is a legitimate premium positioning, not merely a smaller budget's limitation.
- **Should not copy:** no specific visual pattern was verifiable from available search results — this reference is cited for market-positioning validation, not visual-design borrowing.

### 7. Arabic typography and RTL practice — [RTL design checklist](https://localization.saudisoft.com/?p=38918), [Arabic website design basics](https://hapy.co/journal/arabic-website-design-basics/), [globaldev.tech RTL guide](https://globaldev.tech/blog/right-to-left-rtl-website-development-design)
- Use fonts **designed for Arabic**, not Latin fonts with an Arabic fallback glyph set — directly confirms the gap found in `globals.css` (Georgia has no Arabic design intent at all).
- Arabic text needs to render **~20–30% larger** than equivalent Latin text at the same visual weight, because of connected letterforms, dot placement, and (optional) diacritics needing room to stay legible. Sources disagree on the exact percentage (20–25% vs 20–30%), so treat this as a range to test, not an exact multiplier.
- Mirroring layout alone is insufficient — navigation, carousels, forms, and icon direction all need explicit RTL handling (this codebase already does this reasonably well per the Phase 2 audit: `start-`/`end-` logical properties are used consistently, with the Lightbox bug just fixed being the one real exception found).
- Mixed-direction content (Arabic sentence containing a Latin SKU, an EGP price, or a product code) needs deliberate bidi handling — this codebase already does this correctly in places (`dir="ltr"` wrapping prices/SKUs, e.g. `ProductInfo.tsx`), which is good precedent to continue.

### 8. Arabic display typefaces for a heritage/premium brand — [El Messiri on Google Fonts](https://fonts.google.com/specimen/El+Messiri/about), [Amiri on Google Fonts](https://fonts.google.com/specimen/Amiri/about)
- **El Messiri** — described by its own Google Fonts listing as brush-inspired, Naskh-influenced, with wide counters that stay legible at small sizes and gain character at display sizes. Available in 4 weights (Light/Regular/SemiBold/Bold) as a variable font. **Best candidate for a heritage-leaning display/heading face.**
- **Amiri** — a Naskh revival explicitly modeled on early-20th-century Cairo's Bulaq Press typesetting. Google's own guidance frames it as a **body/running-text** face for books, not a display face. **Good as a supporting heritage body face, not for large headlines.**
- **Markazi Text** — search results were too thin to confirm its weight range or display suitability; flagged as **unverified**, not recommended without checking its live Google Fonts specimen directly before use.
- For a cleaner/more modern direction, **Cairo**, **Tajawal**, and **IBM Plex Sans Arabic** are repeatedly named across the RTL-guide sources above as solid, genuinely-Arabic-designed geometric sans options (not independently re-verified beyond being named consistently across sources).

---

## Part 3 — Three Design Directions

All three keep the existing React/Vite/Tailwind v4 architecture, RTL-only Arabic UI, guest-only COD checkout, and no invented shipping/return policy. They differ in personality, palette emphasis, and typographic voice — not in underlying functionality.

### Direction A — "Heritage Atelier" (evolve the current palette, give it real craft/editorial weight)

**Concept & personality:** Warm, tactile, story-led. This is the direction that takes Taybah's *own* stated values — authenticity, quality-first, visual calm — and gives them real typographic and photographic weight instead of default system styling. It reads as "a atelier-shop" that happens to be arabic-first: confident, warm, unhurried.

1. **Palette (HEX):** Keep and deepen the existing instinct.
   - `#F7F3EC` Porcelain (bg, slightly warmer than current `#F7F5F0`)
   - `#5C1A1D` Burgundy (deepened from `#681D20` for more contrast against porcelain)
   - `#A97D3B` Antique Gold (slightly muted from `#B58A43`)
   - `#241E1A` Espresso (near-black text, close to current `#29221E`)
   - `#CBBFA9` Taupe (borders/dividers, close to current)
   - `#8B7355` Terracotta-sand accent (new — pulled from the catalog's own "terracotta"/"sand" color options, for secondary CTAs or sale badges instead of reusing burgundy for everything)
2. **Typography (Arabic RTL):** Display headings in **El Messiri** (SemiBold/Bold) for a brush-Naskh heritage feel at large sizes; body text in **IBM Plex Sans Arabic** or **Cairo** (Regular/Medium) for clean, highly legible reading at normal sizes — pairing a characterful display face with a neutral, reliable body face is the safest heritage-without-illegibility combination. Size body text ~20% larger than the Latin-web-default baseline per the RTL research above, and test from there.
3. **Homepage:** Full-bleed hero photograph (a styled room, not a product cutout) with the existing hero copy treatment, but set in El Messiri at a genuinely large display size; the three collections (Diwan/Heritage/Atelier) each get a short editorial paragraph pulled from their own existing `description` field, not just a thumbnail — mirroring Jaipur Living's artisan-storytelling pattern.
4. **Header/nav:** Keep the current structure (logo centered or start-aligned, horizontal category nav, search/wishlist/cart end-aligned) but increase vertical breathing room and use the display face for the logo wordmark only — nav links stay in the body sans for scanability.
5. **Product listing/card:** Taller image aspect ratio (close to the current 4:5), one true-color shot as the default card image and the styled/hover shot as the second (mirrors the Anthropologie finding above); price in the body sans, SKU/size badges kept subdued; filter panel kept functionally as-is, restyled with more whitespace.
6. **Product details:** Large gallery (current structure is sound — keep it), a short curatorial sentence above the spec table (the "stylist note" pattern from Soho Home research), specs presented as a clean definition list exactly as today, material/color swatches kept prominent since they're core to a textile purchase decision.
7. **Cart/checkout:** No structural change — same guest-only, COD-only flow; visual refinement only (more generous spacing, the accent terracotta color for the COD/payment-method confirmation state instead of reusing burgundy for every state).
8. **Mobile:** Single-column, same component hierarchy, larger tap targets on filter chips and the quantity stepper; hero photography crops to a portrait-safe focal point rather than being redrawn.
9. **Animation/interaction:** Slow, deliberate — 300–400ms ease-out fades and gentle image-scale-on-hover (already used in `ProductCard.tsx`'s `group-hover:scale-105`), no bouncy/elastic easing anywhere. Micro-interactions should feel like "unhurried craftsmanship," not "snappy app."
10. **Advantages:** Lowest execution risk (evolves existing tokens and components rather than replacing them); most faithful to the brand's own written self-description; works well with real artisanal product photography once available.
    **Disadvantages:** Closest of the three to "tasteful but safe" — if the real product photography ends up flat or inconsistent, this direction has the least visual drama to compensate.
11. **References:** The Rug Company (editorial restraint, warm-neutral/near-black palette), Jaipur Living (artisan-storytelling), Anthropologie Home (styled-but-legible photography discipline).

### Direction B — "Atelier Quiet" (minimal, led by the Atelier collection's own stated personality)

**Concept & personality:** Taybah's own `atelier` collection describes itself as *"clean lines and natural materials... calm without ornament."* This direction takes that one collection's personality and makes it the WHOLE brand's visual language — a quiet, gallery-like, almost monochrome experience where the product photography is the only color in the room.

1. **Palette (HEX):**
   - `#FAFAF8` near-white warm bg
   - `#1C1C1A` near-black text
   - `#E8E4DC` stone/neutral borders
   - `#6B5D4F` single warm-neutral accent (used sparingly — sale badges, active filter state, focus rings)
   - No burgundy/gold as a brand color at all — color comes only from product photography and swatches.
2. **Typography:** A single geometric Arabic sans throughout — **Cairo** or **IBM Plex Sans Arabic** — at two weights only (Regular, SemiBold), no separate display face. Hierarchy comes from size and spacing, not a second typeface.
3. **Homepage:** Large, simple product/category photography in a strict grid; minimal copy; the three collections shown as plain category tiles rather than editorial blocks.
4. **Header/nav:** Ultra-minimal — logo, a short flat nav, search/cart. No dropdown decoration beyond what's functionally needed.
5. **Product listing/card:** Square or near-square image crops, generous gutters, price and name only — no badges unless on sale.
6. **Product details:** Large single-image-at-a-time gallery (closer to a lightbox-first browsing pattern), specs in a plain two-column table, no curatorial copy.
7. **Cart/checkout:** Same flow, rendered with maximum whitespace and minimal chrome.
8. **Mobile:** Extremely linear, single accent color, large touch targets, almost no decorative elements to get in the way on a small screen — this direction is the easiest of the three to get right on mobile precisely because there's so little to misalign.
9. **Animation:** Near-none — instant or near-instant state changes, maybe a 150ms opacity fade. Confidence comes from restraint, not motion.
10. **Advantages:** Fastest to build and maintain; most mobile-forgiving; lowest risk of ever looking dated or "trying too hard."
    **Disadvantages:** Risks looking generic / indistinguishable from any other minimalist home-goods site — it under-uses Taybah's own strongest differentiator (the heritage-craft story) and doesn't lean on the burgundy/gold palette the brand has already chosen for itself.
11. **References:** Anthropologie Home (fast, clean, well-filtered), general RTL-minimalism guidance (single accent color, Cairo/IBM Plex Sans Arabic).

### Direction C — "Diwan Luxe" (bold, saturated, editorial-maximalist)

**Concept & personality:** Leans hardest into "فخامة" (luxury) from the brand's own tagline — jewel-toned, dramatic, magazine-style. Closest to a true luxury-rug-house aesthetic (The Rug Company's territory) rather than the accessible-premium tier Taybah's actual prices occupy.

1. **Palette (HEX):**
   - `#1A1210` near-black warm background (sections alternate between this and porcelain, not porcelain-only)
   - `#7A1F23` deep burgundy (saturated, used boldly — large color blocks, not just accents)
   - `#C9972E` bright antique gold (used for dividers, icons, hover states)
   - `#1E2A3D` deep navy (secondary jewel tone, pulled from the catalog's own "navy" color option)
   - `#F7F3EC` porcelain (used only for contrast sections, not as the default background)
2. **Typography:** Large, bold El Messiri display headings (Bold/SemiBold) on dark backgrounds, with generous letter-spacing; body in Cairo at a confident weight; occasional single Amiri accent word/phrase treatment for a collection name or quote (sparingly — Amiri is a body-text face, not a workhorse display face, so it should appear only as a deliberate flourish).
3. **Homepage:** Full-bleed dark-background hero with saturated color photography; alternating dark/light section rhythm; collections presented as large, dramatic editorial spreads (closest to The Rug Company's "seasonal campaign" homepage pattern).
4. **Header/nav:** Dark header bar by default (unusual for e-commerce but distinctive), gold-accented active/hover states, possibly a persistent announcement bar in gold-on-dark.
5. **Product listing/card:** Darker card backgrounds behind product photography, gold price treatment, hover reveals a second (styled) image with a cross-fade rather than the current card's hover-swap.
6. **Product details:** Large, almost full-viewport gallery; specs panel styled with a dark background and gold dividers; collection cross-sell styled as an editorial insert, not a plain grid.
7. **Cart/checkout:** Same functional flow; visual treatment needs real discipline here — a dark, jewel-toned checkout risks feeling heavy/anxiety-inducing for a payment flow (even COD-only) if not lightened deliberately for just that section.
8. **Mobile:** Highest risk direction on mobile — dark backgrounds + large display type + saturated imagery can feel cramped and slow on small screens unless padding and type scale are tested aggressively; needs the most mobile-specific QA of the three.
9. **Animation:** Confident, slightly theatrical — parallax hero images, 400–600ms cross-fades, gold underline-draw animations on nav hover. Highest interaction budget of the three.
10. **Advantages:** Most visually distinctive and "premium-feeling" at first impression; best matches the literal word "فخامة" (luxury) in the brand's own tagline; most magazine-like, which could support strong social/marketing crops.
    **Disadvantages:** Highest execution risk (hard to keep tasteful rather than heavy); least true to the "الهدوء البصري" (visual calm) value the brand states for itself; heaviest for mobile and for page weight (large dark imagery); could visually overpromise relative to the actual accessible-premium price range (EGP 380–12,450), creating a mismatch between look and price that erodes trust rather than building it.
11. **References:** The Rug Company (editorial, high-end campaign energy), Soho Home (lifestyle-led framing), catalog's own "navy"/"gold"/"burgundy" jewel-tone palette pushed further.

---

## Part 4 — Comparison Matrix & Recommendation

| Criterion | A — Heritage Atelier | B — Atelier Quiet | C — Diwan Luxe |
|---|---|---|---|
| Fit with real catalog (rugs/textiles, EGP 380–12,450) | **Strong** — matches accessible-premium tier | Good, but under-sells the craft story | Risky — visually overpromises vs. actual price tier |
| Fit with brand's own stated values (authenticity, calm, transparency) | **Strong** — directly built from them | Strong on "calm," weak on "authenticity"/story | Weak on "calm," strong on "luxury" wording only |
| Premium visual quality | High | Moderate (can read generic) | Highest at first glance, highest risk of missing |
| Arabic RTL experience | Strong (El Messiri + Cairo pairing, tested sizing) | Strong (simplest to get right) | Strong typography, but dark UI needs the most RTL+contrast QA |
| Product presentation (texture-led goods) | **Strong** — photography-first, true-color + styled pairing | Good but minimal, may underserve texture-heavy rugs | Strong photography emphasis, but dark backgrounds can mute true material color |
| Ease of shopping | Strong | **Strongest** (least friction, most whitespace) | Moderate — more visual density to parse |
| Mobile usability | Strong | **Strongest** | Weakest of the three; needs the most dedicated QA |
| Conversion potential | Strong (trust-building + distinctive) | Moderate (low differentiation risk) | Highest ceiling, highest floor risk |
| Maintainability in current React/Tailwind architecture | **Easiest** — extends existing tokens/components | Easy — fewer tokens to maintain | Hardest — more states (dark/light sections), more QA surface |

### Recommendation: **Direction A — "Heritage Atelier"**

This is the direction that best fits *this specific business*, not a generic "which looks most premium" judgment:

- It is the only direction built directly from Taybah's own written self-description (`AboutPage.tsx`'s stated values of authenticity, quality-first, visual calm, and transparency) rather than from an external aesthetic imposed on top.
- It matches the actual price tier (accessible-premium, EGP 380–12,450) — Direction C's dramatic luxury framing risks a mismatch between visual promise and actual price that could *reduce* trust rather than build it; Direction B's minimalism under-uses the one differentiator (heritage craft story) Taybah has already chosen to lead with in its own copy.
- It carries the lowest implementation risk: it evolves the existing `globals.css` tokens and component structure (already Tailwind-v4, already using logical RTL properties correctly almost everywhere) rather than requiring a wholesale rebuild of either a minimal design system or a dual-mode dark/light one.
- It directly fixes this project's single most concrete, verified typography gap found in this research: the current `--font-display: Georgia` has no Arabic design intent at all. El Messiri (display) + Cairo/IBM Plex Sans Arabic (body) is a real, sourced, justified fix for that gap, not a cosmetic preference.

---

## Part 5 — Suggested Design Tokens (Direction A)

```css
@theme {
  /* Backgrounds / neutrals */
  --color-porcelain: #F7F3EC;   /* was #F7F5F0 */
  --color-taupe: #CBBFA9;       /* was #D8CFC1 */
  --color-espresso: #241E1A;    /* was #29221E */

  /* Brand accents */
  --color-burgundy: #5C1A1D;    /* was #681D20 — deepened for contrast */
  --color-gold: #A97D3B;        /* was #B58A43 — slightly muted */
  --color-terracotta: #8B7355;  /* NEW — secondary accent from the catalog's own color options */

  /* Typography */
  --font-display: 'El Messiri', Georgia, serif;         /* Arabic-first display face */
  --font-sans: 'IBM Plex Sans Arabic', 'Cairo', ui-sans-serif, system-ui, sans-serif; /* Arabic-first body face */
}
```

*(Exact hex values above are a proposed starting point for designer review, not finalized production tokens — expect adjustment once tested against real photography and WCAG contrast checks on both light and the darker accent states.)*

## Part 6 — Arabic Typography Recommendations

- **Display headings:** El Messiri, SemiBold/Bold. Variable font, 4 weights available, brush/Naskh-inspired — matches the "heritage craft" voice without sacrificing legibility at large display sizes.
- **Body text:** IBM Plex Sans Arabic or Cairo, Regular/Medium. Either is a solid, widely-used, genuinely-Arabic-designed geometric sans; pick based on direct side-by-side legibility testing at the actual sizes used in this UI, not from search-result description alone.
- **Supporting heritage accent (sparing use only):** Amiri — a Naskh body-text revival, appropriate for a short pull-quote or a collection name treated as a flourish, **not** for running headings or body copy (its own design intent is book typesetting, not UI display).
- **Sizing:** Arabic text generally needs to run larger than an equivalent Latin layout at the same visual weight — budget roughly 20–30% larger for body text as a starting point, then adjust by direct testing with native Arabic readers (sources disagree on the exact number; treat it as a tested range, not a fixed multiplier).
- **Bidi content:** Continue the pattern already used correctly in this codebase (e.g. `ProductInfo.tsx`'s `dir="ltr"` wrapping around prices/SKUs) for any Latin-script or numeral content embedded in Arabic sentences.
- **Markazi Text:** not recommended until its actual Google Fonts specimen (weights, display suitability) is checked directly — search results were too thin to confirm it's production-ready for this use case.

## Part 7 — Storefront Redesign Priorities (once a direction is approved)

In rough dependency/impact order — this is a priority list for the *next, separate* implementation phase, not something to start now:
1. Typography system: load and wire El Messiri + Cairo/IBM Plex Sans Arabic as the real `--font-display`/`--font-sans` tokens; verify Arabic sizing/line-height across every existing component (this alone touches every page, so it should land first and be verified broadly before anything else changes).
2. Color token refinement (deepened burgundy/gold, new terracotta accent) — a token-level change that cascades through existing Tailwind theme usage with minimal component rewrites.
3. Homepage hero and collection sections — highest-visibility surface, good first real test of the new type/color system together.
4. Product card and product listing grid — second-highest-traffic surface.
5. Product detail page (gallery, specs, curatorial-note addition) — most complex surface, do after the simpler ones have validated the token system.
6. Cart/checkout visual refinement — last, since it's function-critical and should change the least amid behavior-affecting risk.

## Part 8 — Mobile Design Principles (Direction A)

- Single-column layouts throughout; no attempt to recreate desktop's side-by-side panels at narrow widths.
- Tap targets sized for touch first (the existing `size-11`/`size-9` icon-button convention in this codebase is a reasonable baseline to keep).
- Hero and collection photography crop to a portrait-safe focal point rather than being redrawn per breakpoint — needs real photography with enough headroom/margin to crop safely once available.
- Keep the slower, deliberate animation timing even on mobile, but respect `prefers-reduced-motion` (not currently checked anywhere in this codebase — worth adding as part of the animation-system work, not before).
- RTL-specific mobile check: swipe gestures (`ProductGallery.tsx`), bottom-sheet filters (`FilterSheet.tsx`), and the mobile nav drawer (`MobileNav.tsx`) all need direction re-verification once new motion/timing values are introduced — the Lightbox keyboard-direction bug fixed in Phase 2 is a reminder that RTL direction bugs hide specifically in interaction code, not just static layout.

## Part 9 — Important Risks & Open Questions

**Risks:**
- The current mock catalog's photography (`picsum.photos` placeholders) cannot validate any of these directions properly — real product photography, shot and styled consistently, is a prerequisite for implementing Direction A well. A heritage-craft direction without photography that actually looks "crafted" will undercut the whole premise.
- Direction A's typography change (El Messiri + Cairo/IBM Plex Sans Arabic) needs real Arabic-reader usability testing before being finalized — the sizing guidance above is a range from secondary sources, not a verified number.
- No contrast/WCAG audit has been run against the proposed deepened palette yet — do this before implementation, not after.

**Open questions requiring approval, not invented here:**
- Final real product photography sourcing/styling direction (not addressed by this research — it's a production/content decision, not a design-system one).
- Whether the "sample/swatch ordering" idea noted under the Nordic Knots reference is worth considering as a future feature — flagged only as an idea surfaced during research, not a recommendation to build.
- Shipping and cancellation/return policy content remain explicitly unfinalized per standing project decisions — this document does not propose any policy text or assume any policy, and the redesign implementation phase will need real policy content before the Shipping & Returns / Terms pages can leave their current placeholder state (confirmed still placeholder as of the Phase 2 audit in this same task).

---

*This document is the complete Phase 3 deliverable. Per the task's stop condition, no visual implementation has been started. Awaiting review and approval of one direction (A, B, or C — or a hybrid) before any redesign work begins.*
