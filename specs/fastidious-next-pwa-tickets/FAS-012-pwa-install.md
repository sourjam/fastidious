# FAS-012 — PWA manifest, icons, fonts, and installation UX

**Status:** Closed

## Objective

Make Fastidious installable with correct metadata/assets and platform-aware installation guidance. This ticket does not implement offline caching or push delivery.

## Dependencies

FAS-003.

## Build compatibility spike

Before selecting a PWA plugin, verify how Vinext/Vite emits:

- client assets;
- RSC/server assets;
- public files;
- manifest metadata;
- Worker output.

Record the result in a short code comment or project note used by FAS-013. Do not install a Next.js-only PWA package.

## Manifest

Create a generated or static web manifest containing:

- `id: "/"`
- `name` and `short_name`: Fastidious
- `description`
- `start_url: "/"`
- `scope: "/"`
- `display: "standalone"`
- `orientation: "portrait"`
- light Industry `theme_color` and `background_color`
- standard 192×192 and 512×512 icons
- maskable 192×192 and 512×512 icons
- monochrome icon if browser support/tooling permits

Do not place a secret in `start_url` or manifest shortcuts.

## Icon set

Design a simple condensed **F** monogram using the steel-blue palette and subtle blueprint registration-mark influence.

Create:

- editable source SVG;
- favicon SVG/ICO as needed;
- 192/512 standard PNGs;
- 192/512 maskable PNGs with verified safe zone;
- 180 Apple touch PNG;
- monochrome SVG/PNG if used.

Test at 16px, 32px, home-screen size, and Android mask shapes. Avoid fine marks that disappear at small sizes.

## Document metadata

Configure through Vinext-compatible layout metadata/HTML:

- manifest link;
- Apple touch icon;
- `apple-mobile-web-app-capable`;
- Apple title;
- safe-area viewport (`viewport-fit=cover`);
- theme color handling for light/dark where supported;
- descriptive page title;
- noindex for secret-bearing application content if crawler behavior reaches it.

Ensure fragment credentials never appear in server metadata or canonical links.

## Self-hosted fonts

- Add optimized WOFF2 files for required Barlow body weights and Barlow Condensed 600.
- Use `font-display: swap`.
- Define fallback metrics/families to minimize layout shift.
- Remove Google Fonts network requests.
- Include license text/attribution as required.
- Keep asset sizes modest; subset only if licensing/tooling makes it reliable for required characters.

## Install UX

Create a small platform capability module and install card/sheet.

### Android/Chromium

- Capture `beforeinstallprompt`.
- Show Install only after the app has meaningful context, not as an immediate modal.
- Invoke prompt from a user action.
- Record dismissal locally.
- Hide when standalone.

### iOS/iPadOS

- Detect likely iOS plus non-standalone mode without relying on detection for security.
- Show concise **Share → Add to Home Screen** steps.
- Explain that installation is required for Web Push.
- Hide when standalone or dismissed.

### Other browsers

- Avoid false claims.
- Show generic browser-menu guidance only when useful.

Install-prompt dismissal is device-local and does not sync.

## Test plan

Minimal tests:

1. Manifest contains required identity, portrait, icon, and start URL fields.
2. Installed/standalone mode hides installation guidance.
3. Captured Android prompt is invoked only from Install action.
4. iOS copy mentions Add to Home Screen and push requirement.

Icon appearance is a manual check, not a brittle pixel test.

## Acceptance criteria

- Browser installability checks recognize the manifest/assets.
- Installed app starts at `/`, then local identity restoration handles the log.
- iOS/Android guidance is accurate and dismissible.
- Fonts load without Google/third-party requests and remain available for FAS-013 caching.
- Portrait orientation is requested.
- Icons remain legible and mask safely.

## Out of scope

Service-worker caching, update prompts, push subscription, App Store/Play Store packaging.

## Completion note

Implemented the credential-free portrait manifest, standard/maskable/Apple/monochrome icon set, Vinext document metadata, self-hosted OFL-licensed Barlow WOFF2 fonts, and contextual Chromium/iOS installation guidance with device-local dismissal. The install prompt is captured while the app shell is mounted, invoked only by the Install action, and hidden in standalone mode. The Vinext/Cloudflare output spike is recorded in `specs/pwa-build-notes.md` for FAS-013.

Validation evidence:

- TDD red: `npm test -- components/install/InstallCard.test.tsx pwa/manifest.test.ts` initially failed because the component and manifest did not exist.
- `npm test -- components/install/InstallCard.test.tsx pwa/manifest.test.ts` — 2 files and 4 tests passed.
- `npm test` — 22 files and 99 tests passed.
- `npm run typecheck` — passed.
- `npm run build` — passed; the Cloudflare output contains the unhashed manifest/icons/fonts and hashed client assets.
- Production preview HTTP checks served `/`, `/manifest.webmanifest`, a maskable PNG, and a WOFF2 font; rendered HTML contained the manifest, Apple metadata/touch icon, safe-area viewport, noindex directive, descriptive title, light/dark theme colors, and no secret fragment.
- PNG verification opened the 192/512 standard and maskable assets plus the 180 Apple asset at their declared dimensions. The monogram was inspected at 16px, 32px, 192px, and 512px; the maskable monogram geometry remains within the centered 80% safe-zone circle on a full-bleed background.
- Runtime source grep found no Google Fonts or other third-party font URL.
- `git diff --check -- .` — passed.

Chrome browser tooling was unavailable in this worker. FAS-016 should visually exercise the You-tab card at a 390×844 mobile viewport in light/dark mode for captured Chromium, iOS guidance, dismissed, and standalone-hidden states, and recheck Android circle/squircle masks on a device or browser PWA tool. No browser evidence is claimed here.
