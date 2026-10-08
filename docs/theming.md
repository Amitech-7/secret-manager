# Theming and layout

## Modes and accent

Four modes: **System** (follows the phone or computer), **Light**, **Dark**, and **Night** (pure black
background, which switches OLED pixels off). On top of any mode, the **accent colour** (buttons,
links, focus rings) can be a preset or any colour from the picker. Nothing else is customisable, so
no combination can make a screen unreadable.

Preferences live on the device only (`localStorage`, key `sm-theme`) and contain no secrets.

## How it works

- All colours are CSS variables (`--sm-*`). Components use semantic Tailwind names such as
  `bg-surface`, `text-fg`, `bg-accent`, never per-theme overrides.
- `src/theme/tokens.ts` is the single source of truth for the palettes. Run
  `pnpm --filter @sm/web tokens` after editing it; a test fails if `tokens.css` is stale.
- `public/theme-init.js` runs before first paint (so there is no flash of the wrong theme). It is an
  external file, not an inline script, so a strict Content Security Policy can allow it. It applies
  only a fixed list of five variables, and only plain `#rrggbb` values.

## Readability guarantees (all enforced by tests)

- Text, muted text, errors and success colours are at least 4.5:1 on every surface in every theme.
- Form-control outlines are at least 3:1.
- Button text is black or white, whichever contrasts more; for any colour that is at least 4.58:1.
- The accent used as link text or a focus ring is shifted per theme until it reaches 4.5:1 on every
  surface.

## Mobile-first rules

- Base styles are the phone layout; wider screens only enhance it.
- Touch targets are at least 44px tall; inputs use 16px text so iOS does not zoom in.
- The header and footer respect phone notches and gesture bars (`env(safe-area-inset-*)`).
- Heights use `dvh`, so the on-screen browser bars do not clip content.
- Check new screens at 360px wide with no sideways scrolling.
