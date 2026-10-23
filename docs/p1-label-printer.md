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
- Printer mode, label gap and speed are local browser preferences. They do not change the store’s tag design or the manager’s laptop. Reconnect using the chooser after reloading.
- Regular, weight and markdown data come from the existing authenticated server snapshots. P1 uses a dedicated 50 × 60 mm template. A saved custom layout is also available to browser printing as a 50 × 60 mm image on the existing print sheet. Cyrillic/currency render to a monochrome bitmap; the printer does not need the same fonts/code page.
- For weighted products the existing scale barcode and package-price calculation are reused. Markdown labels use each unit’s existing unique barcode, never mint new ones.
- All labels are rendered/validated before transmitting. Barcodes keep integer dot widths and quiet zones; codes too wide for the paper fail rather than being squeezed.
- Fast mode is the default: exact occupied raster bands are sent at their original coordinates instead of transmitting blank paper. Dot sizes, barcode quiet zones and label dimensions remain unchanged. Serial BLE writes retain 20-byte payloads, with 4 ms pacing for writes without response; acknowledged writes do not add artificial delays. Actual speed depends on the Android device, connection and firmware.
- Compatibility mode retains the original full 400 × 480 raster and 20-byte / 30 ms transport that was confirmed working on the P1. If Fast mode produces incomplete labels, restart the printer, inspect already printed labels and run a single test in Compatibility mode. No silent retries of partially sent jobs. Keep the screen open while sending.
- Regular price-change jobs require explicit physical-print confirmation before `/prints/:id/complete` updates printed prices. Partial failures leave selections and price-change state untouched. Never attach duplicate markdown barcodes to separate items.
- No hardware acknowledgement / paper-out detection is claimed. Receipt printing and the store-wide price-tag designer are unchanged. This is not yet an ESC/POS or universal printer adapter.

Protocol reference / matching hardware report: https://github.com/Dejniel/TiMini-Print/issues/30
Browser requirements: https://developer.chrome.com/docs/capabilities/bluetooth

## Automated verification

`tests/p1-printing.unit.test.ts` covers raster size, polarity, transparent pixels, gap validation, exact reconstruction from compact bands, both pacing profiles, serial chunking and errors. `tests/e2e/p1-printer.spec.ts` exercises the actual UI/API using a simulated BLE peripheral, checks physical-confirmation ordering, failure behavior and reconnect requirements. Existing `price-tags-weight.spec.ts` verifies browser printing remains intact. These tests do not replace a real P1 print and barcode scan.

## Label layout editor

Price Tags → Edit label layout opens the device-local editor. Select a product first to preview its current content, or use the sample label. Drag objects with mouse or touch; keyboard arrows move the focused object one dot, Shift+arrow one millimetre. Numeric X/Y and width/height use millimetres; text controls use points and alignment. Store name, product name, price, extra details and barcode have independent boxes. Text blocks can be hidden; barcodes remain visible.

Portrait and landscape are logical editing orientations. The physical P1 stock stays 50 × 60 mm: landscape is rotated exactly 90° into the 400 × 480 dot paper raster, without resampling. Oversized barcodes block saving/printing rather than being squeezed. Overlapping objects show a warning. Prices stay on one line without ellipsis.

Save layout persists a versioned, validated template in local storage keyed by store and station device IDs. It is shared by employees on that station, not synchronized to other devices. Saving does not change the manager’s store-wide tag design or prices. Closing without saving discards the draft. Reset positions resets the draft for the current orientation; Use default layouts removes the custom template and restores existing browser/P1 behavior.

Editor preview, P1 jobs/test labels and custom browser sheets use the same renderer. The existing server snapshots, weight calculation, markdown barcodes and physical-print confirmation remain in place. Test a physical label and scan its barcode after changing a layout. `tests/tag-layout.unit.test.ts` covers boundaries/schema/isolation; the P1 browser workflow also covers dragging, keyboard movement, orientation, persistence, custom browser images and pixel-exact rotation.

## Phone workspace

Price Tags uses a phone-width app frame (up to 560 CSS px) with a fixed header and safe-area-aware bottom navigation: Products, Scanner, Layout, Printer, More. Only the central panel scrolls. The print action stays above navigation on Products/Scanner. More contains the employee/device details, replay guide, Lock and management access.

Layout and printer tools are embedded tabs; they no longer require modal dialogs. Scanner starts an inline continuous camera only while that tab is active, and stops when leaving. Manual barcode entry with Enter also selects labels. Product and markdown selections survive tab switches. Layout edits still require Save layout before leaving the tab.

Controls use touch-size targets and 16 px inputs. The viewport opts into safe areas and Android Chrome keyboard content resizing. The phone workflow checks 320×568, 360×640, 390×844, 430×932 and 568×320, including Russian text, long names, no horizontal page overflow, bottom-bar position, scanning and printing. Camera/Bluetooth hardware and real soft-keyboard behavior still need an on-device check.
