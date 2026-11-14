import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test', 'provision')
    .default('development'),
  PORT: Joi.number().default(3000),
  APP_URL: Joi.string().uri().default('http://localhost:3000'),
  CORS_ORIGIN: Joi.string().default('http://localhost:5173'),

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
});
