import 'reflect-metadata';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as express from 'express';
import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/errors/problem.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // OAuth2 token endpoint accepts form-urlencoded as well as JSON.
  app.use(express.urlencoded({ extended: true }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new ProblemDetailsFilter());

  const config = new DocumentBuilder()
    .setTitle('Spark Retail Identity Network (RIN)')
    .setDescription(
      'Identity & consent layer for physical commerce. "One identity, every store."',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .addTag('identity (consumer)', 'Spark login — the "Continue with Spark" side')
    .addTag('identity (merchant)', 'OAuth2 client_credentials for merchants')
    .addTag('profile (consumer)', 'Customer-owned profile')
    .addTag('merchant', 'Merchant tenant & Consent Engine config')
    .addTag('consent (consumer)', 'View / approve / revoke consent')
    .addTag('consent (merchant)', 'Create requests, read consented customers, dashboard')
    .addTag('webhooks (merchant)', 'Event delivery to the merchant CRM')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  new Logger('Bootstrap').log(`Spark RIN listening on http://localhost:${port}  (docs: /docs)`);
}

bootstrap();
