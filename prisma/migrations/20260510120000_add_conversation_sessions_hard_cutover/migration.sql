-- Phase 2 hard cutover: explicit conversation sessions
CREATE TYPE "ConversationSessionState" AS ENUM (
  'IDLE',
  'AWAITING_PROJECT_SELECTION',
  'AWAITING_ACTION_SELECTION',
  'AWAITING_ACTION_INPUT',
  'AWAITING_CONFIRMATION',
  'PROCESSING_ASYNC'
);

CREATE TABLE "conversation_sessions" (
  "id" TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "active_project_id" INTEGER,
  "available_project_ids" JSONB,
  "state" "ConversationSessionState" NOT NULL DEFAULT 'IDLE',
  "current_action_key" TEXT,
  "context_json" JSONB,
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "conversation_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_sessions_contact_id_key" ON "conversation_sessions"("contact_id");
CREATE INDEX "conversation_sessions_active_project_id_idx" ON "conversation_sessions"("active_project_id");
CREATE INDEX "conversation_sessions_state_idx" ON "conversation_sessions"("state");

ALTER TABLE "conversation_sessions"
  ADD CONSTRAINT "conversation_sessions_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_sessions"
  ADD CONSTRAINT "conversation_sessions_active_project_id_fkey"
  FOREIGN KEY ("active_project_id") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill sessions from current contact state
INSERT INTO "conversation_sessions" (
  "id",
  "contact_id",
  "active_project_id",
  "available_project_ids",
  "state",
  "created_at",
  "updated_at"
)
SELECT
  'sess_' || c."id" AS "id",
  c."id" AS "contact_id",
  c."project_id" AS "active_project_id",
  CASE
    WHEN c."available_project_ids" IS NULL OR btrim(c."available_project_ids") = '' THEN NULL
    ELSE (
      SELECT jsonb_agg((btrim(value))::INTEGER)
      FROM unnest(string_to_array(c."available_project_ids", ',')) AS value
      WHERE btrim(value) <> ''
    )
  END AS "available_project_ids",
  CASE
    WHEN c."pending_project_selection" THEN 'AWAITING_PROJECT_SELECTION'::"ConversationSessionState"
    ELSE 'IDLE'::"ConversationSessionState"
  END AS "state",
  CURRENT_TIMESTAMP AS "created_at",
  CURRENT_TIMESTAMP AS "updated_at"
FROM "contacts" c;

ALTER TABLE "contacts" DROP COLUMN "pending_project_selection";
ALTER TABLE "contacts" DROP COLUMN "available_project_ids";
