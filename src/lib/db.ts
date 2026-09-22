import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";
import { attachDatabasePool } from "@vercel/functions/db-connections";

class ManagedNeonAdapter extends PrismaNeon {
  override async connect() {
    const adapter = await super.connect();
    // Prisma 6 creates its pool lazily. Register that actual pool with Fluid
    // compute so idle connections are released before an instance suspends.
    attachDatabasePool(adapter.underlyingDriver());
    return adapter;
  }
}

function createPrismaClient() {
  const adapter = new ManagedNeonAdapter({
    connectionString: process.env.DATABASE_URL,
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
