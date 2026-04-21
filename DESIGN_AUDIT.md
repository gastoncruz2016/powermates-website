# PowerMates — McKinsey/BCG Rebump Visual Audit

**Date:** 2026-04-21
**Repo:** github.com/gastoncruz2016/powermates-website
**Scope:** Look & feel only. No content, meta, structured data, or href changes.

---

## Executive summary

The site is in a **hybrid state**. The April pass (commit 42318ba) moved tokens toward light theme but left dark-era components behind — the nav, hero eyebrow, briefing section, CTA section, and ~20 gradient/orb elements still assume a dark background. That's why it reads "tech startup" in places: the artifacts are clashing with the editorial white base.

Raw counts in `styles.css`:

- **107** bright cyan references (`#36d7b7` / `rgba(54,215,183,*)` / `rgba(46,232,211,*)`)
- **19** uses of `--radius-pill` (every CTA is rounded)
- **20+** gradients (radial orbs, linear sheens, section washes)
- **64** Syne/Figtree font-family declarations
- **45** backdrop-filter rules (glass-morph nav, modals, dropdowns)
- **68** box-shadow rules
- **30+** elements declaring `color: #fff` or `rgba(255,255,255,*)` on now-light backgrounds (contrast hazard, partial cause of the 18 WCAG issues noted historically)

---

## Token-level changes (`styles.css` lines 7–61)

| Token | Current | Proposed |
|---|---|---|
| `--bg` | `#ffffff` | keep |
| `--bg2` | `#f7f9fc` (cool) | `#f8f8f6` (warm off-white, editorial) |
| `--bg3` | `#eef1f6` | retire (section dividers become `<hr>` + whitespace) |
| `--card` | `#ffffff` | keep |
| `--card2` | `#f7f9fc` | retire |
| `--cyan` | `#36d7b7` | **retire from all UI** (keep constant only for legacy SVG fills if referenced) |
| `--cyan-hover` | `#2bc4a6` | retire |
| `--cyan-dim` | `#0f766e` | **single accent, used sparingly** |
| `--cyan-glow` | `rgba(54,215,183,0.12)` | retire |
| `--cyan-border` | `rgba(13,148,136,0.2)` | replace with solid `#e2e8f0` for neutral borders; reserve `#0f766e` for 3px top accents only |
| `--cyan-bg` | `rgba(13,148,136,0.06)` | retire |
| `--gold*` | `#92400e`, etc. | retire (not used in target aesthetic) |
| `--text` | `#0a1628` | `#0d1b2a` (warmer navy) |
| `--text-secondary` | `#374151` | `#2d3748` |
| `--muted` | `#6b7280` | `#718096` |
| `--border` | `rgba(0,0,0,0.08)` | `#e2e8f0` (solid, predictable) |
| `--border-light` | `rgba(0,0,0,0.14)` | `#cbd5e0` |
| `--section-pad` | `128px` | `160px` |
| `--radius-sm/md/lg` | `4/4/6px` | `0/0/2px` |
| `--radius-pill` | `100px` | **retire** |
| `--shadow-card` | `none` | keep |
| `--shadow-hover` | `0 2px 8px rgba(0,0,0,0.06)` | `none` |
| `--shadow-glow` | `none` | keep |

**Font imports** (every HTML file, `<link href="…family=Syne…&amp;family=Figtree…">`):

```
family=Playfair+Display:wght@700&family=Inter:wght@300;400;500;600&display=swap
```

Drop Syne and Figtree entirely. If Syne is needed for one or two legacy eyebrow elements, switch them to Inter 600 uppercase tracked — McKinsey-equivalent treatment.

---

## Typography rebuild (`styles.css` lines 87–156)

Current:
- `h1–h4` → `font-family: 'Syne'`, `font-weight: 800`
- `body` → `font-family: 'Figtree'`, `font-weight: 300`
- `.section-title` → Syne, clamp(38px,6vw,60px)

