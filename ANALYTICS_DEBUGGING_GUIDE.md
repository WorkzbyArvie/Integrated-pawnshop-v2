# Analytics & Dashboard Debugging Guide

## 🎯 Flow: PlatformControl → Dashboard

### 1. **PlatformControl.tsx** - Branch Selection
When user clicks "Enter Live Dashboard":

```log
🎯 [PlatformControl] enterBranchDashboard triggered
🏢 [PlatformControl] Selected shop: { id, name, owner_email }
💾 [PlatformControl] Stored active_pawnshop_id: <UUID>
💾 [PlatformControl] Stored app context: SHOP perspective, BRANCH ADMIN role
🚀 [PlatformControl] Navigating to: /dashboard?pawnshop=<UUID>&branch=<name>
```

**What happens:**
- Pawnshop UUID stored in `localStorage.active_pawnshop_id`
- Query params passed: `?pawnshop=<UUID>&branch=<name>`
- Hard navigation to `/dashboard`

---

### 2. **Dashboard.tsx** - Initialization
When dashboard loads:

```log
🎬 [Dashboard] Main useEffect triggered
🏢 [Dashboard] targetUuid: <UUID>
🔍 [Dashboard] Using pawnshop from query param: <UUID>
```

**UUID Priority (in order):**
1. Query parameter `?pawnshop=<UUID>`
2. localStorage `active_pawnshop_id`
3. Prop `branchId`
4. null (default)

---

### 3. **Dashboard.tsx** - Data Fetching
Once UUID is determined:

```log
🔄 [Dashboard] loadDashboardData called
🏢 [Dashboard] targetUuid: <UUID>
🔍 [Dashboard] Fetching pawnshop data for UUID: <UUID>
📊 [Dashboard] Pawnshop query result: { shopData, shopError }
✅ [Dashboard] Pawnshop found: <branch-name>
📡 [Dashboard] Fetching tickets and customer count...
📊 [Dashboard] Query responses: { ticketsCount, customerCount, errors }
📊 [Dashboard] Total tickets fetched: <count>
🔄 [Dashboard] Processing tickets...
📊 [Dashboard] Stats calculation: { totalTickets, activeTickets, totalPrincipal, ... }
📈 [Dashboard] Category breakdown: { Gold: 3, Silver: 1, ... }
✅ [Dashboard] Final stats calculated: {...}
✅ [Dashboard] Dashboard loading complete
```

---

## 🔍 Common Issues & Solutions

### ❌ "No Neural Data Found" / No Data Displaying

**Check Console Logs:**

1. **PlatformControl logs missing?**
   - User didn't click "Enter Live Dashboard"
   - Check if analytics modal opens

2. **Dashboard logs show `targetUuid: null`?**
   - Query params weren't passed
   - localStorage `active_pawnshop_id` is empty
   - → Solution: Ensure `PlatformControl.enterBranchDashboard` runs

3. **Pawnshop query returns null?**
   ```log
   ❌ [Dashboard] Pawnshop not found for UUID: <UUID>
   ```
   - Wrong UUID format
   - Pawnshop doesn't exist in database
   - RLS policy blocking access
   - → Check: `SELECT * FROM pawnshops WHERE id = '<UUID>'`

4. **Tickets query returns 0?**
   ```log
   📊 [Dashboard] Total tickets fetched: 0
   ```
   - No tickets assigned to this pawnshop
   - Wrong pawnshop UUID being used
   - RLS policy filtering tickets
   - → Check: `SELECT COUNT(*) FROM ticket WHERE pawnshop_id = '<UUID>'`

5. **Error in catch block?**
   ```log
   ❌ [Dashboard] Load Error: <error message>
   ❌ [Dashboard] Error details: { message, code, details }
   ```
   - If `code: 42501` → RLS permission denied
   - If schema error → Check field names (pawn_date, loan_amount, etc.)

---

## 🛠️ Testing Checklist

### Step 1: Open PlatformControl
- [ ] Go to "Admin" → "Platform Control"
- [ ] See list of pawnshops
- [ ] Click "Open Analytics" on a pawnshop

### Step 2: Verify Analytics Modal
- [ ] Modal shows pawnshop name and stats
- [ ] Loan Portfolio & Client Count display
- [ ] "Enter Live Dashboard" button visible

### Step 3: Click "Enter Live Dashboard"
- [ ] Check **Console** for PlatformControl logs
- [ ] Verify: `💾 [PlatformControl] Stored active_pawnshop_id: <UUID>`
- [ ] Should see navigation log: `🚀 [PlatformControl] Navigating to: /dashboard?pawnshop=<UUID>`

