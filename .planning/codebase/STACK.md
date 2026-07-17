# Technology Stack

**Analysis Date:** 2026-07-17

## Languages

**Primary:**
- TypeScript 5.x - Backend (NestJS), Frontend (React), Auction Frontend (React)
- Dart >=3.10.8 - Mobile app (Flutter)

**Secondary:**
- JavaScript (CommonJS) - Legacy `backend/server.js` Express API
- SQL - Prisma migrations, raw SQL scripts in root

## Runtime

**Backend:**
- Node.js (LTS) - NestJS backend
- Flutter SDK >=3.10.8 <4.0.0 - Mobile app

**Package Managers:**
- npm - All JavaScript/TypeScript projects (lockfiles present in all four app dirs)
- pub (Flutter) - Mobile (`mobile/pubspec.lock` present)

## Frameworks

**Backend API:**
- NestJS 10.x (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`) - Primary API framework
  - Config: `backend/nest-cli.json`, `backend/tsconfig.json`
  - Entry: `backend/src/main.ts`
- Express 5.x (`express`) - Underlying HTTP adapter for NestJS + legacy `backend/server.js`
- Prisma 5.22 (`@prisma/client`) - ORM for PostgreSQL
  - Schema: `backend/prisma/schema.prisma` (1604 lines, 23+ models, 23 enums)
  - Seed: `backend/prisma/seed.ts`
  - Config: `backend/prisma.config.ts`

**Frontend (Dashboard):**
- React 19.x (`react`, `react-dom`) - UI framework
- Vite 6.x (`vite`) - Build tool and dev server
  - Config: `frontend/vite.config.js`
- TailwindCSS 4.x (`tailwindcss`) - Utility CSS framework
  - Config: `frontend/tailwind.config.js`
- shadcn/Radix UI (`@radix-ui/react-*`) - Component primitives (30+ Radix packages)
- React Router DOM 7.x (`react-router-dom`) - Client-side routing

**Auction Frontend:**
- React 19.x (`react`, `react-dom`) - UI framework
- Vite 7.x (`vite`) - Build tool
  - Config: `auction-frontend/vite.config.ts`
- React Router DOM 7.x (`react-router-dom`) - Client-side routing

**Mobile:**
- Flutter 3.x (Dart) - Cross-platform mobile framework
  - Config: `mobile/pubspec.yaml`
- BLoC 8.x (`flutter_bloc`, `bloc`) - State management

**Testing:**
- Jest 29.x (`jest`, `ts-jest`) - Backend unit tests
  - Config: Inline in `backend/package.json`
- Vitest 3.x (`vitest`) - Frontend and auction-frontend unit tests
  - Config: Inline in `frontend/vite.config.js` and `auction-frontend/vite.config.ts`
- Testing Library (`@testing-library/react`, `@testing-library/jest-dom`) - React component testing
- Supertest 6.x (`supertest`) - Backend HTTP testing
- bloc_test 9.x + mocktail 1.x - Flutter unit testing

**Build/Dev:**
- TypeScript 5.x - Type checking across all TS projects
- ESLint 9.x - Linting (flat config in all JS/TS projects)
- Prettier 3.x - Code formatting (backend: `.prettierrc`)
- tsx 4.x - TypeScript execution for Prisma seed scripts

## Key Dependencies

**Critical:**
- `@prisma/client` 5.22 - Database ORM; all data access flows through Prisma
- `@supabase/supabase-js` 2.90+ - Authentication, admin user management, storage uploads
- `supabase_flutter` 2.0.2 - Mobile app Supabase integration
- `nodemailer` 8.x - SMTP email delivery for auth codes
- `pdfkit` 0.19 - Server-side PDF generation for contracts and receipts
- `handlebars` 4.7 - Contract template rendering
- `helmet` 8.x - HTTP security headers
- `express-rate-limit` 7.x - Global rate limiting

**UI/Visualization:**
- `recharts` 3.6 - Dashboard charts and analytics
- `lucide-react` 0.471 - Icon library
- `sweetalert2` 11.26 - Modal/alert dialogs
- `leaflet` 1.9.4 + `react-leaflet` 5.0 - Map views (frontend)
- `flutter_map` 6.1 + `google_maps_flutter` 2.5 - Map views (mobile)

**HTTP/Data:**
- `axios` 1.13 - HTTP client (frontend, auction-frontend)
- `dio` 5.3 - HTTP client (mobile)
- `react-router-dom` 7.x - Frontend routing

**Utilities:**
- `class-validator` 0.14 + `class-transformer` 0.5 - DTO validation (NestJS)
- `@nestjs/schedule` 6.1 - Cron job scheduling (overdue checks, notifications)
- `rxjs` 7.8 - Reactive programming (NestJS core)
- `uuid` 4.0 - UUID generation (mobile)
- `equatable` 2.0 - Value equality (mobile BLoC)
- `flutter_dotenv` 5.1 - Environment variable loading (mobile)
- `flutter_secure_storage` 9.0 - Secure credential storage (mobile)
- `intl` 0.19 - Date/number formatting (mobile)

## Configuration

**Environment:**
- `.env` files per application: `backend/.env`, `frontend/.env`, `auction-frontend/.env`, `mobile/.env`
- Template: `.env.example` at project root (comprehensive, 117 lines)
- Frontend uses `import.meta.env.VITE_*` prefix for client-exposed vars
- Backend uses `process.env.*` directly
- Mobile uses `flutter_dotenv` to load `.env` file
- `.gitignore` explicitly keeps `.env` in git (private repo policy)

**Build:**
- `backend/tsconfig.json` - TypeScript config (NodeNext module, ES2021 target, path alias `@/*`)
- `backend/tsconfig.build.json` - Build-only TS config (extends base, excludes tests)
- `backend/nest-cli.json` - NestJS CLI config
- `frontend/vite.config.js` - Vite config with proxy rules for backend API routes
- `frontend/tailwind.config.js` - TailwindCSS config with custom pawn-navy/pawn-blue colors
- `frontend/tsconfig.json` - Frontend TS config
- `auction-frontend/vite.config.ts` - Vite config (port 5174, jsdom test env)
- `auction-frontend/tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json` - Auction TS configs
- `mobile/analysis_options.yaml` - Dart linting config

**Linting:**
- Backend: ESLint 9 flat config (`backend/eslint.config.mjs`) with `typescript-eslint` + `eslint-plugin-prettier`
- Frontend: ESLint 9 flat config (`frontend/eslint.config.js`) with `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh`
- Auction: ESLint 9 flat config (`auction-frontend/eslint.config.js`)
- Backend Prettier: `backend/.prettierrc` (singleQuote: true, trailingComma: "all")
- Mobile: `flutter_lints` 3.x via `analysis_options.yaml`

## Platform Requirements

**Development:**
- Node.js LTS (18+ recommended)
- Flutter SDK >=3.10.8
- PostgreSQL (via Supabase; direct connection or session pooler)
- npm (no yarn/pnpm lockfiles present)

**Production:**
- Backend: Railway (NestJS app) - `backend/server.js` or `dist/src/main`
- Frontend: Railway (static build) - `vite build` output
- Auction Frontend: Railway (static build) - `vite build` output
- Database: Supabase (managed PostgreSQL)
- Mobile: Android APK / iOS build
- Hosting patterns: `.up.railway.app` domains throughout CORS config

## Legacy Code

**`backend/server.js`:**
- Standalone Express server with raw `pg` Pool queries
- Uses CommonJS (`require()`), separate from NestJS architecture
- Provides dashboard stats, decision support, customer, redemption, inventory, appraisal, staff, and auth endpoints
- Direct SQL queries (no ORM) — some Prisma model references in queries (e.g., `"Ticket"`, `"Customer"`)
- Should be considered deprecated in favor of NestJS modules

---

*Stack analysis: 2026-07-17*
