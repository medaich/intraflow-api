import { validateTestDatabaseName } from './test-db-safety';

describe('Test Database Name Safety Validation', () => {
  it('accepts intraflow_test when properly configured', () => {
    expect(validateTestDatabaseName('intraflow_test')).toBe('intraflow_test');
    expect(validateTestDatabaseName('  intraflow_test  ')).toBe('intraflow_test');
  });

  it('strictly rejects the development database intraflow', () => {
    expect(() => validateTestDatabaseName('intraflow')).toThrow(
      'Refusing to drop or modify development database "intraflow"',
    );
  });

  it('strictly rejects missing, null, undefined, or empty database names', () => {
    expect(() => validateTestDatabaseName(undefined)).toThrow(
      'MYSQL_DATABASE environment variable is missing or empty',
    );
    expect(() => validateTestDatabaseName(null)).toThrow(
      'MYSQL_DATABASE environment variable is missing or empty',
    );
    expect(() => validateTestDatabaseName('')).toThrow(
      'MYSQL_DATABASE environment variable is missing or empty',
    );
    expect(() => validateTestDatabaseName('   ')).toThrow(
      'MYSQL_DATABASE environment variable is missing or empty',
    );
  });

  it('strictly rejects unapproved or unknown database names', () => {
    expect(() => validateTestDatabaseName('production')).toThrow(
      'is not on the approved test database allowlist',
    );
    expect(() => validateTestDatabaseName('intraflow_prod')).toThrow(
      'is not on the approved test database allowlist',
    );
    expect(() => validateTestDatabaseName('other_test_db')).toThrow(
      'is not on the approved test database allowlist',
    );
  });

  it('rejects database names containing illegal SQL characters', () => {
    expect(() => validateTestDatabaseName('intraflow_test; DROP TABLE users;')).toThrow();
  });
});
