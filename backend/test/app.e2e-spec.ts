import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect({ success: true, service: 'pawngold-backend', status: 'ok' });
  });

  it('/pawn-tickets/pending-approval (GET) without Authorization returns 401', () => {
    return request(app.getHttpServer())
      .get('/pawn-tickets/pending-approval')
      .expect(401);
  });

  it('/compliance/documents (GET) without Authorization returns 401', () => {
    return request(app.getHttpServer())
      .get('/compliance/documents')
      .expect(401);
  });
});
