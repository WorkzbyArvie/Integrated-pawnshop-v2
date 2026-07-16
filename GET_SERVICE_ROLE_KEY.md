# 🔑 Get Fresh Service Role Key from Supabase (2 Minutes)

Your current service role key is **EXPIRED or INVALID**.

## Quick Steps

### 1️⃣ Open Supabase Dashboard
```
https://app.supabase.com/projects
```

### 2️⃣ Select Your Project
Look for project with these details:
- **Project ID**: `bxayczllpdhrvutubzbg`
- **URL**: `https://bxayczllpdhrvutubzbg.supabase.co`

### 3️⃣ Navigate to API Keys
```
Settings (gear icon) → API → Project API keys
```

### 4️⃣ Find Service Role Key
You'll see several keys:
- ❌ `ANON_PUBLIC` - Don't use (read-only)
- ❌ `JWT_SECRET` - Don't use (internal)
- ✅ `service_role secret` - THIS ONE! Copy it

**Look for the label that says "Service Role" or similar**

### 5️⃣ Copy the Key
- Click the copy icon next to the service role secret
- It will be a long JWT token starting with `eyJ...`

### 6️⃣ Update backend/.env
Open file: `backend/.env`

Find this line:
```dotenv
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1...
```

Replace with your new key:
```dotenv
SUPABASE_SERVICE_ROLE_KEY=YOUR_NEW_KEY_PASTED_HERE
```

### 7️⃣ Restart Backend
```bash
# Stop the running backend (Ctrl+C)
# Then restart:
npm run start:dev
```

### 8️⃣ Test Admin Creation
1. Open frontend: http://localhost:5173
2. Click "Add Branch Admin"
3. Fill email and password
4. Click submit
5. Should work now! ✅

---

## ✅ Verification

After restarting, look for these logs in backend terminal:

```
📝 [Bootstrap] Service Role Key: ✓ Set
✅ [AppService] Initializing Supabase admin client
   URL: https://bxayczllpdhrvutubzbg.supabase.co
   Service Role Key: eyJhbGc...shc
```

If you see **"✓ Set"**, you're good! 🎉

---

## 📸 Visual Guide

```
Supabase Dashboard
    ↓
Settings (gear) → API
    ↓
Under "Project API keys" you'll see:
┌─────────────────────────┐
│ Key          │ Value    │
├─────────────────────────┤
│ ANON_PUBLIC  │ eyJ...   │ ← NOT THIS
├─────────────────────────┤
│ service_role │ eyJ...   │ ← COPY THIS! ✓
│   secret     │  [copy]  │
├─────────────────────────┤
│ JWT_SECRET   │ ****     │ ← NOT THIS
└─────────────────────────┘
```

---

## ⚠️ Important Security Notes

- 🔒 **Never share this key** - It has admin privileges
- 🚫 **Never commit to Git** - Keep in `.env` only
- 🔄 **Can be regenerated** - If accidentally exposed, get a new one
- 🛡️ **Backend only** - Never send this to frontend

---

## 🆘 Can't Find It?

If you can't see the service role key:

1. **Make sure you're in the right place**
   - Settings → API (not other sections)

2. **Check your account permissions**
   - You need admin access to the project

3. **Try the direct URL**
   ```
   https://app.supabase.com/project/bxayczllpdhrvutubzbg/settings/api
   ```

4. **Regenerate if missing**
   - There should be a "regenerate" option
   - Click it to create a new key

---

## ✨ Done!

Once you have the new key in `backend/.env` and the backend is restarted, admin creation should work! 🚀

Any issues? Check the backend logs with `npm run start:dev`
