CREATE TABLE "notifications" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "kind" text NOT NULL,
  "payload" jsonb NOT NULL,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "idempotency" text NOT NULL
);
CREATE INDEX "notifications_user_created_idx" ON "notifications" ("user_id", "created_at" DESC);
CREATE UNIQUE INDEX "notifications_user_idempotency_uq" ON "notifications" ("user_id", "idempotency");
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
