import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { APP_GUARD } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ComplianceGuard } from '../common/guards/compliance.guard';
import { PawnshopGuard } from '../common/guards/pawnshop.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { RbacGuard } from '../common/guards/rbac.guard';
import {
  CORS_ALLOWED_METHODS,
  buildCorsOptions,
  resolveAllowedOrigins,
} from '../common/config/cors.config';
import { SecurityModule } from './security.module';
import { AccountSecurityGuard } from './guards/account-security.guard';
import {
  MFA_ASSERTION_HEADER,
  MfaAssertionService,
} from './mfa-assertion.service';

const MAIN_TS = readFileSync(
  path.resolve(__dirname, '..', 'main.ts'),
  'utf8',
);

describe('account security bootstrap configuration', () => {
  describe('global guard order', () => {
    it('registers the global guards as Pawnshop, Rbac, AccountSecurity, RateLimit, Compliance', () => {
      const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AppModule) as {
        provide?: unknown;
        useClass?: unknown;
      }[];

      const guardOrder = providers
        .filter((provider) => provider?.provide === APP_GUARD)
        .map((provider) => provider.useClass);

      expect(guardOrder).toEqual([
        PawnshopGuard,
        RbacGuard,
        AccountSecurityGuard,
        RateLimitGuard,
        ComplianceGuard,
      ]);
    });

    it('imports the module that supplies the credential and assertion dependencies', () => {
      expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule)).toContain(
        SecurityModule,
      );
    });
  });

  describe('security module wiring', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      SecurityModule,
    ) as unknown[];

    it('registers the MFA assertion service for the global guard', () => {
      expect(providers).toContain(MfaAssertionService);
    });
  });

  describe('cors allowlist', () => {
    it('accepts the MFA assertion header on real bootstrap options', () => {
      const allowedHeaders = String(
        buildCorsOptions(process.env).allowedHeaders,
      );

      expect(allowedHeaders).toContain(MFA_ASSERTION_HEADER);
      expect(allowedHeaders).toContain('Authorization');
      expect(allowedHeaders).toContain('pawnshop-id');
    });

    it('names the assertion header exactly once so drift stays visible', () => {
      const allowedHeaders = String(
        buildCorsOptions(process.env).allowedHeaders,
      );

      expect(MFA_ASSERTION_HEADER).toBe('x-mfa-assertion');
      expect(allowedHeaders.split(MFA_ASSERTION_HEADER)).toHaveLength(2);
    });

    it('keeps the credential headers the dashboard and auction clients send', () => {
      const allowedHeaders = String(
        buildCorsOptions(process.env).allowedHeaders,
      );

      for (const header of [
        'Content-Type',
        'Authorization',
        'pawnshop-id',
        'branch-id',
        'user-id',
      ]) {
        expect(allowedHeaders).toContain(header);
      }
    });

    it('allows the preflight and write methods the clients need', () => {
      expect(buildCorsOptions(process.env).methods).toBe(CORS_ALLOWED_METHODS);
      expect(CORS_ALLOWED_METHODS).toContain('OPTIONS');
      expect(CORS_ALLOWED_METHODS).toContain('POST');
    });

    it('keeps credentialed requests enabled for the browser clients', () => {
      expect(buildCorsOptions(process.env).credentials).toBe(true);
    });
  });

  describe('production wiring in main.ts', () => {
    it('consumes the shared production CORS configuration', () => {
      expect(MAIN_TS).toContain('buildCorsOptions');
      expect(MAIN_TS).toContain('resolveAllowedOrigins');
    });

    it('does not inline its own CORS header allowlist', () => {
      expect(MAIN_TS).not.toMatch(/allowedHeaders\s*:/);
      expect(MAIN_TS).not.toContain('x-mfa-assertion');
    });
  });
});
