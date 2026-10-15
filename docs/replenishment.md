# Sales-based replenishment

Implemented: 15 October 2026. Open **Stock & purchasing → Replenishment**.
API: `GET /api/reports/replenishment`. Requires `sales.read`, `inventory.read`,
`purchases.read` and `suppliers.read`; figures contain no purchase costs or profit.

## Calculation

Defaults: 28 completed store-local calendar days, a 7-day review cycle and 2 safety
days. History can be 14–90 days. The current partial day is excluded. Product
history starts after the first recorded movement and creation day; fewer than 14
complete days means insufficient history, never a confident no-sales conclusion.

Sales pace is gross units sold divided by observed days, including zero-sales
products. Returns are shown separately: a return does not erase the original demand.
Legacy markdown child products are grouped with their original product. A no-sales
label is an observation, not proof of lack of demand. More than 60 days of current
stock cover is labelled slow / high stock cover; it can also mean overstocking.

Target quantity = observed daily sales × (lead time + review cycle + safety days).
Exclude already expired batches. Simulate FEFO use of current batches and expected
arrivals; add stock expected to expire before sale within the horizon. Subtract
available stock and dated incoming stock within the horizon. Round any positive
deficit up to the supplier pack size and minimum order in selling units.

An order-by date is based on the first simulated shortage, minus supplier lead time
and safety days. Supplier lead time may be zero, but must be recorded and at most
365 days. Use the saved preferred supplier, or the sole active supplier offer; do
not guess between multiple offers. Configure preferred suppliers in shopping lists
and lead times/pack sizes in supplier offers.

## Missing data and boundaries

- Stock that does not reconcile with batches suppresses the quantity recommendation.
- Missing lead times, invalid pack sizes, and overdue/undated incoming orders require review.
- Dated arrivals are simulated in order; a late shipment cannot hide an earlier stockout.
- Purchase drafts are displayed and warned about, but never treated as confirmed arrivals.
- Stockouts and unknown expiry dates are warned about. Sales are not adjusted into an
  estimate of lost demand. Seasonality, promotion effects and service levels are not modelled.
- Future incoming expiry is unknown; that stock is assumed usable on arrival. Review
  shelf life and supplier delivery reliability before ordering.
- Search and status filters, stable ordering and 50-record pages are supported.
  The report evaluates up to 5,000 matched products and explicitly flags truncation.
- No writes to prices, financial history, stock, shopping lists or purchase orders occur.
  Existing reviewed purchasing workflows remain the path for placing an order.

## Manual check

1. Select a product with 28 complete days of history and 28 units sold in that window.
2. Set its supplier to a 3-day lead time and a pack size of 6; keep review 7 / safety 2.
3. With 3 usable units and no incoming stock, expect average 1/day, target 12 and
   recommendation 12 units (9-unit deficit rounded to packs), order now.
4. Add a confirmed 20-unit delivery due in 2 days: expect no additional order quantity.
5. Move its expected arrival 10 days away: expect review required for the earlier gap.
6. Remove its delivery date or make it overdue: quantity must be unavailable until reviewed.
7. New products show insufficient history. A stocked mature product with no sales
   remains visible in the no-sales filter. Zero stock and zero sales need review.
8. Ask Eliza AI the equivalent question; it uses the same report and preserves warnings.

Unit, database and browser tests cover calculation, expiry, dates, permissions,
store isolation, filtering and new-product handling. Live LLM behaviour is not
established by mocked-provider tests alone.
