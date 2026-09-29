import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import type { Config } from './config.js';

export async function createApp(config: Config): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(config),
    new FastifyAdapter({ trustProxy: true, bodyLimit: 1024 * 1024 }),
    { logger: config.NODE_ENV === 'test' ? false : ['log', 'warn', 'error'] },
  );
  app.enableCors({ origin: config.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: true });
  app.enableShutdownHooks();
  return app;
}
