import { describe, expect, it } from 'vitest';
import { formatWhatsAppOrder, whatsappOrderUrl } from '../apps/web/src/purchase-whatsapp';

describe('purchase order WhatsApp handoff', () => {
  it('formats the actual order lines and delivery date for manager review', () => {
    expect(
      formatWhatsAppOrder(
        {
          number: 'PO-000123',
          supplierName: 'Rizka',
          expected_date: '2026-10-02',
          lines: [
            { product_name: 'Yogurt', ordered_quantity: '10.000', unit: 'piece' },
            { product_name: 'Apples', ordered_quantity: '2.500', unit: 'kilogram' },
          ],
        },
        { order: 'Order', supplier: 'Supplier', delivery: 'Delivery', items: 'Items' },
      ),
    ).toBe(
      'Order PO-000123\nSupplier: Rizka\nDelivery: 2026-10-02\n\nItems:\n• Yogurt — 10 piece\n• Apples — 2.5 kilogram',
    );
  });

  it('encodes the message and accepts only a full international recipient number', () => {
    expect(whatsappOrderUrl('+47 912 34 567', 'Yogurt: 10 & apples')).toBe(
      'https://wa.me/4791234567?text=Yogurt%3A%2010%20%26%20apples',
    );
    expect(whatsappOrderUrl('0123456789', 'Order')).toBeNull();
    expect(whatsappOrderUrl('123', 'Order')).toBeNull();
    expect(whatsappOrderUrl('+47 912 34 567', '  ')).toBeNull();
  });
});
