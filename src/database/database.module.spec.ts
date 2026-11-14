import { ConfigService } from '@nestjs/config';
import { databaseConfigFactory } from './database.module';

describe('DatabaseModule Configuration Factory', () => {
  it('proves synchronize is strictly false and never enabled from a "false" string', () => {
    const mockConfigService = {
      getOrThrow: jest.fn().mockImplementation((key: string) => {
        const envMap: Record<string, string> = {
          MYSQL_HOST: 'localhost',
          MYSQL_PORT: '3306',
          MYSQL_DATABASE: 'intraflow',
          MYSQL_USERNAME: 'root',
          MYSQL_ROOT_PASSWORD: 'secret',
          MYSQL_SYNCHRONIZE: 'false',
        };
        return envMap[key];
      }),
    } as unknown as ConfigService;

    const config = databaseConfigFactory(mockConfigService);

    expect(config.synchronize).toBe(false);
  });

  it('strictly maps database configuration properties from ConfigService', () => {
    const mockConfigService = {
      getOrThrow: jest.fn().mockImplementation((key: string) => {
        const envMap: Record<string, string> = {
          MYSQL_HOST: 'test-host',
          MYSQL_PORT: '3308',
          MYSQL_DATABASE: 'intraflow_test',
          MYSQL_USERNAME: 'test_user',
          MYSQL_ROOT_PASSWORD: 'test_password',
        };
        return envMap[key];
      }),
    } as unknown as ConfigService;

    const config = databaseConfigFactory(mockConfigService);
    expect(config.database).toBe('intraflow_test');
    expect(config.host).toBe('test-host');
    expect(config.synchronize).toBe(false);
  });
});
