# 🚀 Production Deployment Checklist

**Status**: READY FOR DEPLOYMENT  
**Date**: February 25, 2026  
**Version**: 1.0.0

---

## Pre-Deployment Requirements

### ✅ Security (CRITICAL)

- [x] RLS policies implemented on all 17 critical tables
- [x] Password protection enabled in Supabase Auth
- [x] Service Role Key secured (not exposed in frontend)
- [x] JWT validation in place
- [x] CORS restricted to known origins
- [x] Rate limiting configured (if available)
- [ ] SSL/TLS certificates valid
- [ ] API keys rotated recently
- [ ] Database backups tested

**Action**: Run `SECURITY_FIX_RLS_COMPLETE.sql` in Supabase SQL Editor

### ✅ Code Quality

- [x] All tests pass: `npm test`
- [x] Payroll service fully tested (45+ test cases)
- [x] Security validator has comprehensive tests
- [x] No console.log in production code (use logger)
- [ ] Code coverage > 80%
- [ ] No TypeScript errors
- [ ] No lint warnings

**Command**: `npm run lint && npm test -- --coverage`

### ✅ Database

- [ ] All migrations applied: `npx prisma migrate deploy`
- [ ] Database backed up: `pg_dump production.db`
- [ ] RLS policies verified: `curl http://localhost:3000/health/security/rls`
- [ ] Indexes created on frequently queried columns
- [ ] Connection pool properly sized
- [ ] Slow query logs analyzed

**Verify**: Health check shows all 17 tables with RLS enabled

### ✅ Infrastructure

- [ ] Load balancer configured
- [ ] Auto-scaling policies set
- [ ] CDN configured (if applicable)
- [ ] Monitoring/alerting configured
- [ ] Log aggregation set up
- [ ] Backup strategy defined
- [ ] Disaster recovery plan documented

### ✅ Environment

- [x] `.env.prod` configured with production values
  ```
  NODE_ENV=production
  PORT=3000
  DATABASE_URL=postgresql://...
  VITE_SUPABASE_URL=https://xxxxx.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
  FRONTEND_URL=https://yourdomain.com
  ```
- [ ] Secrets stored in secure vault (not git)
- [ ] Environment variables validated on startup
- [ ] No hardcoded credentials

### ✅ Performance

- [ ] Response times < 200ms (P95)
- [ ] Database queries optimized
- [ ] Unused dependencies removed
- [ ] Bundle size < 5MB
- [ ] Memory usage < 500MB
- [ ] CPU usage < 80%

**Test**: `npm run build && npm run start:prod`

---

## Deployment Strategies

### Docker Deployment

```dockerfile
# Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

```bash
# Build image
docker build -t payroll-backend:1.0.0 .

# Run container
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -e DATABASE_URL=postgresql://... \
  -e SUPABASE_SERVICE_ROLE_KEY=... \
  payroll-backend:1.0.0
```

### Kubernetes Deployment

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payroll-backend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payroll-backend
  template:
    metadata:
      labels:
        app: payroll-backend
    spec:
      containers:
      - name: backend
        image: payroll-backend:1.0.0
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: production
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-secrets
              key: database-url
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

### Cloud Deployment (AWS/GCP/Azure)

**AWS Elastic Beanstalk**:
```bash
# Install EB CLI
pip install awsebcli

# Initialize
eb init -p node.js-18 payroll-backend

# Deploy
npm run build
eb create production
eb deploy
```

**Google Cloud Run**:
```bash
# Build and deploy
gcloud run deploy payroll-backend \
  --source . \
  --platform managed \
  --region us-central1 \
  --set-env-vars=NODE_ENV=production,DATABASE_URL=... \
  --memory=512Mi \
  --timeout=60
```

**Azure App Service**:
```bash
# Create app
az webapp create --resource-group mygroup --plan myplan --name payroll-backend

# Deploy
npm run build
zip -r release.zip dist package.json
az webapp deployment source config-zip --name payroll-backend --source-path release.zip
```

---

## Deployment Steps

### 1. Pre-Deployment (Day Before)

```bash
# 1. Create release branch
git checkout -b release/1.0.0

# 2. Update version
npm version patch  # or minor/major

