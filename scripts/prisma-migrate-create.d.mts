export function parseArguments(args: string[]): {
  name: string;
  allowDestructive: boolean;
};

export function nextMigrationDirectoryName(
  existingNames: string[],
  migrationName: string,
): string;

export function assertSafeGeneratedSql(
  sql: string,
  options?: { allowDestructive?: boolean },
): void;
