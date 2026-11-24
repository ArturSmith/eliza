# Phone as a barcode scanner

The staff scanner is part of the main platform at `/phone-scanner`. It is separate from the customer loyalty application.

## Use

1. Open **Devices → Phone as scanner → Connect phone** on the laptop. This is the single place to connect and manage the phone scanner.
2. Scan the connection QR with the phone's normal camera and open the link. Allow camera access.
3. Keep the scanner page open. Select any editable text field on the laptop. The phone shows the selected field name and readiness; a successful scan is confirmed after the laptop receives it.
4. Review the product on the laptop and save it. The same phone connection remains active for the next product, navigation and page reloads in supported modern browsers.

The phone plays one short scanner beep and vibrates after the laptop confirms insertion. Duplicate detections, retries and cancelled scans do not produce extra success sounds. Mobile browsers require a tap to enable audio: tap **Enable scanner sound** if shown. Audio is also enabled by other interactions on the scanner page; after a reload or browser audio suspension, a new tap may be needed. Device volume and silent-mode settings still apply.

The **Phone as scanner** card on **Devices** shows connection status; **Manage scanner connection** opens connection details and the disconnect action. Product forms and the management header have no phone connection buttons. One laptop tab owns each connection; duplicated tabs receive their own unpaired connection to prevent misdirected scans. Other product forms, including supplier product creation and inline barcode editing, use the same connection. Focus any intended text or number field before scanning, including names, brands, descriptions and individual variant barcodes. Scanned text replaces ordinary field contents; the product barcode list appends unique codes. Passwords, read-only fields and hidden fields cannot receive scans. Invalid or oversized values are rejected without losing existing contents. Barcode lookup runs only when its own input is selected. The mobile page also offers manual entry and retries after a lost response.

Both devices need access to the same public HTTPS platform address. They can use different networks. A laptop's `localhost` address cannot be reached by a separate phone, and phone camera access requires a secure origin.

## Scope and lifetime

A connection requires an active management login with `catalog.write`. It is limited to that login, store, device and tab. The initial QR carries a random one-use token in its URL fragment, expires after at most five minutes and is replaced when refreshed. The phone exchanges it for a separate scan-only credential; the fragment is then removed. The phone gets no management session and cannot read the catalog or modify products directly.

Credentials are hashed in PostgreSQL. The phone credential stays in its own tab's session storage; the laptop stores only connection metadata. Connections expire after at most eight hours or the owning login's expiry, whichever is earlier. Logout, employee/permission/device revocation, expiry or explicit disconnect terminates phone access.

## Delivery

The platform API transports codes using authenticated short polling (roughly one second). This works across Railway replicas without a process-local socket registry or an additional service. Migration `0069_phone_scanner.sql` creates temporary connection and scan tables; `0070_phone_scanner_text.sql` allows QR text up to 4096 characters, including multiline textarea contents. Standard Railway pre-deploy migration applies both. Product barcode limits remain unchanged.

Each selected field has its own target ID and an eight-second readiness lease. A phone may submit only to the currently ready target. The laptop acknowledges delivery, and both sides reuse scan IDs for safe retries. Pending scans are cancelled when the selected field changes or a form is submitted, so a delayed scan cannot spill into the next product. Repeated camera detections are suppressed, and only one pending scan is accepted per connection.

Barcode lookup and product saving retain their existing validation. Saving waits for an active lookup to finish. The scanner itself creates no products, stock movements, purchases or financial entries. Temporary connections are deleted with their owning sessions; expired connections are also purged during later pairing requests.

## Validation

Integration tests exercise one-use/expired QR codes, scan-only access, tenant/login isolation, replay protection, target changes, desktop readiness expiry, revocation and logout. The browser workflow uses separate laptop and mobile contexts and exercises the real camera component with a substituted decoder callback; it verifies selected names, brands, multiline descriptions, barcode fields, invalid-value rejection, responsive icon alignment, consecutive products, volume variants, reloads and disconnect. Physical device camera hardware is not simulated by these tests.
