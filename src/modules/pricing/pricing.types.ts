/**
 * An indicative price is NOT tradable — it's informational only, always
 * fresh (or explicitly marked stale) from the provider, and never written
 * to the database (see plan: "GET /v1/prices ... no DB writes"). Contrast
 * with a Quote (modules/quotes), which is a firm, DB-persisted, time-bound
 * price derived from one of these.
 */
export interface IndicativePrice {
  symbol: string;
  bid: string;
  ask: string;
  mid: string;
  timestamp: string;
  source: 'binance';
  /** true when this price was served from cache after the live provider
   * call failed — callers may choose to reject stale prices for quote
   * creation but accept them for read-only display. */
  stale: boolean;
}

/**
 * What a pricing provider adapter must implement. Kept deliberately small
 * so a second provider (e.g. a "Massive FX" adapter for real FX pairs)
 * could be added later without touching PricingService's caching/
 * resilience logic.
 */
export interface PricingProvider {
  fetchPrice(symbol: string): Promise<Omit<IndicativePrice, 'stale'>>;
}
