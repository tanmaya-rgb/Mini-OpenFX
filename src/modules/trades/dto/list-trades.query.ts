import { z } from 'zod';

export const listTradesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export type ListTradesQuery = z.infer<typeof listTradesQuerySchema>;
