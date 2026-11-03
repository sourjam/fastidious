# FAS-024 — Cloudflare Images and v2 release integration

**Status:** Open

## Objective

Finish v2 by adding image upload, offline staging, delivery, replacement, and cleanup through Cloudflare Images, then validate the complete v2 handoff across features and devices.

Images are part of the v2 release, not deferred. They are scheduled last so core records and synchronization remain independently testable.

## Dependencies

FAS-017 through FAS-023 and FAS-016.

## Cloudflare Images architecture

Use Cloudflare Images as the binary store. D1/Dexie records contain only opaque image metadata and lifecycle state, never full synchronized image bytes.

Required design before implementation:

- authenticated endpoint for one-time/direct uploads or a Worker-mediated equivalent;
- Cloudflare credentials available only server-side;
- image ownership tied to the internal log ID;
- private or signed delivery so knowing another log's image ID is insufficient;
- named delivery variants suitable for 40px list thumbnails and larger edit previews;
- explicit per-file, per-log, MIME, pixel-dimension, and rate limits;
- EXIF stripping/orientation behavior;
- orphan and replacement cleanup policy;
- cost/quota documentation and an actionable quota error.

Do not put image URLs containing credentials or signed tokens in persistent records.

## Offline staging

Image selection must remain local-first:

1. validate type and size;
2. normalize/compress as approved;
3. store a pending Blob in a device-only Dexie table;
4. show the local preview immediately;
5. upload when online;
6. attach the returned opaque asset reference through a normal entity mutation;
7. remove the pending Blob only after durable attachment.

Other devices show the record without its new image until upload/attachment completes. Failed uploads remain retryable and do not block edits to the underlying entity.

## Supported records

Add/replace/remove images for:

- foods;
- whole meals (one image per meal, not per meal item);
- activities;
- checklist items;
- grocery overrides.

Replacing/removing an image must not delete a still-referenced asset. Entity/log deletion schedules safe Cloudflare Images cleanup.

## Import/export policy

Before implementation, record the agreed portability behavior in the product specification. At minimum:

- JSON never contains signed delivery URLs or credentials;
- import rejects image references not owned by the current log/deployment;
- preview reports dropped or unavailable images before replacement;
- pending local blobs are handled explicitly rather than silently omitted;
- export copy states clearly whether image binaries are portable.

Recommendation: keep JSON exports bounded, export opaque metadata only, and warn that image binaries are deployment-managed rather than embedded. If full portable backup is required, specify a separate bounded archive format rather than base64 inside ordinary JSON.

## Security and privacy

- Validate actual decoded content, not only filename/MIME header.
- Reject SVG and executable/polyglot formats unless a safe transform guarantees raster output.
- Never log image bytes, upload tokens, signed URLs, secret links, or entity content.
- Apply authorization to upload creation, attachment, delivery-token creation, and deletion.
- Prevent one log from attaching or deleting another log's asset.
- Bound retries and garbage collection.

## V2 integration validation

Validate the complete handoff at 320×568, 390×844, and 440×956 in light and dark themes:

- Fast active/idle and meal integration;
- Today Log on current/past days;
- checklist empty/partial/complete and cadence states;
- meals empty/populated/edit/one-off/end-fast prompt;
- activities empty/populated/logged/free-text;
- grocery to-buy/cart/empty states;
- Foods and Activities search/category/edit sheets;
- Calendar Day/Month/Year in every layer;
- Stats and You with daily targets and expanded data counts;
- image pending/uploaded/failed/replaced/removed states;
- offline writes and reconnection.

Exercise keyboard focus, sheet return focus, reduced motion, safe areas, software keyboard overlap, and screen-reader labels.

## Test plan

Minimum automated coverage:

1. Pending image Blob and entity mutation are staged consistently.
2. Successful upload attaches one owned asset and removes local pending data.
3. Retry is idempotent after an interrupted response.
4. Another log cannot attach/read/delete the asset.
5. Replace/remove schedules deletion only when no reference remains.
6. Log expiration/clear cleanup covers Cloudflare Images.
7. Invalid content, oversize files, and quota errors leave the record usable.
8. Export/import follows the documented image portability policy.

Manual checks require at least two browsers/devices to verify delayed cross-device image appearance and secret isolation.

## Acceptance criteria

- All v2 image controls in the handoff are functional.
- Image bytes never enter D1 sync payloads or ordinary JSON export accidentally.
- Offline image selection survives reload and uploads after reconnection.
- Authorization and ownership checks prevent cross-log access.
- Cloudflare Images cost/quota and cleanup operations are documented.
- Every FAS-017–FAS-024 acceptance criterion is verified.
- Relevant tests, typecheck, build, and `git diff --check` pass.
- Chrome visual evidence records viewport, theme, feature, and state checked.

## Implementation note

Implemented the Cloudflare Images pipeline, device-only pending-Blob storage, authenticated private delivery, ownership checks, quotas, retry UI, lifecycle cleanup, and food/whole-meal/activity/checklist/grocery controls. JSON portability now reports and drops image references on import; pending blobs are disclosed and excluded.

Validated locally with 192 tests, TypeScript typechecking, the production build, and `git diff --check`. Chrome checks covered the food image sheet and normalized local preview at 320×568 dark, 390×844 light, and 440×900 dark; the sheet remained scrollable and keyboard-sized controls remained usable.

Production deployment validation completed on the `workers.dev` service: migrations `0004` and `0005` are applied; private `thumbnail` (96×96 cover) and `preview` (1,600×1,600 scale-down) variants are configured; and the app and scheduled cleanup Worker are deployed with Images bindings. Live checks covered successful normalized upload, signed/private thumbnail delivery, red-to-blue replacement, removal and deletion scheduling, offline staging surviving a reload, automatic upload after reconnection, an independent sync client receiving the attached reference, and a second log receiving `404` for the private image. A CSP issue found during the live check was fixed by rendering authenticated response bytes as a data URL. Test records were deleted and all four temporary assets are pending the documented cleanup grace period.

A follow-up adds one optional image to each whole meal, including offline staging, private thumbnail display, sync/reset persistence, replacement/removal cleanup, and backward-compatible import of earlier v2 meal records. Migration `0006_meal_images.sql` and the updated Worker still require production deployment; the attempted remote migration was rejected because the local Cloudflare OAuth session was no longer authorized.

Before closing: perform the remaining literal second-browser/device UI check using the same secret link. The deployed independent sync-client and cross-log checks verify the server contracts, but the ticket explicitly calls for a second real browser or device.

## Out of scope

Photo editing, public galleries, social sharing, image recognition, and third-party media libraries.
