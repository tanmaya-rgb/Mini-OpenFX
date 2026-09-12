import type { Balance } from '../../db/schema/index.js';
import { fromMinorUnits } from '../../domain/money.js';

export function presentBalance(balance: Balance) {
  return {
    currency: balance.currency,
    available: fromMinorUnits(balance.availableMinor, balance.currency).toString(),
    available_minor: balance.availableMinor.toString(),
    updated_at: balance.updatedAt.toISOString(),
  };
}
