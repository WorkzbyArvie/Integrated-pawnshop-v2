import { MFA_ASSERTION_HEADER } from '../../security/mfa-assertion.service';

export const CORS_ALLOWED_METHODS =
  'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS';

export const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'pawnshop-id',
  'branch-id',
  'user-id',
  MFA_ASSERTION_HEADER,
].join(',');

const DEFAULT_FRONTEND_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://localhost:7357',
  'http://127.0.0.1:7357',
  'https://pawngold-auction-house-production.up.railway.app',
  'https://pawngold-auctionhouse-v2.vercel.app',
  'https://pawngold-production.up.railway.app',
];

const LOCALHOST_DEV_PATTERN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;
const RAILWAY_FRONTEND_PATTERNS = [
  /^https:\/\/pawngold-production(?:-[a-z0-9]+)?\.up\.railway\.app$/i,
  /^https:\/\/pawngold-auction-house-production(?:-[a-z0-9]+)?\.up\.railway\.app$/i,
];
const VERCEL_FRONTEND_PATTERNS = [
  /^https:\/\/integrated-pawnshop-v2(?:-[a-z0-9]+)?\.vercel\.app$/i,
  /^https:\/\/pawngold-auctionhouse-v2(?:-[a-z0-9]+)?\.vercel\.app$/i,
];

export interface CorsOriginEnv {
  FRONTEND_URL?: string;
  AUCTION_FRONTEND_URL?: string;
  MOBILE_WEB_URL?: string;
  CORS_ALLOWED_ORIGINS?: string;
}

export interface CorsOptions {
  origin: (
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void,
  ) => void;
  credentials: boolean;
  methods: string;
  allowedHeaders: string;
}

export function resolveAllowedOrigins(
  env: CorsOriginEnv = process.env,
): Set<string> {
  const extra = String(env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return new Set<string>([
    ...DEFAULT_FRONTEND_ORIGINS,
    env.FRONTEND_URL || 'http://localhost:5173',
    env.AUCTION_FRONTEND_URL ||
      'https://pawngold-auctionhouse-v2.vercel.app',
    env.MOBILE_WEB_URL || 'http://localhost:7357',
    ...extra,
  ]);
}

export function isAllowedOrigin(
  origin: string | undefined,
  env: CorsOriginEnv = process.env,
): boolean {
  if (!origin) return true;
  if (resolveAllowedOrigins(env).has(origin)) return true;
  if (LOCALHOST_DEV_PATTERN.test(origin)) return true;
  if (RAILWAY_FRONTEND_PATTERNS.some((pattern) => pattern.test(origin))) {
    return true;
  }
  return VERCEL_FRONTEND_PATTERNS.some((pattern) => pattern.test(origin));
}

export function buildCorsOptions(env: CorsOriginEnv = process.env): CorsOptions {
  return {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin, env)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    credentials: true,
    methods: CORS_ALLOWED_METHODS,
    allowedHeaders: CORS_ALLOWED_HEADERS,
  };
}
