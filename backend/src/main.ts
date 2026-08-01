import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { RequestLoggerInterceptor } from './common/interceptors/request-logger.interceptor';
import { ResponseTransformInterceptor } from './common/interceptors/response-transform.interceptor';
import { PrismaService } from './prisma.service';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import { SubscriptionStatus } from '@prisma/client';
import * as dns from 'node:dns';

// Load .env file explicitly — try multiple paths for dev vs compiled
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });
dotenv.config();

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  try {
    dns.setDefaultResultOrder('ipv4first');
  } catch {
    // Older Node runtimes may not support this API.
  }

  const app = await NestFactory.create(AppModule);
  const httpApp = app.getHttpAdapter().getInstance() as express.Express;
  const prisma = app.get(PrismaService);

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseAdmin =
    supabaseUrl && supabaseServiceRoleKey
      ? createClient(supabaseUrl, supabaseServiceRoleKey)
      : null;

  httpApp.disable('x-powered-by');
  httpApp.set('trust proxy', 1);

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const auctionFrontendUrl =
    process.env.AUCTION_FRONTEND_URL || 'http://localhost:5174';
  const mobileWebUrl = process.env.MOBILE_WEB_URL || 'http://localhost:7357';
  const corsOriginsEnv = process.env.CORS_ALLOWED_ORIGINS || '';
  const corsOriginsFromEnv = corsOriginsEnv
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  const allowedOrigins = new Set<string>([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://localhost:7357',
    'http://127.0.0.1:7357',
    'https://pawngold-auction-house-production.up.railway.app',
    'https://pawngold-production.up.railway.app',
    frontendUrl,
    auctionFrontendUrl,
    mobileWebUrl,
    ...corsOriginsFromEnv,
  ]);

  const localhostDevPattern = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;
  const railwayFrontendPatterns = [
    /^https:\/\/pawngold-production(?:-[a-z0-9]+)?\.up\.railway\.app$/i,
    /^https:\/\/pawngold-auction-house-production(?:-[a-z0-9]+)?\.up\.railway\.app$/i,
  ];

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const matchesRailwayFrontend = railwayFrontendPatterns.some((pattern) =>
        pattern.test(origin),
      );

      if (
        allowedOrigins.has(origin) ||
        localhostDevPattern.test(origin) ||
        matchesRailwayFrontend
      ) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Authorization,pawnshop-id,branch-id,user-id',
  });

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    rateLimit({
      windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
      max: Number(process.env.RATE_LIMIT_MAX || 250),
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => {
        if (req.path.includes('/loans/paymongo/webhook')) return true;
        if (req.path.startsWith('/auth/request-auth-code')) return true;
        if (req.path.startsWith('/auth/verify-auth-code')) return true;
        if (req.path.startsWith('/auth/register-bidder')) return true;
        if (req.path.startsWith('/tenant-governance/client-registrations'))
          return true;
        return false;
      },
      message: {
        success: false,
        message: 'Too many requests. Please try again later.',
      },
    }),
  );

  // Tenant-wide operational freeze: if subscription is not ACTIVE/TRIAL,
  // block operational endpoints until owner re-subscribes.
  const operationalPrefixes = [
    '/analytics',
    '/auction',
    '/finance',
    '/payroll',
    '/compliance',
    '/queue',
    '/notifications',
    '/attendance',
    '/loan',
    '/loans',
  ];

  const freezeExemptPrefixes = [
    '/subscriptions',
    '/payment-methods',
    '/tenant-governance',
    '/branding',
    '/security',
    '/compliance',
  ];

  const isPublicAuctionReadRoute = (
    req: express.Request,
    pathName: string,
  ): boolean => {
    if (req.method !== 'GET') return false;
    if (!pathName.startsWith('/auction/listings')) return false;

    // Public auction-house endpoints (no tenant headers required)
    // - GET /auction/listings
    // - GET /auction/listings/:id
    // - GET /auction/listings/:id/ratings
    return true;
  };

  const isBidderMobileRoute = (
    req: express.Request,
    pathName: string,
  ): boolean => {
    if (!pathName) return false;

    // Mobile bidder routes that resolve pawnshop context at service level.
    if (pathName === '/loans/my-items' && req.method === 'GET') return true;
    if (pathName === '/loans/my-history' && req.method === 'GET') return true;
    if (/^\/loans\/\d+\/pay-link$/.test(pathName) && req.method === 'POST')
      return true;
    if (
      /^\/loans\/\d+\/confirm-payment$/.test(pathName) &&
      req.method === 'POST'
    )
      return true;
    if (pathName === '/queue/mobile' && req.method === 'POST') return true;
    if (pathName === '/queue/my-tickets' && req.method === 'GET') return true;
    if (
      /^\/queue\/my-tickets\/[^/]+\/(cancel|messages)$/.test(pathName) &&
      (req.method === 'POST' || req.method === 'GET')
    )
      return true;
    if (
      /^\/auction\/listings\/\d+\/bids$/.test(pathName) &&
      req.method === 'POST'
    )
      return true;
    if (/^\/notifications\/user\/[^/]+$/.test(pathName) && req.method === 'GET')
      return true;
    if (/^\/notifications\/[^/]+\/read$/.test(pathName) && req.method === 'PATCH')
      return true;
    if (pathName === '/notifications/read-all' && req.method === 'PATCH')
      return true;

    return false;
  };

  const isBidderAuctionRoute = (
    req: express.Request,
    pathName: string,
  ): boolean => {
    if (!pathName) return false;
    if (pathName.startsWith('/auction/bidders/tos-status')) return true;
    if (pathName.startsWith('/auction/bidders/accept-tos')) return true;
    if (pathName.startsWith('/auction/bidders/my-bids')) return true;
    if (pathName.startsWith('/auction/bidders/my-winnings')) return true;
    if (pathName.startsWith('/auction/bidders/me/')) return true;
    if (/^\/auction\/settlements\/[^/]+\/sign-contract$/.test(pathName) && req.method === 'POST') return true;
    return false;
  };

  app.use(async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      const pathName = req.path || '';
      if (req.method === 'OPTIONS') {
        next();
        return;
      }

      const isOperationalPath = operationalPrefixes.some((prefix) =>
        pathName.startsWith(prefix),
      );

      if (!isOperationalPath) {
        next();
        return;
      }

      if (freezeExemptPrefixes.some((prefix) => pathName.startsWith(prefix))) {
        next();
        return;
      }

      if (isPublicAuctionReadRoute(req, pathName)) {
        next();
        return;
      }

      if (!supabaseAdmin) {
        next();
        return;
      }

      const authHeader = (req.headers.authorization || '').trim();
      if (!authHeader) {
        res.status(401).json({
          success: false,
          message: 'Missing authorization header.',
        });
        return;
      }

      const pawnshopHeader = String(req.headers['pawnshop-id'] || '').trim();

      const [scheme, token] = authHeader.split(' ');
      if (scheme?.toLowerCase() !== 'bearer' || !token) {
        res.status(401).json({
          success: false,
          message: 'Invalid authorization format.',
        });
        return;
      }

      const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(
        token,
      );

      if (authError || !authData?.user?.id) {
        res.status(401).json({
          success: false,
          message: 'Invalid or expired token.',
        });
        return;
      }

      const actor = await prisma.profile.findUnique({
        where: { id: authData.user.id },
        select: { role: true, pawnshopId: true },
      });

      if (!actor) {
        res.status(403).json({
          success: false,
          message: 'Authenticated profile not found.',
        });
        return;
      }

      const normalizedRole = String(actor.role || '')
        .toUpperCase()
        .replace(/[\s-]+/g, '_');

      if (normalizedRole === 'SUPER_ADMIN') {
        next();
        return;
      }

      if (normalizedRole === 'BIDDER' && isBidderMobileRoute(req, pathName)) {
        next();
        return;
      }

      if (isBidderAuctionRoute(req, pathName)) {
        next();
        return;
      }

      if (req.method === 'GET' && /^\/notifications\/user\/[^/]+$/.test(pathName)) {
        next();
        return;
      }

      if (!pawnshopHeader) {
        res.status(400).json({
          success: false,
          message: 'Missing pawnshop-id header for tenant operational access.',
        });
        return;
      }

      if (actor.pawnshopId && actor.pawnshopId !== pawnshopHeader) {
        res.status(403).json({
          success: false,
          message: 'You can only access your own pawnshop operational data.',
        });
        return;
      }

      const latestSubscription = await prisma.subscription.findFirst({
        where: { pawnshopId: pawnshopHeader },
        orderBy: { createdAt: 'desc' },
        select: { status: true },
      });

      const isOperable =
        latestSubscription?.status === SubscriptionStatus.ACTIVE ||
        latestSubscription?.status === SubscriptionStatus.TRIAL;

      if (!isOperable) {
        res.status(403).json({
          success: false,
          message:
            'Tenant operations are frozen. Owner must re-subscribe to reactivate all branches.',
        });
        return;
      }

      next();
    } catch (error) {
      logger.error(
        `Subscription freeze middleware failed: ${(error as Error).message}`,
      );
      res.status(500).json({
        success: false,
        message: 'Unable to validate tenant subscription access.',
      });
    }
  });

  // Global validation pipe with strict settings
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Global interceptors
  app.useGlobalInterceptors(
    new RequestLoggerInterceptor(),
    new ResponseTransformInterceptor(),
  );

  // Keep upload limits configurable; default kept conservative for abuse resistance.
  const bodyLimitMb = Number(process.env.BODY_LIMIT_MB || 12);
  app.use(express.json({ limit: `${bodyLimitMb}mb` }));
  app.use(express.urlencoded({ limit: `${bodyLimitMb}mb`, extended: true }));

  const port = parseInt(process.env.PORT || '3000', 10);

  await app.listen(port, '0.0.0.0');
  logger.log(`Backend listening on 0.0.0.0:${port}`);
  logger.log(`CORS origins loaded: ${allowedOrigins.size}`);
  logger.log(`Security middleware enabled (helmet + rate-limit)`);
}

bootstrap().catch((err) => {
  console.error('❌ [Bootstrap] Failed to start backend:', err);
  process.exit(1);
});
