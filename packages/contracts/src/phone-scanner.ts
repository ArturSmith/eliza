import { z } from 'zod';
export const scannerPairSchema = z.object({ tabId: z.uuid() }).strict();
export const scannerSyncSchema = z
  .object({
    targetId: z.uuid().nullable(),
    ready: z.boolean(),
    label: z.string().trim().max(120),
    ackId: z.uuid().optional(),
    cancelId: z.uuid().optional(),
  })
  .strict();
export const scannerClaimSchema = z
  .object({ pairingToken: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export const scannerScanSchema = z
  .object({
    id: z.uuid(),
    targetId: z.uuid(),
    barcode: z
      .string()
      .trim()
      .min(1)
      .max(4096)
      .refine((v) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v), 'Use valid scanned text.'),
  })
  .strict();
export type ScannerEvent = {
  id: string;
  barcode: string;
  targetId: string;
  status: 'pending' | 'delivered' | 'cancelled';
};
export type ScannerPair = {
  id: string;
  pairingToken: string;
  pairExpiresAt: string;
  expiresAt: string;
  shopName: string;
};
export type ScannerDesktopStatus = {
  id: string;
  claimed: boolean;
  phoneOnline: boolean;
  expiresAt: string;
  event: ScannerEvent | null;
};
export type ScannerPhoneStatus = {
  shopName: string;
  expiresAt: string;
  ready: boolean;
  targetId: string | null;
  label: string;
  lastScan: ScannerEvent | null;
};
export type ScannerScanInput = z.infer<typeof scannerScanSchema>;
