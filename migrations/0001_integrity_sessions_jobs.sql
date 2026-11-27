-- Preflight: backfill ownership columns that can be derived safely, then refuse
-- to continue (rolling back the whole migration) if any row would violate the new
-- integrity rules. Resolve reported rows manually, then re-run `npm run db:migrate`.
UPDATE "analysis_results" r SET "tenant_id" = d."tenant_id" FROM "documents" d WHERE r."document_id" = d."id" AND r."tenant_id" IS NULL;--> statement-breakpoint
UPDATE "annotations" a SET "tenant_id" = d."tenant_id" FROM "documents" d WHERE a."document_id" = d."id" AND a."tenant_id" IS NULL;--> statement-breakpoint
UPDATE "defense_sessions" s SET "tenant_id" = d."tenant_id" FROM "documents" d WHERE s."document_id" = d."id" AND s."tenant_id" IS NULL;--> statement-breakpoint
UPDATE "defense_sessions" s SET "user_id" = d."user_id" FROM "documents" d WHERE s."document_id" = d."id" AND s."user_id" IS NULL;--> statement-breakpoint
UPDATE "documents" d SET "tenant_id" = u."tenant_id" FROM "users" u WHERE d."user_id" = u."id" AND d."tenant_id" IS NULL;--> statement-breakpoint
UPDATE "credit_transactions" c SET "tenant_id" = u."tenant_id" FROM "users" u WHERE c."user_id" = u."id" AND c."tenant_id" IS NULL;--> statement-breakpoint
DO $$
DECLARE problems text := '';
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM "users" WHERE "tenant_id" IS NULL; IF n > 0 THEN problems := problems || format(' users without tenant: %s;', n); END IF;
  SELECT count(*) INTO n FROM "documents" WHERE "tenant_id" IS NULL OR "user_id" IS NULL; IF n > 0 THEN problems := problems || format(' documents without owner/tenant: %s;', n); END IF;
  SELECT count(*) INTO n FROM "documents" d JOIN "users" u ON u."id" = d."user_id" WHERE u."tenant_id" <> d."tenant_id"; IF n > 0 THEN problems := problems || format(' documents whose owner is in another tenant: %s;', n); END IF;
  SELECT count(*) INTO n FROM "analysis_results" WHERE "tenant_id" IS NULL OR "document_id" IS NULL; IF n > 0 THEN problems := problems || format(' orphan analysis_results: %s;', n); END IF;
  SELECT count(*) INTO n FROM "annotations" WHERE "tenant_id" IS NULL OR "document_id" IS NULL; IF n > 0 THEN problems := problems || format(' orphan annotations: %s;', n); END IF;
  SELECT count(*) INTO n FROM "defense_sessions" WHERE "tenant_id" IS NULL OR "document_id" IS NULL OR "user_id" IS NULL; IF n > 0 THEN problems := problems || format(' orphan defense_sessions: %s;', n); END IF;
  SELECT count(*) INTO n FROM "credit_transactions" WHERE "tenant_id" IS NULL; IF n > 0 THEN problems := problems || format(' credit_transactions without tenant: %s;', n); END IF;
  SELECT count(*) INTO n FROM "analysis_results" r JOIN "documents" d ON d."id" = r."document_id" WHERE d."tenant_id" <> r."tenant_id"; IF n > 0 THEN problems := problems || format(' cross-tenant analysis_results: %s;', n); END IF;
  SELECT count(*) INTO n FROM "annotations" a JOIN "documents" d ON d."id" = a."document_id" WHERE d."tenant_id" <> a."tenant_id"; IF n > 0 THEN problems := problems || format(' cross-tenant annotations: %s;', n); END IF;
  SELECT count(*) INTO n FROM "defense_sessions" s JOIN "documents" d ON d."id" = s."document_id" WHERE d."tenant_id" <> s."tenant_id"; IF n > 0 THEN problems := problems || format(' cross-tenant defense_sessions: %s;', n); END IF;
  SELECT count(*) INTO n FROM (SELECT "stripe_session_id" FROM "credit_transactions" WHERE "stripe_session_id" IS NOT NULL GROUP BY 1 HAVING count(*) > 1) x; IF n > 0 THEN problems := problems || format(' duplicate stripe_session_id credits (possible double fulfillment): %s;', n); END IF;
  SELECT count(*) INTO n FROM (SELECT "description" FROM "credit_transactions" WHERE "type" = 'refund' GROUP BY 1 HAVING count(*) > 1) x; IF n > 0 THEN problems := problems || format(' duplicate refunds: %s;', n); END IF;
  SELECT count(*) INTO n FROM (SELECT lower("email") FROM "users" GROUP BY 1 HAVING count(*) > 1) x; IF n > 0 THEN problems := problems || format(' case-insensitive duplicate emails: %s;', n); END IF;
  SELECT count(*) INTO n FROM "rubrics" WHERE "tenant_id" IS NULL AND NOT "is_template"; IF n > 0 THEN problems := problems || format(' tenantless non-template rubrics: %s;', n); END IF;
  IF problems <> '' THEN
    RAISE EXCEPTION 'RavPaper migration 0001 preflight failed; reconcile data first:%', problems;
  END IF;
