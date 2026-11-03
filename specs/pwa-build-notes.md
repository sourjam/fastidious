# PWA build notes

## Vinext/Vite output spike (FAS-012)

Validated with `npm run build` on the versions locked for FAS-012.

- Vinext runs separate analysis, RSC, client, and SSR build environments.
- Browser chunks and CSS are hashed under `.cloudflare/output/v0/workers/default/assets/_next/static/`.
- Files in `public/` (including the web manifest, icons, and fonts) are copied without hashing to `.cloudflare/output/v0/workers/default/assets/`.
- The Cloudflare Worker, RSC modules, SSR modules, and their Vite manifests are emitted under `.cloudflare/output/v0/workers/default/bundle/`; these are not browser precache inputs.
- `dist/server/` contains Vinext build identifiers/configuration only and is not the source of deployable client assets.
- Layout metadata is rendered by Vinext from `app/layout.tsx`; the static `public/manifest.webmanifest` remains directly addressable at `/manifest.webmanifest`.

FAS-013 should spike a Vite-compatible inject-manifest flow against the final Cloudflare **assets** directory and its client `.vite/manifest.json`. It must not glob the Worker/RSC/SSR bundle, and it should include the unhashed manifest icons and fonts explicitly. No PWA plugin was added in FAS-012.

## FAS-013 build decision

A small project-owned Vite plugin now runs only for Vinext's `client` build environment. Its post-`generateBundle` hook sees the final hashed browser chunks and CSS, adds the explicit public icons/fonts/manifest, sorts the URLs, derives a content-based cache version, and emits both `service-worker.js` and `service-worker-assets.json` through Vite. Emitting through Vite is required: an initial post-build filesystem spike produced files that Cloudflare preview did not know about and returned 404. The plugin output is recognized by the Cloudflare asset binding and does not inspect or precache the RSC, SSR, or Worker bundle.
