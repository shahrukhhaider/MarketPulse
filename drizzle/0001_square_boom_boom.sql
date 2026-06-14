CREATE TABLE "user_webhook" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"webhook_url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "user_webhook_user_id_idx" ON "user_webhook" USING btree ("user_id");