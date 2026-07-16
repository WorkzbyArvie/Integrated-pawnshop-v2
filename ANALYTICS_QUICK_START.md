# 🚀 Analytics & Dashboard - Quick Start

## ✅ What Was Fixed

### 1. **PlatformControl.tsx**
- ✅ Now stores `active_pawnshop_id` in localStorage
- ✅ Passes pawnshop UUID as query param: `?pawnshop=<UUID>&branch=<name>`
- ✅ Added comprehensive logging to trace execution

### 2. **Dashboard.tsx**
- ✅ Reads pawnshop UUID from: query param → localStorage → prop → null (priority order)
- ✅ Fetches branch-specific data using UUID
- ✅ Added comprehensive logging at every step

### 3. **DecisionSupport.tsx**
- ✅ Accepts all ticket statuses (ACTIVE, REDEEMED, AUCTION)
- ✅ Added comprehensive logging for filtering and transformation

---

## 🎯 How to Test

### Test 1: Open Analytics Modal
```
1. Navigate to Admin → Platform Control
2. Click "Open Analytics" on any pawnshop
3. Modal should show: Loan Portfolio, Client Count
```

**Console logs should show:**
```
[PlatformControl] enterBranchDashboard triggered
[PlatformControl] Selected shop: { id, name, ... }
```

---

### Test 2: Enter Live Dashboard
```
1. Click "Enter Live Dashboard" button
2. Page should navigate to dashboard for that specific branch
3. Stats should load and display
```

**Console logs should show:**
```
[PlatformControl] Navigating to: /dashboard?pawnshop=<UUID>...
[Dashboard] Main useEffect triggered
[Dashboard] targetUuid: <UUID>
[Dashboard] Pawnshop found: <branch-name>
[Dashboard] Total tickets fetched: <count>
[Dashboard] Dashboard loading complete
```

---

### Test 3: Verify Data Display
```
✅ Should see branch name in header
✅ Should see stats (Total Loans, Portfolio Growth, etc.)
✅ Should see customer count
✅ Charts should render if data exists
```

---

## 🔍 Debug Checklist

### If Dashboard Shows No Data:

- [ ] Open DevTools Console (F12)
- [ ] Look for log: `[Dashboard] Total tickets fetched: <count>`
  - If 0: No tickets in database OR wrong pawnshop UUID
  - If > 0: Data issue in transformation/filtering

- [ ] Look for errors:
  - `❌ [Dashboard] Pawnshop not found` → UUID mismatch
  - `❌ [Dashboard] Load Error` → RLS permission or schema issue
  - No error → Data transforms but might not display (CSS/React issue)

- [ ] Check `targetUuid`:
  - Should show the pawnshop UUID
  - If null → localStorage and query params not working

---

## 📱 Files to Monitor

While testing, keep these files open in your editor to trace changes:

1. **frontend/src/pages/admin/PlatformControl.tsx**
   - `enterBranchDashboard()` function

2. **frontend/src/components/Dashboard.tsx**
   - `getTargetUuid()` function
   - `loadDashboardData()` function

3. **frontend/src/components/DecisionSupport.tsx**
   - `fetchLiveData()` function

4. **Browser Console (F12)**
   - Filter by component name: `[PlatformControl]`, `[Dashboard]`, etc.

---

## 🎓 Understanding the Flow

```
┌─────────────────────────────────────────────────────────────┐
│ User clicks "Open Analytics" on a pawnshop card             │
│ (PlatformControl.tsx)                                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Analytics Modal opens showing:                               │
│ - Loan Portfolio amount                                      │
│ - Active Customer count                                      │
│ - "Enter Live Dashboard" button                              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ User clicks "Enter Live Dashboard"                           │
│ → enterBranchDashboard(shop) called                          │
│ → localStorage: active_pawnshop_id = shop.id               │
│ → Navigate: /dashboard?pawnshop=<UUID>&branch=<name>       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Dashboard component loads                                     │
│ → getTargetUuid() retrieves UUID from:                      │
│   1. Query param ?pawnshop=                                  │
│   2. localStorage.active_pawnshop_id                        │
│   3. prop branchId                                          │
│   4. null                                                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ loadDashboardData(targetUuid) executes:                     │
│ 1. Fetch pawnshop record                                    │
│ 2. Fetch tickets for pawnshop                              │
│ 3. Fetch customer count for pawnshop                        │
│ 4. Calculate statistics                                     │
│ 5. Render dashboard with data                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 💡 Key Points

- **UUID is CRITICAL**: If UUID is null or wrong, no data loads
- **Query params are PRIMARY**: They override localStorage and props
- **Console logging is COMPREHENSIVE**: Every step is logged with emoji prefix
- **RLS is ENFORCED**: Make sure pawnshop UUID belongs to current user

---

## 🎯 Success Indicators

When working correctly, you'll see:

1. ✅ Pawnshop card shows "Open Analytics" button
2. ✅ Modal opens with correct stats
3. ✅ "Enter Live Dashboard" navigates to `/dashboard?pawnshop=...`
4. ✅ Dashboard loads with branch name
5. ✅ Stats cards show values > 0
6. ✅ Console shows NO errors (only info/log messages)

---

## 🚨 Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| "No Neural Data Found" | No tickets in branch | Add test tickets to branch |
| Dashboard blank | UUID is null | Check query params in URL |
| "Permission Denied" | RLS blocking access | Check database RLS policies |
| 0 customers | No customers linked | Check customer.pawnshop_id |
| Wrong branch loads | UUID mismatch | Verify UUID in query params |

---

## 📞 Support Log Location

Full debugging guide: `ANALYTICS_DEBUGGING_GUIDE.md`

All console messages follow format: `[ComponentName] Message description`

Filter console by component name to isolate issues!
