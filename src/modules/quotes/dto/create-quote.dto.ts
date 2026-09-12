import { z } from 'zod';

/**
 * base_amount is a plain human-readable decimal string ("0.01"), not
 * minor units — the client shouldn't need to know each currency's
 * decimals to request a quote. It's converted to minor units (and
 * validated as strictly positive) inside QuotesService via
 * domain/money.ts.
 */
export const createQuoteSchema = z.object({
  symbol: z
    .string()
    .min(1)
    .max(20)
    .transform((value) => value.toUpperCase()),
  side: z.enum(['BUY', 'SELL']),
  base_amount: z
    .string()
    .regex(/^\d+(\.\d+)?$/, 'base_amount must be a positive decimal string, e.g. "0.01"')
    .refine((value) => Number.parseFloat(value) > 0, 'base_amount must be greater than zero'),
  ttl_seconds: z.coerce.number().int().min(1).max(300).optional(),
});

export type CreateQuoteDto = z.infer<typeof createQuoteSchema>;