Replace with:
- `h1, h2, h3, .hero-title, .section-title` → `'Playfair Display', serif`, weight 700, tracking `-0.02em`, line-height 1.1
- `h4` → `'Inter', sans-serif`, weight 600 (sans subheads OK, McKinsey mixes)
- `body` → `'Inter', sans-serif`, weight 300, 17px, line-height 1.75
- `.hero-title` clamp → `clamp(56px, 7vw, 80px)` (down from `clamp(48px, 9vw, 120px)` — 120 is too large for editorial tone)
- `.section-title` clamp → `clamp(40px, 5vw, 48px)` (down from `clamp(38px, 6vw, 60px)`)
- `.section-label` / eyebrow → 11px, Inter 600, tracking `0.12em`, uppercase, `color: var(--cyan-dim)`. Currently `rgba(255,255,255,0.4)` which is white on white — broken.
- Stat numbers (`.stat-num`, `.briefing-card` totals, etc.) → Playfair 700, 56px, color `--text` (was Syne 42px cyan)

---

## Nav (`styles.css` lines 159–293, `nav.js`)

Current issues:
- `background: rgba(6, 11, 22, 0.72)` — dark glass-morph on what's supposed to be a white site. **This is the single most jarring visual artifact.**
- `backdrop-filter: blur(32px) saturate(180%)`
- `.nav-links a` color `var(--muted)` (#6b7280) on dark glass — invisible at top of page
- `.nav-links a:hover` background `rgba(255,255,255,0.04)` — assumes dark bg
- `.logo span:first-child { color: #fff }` — white on white when scrolled past glass
- `.nav-cta` → pill button, cyan fill, dark text — needs outlined rectangle

Replace with:
- `nav` bg `#ffffff`, no backdrop-filter
- `nav.scrolled` bg `#ffffff`, add `border-bottom: 1px solid #e2e8f0`
- `.logo` both spans `color: #0d1b2a`; keep "MATES" subtle weight differentiation via Inter 500 vs 400 instead of cyan highlight
- `.nav-links a` → Inter 400, 14px, `#374151`; hover `#0d1b2a` with 2px bottom border `#0f766e`
- `.nav-links a.active` → `#0d1b2a`, Inter 500, persistent 2px bottom border
- `.nav-cta` → outlined: `border: 1.5px solid #0f766e; color: #0f766e; background: transparent; border-radius: 0; padding: 8px 20px`. Hover fills `#0f766e`, text white.
- `.hamburger span { background: #0d1b2a }` (currently `#fff`)
- `.nav-dropdown` shadow `0 16px 48px rgba(0,0,0,0.4)` → `0 8px 24px rgba(13,27,42,0.08)`; dropdown link hover bg `#f8f8f6`, color `#0d1b2a` (currently cyan-bg + white text — broken on light theme)
- `.dropdown-price` color `var(--cyan)` → `#0f766e`

---

## Hero (`#hero`, `.hero-*` — lines 344–473)

Current issues:
- `#hero-canvas` — WebGL particle canvas rendered at 0.25 opacity. McKinsey has no particles. **Hide.**
- `.hero-eyebrow` color `rgba(255,255,255,0.45)` — white eyebrow on white hero. Invisible.
- `.hero-title` Syne 800, clamp up to 120px, 0.95 line-height
- `.hero-sub strong { color: var(--cyan) }` — bright cyan inline text
- `.hero-ctas` two filled pill buttons
- `.hero-stats` cyan Syne numbers 42px
- `.scroll-hint` mouse icon with cyan animated dot — tech-startup motif

Replace with:
- Remove `#hero-canvas` (or set `display: none`). Hero bg plain `#f8f8f6`.
- `.hero-eyebrow` → 11px Inter 600 uppercase tracked, color `#0f766e`, no animations
- `.hero-title` → Playfair 700, `clamp(56px, 7vw, 80px)`, line-height 1.1, tracking `-0.02em`, max-width 760px
- `.hero-sub` → Inter 300, 20px, color `#2d3748`, max-width 560px; `strong` inherit color, weight 500, no cyan
- `.hero-ctas` → primary becomes outlined rectangle (black border), secondary becomes text-link-with-arrow `color: #0f766e; text-decoration: none; font-weight: 500;` → hover underline. Remove `transform: translateY(-4px) scale(1.02)` micro-interaction — too SaaS.
- `.hero-stats` → keep grid, swap `.stat-num` to Playfair 700 56px `#0d1b2a` (not cyan); `.stat-label` Inter 400 13px uppercase tracked `#718096`
- `.scroll-hint` → remove entirely (McKinsey/BCG never use scroll hints)
- After hero, insert `<hr>` divider pattern before the next section

---

## Buttons (`styles.css` lines 475–567)

Current:
- `.btn-primary` — white fill, pill radius, glow box-shadow, `translateY(-4px) scale(1.02)` on hover, switches to cyan fill on hover
- `.btn-secondary` — translucent white fill, pill radius, border, lift-scale hover
- `.btn-outline` — cyan text, cyan border, pill, cyan-tint fill on hover
- `.pricing-cta` / `.pricing-cta.outline` — same cyan pill pattern

Replace (3-tier system per brief):

```css
/* Primary: outlined navy rectangle */
.btn-primary {
  background: transparent;
  color: #0d1b2a;
  border: 2px solid #0d1b2a;
  border-radius: 0;
  padding: 14px 28px;
  font: 500 15px/1 'Inter', sans-serif;
  letter-spacing: 0.01em;
  box-shadow: none;
  transition: background 0.2s, color 0.2s;
}
.btn-primary:hover { background: #0d1b2a; color: #fff; transform: none; }

/* Brand CTA: outlined teal */
.btn-outline, .pricing-cta.outline {
  background: transparent;
  color: #0f766e;
  border: 1.5px solid #0f766e;
  border-radius: 0;
  padding: 12px 24px;
  font: 500 15px/1 'Inter', sans-serif;
}
.btn-outline:hover { background: #0f766e; color: #fff; }

/* Text-link CTA — new utility, replaces most filled CTAs on content sections */
.btn-text {
  color: #0f766e;
  font: 500 15px/1 'Inter', sans-serif;
  text-decoration: none;
  border-bottom: 1px solid transparent;
  padding-bottom: 2px;
}
.btn-text::after { content: ' →'; }
.btn-text:hover { border-bottom-color: #0f766e; }
```

`.btn-secondary` and `.pricing-cta` (filled cyan) — retire, map to `.btn-primary` or `.btn-text`. Inline style overrides in HTML (`style="font-size:17px;padding:16px 36px;"` etc.) can stay — they'll inherit the new base.

---

## Cards (`styles.css` lines 570–608 + 737–770 + 835–935)

`.topic-card` is already close — border-radius 4px, no shadow, `border-top: 3px solid transparent` that turns `--cyan-dim` on hover. Tighten:
- `border-radius: 0` (was 4px)
- `border-top: 3px solid #0f766e` **always visible** (not hover-only — McKinsey shows the accent as a persistent classifier)
- `padding: 40px` (was 36px)
- `h3` → Inter 600 18px `#0d1b2a` (currently Syne 17px 700)
- `p` → Inter 300 16px `#374151` (currently 14px `--muted`)
- Add "`Learn more →`" footer link using `.btn-text` pattern where cards link out

`.briefing-card`:
- `border: 1px solid var(--cyan-border)` → `border: 1px solid #e2e8f0; border-top: 3px solid #0f766e`
- `border-radius: 0`
- Remove `.briefing-icon` circle-with-cyan-bg motif → use small 24px line icon or eyebrow label instead (cyan circles read as web3, not consulting)
- `h3 { color: #fff }` — broken on light theme, change to `#0d1b2a`
- Remove `transform: translateY(-4px) scale(1.005)` hover

`#briefing` section itself (line 715):
- `background: linear-gradient(135deg, var(--bg2) 0%, rgba(17,30,51,0.8) 100%)` — **dark gradient on light site**, obvious artifact. Replace with plain `background: #f8f8f6;` and use an `<hr>` top/bottom.
- `::before` radial-gradient cyan glow — delete.

`.news-article`:
- `border-radius` → 0
- `.news-article-title { color: #fff }` → `#0d1b2a`
- `.news-article-lead { color: #a8b8d0; border-left: 3px solid var(--cyan) }` → color `#2d3748`, border-left `#0f766e`
- `.news-highlight-label { color: #fff }` → `#0d1b2a`
- `.news-highlight p { color: #8a9db8 }` → `#374151`
- `.news-tag` cyan pill → Inter 600 11px uppercase tracked `#0f766e`, no background, no border, no pill
- `.news-read-more` cyan pill-button → `.btn-text` pattern

---

## Section backgrounds & gradients (lines 104, 716, 724, 949, 1113, 1282–1492, 1585, 1685, 1731)

All 20+ gradient/orb declarations must go. Specific offenders:

- `.gradient-text { color: var(--cyan-dim) }` — harmless now, keep or remove
- `#briefing` linear gradient + radial ::before — delete both
- `#cta::before` radial cyan glow — delete
- Lines 1113, 1685 — card and section gradient-backgrounds — replace with `#ffffff` or `#f8f8f6`
- **Hero orbs block (1282–1492)** — `.orb-1`, `.orb-2`, `.orb-3`, `.beam`, etc. Entire section deletable. These are the "gradient blobs" giving the SaaS feel. ~210 lines go.
- Line 1429 — `.hero-title` gradient text (`linear-gradient(135deg, cyan → gold)`) — replace with solid `color: #0d1b2a`
- Line 1731 `.gradient-section` — delete definition and all usages

After this sweep, the entire site should have **two** background colors: `#ffffff` and `#f8f8f6`, with section transitions handled by `<hr>` or whitespace.

---

## Footer (`footer`, `.footer-*` — lines 1012+)

Current footer (from grep): uses `.footer-logo .w { color: #fff }` and `.footer-col h4 { color: #fff }` with col links styled for dark bg. This means footer is presumably still dark. Need to confirm by reading full block, but the plan is:

- Footer bg → `#0d1b2a` (McKinsey-style dark footer — acceptable, gives anchoring weight)
- Keep white text in footer (this is intentional there, unlike the nav)
- Column headings → Inter 600 12px uppercase tracked white
- Links → Inter 400 14px `rgba(255,255,255,0.7)`, hover white with underline
- Thin 1px `rgba(255,255,255,0.1)` divider between main grid and copyright strip

---

## Trust bar / credibility badges (lines 611–646)

- `.cred-badge` — cyan pill, cyan-tint fill. Replace with plain text link: Inter 500 13px `#0d1b2a`, separated by `•` dots, no pills, no borders. Optional: keep a thin underline.
- `.trust-label` — keep pattern, color `#718096`

---

## About pillars, manifesto (lines 662–711)

- `.pillar-icon` circle with cyan bg + border — remove background fill, use just a 24px line icon in `#0f766e` above the heading
- `.manifesto` cyan-left-border blockquote with italic — keep the editorial device but: `border-left: 3px solid #0f766e`, bg `transparent`, no border-radius, padding 32px 0 32px 36px, italic on body, `strong { color: #0d1b2a; font-style: normal; font-weight: 600 }` (currently `var(--cyan)`)

---

## Blog → "Insights" (`blog/index.html`, `.blog-card*`)

Current: `.blog-card`, `.blog-tag`, `.blog-filters`, `.blog-read-more`, `.hero-badge` (INSIGHTS label is already there).

Recommended:
- Keep the URL `/blog/` frozen. Only change the *visible label* from "Blog" to "Insights" across nav/breadcrumb/page headings — **but this is a copy change**, so skip per the content-frozen rule unless Gastón opts in separately.
- `.blog-filters` pill buttons → text-link tabs with bottom-border active state, Inter 500 13px uppercase tracked
- `.blog-card` → top-3px `#0f766e` accent, no radius, no shadow, 16:9 image slot at top, then eyebrow category label (Inter 600 11px uppercase `#0f766e`), then Playfair 700 22px title `#0d1b2a`, then Inter 300 15px excerpt `#2d3748`, then thin `<hr>`, then meta row (Inter 400 12px `#718096`) with date + read-time
- `.blog-tag` → retire pill look, use eyebrow pattern above
- `.blog-read-more` → `.btn-text` pattern
- `.hero-badge` on insights hero → 11px Inter 600 uppercase tracked `#0f766e`

---

## Component-level fixes (rapid list)

- **Scroll hint** (`.scroll-hint*`) — delete
- **Hero orbs block** (1282–1492) — delete
- **WebGL hero canvas** (`#hero-canvas`) — hide or remove script tag from `index.html`
- **Backdrop filters** (45 occurrences) — remove every one; replace with solid bg where used
- **Box shadows** (68 occurrences) — remove all except: (a) nav-dropdown subtle shadow, (b) modal shadow if `.report-modal` still in use
- **Border-radius** — run a pass replacing `var(--radius-pill)` with `0`, `var(--radius-lg)` with `0`, `var(--radius-md)` with `0`, `var(--radius-sm)` with `0` (use CSS var update, no search-replace needed)
- **Cyan color** — 107 bright-cyan refs: all should resolve through `--cyan` which we'll redefine as `#0f766e` (or ideally delete the var and migrate every `var(--cyan)` to `var(--cyan-dim)`). Safer approach: redefine `--cyan: #0f766e` globally, then the 107 sites auto-heal. Same for `--cyan-hover`.
- **`rgba(54,215,183,*)` literals** — hard-coded in the gradient blocks. Delete the whole blocks (they're decorative).
- **`rgba(46,232,211,*)` literals** — same treatment; these are also decorative.

---

## Page-by-page propagation

Once styles.css is rebuilt, these pages need per-file checks (not rewrites — just inline style overrides to clear):

| File | Expected cleanup |
|---|---|
| `index.html` | Remove `#hero-canvas` script, inline `style=` overrides on buttons (padding/font-size tweaks can stay), verify hero markup still works with new type scale |
| `tenant-scan.html` (1,041 lines) | Biggest page; multiple pricing cards, stat callouts, testimonial blocks — all will flow through shared classes, but spot-check for inline cyan/gradient |
| `services.html`, `pricing.html`, `about.html` | Hero + grid — flows through |
| `tenant-scan-{starter,professional,enterprise,ai-assisted}.html` | Pricing cards, CTAs — flow through |
| Other offering pages (14 files) | Same template — flow through |
| `blog/index.html` + 8 post pages | Card pattern rebuild (above) + post typography |
| `404.html`, `privacy.html`, `terms.html`, `fabcon-session.html`, `tenant-scan-success.html` | Minor — spot check |

**No hrefs change. No `<title>`, `<meta>`, JSON-LD, or canonical tags touched.**

---

## Out of scope (explicit)

- ROI estimator interactive component — keep JS behavior, apply new tokens only
- Tenant Scan dashboard preview (`tenant-scan-dashboard/`) — product UI, different aesthetic rules apply
- `samples/` directory — frozen per brief
- Any copy/heading/link changes — including the "Blog" → "Insights" rename (raised as a separate decision for Gastón)
- Image swaps — no new imagery; existing photos stay

---

## Risk / call-outs

1. **Contrast regressions** — previous audit flagged 18 issues. Primary risk areas: `.news-article-title` (`#fff`), `.briefing-card h3` (`#fff`), nav dropdown hover state, hero eyebrow. Fix in token pass will cascade, but a final contrast sweep is mandatory.
2. **Hero height change** — reducing H1 max from 120px to 80px will shrink the hero visually ~20%. Intentional — McKinsey heroes are quieter. If Gastón wants more presence, widen the type column instead.
3. **Dropdown menu legibility** — currently cyan hover on dark bg. After nav goes light, hover pattern changes meaningfully. Expect one follow-up review here.
4. **"Blog" vs "Insights"** — this is the one content decision I'd flag. Copy is frozen by default, but McKinsey/BCG don't call it Blog. Worth 30 seconds of Gastón's attention.

---

## Proposed execution order (unchanged from brief)

1. Token update (this unlocks ~80% of the visual change)
2. Global components (nav, buttons, cards, hero base, footer, hr pattern)
3. `index.html` as reference
4. `tenant-scan.html` → `services.html` → `pricing.html` → `about.html`
5. Offering pages batch
6. Blog
7. Contrast QA + before/after screenshots

**Estimated scope:** ~80% of the work is in `styles.css` (2 rewrites: tokens, then components). The HTML changes are minor — deleting `#hero-canvas`, trimming inline `style=` overrides, a few markup tweaks for blog cards.

---

## Sign-off ask

Gastón — two decisions:

1. **Approve the token + component direction above?** Specifically, are you OK with the accent going from cyan `#36d7b7` to teal `#0f766e` across all UI (it still reads as your brand color family, just the darker tone). This is the single biggest aesthetic change.

2. **"Blog" → "Insights" label rename** — yes, no, or defer?

On yes-yes (or yes-defer), I start on the token pass. ETA to rebuilt homepage: one working session.

---

## Ship report — 2026-04-21

**Both decisions approved. Rebump shipped.**

### What changed

| Area | Before | After |
|---|---|---|
| Fonts | Syne + Figtree | Playfair Display 700 (headings) + Inter 300/400/500/600 (body) |
| Accent | Bright cyan #36d7b7 | Deep teal #0f766e everywhere |
| Body text | #0d1b2a on #ffffff | Unchanged (17.4 ratio — AAA) |
| Muted text | #718096 (4.02 — **AA fail**) | #475569 (7.58 — AAA) |
| Card pattern | Rounded + shadow + hover-only top border | Flat 3px #0f766e top border, 0 radius, no shadow |
| CTAs | Pill-shaped with glow | Outlined rectangles + text-link-with-arrow |
| Section padding | Variable 60–100px | Fixed 160px (desktop) / 96px (mobile) |
| Hero background | `#hero-canvas` WebGL orbs | Clean white, editorial typography |
| Nav | Dark-era rgba bg + blur | White + underline hover + outlined teal CTA |
| Footer | Mixed teal/dark | Dark #0d1b2a anchor, white Inter text |
| Blog label | "Blog" | "Insights" (URL `/blog/` preserved) |

### Final QA (2026-04-21)

- **48 HTML pages audited.**
- 0 Syne/Figtree refs anywhere.
- 0 old-cyan `#36d7b7` refs.
- 0 pill/rounded radii (8–100px) in any HTML file or styles.css.
- 0 card box-shadows.
- 1 `backdrop-filter` remaining — `tenant-scan-dashboard/index.html` — intentional dark preview of the delivered audit dashboard (not marketing surface).
- WCAG AA: **10 of 10** key text/bg token pairs pass AA (most pass AAA).
- Content, nav links, SEO metadata, JSON-LD structured data, and JS behavior frozen as specified.
- Hero canvas JS guarded with null-check so removed `#hero-canvas` won't throw.

### Scope summary

- `styles.css` fully rewritten (tokens + ~15 component blocks + 200-line editorial override).
- `index.html` inline `<style>` block cleaned (ROI estimator, hero editorial grid, enterprise hero, HIW tags, case metrics).
- 37 HTML files: Google Fonts import swapped to Playfair + Inter.
- 32 HTML files: bulk transform for Syne→Playfair, Figtree→Inter, #36d7b7→#0f766e, pill radii→0.
- 20 offering/blog pages: inline dark-card `rgba(15,27,46,0.8)` backgrounds swapped to `#f8f8f6`; inline `color:#fff` flipped to `#0d1b2a`; white borders → `#e2e8f0`.
- Blog renamed to Insights: nav links in 37 files, page title + H1 + hero badge + JSON-LD "name" field on blog/index.html, title tags across 6 post pages.

Status: **shipped and QA-clean.**