END $$;--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "analysis_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"document_id" integer NOT NULL,
	"usage_transaction_id" integer NOT NULL,
	"rubric_id" integer,
	"engines" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"revoke_reason" text,
	"user_agent" text,
	"ip_address" text
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"rotated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"livemode" boolean NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"error" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "analysis_results" DROP CONSTRAINT "analysis_results_document_id_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "annotations" DROP CONSTRAINT "annotations_document_id_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "annotations" DROP CONSTRAINT "annotations_analysis_result_id_analysis_results_id_fk";
--> statement-breakpoint
ALTER TABLE "credit_transactions" DROP CONSTRAINT "credit_transactions_document_id_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "defense_sessions" DROP CONSTRAINT "defense_sessions_document_id_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "analysis_results" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_results" ALTER COLUMN "document_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "annotations" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "annotations" ALTER COLUMN "document_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_transactions" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "defense_sessions" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "defense_sessions" ALTER COLUMN "document_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "defense_sessions" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_results" ADD COLUMN "job_id" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_id_tenant_unique" UNIQUE("id","tenant_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_id_tenant_unique" UNIQUE("id","tenant_id");--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_usage_transaction_id_credit_transactions_id_fk" FOREIGN KEY ("usage_transaction_id") REFERENCES "public"."credit_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_document_tenant_fk" FOREIGN KEY ("document_id","tenant_id") REFERENCES "public"."documents"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_auth_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."auth_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_jobs_usage_unique" ON "analysis_jobs" USING btree ("usage_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_jobs_active_document_unique" ON "analysis_jobs" USING btree ("document_id") WHERE "analysis_jobs"."status" IN ('queued', 'running');--> statement-breakpoint
CREATE INDEX "analysis_jobs_claim_idx" ON "analysis_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_session_idx" ON "refresh_tokens" USING btree ("session_id");--> statement-breakpoint
ALTER TABLE "analysis_results" ADD CONSTRAINT "analysis_results_document_tenant_fk" FOREIGN KEY ("document_id","tenant_id") REFERENCES "public"."documents"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_document_tenant_fk" FOREIGN KEY ("document_id","tenant_id") REFERENCES "public"."documents"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_analysis_result_id_analysis_results_id_fk" FOREIGN KEY ("analysis_result_id") REFERENCES "public"."analysis_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defense_sessions" ADD CONSTRAINT "defense_sessions_document_tenant_fk" FOREIGN KEY ("document_id","tenant_id") REFERENCES "public"."documents"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_tenant_fk" FOREIGN KEY ("user_id","tenant_id") REFERENCES "public"."users"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_results_document_idx" ON "analysis_results" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "annotations_document_idx" ON "annotations" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_tx_stripe_session_unique" ON "credit_transactions" USING btree ("stripe_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_tx_refund_reference_unique" ON "credit_transactions" USING btree ("description") WHERE "credit_transactions"."type" = 'refund';--> statement-breakpoint
CREATE INDEX "credit_tx_user_idx" ON "credit_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "documents_tenant_idx" ON "documents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "documents_user_idx" ON "documents" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_tenant_or_template" CHECK ("rubrics"."tenant_id" IS NOT NULL OR "rubrics"."is_template");