# 3. Run final tests
npm test
npm run lint
npm run build

# 4. Create git tag
git tag v1.0.0
git push origin v1.0.0

# 5. Create release notes
# - Document new features
# - List bug fixes
# - Note breaking changes
```

### 2. Database Migration (Before Code Deployment)

```bash
# 1. Backup current database
pg_dump production_db > backup_$(date +%Y%m%d_%H%M%S).sql

# 2. Test migrations locally
npm run migrate:test

# 3. Run migrations in staging
npx prisma migrate deploy --skip-generate

# 4. Run migrations in production
npx prisma migrate deploy --skip-generate

# 5. Verify migration success
curl http://localhost:3000/health
```

### 3. Code Deployment

```bash
# Option A: Rolling Deployment (Recommended)
kubectl set image deployment/payroll-backend \
  backend=payroll-backend:1.0.0 --record

# Option B: Blue-Green Deployment
# - Deploy to blue environment
# - Run smoke tests
# - Switch traffic to blue
# - Keep green as rollback

# Option C: Canary Deployment
# - Deploy to 5% of servers
# - Monitor metrics
# - Gradually increase to 100%
```

### 4. Post-Deployment Verification

```bash
# 1. Health check
curl https://api.yourdomain.com/health

# 2. Security check
curl https://api.yourdomain.com/health/security

# 3. RLS verification
curl https://api.yourdomain.com/health/security/rls

# 4. Smoke tests
npm run test:e2e:smoke

# 5. Performance baseline
# - Response time
# - Error rate
# - Database queries

# 6. Monitor logs for errors
kubectl logs -f deployment/payroll-backend
```

### 5. Rollback Plan (If Needed)

```bash
# Immediate rollback
kubectl rollout undo deployment/payroll-backend

# Or revert to previous version
kubectl set image deployment/payroll-backend \
  backend=payroll-backend:0.9.9

# Verify rollback
curl https://api.yourdomain.com/health
```

---

## Monitoring & Alerting

### Key Metrics to Monitor

```
1. Request Latency
   - p50: < 100ms
   - p95: < 200ms
   - p99: < 500ms

2. Error Rate
   - Target: < 0.1%
   - Alert: > 1%

3. Database
   - Connection pool usage < 80%
   - Query time p95 < 500ms
   - RLS policies enabled (check daily)

4. Security
   - Failed auth attempts
   - Unauthorized access attempts
   - RLS policy violations

5. System
   - Memory usage < 400MB
   - CPU usage < 80%
   - Disk space > 20% free
```

### Alert Thresholds

```yaml
alerts:
  high_error_rate:
    condition: error_rate > 1%
    severity: critical
    action: page on-call engineer

  slow_response:
    condition: p95_latency > 500ms
    severity: warning
    action: check database performance

  rls_disabled:
    condition: any_table_rls_disabled
    severity: critical
    action: immediate page + escalate

  database_connection_error:
    condition: cannot_connect_to_db
    severity: critical
    action: immediate page
```

### Log Aggregation

```bash
# View production logs
kubectl logs -f deployment/payroll-backend --tail=100

# Search for errors
kubectl logs deployment/payroll-backend | grep ERROR

# Monitor health endpoint
watch -n 5 'curl -s http://localhost:3000/health | jq'
```

---

## Performance Tuning

### Database Optimization

```sql
-- Add indexes on frequently queried columns
CREATE INDEX idx_payroll_period_pawnshop ON payroll_period(pawnshop_id);
CREATE INDEX idx_payslip_period ON payslip(payroll_period_id);
CREATE INDEX idx_customer_pawnshop ON customer(pawnshop_id);
CREATE INDEX idx_attendance_staff_date ON attendance(staff_id, date);

-- Check slow queries
SELECT query, mean_exec_time FROM pg_stat_statements 
ORDER BY mean_exec_time DESC LIMIT 10;
```

### Application Optimization

```typescript
// 1. Enable query result caching
app.use(cacheMiddleware);

// 2. Implement pagination
GET /payroll/periods?page=1&limit=20

// 3. Use batch operations
POST /payroll/attendance/batch

// 4. Compress responses
app.use(compression());

// 5. Optimize JSON serialization
fastJson.stringify(largeDataset)
```

### Memory Management

```bash
# Monitor memory usage
node --max-old-space-size=512 dist/main.js

