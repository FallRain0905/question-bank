import './load-env';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  DocumentBuilder,
  SwaggerModule,
} from '@nestjs/swagger';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import multipart from '@fastify/multipart';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  const maxUploadBytes = Number(process.env.KB_MAX_UPLOAD_MB ?? 30) * 1024 * 1024;
  await app.register(multipart, {
    limits: { fileSize: maxUploadBytes, files: 1 },
  });

  app.setGlobalPrefix('api');
  const allowedOrigins = (process.env.API_CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Learning API')
    .setDescription('Learning workflow API foundation')
    .setVersion('0.1.0')
    .addCookieAuth('session')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', description: 'API_ACCESS_TOKEN' },
      'api-token',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, process.env.API_HOST ?? '127.0.0.1');
}

void bootstrap();
