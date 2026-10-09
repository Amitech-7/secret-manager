ALTER TABLE "vault_items" DROP CONSTRAINT "vault_items_type_valid";--> statement-breakpoint
DROP INDEX "vault_items_user_type_idx";--> statement-breakpoint
CREATE INDEX "vault_items_user_type_idx" ON "vault_items" USING btree ("user_id","type");--> statement-breakpoint
ALTER TABLE "vault_items" DROP COLUMN "deleted_at";--> statement-breakpoint
ALTER TABLE "vault_items" ADD CONSTRAINT "vault_items_type_valid" CHECK ("vault_items"."type" in ('credential', 'card', 'member', 'bank', 'account_type', 'account'));