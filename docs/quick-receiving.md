# Quick receiving

Use shortcuts for recurring deliveries of one product from one supplier, such as bread arriving several times a day.

## Manager setup

1. Open **Suppliers & purchases → Quick receiving → Add shortcut**.
2. Select an existing product and supplier, give the shortcut a name, and set the purchase tax rate.
3. For staff access, assign **Receiving clerk** in Team. Combine it with **Cashier** for register access; management login credentials are needed to use the management workspace.

Owners and managers have quick-receiving access. The additive `0068_quick_receipts.sql` migration grants the new permission to existing roles that already have both purchase editing and receiving permissions. Other staff do not receive it automatically. The receiving role exposes shortcuts and the receipt result, without granting purchase history, supplier administration or financial reports.

## Accept a delivery

Open a shortcut from Purchases, or **Quick receiving** in an open register. Enter quantity in the product's stock unit and the **actual unit cost excluding tax**. Both start blank every time. The shortcut stores no procurement price. Expiry date, supplier document number and notes are optional.

Confirmation atomically creates a delivered purchase, immutable goods receipt, stock batch with the actual cost, stock movement and actor audit. It establishes/reactivates the supplier-product association. Selling prices stay unchanged. Each delivery is distinct, even when the same shortcut is used several times in one day. Whole-unit products require whole-number quantities.

The purchase is **unpaid**. A manager can open it and update payment status through the existing purchase workflow. Receiving does not remove cash from the register or create an operating expense. Existing batch-based inventory valuation and sale cost snapshots apply.

## Corrections and retries

Managers can edit or archive shortcuts. Changes require the current version; receipts using stale or inactive shortcuts fail before recording stock. Archiving preserves existing purchases and batches.

Receipt requests use a durable per-tab request ID. If the connection fails, retry the same frozen request; reloading also restores it. Successful retries return the original receipt rather than adding stock twice. The cashier's current basket stays in place while quick receiving is open.
