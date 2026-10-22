# Taybah — Design System

## 1. Brand Direction

**Luxury Editorial with Modern Royal influences.** The UI should feel like a
high-end design magazine that happens to sell oriental rugs and home
furnishings — not a marketplace. Every screen should prioritize:

- Premium oriental heritage, expressed subtly (pattern motifs as accents,
  not wallpaper).
- Contemporary luxury — restraint over ornamentation.
- Editorial layout logic: asymmetry, generous margins, strong typographic
  hierarchy, photography as the hero.
- Sophisticated typography with clear hierarchy.
- Generous whitespace — the interface should never feel dense, even with
  1,000+ products in the catalog.

**Explicit constraint carried through this doc: Antique Gold is an accent,
never a dominant surface or primary interactive color.**

This brand direction and the color system in §3 are **approved and
unchanged** from the initial discovery phase. This revision adds the
mandatory mobile-first and bilingual (Arabic RTL / English LTR) strategy
below as an equally binding constraint on every storefront screen.

## 2. Mandatory Mobile-First & RTL/LTR Strategy

**Mobile is the primary storefront experience.** Every storefront page is
designed and validated in this order: **mobile → tablet → desktop.**
Desktop is an intentional expansion of the mobile experience — more
breathing room, additional secondary content, richer hover states — not a
mobile layout stretched into extra space, and not a desktop-first design
later squeezed down.

### 2.1 Breakpoint Intent (design targets, not final pixel values)

| Tier | Target | Design intent |
|---|---|---|
| Mobile | ~360–480px | The baseline. Every core flow (browse → filter → product → cart → checkout) must work fully here with no desktop-only dependency. |
| Tablet | ~768–1024px | An expansion: more columns, filter sidebar may appear, secondary content (related products, extra editorial copy) becomes visible. |
| Desktop | 1280px+ | Full editorial expression: asymmetric layout, persistent filter sidebar, richer imagery, hover interactions. |

Exact pixel breakpoints are a Tailwind config decision for Phase 2+, not
fixed here — the ordering and intent above is the binding part of this
strategy.

### 2.2 Arabic (RTL) Default, English (LTR) Secondary

- **Arabic is the default storefront locale and reading direction.**
  English is a fully supported secondary locale, not a stripped-down
  fallback.
- Direction (`dir="rtl"` / `dir="ltr"`) is set at the document root per
  locale and the entire layout — navigation, breadcrumbs, forms, icons
  with inherent direction (back/forward chevrons), gallery swipe order —
  mirrors accordingly. This is a **logical-properties-first** approach at
  the implementation level (`margin-inline-start` instead of `margin-left`,
  etc.) so the layout flips correctly rather than needing a parallel
  hand-mirrored RTL layout maintained separately.
- Typography (§4) must be selected/paired to render Arabic script
  properly — the headline serif chosen for Latin text needs an Arabic
  counterpart with comparable weight and editorial character, not a
  generic system Arabic font substituted underneath a bespoke Latin one.
  This pairing is called out as an **open design decision**, not resolved
  by this document — see [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md).
- Numerals, prices, and SKUs remain LTR within RTL text (standard
  bidi-text handling), per normal Arabic typographic convention — not
  mirrored.
- The decorative oriental-pattern motifs (§6) are symmetric or
  direction-neutral by design specifically so they don't need a separate
  mirrored asset per locale.
- **The admin dashboard is LTR/English-only for v1** (an internal tool, not
  the bilingual brand surface) unless a business decision says otherwise —
  see [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md).

### 2.3 Touch & Mobile-Specific Patterns

- **Touch targets** meet a minimum ~44×44px hit area throughout the
  storefront, per standard mobile accessibility guidance — not just
  "looks clickable on a mouse cursor."
- **Navigation:** a mobile nav drawer/bottom navigation pattern on mobile;
  expands to a full horizontal nav bar on tablet/desktop. Same information
  architecture, two presentations.
