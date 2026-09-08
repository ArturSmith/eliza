# Eliza — Shop Owner & Manager Guide

Eliza is management software for a single local shop: your product catalogue, stock,
till (checkout), staff, suppliers, and sales reports in one place.

Everything runs on your own computer and your own database. There is no external
account, no subscription, no cloud service, and no data leaving your shop.

---

## 1. What Eliza can do for you

| Area | What you get |
| --- | --- |
| **Products** | Product cards with SKU, PLU, several barcodes, price, tax rate, category, unit |
| **Inventory** | Opening stock, manual adjustments, complete movement history that cannot be edited |
| **Stock counts** | Physical counting sheets with review and approval before stock is changed |
| **Checkout (POS)** | Barcode/PLU/SKU/search selling, weighed goods, discounts, cash and card, printed receipts |
| **Shifts** | Opening float, cash in/out, expected drawer, closing count and difference |
| **Refunds** | Find any receipt, return full or partial quantities, optionally restock |
| **Team** | Employees with Owner / Manager / Cashier roles and 6-digit till PINs |
| **Devices** | Which browsers may manage the shop and which are enrolled as tills |
| **Suppliers & purchases** | Supplier contacts, purchase orders, partial deliveries, cost history |
| **Reports** | Sales by day/week/month, shift, cashier, register, product, category, payment method |
| **Activity log** | Who did what and when |

Roles decide what people see. Cashiers sell; Managers also handle stock, purchasing and
approvals; only the Owner administers the team. Cost prices are hidden from staff who
are not allowed to see them.

---

## 2. Getting started (first day)

### 2.1 Open the app
Someone technical starts the system once (see the README). You then open
**http://localhost:5173** in the browser.

### 2.2 Create your shop
On first launch you enter:
- shop name,
- currency,
- time zone,
- your owner e-mail and password.

This happens **once**. There is no default login and no password reset by e-mail yet —
store your owner password safely.

### 2.3 Set your own till PIN
Go to **Team → edit your own account** and set a six-digit PIN. You need it to approve
discounts, refunds and cash differences at the till.

### 2.4 Add your staff
Still in **Team**:
1. Create an employee (name, role, employee code).
2. Give them a six-digit PIN.
3. Deactivate people who leave — but close their open shift first.

You cannot disable your own account or change your own role — this prevents locking
yourself out.

### 2.5 Build your catalogue
**Products → new product.** Fill in:
- Name and price — **prices include tax**.
- Tax rate. New shops start at 0%: set the correct rate before you start selling.
- Unit: piece / pack / box (whole numbers only) or a weighed unit (decimals allowed).
- SKU, optional PLU code, and any number of barcodes (or none).
- Category label, used later in reports.

The unit cannot be changed after creation, so pick it carefully.

### 2.6 Enter opening stock
**Inventory → record opening stock** for each product you already have on the shelf.
Opening stock can only be entered before the product's first movement; afterwards use
a stock adjustment with a reason.

---

## 3. Running the till

### 3.1 Turn a device into a till
On the computer or tablet that will be the checkout, sign in as Owner/Manager, open
**Checkout**, give the register a name and enrol it.

Important: enrolling ends the management session **on that device**. From then on this
device is a till only — staff sign in with PINs and cannot reach management screens.
That is intentional and protects your reports and costs.

### 3.2 A cashier's day
1. Select their name, enter their PIN.
2. Start a shift and enter the cash in the drawer (opening float).
3. Sell: scan a barcode, type a PLU/SKU, search, or tap a product button.
   For weighed goods, type the quantity in the product's unit.
4. Take payment: cash (Eliza shows the change) or card.
5. Print the receipt.
6. At the end: close the shift and enter the counted cash.

Five failed PIN attempts lock PIN entry on that device for five minutes. The till also
locks itself after five minutes of inactivity.

### 3.3 Held carts and interruptions
A cashier can hold up to ten carts (e.g. a customer went back for milk). Drafts survive
a page reload in the same browser tab — but not closing the tab. They are a convenience,
not durable storage.

### 3.4 Discounts and approvals
A cashier can give a whole-sale percentage discount. Above 10% a Manager/Owner PIN is
required. Eliza records the approver separately; the cashier stays signed in and remains
responsible for the sale.

### 3.5 Card payments — read this
Eliza **does not charge the card terminal**. The cashier charges the card on your
existing terminal and then confirms it in Eliza, which records the payment. Same for card
refunds. One payment method per sale — split payments are not available yet.

### 3.6 When something goes wrong mid-payment
If the screen freezes or the network drops after a payment, use **Recover payment**.
Eliza recognises the same sale and will not charge or record it twice. Never re-key the
sale blindly — recover first.

### 3.7 Closing the shift
Eliza compares the counted cash with the expected drawer total (float + cash sales +
cash in/out − cash refunds). A cashier needs a Manager/Owner PIN to close with a
difference. Closed shifts cannot be edited afterwards.

The cashier who opened a shift must close it before anyone else can use that register.

---

## 4. Refunds and receipt lookup

- **Sales → Search all receipts** (office) or **Search / refund** (till) finds any receipt
  by number, transaction ID, or date range.
