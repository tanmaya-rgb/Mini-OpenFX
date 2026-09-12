import { z } from 'zod';

export const createTradeSchema = z.object({
  quote_id: z.string().uuid('quote_id must be a valid UUID'),
});

export type CreateTradeDto = z.infer<typeof createTradeSchema>;
