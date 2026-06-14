CREATE TABLE "member_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"ticker" text NOT NULL,
	"entry_price" real NOT NULL,
	"stop_price" real NOT NULL,
	"target_price" real NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"exit_price" real,
	"pnl_percent" real,
	"result" text,
	"status" text DEFAULT 'open' NOT NULL,
	"last_price" real,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_watchlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"ticker" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "user_watchlist_user_id_ticker_idx" ON "user_watchlist" USING btree ("user_id","ticker");