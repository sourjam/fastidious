# FAS-022 — Grocery list and food linkage

**Status:** Closed

## Objective

Implement the v2 Grocery section in Today → Log and connect it to reusable foods without making groceries depend on the food library.

## Dependencies

FAS-017, FAS-018, FAS-019, and FAS-020.

## Grocery behavior

- Show active `to buy` count and optional estimated price.
- Add a free-text grocery item inline.
- Toggle an item into/out of the cart with an accessible checkbox-style control.
- Show/hide completed cart items.
- Clear completed cart items explicitly.
- Edit name, safe external link, and later image override.
- Delete an individual item.
- Work on the selected Today date only as a view context; the grocery list itself is current shared log state, not a historical per-day list.

## Food integration

Food rows expose `+ List` or `On list`.

- Adding creates one active linked grocery item.
- Repeating the action removes that active linked item rather than creating duplicates.
- A linked food supplies name, price, URL, and image when no grocery override exists.
- Grocery overrides do not mutate the food.
- Deleting a food leaves the grocery item and clears its link.
- Estimated price sums known active-item prices and labels the total as an estimate.

Do not use mutable name matching as identity after a link is established.

## Offline and conflicts

Grocery actions commit locally with queued mutations. Last server arrival wins per item. Concurrent devices may add similarly named unlinked items; do not silently merge distinct IDs.

## Accessibility

- Cart state is announced as checked/unchecked.
- Completed styling is not conveyed by strikethrough/opacity alone.
- `Clear cart` confirms the affected count and remains keyboard accessible.
- External links are separate from row toggle/edit actions.

## Test plan

Minimum tests:

1. `+ List` adds one linked active item and changes to `On list`.
2. Repeating `On list` removes only the matching active linked item.
3. Cart toggle survives offline reload and sync.
4. Estimated price uses food price and grocery overrides correctly.
5. Food deletion preserves the grocery item.
6. Clear cart removes completed items but not active items.
7. Two same-name unlinked items remain distinct records.

## Acceptance criteria

- Grocery populated, empty, cart-hidden, and cart-visible states match the v2 handoff.
- Food linkage has explicit stable identity and safe deletion behavior.
- Grocery remains fully usable without any food records.
- All actions are local-first, synchronized, and accessible.

## Out of scope

Store aisles, shared-user attribution, retailer APIs, purchasing, and image upload/delivery.

## Completion note

Implemented the shared local-first grocery list, linked Food `+ List`/`On list` actions, inherited price/link/media details, free-text duplicates, cart visibility and clearing, safe item editing, stable food unlinking, and estimated totals.

Validation: 178 Vitest tests, TypeScript typecheck, production build, and `git diff --check` passed. Compared empty, populated, cart-hidden, cart-visible, light, and dark states with `Fastidious-v2.html` at 320×720, 390×844, and 440×900 Chrome viewports.
