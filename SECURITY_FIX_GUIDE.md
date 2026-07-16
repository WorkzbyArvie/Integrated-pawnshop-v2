# 🔒 SECURITY FIX: RLS & Password Protection

## Critical Issues Detected

- **17 tables with RLS disabled** — data is publicly readable
- **Password protection disabled** — weak authentication
- **Risk level**: CRITICAL — Production data exposed

---

## Fix #1: Enable RLS on All Tables

### Step 1: Copy & Run the SQL Script

1. Go to **Supabase Dashboard** → **SQL Editor**
2. Create new query
3. Copy entire content from: `SECURITY_FIX_RLS_COMPLETE.sql`
4. Click **Run**
5. Wait for all statements to complete ✓

### Step 2: Verify RLS is Enabled

In SQL Editor, run:
```sql
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;
```

**Expected output**: All rows should have `rowsecurity = true`

If any show `false`, RLS is still disabled — scroll up and check for errors.

### Step 3: Check Policies in UI

1. Go to **SQL Editor** → **Database** → Each table
2. Click **Auth** tab
3. Verify each table has **Policies** listed (not empty)

Missing policies = RLS enforcing DENY ALL (correct but restrictive)

---

## Fix #2: Enable Password Protection

### The Issue

Supabase detected "Leaked password protection is disabled" — this prevents weak/reused passwords.

### The Fix

1. Go to **Supabase Dashboard** → **Authentication**
2. Click **Providers** (left sidebar)
3. Click **Email** provider
4. Under "Email provider settings", check:
   - ✓ **Require email confirmation** (or enable similar)
   - ✓ **Require MFA** (recommended for admins)
5. Scroll down → **Save**

**Note**: This is UI-only, not a database setting.

---

## Security Architecture

### Access Patterns

```
SUPER_ADMIN/OWNER
  └─ Can see all pawnshops & all data

MANAGER/ADMIN/BRANCH_ADMIN
  └─ Can see/manage only their pawnshop's data

STAFF
  └─ Can see limited data (their branch only)

ANONYMOUS (not authenticated)
  └─ Can only see LIVE auction listings
```

### Table Isolation

| Table | Isolation Method | Super Admin | Branch Admin | Staff |
|-------|-----------------|-------------|-------------|-------|
| profiles | Direct user check | All profiles | Own profile + pawnshop | Own only |
| pawnshops | Direct ID check | All | Own only | None |
| customer | pawnshop_id | All | Own pawnshop | Own pawnshop |
| ticket | pawnshop_id | All | Own pawnshop | Own pawnshop |
| inventory | Via ticket.pawnshop_id | All | Own pawnshop | Own pawnshop |
| staff | Via branch.pawnshop_id | All | Own pawnshop | Own branch |
| auction_listings | pawnshop_id + status | LIVE + own | All + own | LIVE only |

---

## Testing RLS

### Test 1: Super Admin Access

```typescript
// Should work — super admin sees all
const { data } = await supabase
  .from('pawnshops')
  .select('*');
// Returns all pawnshops ✓
```

### Test 2: Branch Admin Isolation

```typescript
// Should return only their pawnshop
const { data } = await supabase
  .from('customer')
  .select('*');
// Returns only customers in their pawnshop ✓
```

### Test 3: Data Leakage Prevention

```typescript
// Should fail — trying to access another pawnshop
const { data, error } = await supabase
  .from('customer')
  .select('*')
  .eq('pawnshop_id', 'OTHER-PAWNSHOP-ID');
// Returns [] or permission error ✓
```

### Test 4: Anonymous Access

```typescript
// Should work — can see live auctions
const { data } = await supabase
  .from('auction_listings')
  .select('*')
  .eq('status', 'LIVE');
// Returns live listings only ✓
```

---

## Verification Checklist

- [ ] SQL script executed without errors
- [ ] All 17 tables show `rowsecurity = true`
- [ ] Each table has policies in Auth tab
- [ ] Email confirmation enabled in Auth Providers
- [ ] Tested super admin access → ✓ sees all
- [ ] Tested branch admin isolation → ✓ sees own data only
- [ ] Tested anonymous access → ✓ sees public data only
- [ ] No data leakage between pawnshops

---

## Common Issues & Fixes

### Problem: "permission denied" on all queries

**Cause**: RLS policies too strict or malformed

**Fix**: 
1. Check `RLS_SECURITY_TESTS.sql` for policy verification
2. Review policies in Supabase UI
3. Ensure `profiles` table has correct `role` and `pawnshop_id` values

### Problem: Admin can't see staff

**Cause**: Staff table has no branch relationship or incorrect join

**Fix**:
1. Verify `staff.branch_id` links to `branch.id`
2. Verify `branch.pawnshop_id` exists
3. Re-run staff policy (lines ~380 in RLS script)

### Problem: Customers visible between pawnshops

**Cause**: RLS not actually enforced (didn't run SQL or syntax error)

**Fix**:
1. Re-run `SECURITY_FIX_RLS_COMPLETE.sql`
2. Check Supabase error messages
3. Verify policies in UI match expected names

---

## Ongoing Maintenance

### Monthly Security Audit

1. Check Supabase Security Advisor (top-right menu)
2. Verify no new RLS warnings
3. Review audit logs for unauthorized access attempts

### When Adding New Tables

1. **Always enable RLS**: `ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;`
2. **Add policies** matching pawnshop isolation pattern
3. **Test** with multi-pawnshop user
4. **Document** access rules

### When Adding New Roles

Update all policies with new role. Example:
```sql
-- OLD
WHERE role IN ('SUPER_ADMIN', 'OWNER', 'ADMIN')

-- NEW (if adding AUDITOR role)
WHERE role IN ('SUPER_ADMIN', 'OWNER', 'ADMIN', 'AUDITOR')
```

---

## Reference Files

- **SQL Script**: `SECURITY_FIX_RLS_COMPLETE.sql` → Run this in Supabase
- **Tests**: `RLS_SECURITY_TESTS.sql` → Verify policies work
- **Original Policies**: `RLS_POLICIES.sql` → Reference only

---

## Next Steps

1. **Execute immediately**: Run the RLS SQL script
2. **Enable password protection**: 5-minute UI update
3. **Test thoroughly**: Use test user in each role
4. **Document**: Mark this fixed in production checklist
5. **Monitor**: Check Security Advisor weekly

**After completion, all 17 errors should resolve ✓**

---

## Support

If issues persist:
1. Check Supabase logs: Dashboard → Logs
2. Verify `auth.uid()` is being set correctly
3. Ensure JWT claims include `role` field
4. Test with raw SQL first (see `RLS_SECURITY_TESTS.sql`)

---

**Status**: CRITICAL FIX
**Estimated time**: 15 minutes
**Risk if not fixed**: Complete data exposure
