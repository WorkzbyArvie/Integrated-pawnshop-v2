# PawnGold: Production Deployment Guide

## Pre-Deployment Checklist

### Database
- [ ] Supabase project created and configured
- [ ] All tables exist with correct schemas
- [ ] RLS policies enabled and tested
- [ ] Backups configured with 14-day retention
- [ ] Read replicas setup for high availability (optional)
- [ ] Connection pooling configured

### Backend Preparation
- [ ] All environment variables set correctly
- [ ] `NODE_ENV=production`
- [ ] Database connection tested
- [ ] CORS origins whitelisted
- [ ] API endpoints tested with proper error handling
- [ ] Rate limiting and throttling configured
- [ ] Database migrations applied
- [ ] Seed data loaded

### Frontend Preparation
- [ ] Build tested: `npm run build`
- [ ] No console errors in build output
- [ ] Supabase keys configured correctly
- [ ] API endpoints point to production backend
- [ ] Analytics/monitoring configured (optional)
- [ ] Service workers and offline support configured (optional)

### Security & Infrastructure
- [ ] HTTPS certificate obtained (Let's Encrypt)
- [ ] SSL/TLS configured and enforced
- [ ] Security headers configured
  - Content-Security-Policy
  - X-Frame-Options
  - X-Content-Type-Options
  - Strict-Transport-Security
- [ ] Input validation and sanitization on backend
- [ ] SQL injection prevention verified (Prisma ORM handles this)
- [ ] CSRF protection enabled if needed
- [ ] Rate limiting and DDoS protection configured

### Monitoring & Logging
- [ ] Application performance monitoring (APM) setup
  - Error tracking (Sentry, LogRocket, etc)
  - Performance monitoring
  - User analytics
- [ ] Log aggregation configured (ELK, CloudWatch, Datadog)
- [ ] Alerting rules configured
- [ ] Health check endpoints monitored

### Testing
- [ ] Manual smoke test of critical flows:
  - User authentication
  - Dashboard loading
  - CRUD operations
  - Error scenarios
- [ ] Load testing to verify capacity
- [ ] Security testing (OWASP Top 10)
- [ ] API integration testing

---

## Deployment Steps

### Option 1: Vercel (Recommended for Frontend)

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy frontend
cd frontend
vercel --prod

# Configure environment variables in Vercel dashboard:
# VITE_SUPABASE_URL
# VITE_SUPABASE_ANON_KEY
```

### Option 2: Railway.app or Heroku (Recommended for Backend)

#### Railway.app
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Create new project
railway init

# Link Supabase database
# (In Railway dashboard, add Supabase as a plugin)

# Deploy
railway up
```

#### Heroku
```bash
# Install Heroku CLI
# Login: heroku login

# Create app
heroku create pawngold-api

# Set environment variables
heroku config:set NODE_ENV=production -a pawngold-api
heroku config:set DATABASE_URL="postgresql://..." -a pawngold-api
heroku config:set FRONTEND_URL="https://pawngold.vercel.app" -a pawngold-api

# Deploy
git push heroku main
```

### Option 3: Docker + VPS/Cloud (Most Control)

```dockerfile
# Dockerfile for backend
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY prisma ./prisma
RUN npm run prisma:generate

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
# Build and push to Docker Hub
docker build -t yourusername/pawngold-backend:latest .
docker push yourusername/pawngold-backend:latest

# Pull and run on VPS
docker pull yourusername/pawngold-backend:latest
docker run -d \
  -e DATABASE_URL="postgresql://..." \
  -e NODE_ENV=production \
  -e FRONTEND_URL="https://pawngold.com" \
  -p 3000:3000 \
  yourusername/pawngold-backend:latest
```

---

## Post-Deployment Verification

1. **Frontend Health**
   ```bash
   curl -s https://your-frontend.com/ | grep -i "<!DOCTYPE html"
   ```

2. **Backend Health**
   ```bash
   curl -s https://your-api.com/health
   # Expected: { "status": "ok", "timestamp": "..." }
   ```

3. **Database Connection**
   ```bash
   # Test in backend logs - should see successful connections
   ```

4. **Authentication Flow**
   - Visit frontend
   - Attempt login with test credentials
   - Verify profile loads from database
   - Check redirect to dashboard/platform-control

5. **Critical Features**
   - Dashboard stats load correctly
   - Inventory vault shows data
   - Redemption center functional
   - CRM/staff matrix accessible

6. **Error Monitoring**
   - Check error tracking service
   - Verify no critical errors logged
   - Review performance metrics

---

## Production Best Practices

### Application Level
- Use connection pooling (configured in `server.js`)
- Enable request compression
- Cache static assets with proper headers
- Implement graceful shutdown (configured)
- Monitor memory usage and restart if needed

### Database Level
- Run regular backups (Supabase handles this)
- Test backup restoration procedures
- Monitor query performance
- Optimize slow queries
- Use read replicas for reporting queries

### Infrastructure Level
- Use CDN for static assets (Vercel does this)
- Load balance API requests if scaling
- Enable auto-scaling
- Configure DDoS protection
- Set up redundancy for critical services

### Monitoring & Maintenance
- Daily monitoring of error rates
- Weekly review of performance metrics
- Monthly security reviews
- Quarterly disaster recovery drills
- Regular dependency updates (with testing)

---

## Rollback Procedure

If deployment fails:

```bash
# Revert to previous version
vercel rollback  # Frontend
railway rollback # Backend

# Or manually redeploy previous commit
git checkout [PREVIOUS_COMMIT]
npm run build
# Redeploy
```

---

## Scaling Strategy

### Phase 1: Initial Launch (0-10K users)
- Single backend instance
- Supabase standard plan
- Vercel free tier acceptable
- Monitor closely for bottlenecks

### Phase 2: Growth (10K-100K users)
- Scale backend to 2-3 instances with load balancer
- Upgrade to Supabase Pro
- Enable caching layer (Redis)
- Implement read replicas

### Phase 3: Enterprise (100K+ users)
- Multi-region backend deployment
- Database sharding by pawnshop
- CDN with edge caching
- Dedicated support and SLA

---

## Support & Troubleshooting

### Common Issues

**500 Errors on /api/dashboard/stats**
- Check database connection
- Verify RLS policies allow access
- Review Prisma schema matches database

**403 Forbidden on Supabase queries**
- RLS policies blocking queries
- User role not matching policy
- Anon key insufficient permissions

**Build failures**
- Clear `node_modules` and reinstall
- Check Node.js version compatibility
- Verify all env vars set

**Memory leaks in backend**
- Check for unclosed database connections
- Monitor with `node --inspect`
- Use heap snapshots to debug

For more help, review logs in:
- Backend: console output / process logs
- Frontend: browser console
- Database: Supabase dashboard query logs
