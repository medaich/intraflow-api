export const APPROVED_TEST_DATABASES = Object.freeze(['intraflow_test']);

/**
 * Validates that a database name is safe to drop and recreate for E2E testing.
 * Strictly prevents accidental operations on the development or production database.
 */
export function validateTestDatabaseName(dbName: string | undefined | null): string {
  if (!dbName || typeof dbName !== 'string' || dbName.trim() === '') {
    throw new Error('E2E test setup aborted: MYSQL_DATABASE environment variable is missing or empty.');
  }

  const normalized = dbName.trim();

  if (normalized === 'intraflow') {
    throw new Error('E2E test setup aborted: Refusing to drop or modify development database "intraflow".');
  }

  if (!APPROVED_TEST_DATABASES.includes(normalized)) {
    throw new Error(
      `E2E test setup aborted: Database "${normalized}" is not on the approved test database allowlist: [${APPROVED_TEST_DATABASES.join(', ')}].`,
    );
  }

  if (!/^[a-zA-Z0-9_]+$/.test(normalized)) {
    throw new Error(`E2E test setup aborted: Database name "${normalized}" contains invalid characters.`);
  }

  return normalized;
}