### Step 4: Dashboard Loads
- [ ] Check **Console** for Dashboard logs
- [ ] Verify: `🎬 [Dashboard] Main useEffect triggered`
- [ ] Check: `🏢 [Dashboard] targetUuid: <UUID>`
- [ ] Look for: `✅ [Dashboard] Pawnshop found: <branch-name>`
- [ ] Should see: `📊 [Dashboard] Total tickets fetched: <count>`

### Step 5: Data Displays
- [ ] Stats cards show values (not 0)
- [ ] Charts render with data
- [ ] Branch name displays correctly

---

## 📋 Console Filter Guide

**Copy-paste into Console to filter specific components:**

```javascript
// Show only PlatformControl logs
console.log('%c Filtering logs...', 'color: blue');
// Then in Console, use Filter: [PlatformControl]

// Show only Dashboard logs
// Then in Console, use Filter: [Dashboard]

// Show only DecisionSupport logs
// Then in Console, use Filter: [DecisionSupport]
```

---

## 🔗 Key Files Modified

1. **PlatformControl.tsx**
   - `enterBranchDashboard()` - stores UUID in localStorage + query params
   - Added comprehensive logging

2. **Dashboard.tsx**
   - `getTargetUuid()` - reads UUID from query params, localStorage, or props
   - `loadDashboardData()` - fetches branch-scoped data
   - Added comprehensive logging at every step

3. **DecisionSupport.tsx**
   - `fetchLiveData()` - filters and transforms ticket data
   - Added comprehensive logging

---

## 📊 Expected Console Output

**Successful flow:**
```
🎯 [PlatformControl] enterBranchDashboard triggered
🏢 [PlatformControl] Selected shop: { id: 'abc123...', name: 'JARO PAWNSHOP', ... }
💾 [PlatformControl] Stored active_pawnshop_id: abc123...
🚀 [PlatformControl] Navigating to: /dashboard?pawnshop=abc123...&branch=JARO%20PAWNSHOP

[Page loads...]

🎬 [Dashboard] Main useEffect triggered
🏢 [Dashboard] targetUuid: abc123...
🔍 [Dashboard] Using pawnshop from query param: abc123...
🔍 [Dashboard] Fetching pawnshop data for UUID: abc123...
📊 [Dashboard] Pawnshop query result: { shopData: { id, name, status }, shopError: null }
✅ [Dashboard] Pawnshop found: JARO PAWNSHOP
📌 [Dashboard] Active branch name set to: JARO PAWNSHOP
📡 [Dashboard] Fetching tickets and customer count...
✅ [Dashboard] Query responses: { ticketsCount: 5, customerCount: 12, errors: null }
📊 [Dashboard] Total tickets fetched: 5
🔄 [Dashboard] Processing 5 tickets...
📊 [Dashboard] Stats calculation: { totalLoans: 250000, activeTickets: 4, customerCount: 12 }
📈 [Dashboard] Category breakdown: { Gold: 3, Silver: 2 }
✅ [Dashboard] Final stats calculated: { ... }
✅ [Dashboard] Dashboard loading complete
```

---

## 🚨 Error Scenarios

### Scenario 1: "Permission Denied: Pawnshop Access Restricted"
**Cause:** RLS policy blocking SELECT on pawnshops table
**Fix:** Check RLS policies in Supabase:
```sql
SELECT * FROM pg_policies WHERE tablename = 'pawnshops';
```

### Scenario 2: "Pawnshop not found"
**Cause:** UUID doesn't exist in database
**Debug:** In Supabase SQL Editor:
```sql
SELECT id, name FROM pawnshops WHERE id = '<UUID from console>';
```

### Scenario 3: Dashboard shows 0 data
**Cause:** Tickets exist but pawnshop_id mismatch
**Debug:** In Supabase SQL Editor:
```sql
SELECT COUNT(*) as ticket_count, pawnshop_id 
FROM ticket 
WHERE pawnshop_id = '<UUID>' 
GROUP BY pawnshop_id;
```

---

## ✅ All Systems Working Sign

When everything works, you should see:
- ✅ PlatformControl logs showing UUID storage
- ✅ Dashboard logs showing UUID retrieval
- ✅ Pawnshop name loads correctly
- ✅ Ticket count > 0
- ✅ Stats cards display numbers
- ✅ Charts render data
- ✅ No errors in console (only info/log messages)
