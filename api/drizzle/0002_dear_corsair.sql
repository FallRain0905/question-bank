CREATE TABLE "kb_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_collections_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "kb_documents" ADD COLUMN "collection_id" uuid;--> statement-breakpoint
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_collection_id_kb_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."kb_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_documents_collection_id_idx" ON "kb_documents" USING btree ("collection_id");--> statement-breakpoint
-- Manually maintained backfill: existing documents (uploaded before knowledge
-- bases existed) are moved into a default collection so retrieval scoping works.
INSERT INTO "kb_collections" ("name", "description")
SELECT '默认知识库', '未指定知识库时的默认归档位置'
WHERE NOT EXISTS (SELECT 1 FROM "kb_collections");--> statement-breakpoint
UPDATE "kb_documents"
SET "collection_id" = (SELECT "id" FROM "kb_collections" ORDER BY "created_at" LIMIT 1)
WHERE "collection_id" IS NULL;
