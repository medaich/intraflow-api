import * as Joi from 'joi';

function isLocalHost(urlStr?: string): boolean {
  if (!urlStr) return true;
  try {
    const parsed = new URL(urlStr);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test', 'provision')
    .default('development'),
  PORT: Joi.number().default(3000),
  APP_URL: Joi.string().uri().default('http://localhost:3000'),
  CORS_ORIGIN: Joi.string().default('http://localhost:5173'),

  TRUST_PROXY: Joi.number().integer().min(0).default(0),

  COOKIE_SECURE: Joi.boolean().default((parent: { NODE_ENV?: string }) => {
    return parent?.NODE_ENV === 'production';
  }),
  COOKIE_KEY: Joi.string().min(16).required(),
  TOKEN_EXPIRATION: Joi.number().default(86400),

  MYSQL_HOST: Joi.string().required(),
  MYSQL_PORT: Joi.number().default(3306),
  MYSQL_DATABASE: Joi.string().required(),
  MYSQL_USERNAME: Joi.string().required(),
  MYSQL_ROOT_PASSWORD: Joi.string().required(),

  ADMIN_EMAIL: Joi.string().email().optional(),
  ADMIN_PASSWORD: Joi.string().min(8).optional(),
  ADMIN_NAME: Joi.string().default('Super Admin'),

  // Mailer Configuration
  MAIL_TRANSPORT: Joi.string().valid('smtp', 'memory').default('memory'),
  SMTP_HOST: Joi.string().when('MAIL_TRANSPORT', {
    is: 'smtp',
    then: Joi.required(),
    otherwise: Joi.optional().default('localhost'),
  }),
  SMTP_PORT: Joi.number().default(1025),
  SMTP_USER: Joi.string().allow('').optional(),
  SMTP_PASS: Joi.string().allow('').optional(),
  MAIL_FROM: Joi.string().default('noreply@intraflow.dev'),
  RESET_TOKEN_TTL: Joi.number().default(3600),
  EMAIL_CHANGE_TOKEN_TTL: Joi.number().default(86400),

  // Storage & Attachment Configuration
  STORAGE_DIR: Joi.string().default('./storage'),
  MAX_FILE_SIZE: Joi.number().default(10485760),
  MAX_ATTACHMENTS_PER_TASK: Joi.number().default(20),
}).custom((values: unknown, helpers) => {
  const val = values as Record<string, unknown>;
  const isProd = val.NODE_ENV === 'production';
  const appUrl = typeof val.APP_URL === 'string' ? val.APP_URL : undefined;
  const isLocal = isLocalHost(appUrl);

  if (isProd && !isLocal) {
    if (val.COOKIE_SECURE === false) {
      return helpers.message({
        custom: 'COOKIE_SECURE cannot be false in production unless APP_URL is localhost or 127.0.0.1',
      });
    }

    const cookieKey = typeof val.COOKIE_KEY === 'string' ? val.COOKIE_KEY : '';
    if (cookieKey) {
      if (cookieKey.length < 32) {
        return helpers.message({
          custom: 'COOKIE_KEY must be at least 32 characters long in production',
        });
      }
      if (
        cookieKey.startsWith('CHANGE_ME_') ||
        cookieKey === 'secret' ||
        cookieKey === 'default_key' ||
        cookieKey === 'replace_with_a_secure_random_key_in_production'
      ) {
        return helpers.message({
          custom: 'COOKIE_KEY cannot use placeholder or example values in production',
        });
      }
    }

    const adminPassword = typeof val.ADMIN_PASSWORD === 'string' ? val.ADMIN_PASSWORD : '';
    if (adminPassword) {
      if (
        adminPassword.startsWith('CHANGE_ME_') ||
        adminPassword === 'AdminPassword123!' ||
        adminPassword === 'secret'
      ) {
        return helpers.message({
          custom: 'ADMIN_PASSWORD cannot use placeholder or example values in production',
        });
      }
    }

    const dbPassword = typeof val.MYSQL_ROOT_PASSWORD === 'string' ? val.MYSQL_ROOT_PASSWORD : '';
    if (dbPassword) {
      if (dbPassword.startsWith('CHANGE_ME_') || dbPassword === 'secret') {
        return helpers.message({
          custom: 'MYSQL_ROOT_PASSWORD cannot use placeholder or example values in production',
        });
      }
    }
  }

  return val;
});
