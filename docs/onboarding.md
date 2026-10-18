# Page onboarding

Eliza offers first-visit spotlight walkthroughs for the 26 operational page types in `onboardingPages` (including receipts, refunds, checkout and Price Tags). Authentication and device-unlock forms keep their existing flow. The customer-facing price checker exposes the guide manually, without interrupting scanning.

## Behavior

- Start after the page has settled for 650 ms and employee progress has loaded. A completed or skipped version does not start automatically again.
- Do not interrupt an existing dialog, user interaction or a nonempty checkout cart. The Page guide button remains available.
- Next, Back, Finish, Skip, Close and Escape operate only the guide; they never trigger business actions. Arrow keys navigate steps. A native modal dialog keeps keyboard focus inside the guide and restores it afterward.
- Navigation closes an unfinished guide without marking it seen. Hidden or unavailable targets are omitted. Placement follows scrolling, resizing and layout changes.
- Russian and English use the existing translation system; colors follow the active theme. Guides are hidden when printing.

## Identity and persistence

Migration `0054_page_onboarding.sql` creates a separate `onboarding_progress` table. Rows are keyed by store, employee, page and version; statuses are `completed` or `skipped`. No sales, inventory or financial records change.

Authenticated GET/POST endpoints are `/api/auth/onboarding`, `/api/pos/onboarding`, and `/api/price-tags/onboarding`. All derive the employee and store from the existing authenticated session and share the same progress table. Clients cannot choose another actor. The POST payload is `{pageId, version, status}` and is validated against the shared contract.

Browser storage caches acknowledgements by store and employee and retains pending writes when a request fails. Pending acknowledgements retry after a later successful progress load. Server progress prevents repeat guides across browsers. Storage failure falls back to memory for the current session. The customer price checker has no employee login and stores manual guide progress locally by device instead.

## Adding or updating a guide

1. Add its stable page ID to `onboardingPages` in the contracts package and map the route in `onboardingPage`.
2. Add a versioned definition to `apps/web/src/onboarding/tours.ts` with scoped CSS selectors and short explanations. Prefer existing stable class names. Steps should explain actions rather than execute them.
3. Add Russian copy in `apps/web/src/i18n/ru.json`. Increase the guide version only when employees should see a revised tour again.
4. Mount `PageOnboarding` inside the authenticated workspace and provide its store/employee identity, authenticated endpoint and DOM scope. Management routes already use the shared shell mount.

Verification covers definitions/translations, responsive placement, storage failures, authenticated API isolation, cross-browser persistence, keyboard focus, all management pages and employee checkout/Price Tags guides. Existing workflow tests acknowledge guides through `tests/e2e/fixtures.ts`; guide-specific tests import Playwright directly.
