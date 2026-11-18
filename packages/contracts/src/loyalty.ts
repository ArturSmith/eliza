import { z } from 'zod';
// Fixed-decimal strings keep point values exact across API clients.
export const loyaltyProgramSchema = z.object({
  enabled: z.boolean(),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000),
  earnPercent: z
    .string()
    .regex(/^\d{1,2}(\.\d{1,2})?$/)
    .refine((v) => Number(v) <= 25),
  version: z.number().int().min(0),
});
export const loyaltyCampaignSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(2000),
    published: z.boolean(),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    version: z.number().int().min(0),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), 'Campaign end must follow its start');
export const loyaltySaleSchema = z.object({
  code: z.string().regex(/^ELIZA-(LOYALTY|REDEEM):[a-f0-9]{64}$/),
  // Optional preserves retry fingerprints for sales submitted by older clients.
  mode: z.enum(['collect', 'spend']).optional(),
});
export type LoyaltyMember = {
  id: string;
  code: string;
  balance: string;
  maxPoints?: string;
  earnPercent: string;
  redeemPercent: string;
  programName: string;
  currency: string;
};