- **Product galleries:** swipe-first on mobile (swipe direction follows
  the active locale's reading direction), with hover-zoom and a thumbnail
  strip added as a tablet/desktop expansion — not the mobile gallery's
  primary interaction.
- **Filters:** a bottom sheet on mobile, a persistent sidebar on
  tablet/desktop — one filter state, two presentations. See
  [FEATURES.md](./FEATURES.md) §0 and Product Listing.
- **Product grids:** responsive column counts (fewer columns, larger cards
  on mobile; more columns on desktop) rather than one fixed grid scaled by
  CSS alone.

## 3. Color System

| Token | Hex | Role |
|---|---|---|
| `porcelain` | `#F7F5F0` | Primary background (warm, not stark white) |
| `white` | `#FFFFFF` | Card/surface backgrounds, contrast against porcelain |
| `burgundy` | `#681D20` | Primary brand color — CTAs, key accents, active states |
| `gold` | `#B58A43` | **Accent only** — dividers, icon highlights, decorative details, hover micro-interactions. Never a button fill, never a large surface. |
| `espresso` | `#29221E` | Primary text color, headlines |
| `taupe` | `#D8CFC1` | Secondary surfaces, borders, muted backgrounds |

### Usage rules
- **Backgrounds:** porcelain (default) / white (cards, elevated surfaces).
- **Primary text:** espresso. Never pure black.
- **Primary actions (Add to Cart, Checkout, Submit):** burgundy fill, white
  text.
- **Secondary actions:** espresso or taupe outline, transparent fill.
- **Gold is reserved for:** thin rule lines under section headers, small
  icon accents, a subtle border on featured/editorial cards, hover state on
  text links. Gold should appear in no more than one or two small details
  per screen.
- **Never:** gold buttons, gold backgrounds, gold navigation bars, gold text
  on porcelain (fails contrast for body text regardless).
- All text/background combinations must meet WCAG AA contrast — burgundy on
  porcelain and espresso on white/porcelain pass; gold text is restricted to
  large decorative headings only, never body copy or small UI labels, due to
  contrast limits.
- These rules apply identically in RTL and LTR layouts — color usage does
  not change with reading direction.

## 4. Typography

- **Headlines/Editorial:** a refined serif or high-contrast display
  typeface for Latin (English) text — communicates heritage and editorial
  luxury — **paired with an Arabic display typeface of comparable weight
  and character** for Arabic headlines, not a generic system Arabic
  fallback. Specific typeface selection for both scripts is an **open
  decision** — see [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md); Latin
  candidates to evaluate include a licensed premium serif vs. a
  well-reviewed open-source alternative such as "Fraunces"; the Arabic
  counterpart needs to be evaluated alongside it, not chosen separately
  after the fact.
- **Body/UI:** a clean, highly legible sans-serif (e.g. "Inter" or similar)
  for Latin product details/filters/forms, with a matching legible Arabic
  sans-serif for the same UI in Arabic — editorial flourish stays in
  headlines, not in functional text, in either language.
- **Scale:** generous type scale with clear jumps between headline, subhead,
  body, and caption levels — avoid a cramped, marketplace-dense hierarchy.
  Arabic script generally needs slightly larger body sizes and more
  line-height than Latin to read as comfortably — the type scale accounts
  for this per-locale rather than reusing identical point sizes.
- **Admin dashboard uses the same sans-serif body font throughout** (no
  serif in admin) — admin is a functional tool, not an editorial surface,
  and is LTR/English-only for v1 (§2.2).

## 5. Layout Principles

- **Mobile-first, per §2** — every principle below is first satisfied at
  mobile width, then expanded for tablet/desktop.
- **Whitespace is a design element**, not empty space to fill. Product
  grids should breathe — fewer items per row than a typical marketplace,
  at every breakpoint.
- **Asymmetric, editorial grid** for homepage/category storytelling
  sections on tablet/desktop (not a uniform card grid everywhere); on
  mobile, storytelling sections stack in a single, clear reading column —
  "asymmetric" on mobile means purposeful visual rhythm, not literally
  overlapping/off-grid elements that don't fit a small viewport.
- **Photography-first**: product images are large, high-quality, and never
  cropped awkwardly to fit a rigid grid cell — the design system should
  define consistent aspect ratios (e.g. 4:5 portrait for product cards) so
  photography direction can standardize around them.
- **Layout mirrors correctly in RTL** (§2.2) using logical CSS properties,
  not a hand-maintained mirrored layout.
- Admin dashboard layout is **functional-first**: dense data tables,
  sidebar navigation, clear information hierarchy — borrows the color
  system and typography for brand consistency but does not attempt
  editorial flourish, and is not mobile-first (admin is a desktop-primary
  internal tool; reasonable tablet support, no mobile-first requirement).

## 6. Decorative Details

- Subtle oriental-pattern-inspired motifs (e.g. a thin geometric border
  treatment, a corner flourish) used sparingly — section dividers, empty
  states, email templates. These are **decorative accents**, not textures
  applied broadly across backgrounds.
- No heavy ornamentation, no literal "carpet pattern as UI background" —
  that would undercut the "modern" half of "Modern Royal."
- Motifs are symmetric/direction-neutral so the same asset works unmirrored
  in both RTL and LTR layouts (§2.2).

## 7. Logo

- Brand logo will be supplied as a project asset (not yet provided).
  Design system should define logo clear-space, minimum size, and
  acceptable backgrounds (porcelain/white) once supplied — tracked in
  [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md). Confirm whether the logo has a
  distinct Arabic wordmark (طيبة) vs. a single direction-neutral mark used
  in both locales — also tracked there.

## 8. Component Design Direction (not yet built)

To be implemented as Tailwind-based components matching this system, each
designed mobile-first and validated in both RTL and LTR (non-exhaustive,
expanded during Phase 4+):
- Product card (listing grid)
- Variant selector (swatches/dropdowns)
- Filter bottom sheet (mobile) / filter sidebar (tablet/desktop) — one
  component's two presentations, not two components
- Quick View modal
- Cart drawer
- Mobile nav drawer / desktop nav bar
- Admin data table
- Admin form inputs (consistent with storefront type/color tokens, denser
  spacing; LTR/English only per §2.2)

## 9. What This Document Is Not

This is **design direction**, not final visual comps. No components have
been built. Pixel-level mockups and a component library are implementation
work for later phases, informed by this document.
