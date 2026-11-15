import { DataSource } from 'typeorm';
import { join } from 'path';

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
  const dotenv: typeof import('dotenv') = require('dotenv');
  if (process.env.NODE_ENV === 'test') {
    dotenv.config({ path: '.env.test' });
  } else {
    dotenv.config();
  }
} catch {
  // In production container environments, dotenv may not be present and env vars are injected directly
}

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.MYSQL_HOST ?? 'localhost',
  port: Number(process.env.MYSQL_PORT ?? 3306),
  database: process.env.MYSQL_DATABASE ?? 'intraflow',
  username: process.env.MYSQL_USERNAME ?? 'root',
  password: process.env.MYSQL_ROOT_PASSWORD ?? 'secret',
  timezone: 'Z',
  entities: [join(__dirname, '/../**/*.entity{.ts,.js}')],
  migrations: [join(__dirname, '/migrations/*{.ts,.js}')],
  synchronize: false,
});
