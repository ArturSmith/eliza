# Scale barcode setup

Implemented 14 September 2026. Enabled per store in Store settings → Scale barcodes; disabled by default.

## Apples example

1. Create Apples with unit kilogram, price 30.00 per kilogram and PLU 42.
2. Configure the scale with the same product code and price.
3. Configure Eliza: prefix 20, five product-code digits, Weight, three decimal places.
4. Enable scale barcodes and save settings. Refresh products at checkout.
5. Scan 2000042012502. Eliza adds Apples, 1.250 kg, costing 37.50 before any sale discount. Completing checkout deducts 1.250 kg through the existing sale workflow.

The label contains 20 + 00042 + 01250 + checksum 2. Leading zeros in the product code are ignored when matching PLUs; multiple matches are rejected.

## Supported formats

One configured EAN-13 layout per store: two-digit prefix 20–29, 1–8 product-code digits, remaining data digits, then standard EAN checksum. Weight can use 0–3 decimal places in kilograms. Price uses two decimal places in the store currency. Products must use kilogram as their selling unit.

Do not enable the example layout until it matches the scale's manual and a real label. Different prefixes, additional verification digits, GS1 DataBar, embedded units, and multiple simultaneous layouts need additional support.

## Price-only labels

Weight is inferred to the nearest gram using the current selling price. Eliza rejects the label if that weight cannot reproduce its encoded price. The original measured weight cannot be recovered reliably from a rounded price, and a stale scale price cannot always be detected. Prefer weight labels for accurate inventory; synchronize scale and Eliza prices if using price labels. Standard sale discounts still apply.

## Limits and checks

No scale programming, catalog synchronization, label printing or direct scale connection is included. Configure the physical device separately.

Invalid checksums, zero values, unknown or ambiguous PLUs and non-kilogram products are rejected. Short PLU entry and regular unreserved barcodes retain their existing workflow. The configured scale prefix takes precedence for long numeric scans. Store settings use existing manager permissions, version checks and audit history; register settings require an authenticated operator.
