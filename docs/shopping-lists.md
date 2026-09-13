# Shopping lists

Open **Stock & purchasing → Shopping lists**.

1. Choose **New shopping list**, give it a name and notes, and generate it.
2. Eliza includes active products whose stock is at or below the minimum-stock threshold. Add other products manually or remove items you do not need.
3. Review target stock, quantity to buy, supplier, estimated unit cost excluding tax, purchase tax and item notes.
4. Save the list. Target stock and the chosen supplier become the defaults for that product in future lists.
5. Select individual items or supplier groups and choose **Create selected purchase drafts**.
6. Follow the resulting order links to review prices, place orders and receive deliveries through Purchases.

## Suggestions and estimates

Suggested quantity is the greater of zero and **target stock − current stock − outstanding placed-order quantities − unplaced purchase-draft quantities**. Remaining quantities on partially received orders count as incoming. Cancelled and fully received orders are excluded. Discrete units (pieces, packs and boxes) round upward to whole units.

Target stock is separate from the low-stock threshold. For products without a saved target, the initial target is twice the minimum stock, with a floor of one selling unit. Review it before ordering.

**Use suggestion** applies the currently displayed calculation to one item. **Refresh stock and recalculate** fetches current stock and purchase commitments and replaces outstanding item quantities with fresh suggestions, keeping your targets and notes. Save to retain those changes. Quantities are not automatically changed when a different user sells, receives or orders stock.

Initial costs and purchase tax come from the product catalog and are estimates, not supplier quotes. You can edit them in the list and again in the resulting purchase draft. Estimated totals include the purchase tax.

## Saved plans and conversion

Lists are shared within a store and persist across browsers. Users with purchase-reading permission can view them; purchase-writing permission is required to create, edit or convert them.

Conversion uses saved quantities, groups selected items by supplier and creates purchase drafts atomically. Requests are safe to retry, concurrent edits are version-checked, and inactive or foreign-store products/suppliers are rejected. Each draft holds up to 100 lines; larger supplier groups are split. Each list supports up to 500 products; the page shows the latest 100 lists.

Converted items retain their order links and cannot be converted again from the same list. They remain linked if the resulting order is later edited or cancelled. Create a new list when planning another order. Other unconverted shopping lists are plans, not reserved stock or orders: refresh suggestions before converting overlapping plans.

List notes accompany the order; item notes remain in the saved list. Drafts are not sent to suppliers automatically. Stock changes only when a delivery is recorded.

Deployment requires migration **0013_shopping_lists.sql**.