- A refund needs an **open shift** at the register.
- Choose the returned quantities, tick items that are saleable (those go back into
  stock; damaged goods do not), and enter a reason.
- Cashiers need a Manager PIN. Owner/Manager may approve their own refund.
- The refund uses the original payment method. Cash refunds reduce the drawer and cannot
  exceed the cash in it. Card refunds are done on the terminal and confirmed in Eliza.
- The original sale is never altered, and you cannot return more than was sold.
- Every reprint of a receipt is logged.

---

## 5. Stock control

### 5.1 Adjustments
**Inventory** — for breakages, waste, or corrections. Every adjustment needs a reason and
appears in the movement history permanently.

### 5.2 Physical counts
**Stock counts** — the proper way to reconcile shelves.

1. Create a draft and pick up to 500 products (inactive ones allowed).
2. **Start counting** — Eliza snapshots the current system quantities.
3. Enter every physical quantity, including zeros, and save.
4. **Review count** to see the differences.
5. Owner or Manager finalises. Only non-zero differences create stock movements.

Only one count can be open at a time. Count while the selected stock is **not moving** —
any sale, delivery or refund touching those products after the snapshot blocks
finalisation, and you must restart the count. Cancelling requires a reason and never
changes stock. Finalised and cancelled counts stay in history with who counted and who
finalised.

---

## 6. Suppliers and purchasing

1. **Suppliers** — add contacts.
2. **Purchases** — create a draft order, edit it freely, then **place** it.
3. **Receive delivery** each time goods actually arrive; partial deliveries are normal.

Rules worth knowing:
- Drafts and placed orders do **not** change stock. Only receiving does.
- Receiving updates stock and the product's latest cost, while keeping the order and
  delivery cost snapshots intact for history.
- Purchase costs are entered **excluding tax** (unlike selling prices).
- You cannot receive more than was ordered. Piece/pack/box items need whole numbers.
- Drafts and placed orders can be cancelled with a reason; partially received ones cannot.
- Deactivating a supplier blocks new orders but still lets you receive open ones.

Not yet available: supplier invoices, payments, purchase returns, barcode receiving.

---

## 7. Reports

**Sales** and **Shifts** give date-range summaries grouped by day, week, month, shift,
cashier, register, product, category, or payment method. Each report shows transactions,
sales after discount (including tax), cash and card sales, discounts, tax, and average
basket.

Points to interpret correctly:
- Both dates are inclusive, in your shop's time zone. Weeks start on Monday.
- Totals cover all completed sales in the range, not just the recent receipts on screen.
- Reports show original sales, refunds issued in the period, and sales less refunds.
  Product/category breakdown rows always show original sales, not refund allocations.
- Payment totals exclude change. Tax and discounts are not split across payment methods.
- Opening floats and drawer cash in/out are excluded from sales figures.
- Receipts created before category tracking appear as "Unrecorded category".
- **Profit / cost of goods sold is not reported yet.**

History screens show the latest 100 records (cashier receipt history: 20; orders: 200).
Nothing is deleted — older records remain in the database.

---

## 8. Security and good practice

- Every management sign-in registers that browser as a management device.
  **Devices** lets you see and block them — do this immediately for a lost laptop.
- Till PIN sessions can never reach management screens.
- Stock movements, receipts, audit entries and closed shifts cannot be edited or deleted
  through the app. **Activity log** shows who did what.
- PINs never appear in receipts, logs, or browser storage.

Daily habits that keep the numbers honest:
1. One cashier per shift; close before handover.
2. Count and close the drawer every shift.
3. Receive deliveries the day they arrive.
4. Do stock counts outside trading hours.
5. Review the Activity log and any drawer differences weekly.

---

## 9. Current limitations (please read before going live)

Eliza is a solid working foundation, but the following are **not implemented yet**:

- No profit / margin reporting and no expense tracking.
- No offline checkout — the till needs the shop server running.
- No direct card terminal or scale/hardware integration; card charges are manual.
- No split payments and no void controls.
- Receipts carry basic shop details only. **Legal/fiscal receipt requirements for your
  country are not implemented** — check this with your accountant before using Eliza as
  your official till.
- No password recovery by e-mail; the Owner password cannot be reset from the app.
- Product units cannot be changed; categories are flat labels, not a hierarchy.
- Single shop only — no multi-store or shared catalogue.

Coming next: expenses and gross profit, shop/receipt settings, then backup and
operational readiness.

---

## 10. Quick troubleshooting

| Problem | What to do |
| --- | --- |
| "PIN entry locked" | Five wrong attempts — wait five minutes, or reset the PIN in Team |
| Payment result unknown | Use **Recover payment**; never re-enter the sale |
| Refund seems lost after reload | Open the receipt and check refund history before retrying |
| Cannot finalise a stock count | Stock moved after the snapshot — restart and recount |
| Cannot deactivate an employee | Their open shift must be closed first |
| A till device shows management screens | It was never enrolled — enrol it from Checkout |
| Prices look wrong at the till | Check the product's tax rate; new products default to 0% |

Ask your technical contact for backups. Your data lives in one PostgreSQL database —
a verified backup and restore routine is the single most important thing to set up
before you rely on Eliza for daily trading.
