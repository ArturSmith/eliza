# P1 label printer (experimental)

Employee controls live in Price Tags → Printer, not management settings. The connection belongs to this browser/device. Initial target: Shenzhen Tuofengda P1 / Toprint, TSPL mode, BLE service `000018f0`, write characteristic `00002af1`. Same model names can ship different firmware. Physical compatibility is not yet confirmed on Arthur’s device.

## First physical test

1. On Android open Eliza over HTTPS in Chrome. Turn on Bluetooth and the P1. Close Toprint so it releases the printer.
2. Unlock Price Tags as an employee. Open Printer and choose P1 Bluetooth.
3. The label dimensions are fixed at **50 mm wide × 60 mm high** at 203 dpi (400 × 480 dots). Measure the gap between stickers; the default **2 mm is an assumption**, editable from 0.5 to 6 mm.
4. Connect printer and print **one test label**. Inspect feed alignment, orientation, black/white polarity and scan its barcode. A successful Bluetooth write is not proof of a printed label.
5. If nothing prints, check the printer self-test / vendor app for its command mode: this profile expects TSC/TSPL, not an arbitrary ESC/POS profile. Do not repeatedly resend unknown jobs. If interrupted, restart the printer before retrying, and inspect already printed labels.

## Behavior

- Browser printing remains the default. Choosing P1 is explicit; disconnection never silently falls back to browser printing.
- Printer mode and label gap are local browser preferences. They do not change the store’s tag design or the manager’s laptop. Reconnect using the chooser after reloading.
- Regular, weight and markdown data come from the existing authenticated server snapshots. P1 uses a dedicated fixed-size template, not the A4 browser sheet. Cyrillic/currency render to a monochrome bitmap; the printer does not need the same fonts/code page.
- For weighted products the existing scale barcode and package-price calculation are reused. Markdown labels use each unit’s existing unique barcode, never mint new ones.
- All labels are rendered/validated before transmitting. Barcodes keep integer dot widths and quiet zones; codes too wide for the paper fail rather than being squeezed.
- Conservative 20-byte BLE writes with 30 ms pacing can take about 40 seconds per label. Keep the screen open. No silent retries of partially sent jobs.
- Regular price-change jobs require explicit physical-print confirmation before `/prints/:id/complete` updates printed prices. Partial failures leave selections and price-change state untouched. Never attach duplicate markdown barcodes to separate items.
- No hardware acknowledgement / paper-out detection is claimed. Receipt printing and the store-wide price-tag designer are unchanged. This is not yet an ESC/POS or universal printer adapter.

Protocol reference / matching hardware report: https://github.com/Dejniel/TiMini-Print/issues/30
Browser requirements: https://developer.chrome.com/docs/capabilities/bluetooth

## Automated verification

`tests/p1-printing.unit.test.ts` covers raster size, polarity, transparent pixels, gap validation, serial chunking and errors. `tests/e2e/p1-printer.spec.ts` exercises the actual UI/API using a simulated BLE peripheral, checks physical-confirmation ordering, failure behavior and reconnect requirements. Existing `price-tags-weight.spec.ts` verifies browser printing remains intact. These tests do not replace a real P1 print and barcode scan.
