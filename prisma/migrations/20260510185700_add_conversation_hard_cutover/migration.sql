-- DropIndex
DROP INDEX "conversation_sessions_active_project_id_idx";

-- DropIndex
DROP INDEX "conversation_sessions_state_idx";

-- AlterTable
ALTER TABLE "conversation_sessions" ALTER COLUMN "updated_at" DROP DEFAULT;
