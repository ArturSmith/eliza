# Purchase payments

Delivery and payment statuses are independent. Receiving stock never marks an order paid.

Open Purchases, choose View on an order, then use Purchase payment to select Paid or Unpaid and optionally set a payment due date. Save payment status records the change in the activity log. This records the shop’s confirmation; it does not transfer money.

Unpaid placed, partially received, and received orders become overdue after their due date in the store timezone. The list has a separate payment filter, including Overdue. An order due today is not overdue. Draft and cancelled orders are not flagged overdue.

New purchases start unpaid. Existing purchases start with Payment not recorded; review them before assigning a status. Only users with purchase-writing permission can update payment information. Cancelled orders retain their recorded payment information and cannot be edited.

This is whole-order payment tracking: mark Paid after full settlement. Partial payment amounts and supplier account balances are not tracked.

Deployment requires migration 0012_purchase_payments.sql.
