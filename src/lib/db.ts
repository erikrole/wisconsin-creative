import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { attachDatabasePool } from "@vercel/functions/db-connections";

class ManagedNeonAdapter extends PrismaNeon {
  override async connect() {
    const adapter = await super.connect();
    // Prisma creates its pool lazily. Register that actual pool with Fluid
    // compute so idle connections are released before an instance suspends.
    attachDatabasePool(adapter.underlyingDriver());
    return adapter;
  }
}

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  // Neon speaks WebSockets through its serverless driver. Any other Postgres
  // (the end-to-end flow tests' disposable cluster, a plain local server) takes
  // the standard pg driver, which the seed script already does the same way.
  const adapter = connectionString && !connectionString.includes(".neon.tech")
    ? new PrismaPg({ connectionString, max: 5 })
    : new ManagedNeonAdapter({
      connectionString,
      max: 5,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 10_000,
    });
  return new PrismaClient({ adapter });
}

declare global {
  var prisma: PrismaClient | undefined;
}

export const db = global.prisma ?? createPrismaClient();

global.prisma = db;
