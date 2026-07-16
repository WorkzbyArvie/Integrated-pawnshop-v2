# PawnGold: Integrated Pawnshop Management System

A modern, production-ready full-stack application for managing pawnshop operations including inventory management, customer relations, financial tracking, and decision support.

## 🌟 Features

### Core Modules
- **Dashboard**: Real-time overview of business metrics
- **Sales & Loans**: Quick loan entry and management  
- **Inventory Vault**: Track pawned items with advanced filtering
- **Redemption Center**: Process customer redemptions
- **Auction House**: Manage expired items for auction
- **CRM**: Customer relationship management
- **Staff Matrix**: Employee management and scheduling
- **Finance & Treasury**: Financial reporting and analysis
- **Decision Support**: AI-powered insights and recommendations
- **Branch Management**: Multi-branch operations (Super Admin)

### Technical Highlights
- **Type-Safe**: Full TypeScript codebase
- **Responsive Design**: Mobile-first UI with TailwindCSS
- **Real-time Data**: Supabase for live database synchronization
- **Secure**: Role-based access control with RLS policies
- **Scalable**: Built for growth with proper database indexing
- **Production-Ready**: Error handling, logging, and monitoring built-in

## 🛠️ Tech Stack

### Frontend
- React 19 + TypeScript
- Vite (fast build tool)
- TailwindCSS (styling)
- Recharts (data visualization)
- Supabase JS Client (real-time DB)
- React Router v7 (navigation)

### Backend
- Node.js + NestJS Framework
- Prisma ORM (database access)
- PostgreSQL via Supabase
- CORS & security headers
- Connection pooling

### Database
- Supabase (PostgreSQL + Auth + RLS)
- Automated backups
- Row-Level Security policies

## 📋 Prerequisites

- **Node.js**: v18+ (includes npm)
- **Supabase**: Free or Pro account
- **Git**: For version control
- **Modern Browser**: Chrome, Firefox, Safari, or Edge

## 🚀 Quick Start

### 1. Clone & Setup

```bash
# Clone repository
git clone https://github.com/WorkzbyArvie/Integrated-Pawnshop-System-with-Decision-Support-in-Dasmarinas-Cavite.git
cd Integrated-Pawnshop-System-with-Decision-Support-in-Dasmarinas-Cavite

# Install dependencies (root level)
npm install
```

### 2. Configure Environment

Create `.env` files:

**backend/.env**
```env
DATABASE_URL=postgresql://[user]:[password]@db.[SUPABASE_ID].supabase.co:5432/postgres
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
VITE_SUPABASE_URL=https://[PROJECT_ID].supabase.co
SUPABASE_SERVICE_ROLE_KEY=[YOUR_SERVICE_ROLE_KEY]
```

**frontend/.env**
```env
VITE_SUPABASE_URL=https://[PROJECT_ID].supabase.co
VITE_SUPABASE_ANON_KEY=[YOUR_ANON_KEY]
VITE_BACKEND_URL=http://localhost:3000
```

See `.env.example` for all available options.

### 3. Initialize Database

```bash
cd backend
npm run prisma:generate
npm run prisma:seed
```

### 4. Run Development Servers

**Terminal 1 - Backend:**
```bash
cd backend
npm run start:dev
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

Visit `http://localhost:5174`

### 5. Test Login

Default test credentials are created during seed. Check Supabase Auth dashboard for user accounts.

## 📚 Project Structure

```
.
├── frontend/              # React + Vite application
│   ├── src/
│   │   ├── components/   # UI components
│   │   ├── pages/        # Page layouts
│   │   ├── lib/          # Supabase client & utils
│   │   ├── App.tsx       # App routing & auth
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
│
├── backend/              # Node.js + NestJS API
│   ├── src/
│   │   ├── app.service.ts
│   │   ├── app.controller.ts
│   │   ├── main.ts
│   │   └── analytics/
│   ├── prisma/
│   │   ├── schema.prisma   # Database schema
│   │   └── seed.ts         # Initial data
│   ├── scripts/
│   │   ├── diagnose-admin.ts
│   │   └── validate-admin-setup.ts
│   ├── package.json
│   └── .env
│
├── .env.example          # Environment template
├── PRODUCTION_DEPLOYMENT_GUIDE.md
└── README.md
```

## 🔐 Authentication & Authorization

### Login Flow
1. User enters email + password
2. Supabase Auth validates
3. Profile fetched from database
4. Role-based redirect to appropriate dashboard

