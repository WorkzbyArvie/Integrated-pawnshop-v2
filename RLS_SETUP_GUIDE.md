# Access Denied Fix - RLS Configuration Guide

## Problem Summary
Your app was showing "PERMISSION DENIED" and "ACCESS DENIED" errors because:
1. Your Supabase tables have RLS (Row Level Security) enabled
2. But the RLS policies were **missing or too restrictive**
3. The `profiles` table may have needed data fixes for role assignment

## Solution Overview

### Step 1: Fix the Database Data (RLS Prerequisite)
Run the SQL in `DATA_FIXES.sql` to ensure:
- ✅ Super Admin user has `role = 'SUPER_ADMIN'` and `pawnshop_id = NULL`
- ✅ Branch Admin users have `role = 'BRANCH_ADMIN'` and `pawnshop_id = (their assigned pawnshop UUID)`
- ✅ Staff users have `role = 'STAFF'` and `pawnshop_id = (their assigned pawnshop UUID)`

### Step 2: Create RLS Policies
Run the SQL in `RLS_POLICIES.sql` to create policies that:
- ✅ Allow **Super Admin** to query **ALL** pawnshops, customers, tickets, loans, etc.
- ✅ Allow **Branch Admin** to query only **their assigned pawnshop's data**
- ✅ Isolate data by `pawnshop_id` on all transactional tables

## How to Apply These Fixes

### Method 1: Using Supabase Dashboard (Easiest)
1. Open Supabase Dashboard → Go to your project
2. Navigate to **Database** → **SQL Editor**
3. Click **New Query**
4. Copy and paste the contents of `DATA_FIXES.sql`
5. Click **Run** button (▶️)
6. Verify the output shows your profiles with correct roles and pawnshop_ids
7. Repeat steps 3-5 with `RLS_POLICIES.sql`

### Method 2: Using psql (Command Line)
```bash
psql -U postgres -h your-db-host -d postgres < DATA_FIXES.sql
psql -U postgres -h your-db-host -d postgres < RLS_POLICIES.sql
```

## After Applying the Fixes

### Test with Your App
1. **Log in as Super Admin** (superadmin@pawngold.com)
   - Should see ALL pawnshops
   - Should see Platform Control page working
   - Should see live dashboard with data from all branches

2. **Log in as Branch Admin** (arviesamala2005@gmail.com)
   - Should see ONLY their assigned pawnshop
   - Should see the live dashboard with their pawnshop's data
   - Should be able to create customers, tickets, loans, etc.

### Expected Results
- ❌ "PERMISSION DENIED" errors → ✅ Fixed
- ❌ "ACCESS DENIED" on Platform Control → ✅ Fixed
- ❌ Dashboard showing empty data → ✅ Fixed (will show data for assigned pawnshop)

## RLS Policy Logic Explained

### For PAWNSHOPS table:
```sql
-- Super Admin sees all pawnshops
WHERE role = 'SUPER_ADMIN'

-- Branch Admin sees only their assigned pawnshop
WHERE pawnshop_id = their_pawnshop_id
```

### For CUSTOMER, TICKET, LOAN, INVENTORY tables:
```sql
-- Super Admin sees all records
WHERE role = 'SUPER_ADMIN'

-- Branch Admin sees only records in their pawnshop
WHERE pawnshop_id = their_pawnshop_id
```

## Troubleshooting

### If you still get "PERMISSION DENIED":
1. Check that the policies were created (look in Supabase Dashboard → Database → Policies)
2. Verify that `profiles` table has correct roles and pawnshop_ids
3. Make sure you logged out and back in (JWT needs to be refreshed)

### If you see data from other pawnshops:
1. The RLS policies may not have been applied to that table
2. Run `RLS_POLICIES.sql` again, focusing on the relevant table

### If Super Admin still can't see all data:
1. Check that the user's role in `profiles` is exactly `'SUPER_ADMIN'` (case-sensitive)
2. Verify pawnshop_id is NULL (not a value)

## Important: Role Enum Values

Your Prisma schema defines these roles:
```typescript
enum Role {
  SUPER_ADMIN
  BRANCH_ADMIN
  STAFF
}
```

These must match exactly in the `profiles.role` field (case-sensitive):
- ✅ `SUPER_ADMIN`
- ✅ `BRANCH_ADMIN`
- ✅ `STAFF`

Not ❌ `Super Admin`, ❌ `superadmin`, ❌ `admin`, etc.

## Files Created
- `RLS_POLICIES.sql` - RLS policy creation script
- `DATA_FIXES.sql` - Profile data fixes
- `RLS_SETUP_GUIDE.md` - This file

## Next Steps After RLS is Fixed

1. ✅ Test login for all user types
2. ✅ Test dashboard data loading
3. ✅ Test Platform Control delete functionality
4. ✅ Test SalesPos transaction creation
5. Consider implementing additional security:
   - Column-level security for sensitive fields (e.g., interest_rate)
   - Audit logs via `activity_log` table
   - Time-based access restrictions if needed
