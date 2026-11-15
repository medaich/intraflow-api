import * as dotenv from 'dotenv';
import { resolve } from 'path';
import mysql from 'mysql2/promise';
import { DataSource } from 'typeorm';
import { InitialSchema1731510000000 } from '../src/database/migrations/1731510000000-InitialSchema';
import { Phase3Schema1731520000000 } from '../src/database/migrations/1731520000000-Phase3Schema';
import { Phase4Schema1731530000000 } from '../src/database/migrations/1731530000000-Phase4Schema';
import { validateTestDatabaseName } from '../src/database/test-db-safety';

export default async function globalSetup() {
  process.env.NODE_ENV = 'test';
  dotenv.config({ path: resolve(__dirname, '../.env.test'), override: true });

  const host = process.env.MYSQL_HOST ?? 'localhost';
  const port = Number(process.env.MYSQL_PORT ?? 3308);
  const user = process.env.MYSQL_USERNAME ?? 'root';
  const password = process.env.MYSQL_ROOT_PASSWORD ?? 'secret';

  // Strictly validate the database name before constructing any SQL commands
  const testDbName = validateTestDatabaseName(process.env.MYSQL_DATABASE);

  // Connect to MySQL server, drop and recreate test database to guarantee fresh state
  const connection = await mysql.createConnection({ host, port, user, password });
  await connection.query(`DROP DATABASE IF EXISTS \`${testDbName}\`;`);
  await connection.query(`CREATE DATABASE \`${testDbName}\`;`);
  await connection.end();

  // Run migrations from scratch on the fresh test database
  const dataSource = new DataSource({
    type: 'mysql',
    host,
    port,
    username: user,
    password,
    database: testDbName,
    migrations: [
      InitialSchema1731510000000,
      Phase3Schema1731520000000,
      Phase4Schema1731530000000,
    ],
    synchronize: false,
  });

  await dataSource.initialize();
  await dataSource.runMigrations();
  await dataSource.destroy();
}
