CREATE TYPE "public"."ledger_reason" AS ENUM('DEPOSIT', 'TRADE');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('ACTIVE', 'EXPIRED', 'EXECUTED');--> statement-breakpoint
CREATE TYPE "public"."trade_side" AS ENUM('BUY', 'SELL');--> statement-breakpoint
CREATE TYPE "public"."trade_status" AS ENUM('FILLED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"api_key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"available_minor" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"delta_minor" bigint NOT NULL,
	"reason" "ledger_reason" NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"side" "trade_side" NOT NULL,
	"base_currency" text NOT NULL,
	"quote_currency" text NOT NULL,
	"base_amount_minor" bigint NOT NULL,
	"price" numeric(38, 18) NOT NULL,
	"quote_amount_minor" bigint NOT NULL,
	"status" "quote_status" DEFAULT 'ACTIVE' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"side" "trade_side" NOT NULL,
	"base_currency" text NOT NULL,
	"quote_currency" text NOT NULL,
	"base_amount_minor" bigint NOT NULL,
	"quote_amount_minor" bigint NOT NULL,
	"price" numeric(38, 18) NOT NULL,
	"status" "trade_status" NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "balances_client_currency_unique" ON "balances" USING btree ("client_id","currency");--> statement-breakpoint
CREATE INDEX "ledger_entries_client_currency_idx" ON "ledger_entries" USING btree ("client_id","currency");--> statement-breakpoint
CREATE INDEX "quotes_client_idx" ON "quotes" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_quote_id_unique" ON "trades" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_client_idempotency_key_unique" ON "trades" USING btree ("client_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "trades_client_created_at_idx" ON "trades" USING btree ("client_id","created_at","id");