export type WhatsAppOrder = {
  number: string;
  supplierName: string;
  expected_date: string | null;
  lines: { product_name: string; ordered_quantity: string; unit: string }[];
};

export function formatWhatsAppOrder(
  order: WhatsAppOrder,
  labels: {
    order: string;
    supplier: string;
    delivery: string;
    items: string;
  },
): string {
  const lines = [`${labels.order} ${order.number}`, `${labels.supplier}: ${order.supplierName}`];
  if (order.expected_date) lines.push(`${labels.delivery}: ${order.expected_date.slice(0, 10)}`);
  lines.push('', `${labels.items}:`);
  for (const line of order.lines) {
    lines.push(`• ${line.product_name} — ${Number(line.ordered_quantity)} ${line.unit}`);
  }
  return lines.join('\n');
}

export function whatsappPhoneDigits(phone: string): string | null {
  const compact = phone.replace(/[\s().-]/g, '');
  if (!/^\+?[1-9]\d{6,14}$/.test(compact)) return null;
  return compact.replace(/^\+/, '');
}

export function whatsappOrderUrl(phone: string, message: string): string | null {
  const digits = whatsappPhoneDigits(phone);
  if (!digits || !message.trim()) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
