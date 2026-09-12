import { z } from 'zod';

export const getPriceQuerySchema = z.object({
  symbol: z
    .string()
    .min(1, 'symbol is required')
    .max(20)
    .transform((value) => value.toUpperCase()),
});

export type GetPriceQuery = z.infer<typeof getPriceQuerySchema>;
