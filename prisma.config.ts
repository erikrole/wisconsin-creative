import "dotenv/config";
import { defineConfig } from "prisma/config";
import { resolvePrismaConfigUrl } from "./scripts/lib/prisma-direct-url.mjs";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Schema-only commands do not need a live database. Migration wrappers
    // perform the strict direct/unpooled connection preflight before any DDL.
    url: resolvePrismaConfigUrl(),
  },
});
