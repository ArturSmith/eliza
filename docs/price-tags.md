# Price Tags station

A manager sets an employee's **Price Tags access** in Team and assigns a browser to the **Price Tags** environment in Devices. An employee can also keep Checkout access through their role. The device assignment selects the workspace; the employee's access controls who appears on its PIN sign-in screen. Changing a device environment ends its active sessions. A register with an open cashier shift must close that shift before changing environments.

On a Price Tags device, opening Eliza routes to `/price-tags`. Staff select their name, enter their six-digit PIN, search products, select tags, and choose **Print selected tags**. The server returns a fresh snapshot of product prices for the print job and records the station, employee, products and prices. The browser then opens its print dialog. The initial layout is an A4 sheet with three columns; use the browser's print settings for paper and margins. A print request records that the dialog was opened, not that a physical printer successfully produced the sheet.

Price Tags sessions cannot use management or checkout endpoints. The printable tags include name, selling price, unit and a printed barcode/PLU value. They do not yet render a machine-readable barcode graphic or connect directly to a dedicated label printer. Those need a printer and label-size specification before calibration.
