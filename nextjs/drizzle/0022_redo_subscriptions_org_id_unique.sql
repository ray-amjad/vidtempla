CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_org_id_unique" ON "subscriptions" USING btree ("organization_id") WHERE "subscriptions"."organization_id" IS NOT NULL;