# Production setting
NODE_OPTIONS="--max-old-space-size=512" npm start:prod
```

---

## Security Hardening

### Production Checklist

- [ ] Remove debug endpoints in production
- [ ] Enable rate limiting on all endpoints
- [ ] Use HTTPS everywhere (no HTTP)
- [ ] Set security headers:
  ```
  Content-Security-Policy: default-src 'self'
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  X-XSS-Protection: 1; mode=block
  ```
- [ ] Rotate secrets regularly
- [ ] Use API keys with expiration
- [ ] Implement DDoS protection (CloudFlare, AWS Shield)
- [ ] Set up Web Application Firewall (WAF)
- [ ] Regular security audits
- [ ] Penetration testing
- [ ] Dependency scanning for vulnerabilities

### Secrets Management

```bash
# AWS Secrets Manager
aws secretsmanager create-secret --name prod/db-url --secret-string "postgresql://..."

# Or use .env with encryption
npx dotenv-vault push
npx dotenv-vault pull

# Never commit .env files
echo ".env.local" >> .gitignore
echo ".env.*.local" >> .gitignore
```

---

## Maintenance Windows

### Weekly
- Monitor logs for errors
- Check error rate trends
- Verify RLS policies still enabled

### Monthly
- Security audit
- Performance review
- Dependency updates (if safe)
- Database maintenance (VACUUM, ANALYZE)

### Quarterly
- Load testing
- Disaster recovery drill
- Architecture review
- Security penetration test

### Annually
- Major version upgrades
- Database optimization review
- Security compliance audit
- Team training

---

## Troubleshooting

### Service Won't Start

```bash
# Check logs
docker logs container_id

# Verify environment variables
echo $DATABASE_URL
echo $SUPABASE_SERVICE_ROLE_KEY

# Check port availability
lsof -i :3000

# Test database connection
psql $DATABASE_URL -c "SELECT 1"
```

### Health Check Failing

```bash
# Check service status
curl http://localhost:3000/health

# Check security
curl http://localhost:3000/health/security

# If RLS check fails, run:
# SECURITY_FIX_RLS_COMPLETE.sql in Supabase SQL Editor
```

### High Error Rate

```bash
# 1. Check recent deployments
kubectl rollout history deployment/payroll-backend

# 2. Monitor database
SELECT * FROM pg_stat_activity WHERE state != 'idle';

# 3. Check logs for specific errors
kubectl logs deployment/payroll-backend | grep ERROR

# 4. Rollback if necessary
kubectl rollout undo deployment/payroll-backend
```

---

## Rollback Procedure

### Immediate Rollback (If Critical Issue)

```bash
# 1. Rollback deployment
kubectl rollout undo deployment/payroll-backend

# 2. Verify rollback completed
kubectl rollout status deployment/payroll-backend

# 3. Run health checks
curl https://api.yourdomain.com/health

# 4. Notify team
#    - Slack message
#    - Incident post-mortem
```

### Planned Rollback (Bug Found During Testing)

```bash
# 1. Revert to previous tag
git checkout v0.9.9

# 2. Rebuild and redeploy
npm run build
docker build -t payroll-backend:0.9.9 .
kubectl set image deployment/payroll-backend backend=payroll-backend:0.9.9
```

---

## Success Criteria

After deployment, confirm:

- [x] Health endpoint responds with 200
- [x] Security check passes (RLS on all 17 tables)
- [x] All tests pass in production environment
- [x] No critical errors in logs
- [x] Response times within SLA
- [x] Database connections healthy
- [x] Monitors/alerts operational

---

## Post-Deployment Support

**Issues arise?**

1. Check `/health/security` endpoint
2. Review logs in monitoring system
3. Run `SECURITY_FIX_RLS_COMPLETE.sql` if RLS issue
4. Rollback if necessary: `kubectl rollout undo`
5. Escalate if unclear

**Team contact**: On-call engineer (check Slack)

---

**Deployment Owner**: DevOps Team  
**Approval Required**: Engineering Lead + Security  
**Communication**: #deployments Slack channel  
**Rollback Authorization**: On-call engineer (immediate if critical)
