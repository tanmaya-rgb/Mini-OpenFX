import { z } from 'zod';
import { isSupportedCurrency } from '../../../domain/currencies.js';

export const createDepositSchema = z.object({
  currency: z
    .string()
    .min(1)
    .transform((value) => value.toUpperCase())
    .refine(isSupportedCurrency, 'Unsupported currency'),
  amount: z
    .string()
    .regex(/^\d+(\.\d+)?$/, 'amount must be a positive decimal string, e.g. "100.00"')
    .refine((value) => Number.parseFloat(value) > 0, 'amount must be greater than zero'),
});

export type CreateDepositDto = z.infer<typeof createDepositSchema>;