### Roles
- **SUPER_ADMIN**: Full system access
- **BRANCH_ADMIN**: Branch operations only  
- **MANAGER**: Inventory & financial ops
- **STAFF**: Limited assigned features

## 🔌 Key API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | API health check |
| `/api/dashboard/stats` | GET | Dashboard metrics |
| `/auth/create-branch-admin` | POST | Create admin account |
| `/api/redemption/active-items` | GET | Redemption queue |
| `/api/inventory` | GET | All inventory |
| `/api/auction/items` | GET | Auction items |

## 🧪 Testing & Building

### Verify Installation
```bash
# Test frontend build
cd frontend
npm run build

# Test backend starts
cd ../backend
npm run start:dev
# Should see: 🚀 Backend running on http://localhost:3000
```

### Check for Errors
```bash
# Frontend lint
cd frontend
npm run lint

# Backend - test database
cd ../backend
npm run prisma:generate
```

## 📊 Database Tables

- **profiles**: User accounts and roles
- **Staff**: Employee records
- **Customer**: Customer data
- **Ticket**: Pawn tickets (loans)
- **Inventory**: Tracked items
- **Loan**: Financial transactions
- **Pawnshops**: Branch/location data
- **Category**: Item categories

## 🚀 Deployment

### Frontend (Recommended: Vercel)
```bash
npm i -g vercel
cd frontend
vercel --prod
```

### Backend (Recommended: Railway or Heroku)
```bash
# Railway
npm i -g @railway/cli
cd backend
railway login
railway init
railway up

# Or Heroku
npm i -g heroku
heroku login
heroku create
git push heroku main
```

See `PRODUCTION_DEPLOYMENT_GUIDE.md` for detailed instructions.

## 🛠️ Troubleshooting

### Backend won't start
- Check `.env` is set correctly
- Verify Supabase DATABASE_URL and SERVICE_ROLE_KEY
- Ensure port 3000 is available: `lsof -i :3000`

### Frontend shows blank page
- Verify `.env` vars: Check browser console
- Test API: `curl http://localhost:3000/health`
- Clear browser cache: Ctrl+Shift+Delete

### Database errors
- Check Supabase dashboard status
- Verify connection string in `.env`
- Review RLS policies if getting 403 errors

### Login fails  
- Confirm Supabase keys in `.env`
- Check user exists in Supabase Auth
- Review backend logs for detailed error

## 📈 Performance

- **Frontend**: Vite builds in ~12s, optimized bundle
- **Backend**: Handles 20+ concurrent connections with pooling
- **Database**: Automatic backups, query optimization via Prisma

## 📝 Development Workflow

```bash
# Make changes to frontend components
cd frontend
# HMR (Hot Module Reload) automatically updates

# Make changes to backend
cd backend
# Restart: Ctrl+C, then: npm run start:dev

# Test database changes
npm run prisma:generate
npm run prisma:seed  # Reset to clean state
```

## 🔄 Production Checklist

- [ ] All `.env` variables set correctly
- [ ] Database migrations applied
- [ ] Frontend builds without errors: `npm run build`
- [ ] Backend API tested: `/health` endpoint
- [ ] Security: HTTPS enabled, CORS configured
- [ ] Monitoring: Error tracking & logging setup
- [ ] Backups: Database backups configured
- [ ] DNS: Domain pointing to production server

## 📄 License

Proprietary - PawnGold Management System. All rights reserved.

## 👥 Support & Issues

1. Check logs in backend console and browser DevTools
2. Review Supabase dashboard for database status  
3. Verify all `.env` variables are set
4. See `PRODUCTION_DEPLOYMENT_GUIDE.md` for deployment issues
5. Check diagnostic scripts: `node scripts/diagnose-admin.ts`

## 🎯 Roadmap

- [ ] Mobile app (React Native)
- [ ] Advanced analytics & reporting
- [ ] Machine learning for appraisals
- [ ] Payment gateway integration
- [ ] SMS/Email notifications
- [ ] Two-factor authentication (2FA)
- [ ] API rate limiting
- [ ] Blockchain provenance tracking

---

**Version**: 1.0.0 (Production Ready) ✅  
**Last Updated**: February 4, 2026  
**Repository**: [GitHub - Integrated Pawnshop System](https://github.com/WorkzbyArvie/Integrated-Pawnshop-System-with-Decision-Support-in-Dasmarinas-Cavite)  
**Support**: support@pawngold.com

## Key Module Descriptions

- **CRM**: Centralized customer records and transaction history
- **Decision Support**: Risk scoring and market volatility analysis
- **Inventory Vault**: Secure inventory and storage management with real-time tracking
