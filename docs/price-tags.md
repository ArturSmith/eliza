# Price Tags station

A manager assigns the **General employee** role in Team and assigns a browser to the **Price Tags** environment in Devices. An employee can also keep Checkout access through their role. The device assignment selects the workspace; the employee's access controls who appears on its PIN sign-in screen. Changing a device environment ends its active sessions. A register with an open cashier shift must close that shift before changing environments.

On a Price Tags device, opening Eliza routes to `/price-tags`. Staff select their name, enter their six-digit PIN, search products, select tags, and choose **Print selected tags**. The server returns a fresh snapshot of product prices for the print job and records the station, employee, products and prices. The browser then opens its print dialog. The initial layout is an A4 sheet with three columns; use the browser's print settings for paper and margins. A print request records that the dialog was opened, not that a physical printer successfully produced the sheet.

Price Tags sessions cannot use management or checkout endpoints. The printable tags include name, selling price, unit and a printed barcode/PLU value. They do not yet render a machine-readable barcode graphic or connect directly to a dedicated label printer. Those need a printer and label-size specification before calibration.

To return an assigned device to Management, use **Management sign in** on the locked Checkout or Price Tags screen. A manager with device-management access enters their email and password and confirms the environment change. Eliza refuses the switch while that device has an open cashier shift. After a successful switch, the same browser returns to the Management workspace.

## Changed prices

The station opens on **Price changed**, whose counter includes active products needing replacement tags. **All products** retains the complete active catalog; search works within either tab. New products do not count as price changes. A real selling-price edit queues the product regardless of whether it comes from Products, receiving or Eliza AI. Cost-only edits and saving the same selling price do not queue it.

The queue is stored per shop in the database. Opening the browser print dialog prepares a price snapshot; completing the print flow acknowledges only that exact price version. Another price edit while a job is open stays pending, including changes back to an earlier price. Weighted tags use the same job snapshots and clear the same queue. Completed tags remain available in All products.

The browser does not report physical printer success or distinguish cancellation reliably. The app completes the print flow when `window.print()` returns. Cancelled or failed physical printing may require printing the product again from All products. A failed API acknowledgement leaves the price change pending.

Migration 0036 starts tracking all new price edits and recovers differences against existing recorded print snapshots. Existing products without a prior print record start with no pending change because their previous shelf price is unknown.
