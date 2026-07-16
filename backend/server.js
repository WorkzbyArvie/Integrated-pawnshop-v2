const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

// 1. Enhanced CORS for both dev and production
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? (process.env.FRONTEND_URL?.split(',') || ['https://pawngold.com'])
    : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'pawnshop-id', 'branch-id', 'user-id'],
  credentials: true,
  maxAge: 86400
};
app.use(cors(corsOptions));

app.use(express.json({ limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// 2. Connection Pool (Sydney Region)
const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20, 
  idleTimeoutMillis: 30000, 
  connectionTimeoutMillis: 5000,
  keepAlive: true, 
});

// --- DASHBOARD ROUTE ---
// Fixes: Accurate counts for Vault, Redeemed, and Auction cards
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const [loanResult, invResult, statusCountsResult] = await Promise.all([
      pool.query('SELECT SUM("loanAmount")::float as total FROM "Ticket" WHERE "status"::text = \'ACTIVE\''),
      pool.query(`
        SELECT category as name, COUNT(*)::int as count 
        FROM "Ticket" 
        WHERE "status"::text = 'ACTIVE'
        GROUP BY category
      `),
      pool.query('SELECT status::text, COUNT(*)::int FROM "Ticket" GROUP BY status')
    ]);

    const stats = statusCountsResult.rows;
    const totalLoans = (loanResult.rows[0] && loanResult.rows[0].total) || 0;

    res.json({
      totalLoans: totalLoans,
      totalInterest: totalLoans * 0.035,
      portfolioGrowth: 12.5,
      // Map database UPPERCASE statuses to the specific frontend labels
      activeTickets: stats.find(s => s.status === 'ACTIVE')?.count || 0,
      redeemedTickets: stats.find(s => s.status === 'REDEEMED')?.count || 0,
      auctionTickets: stats.find(s => s.status === 'AUCTION')?.count || 0,
      staffOnDuty: 5,
      efficiency: 94,
      inventorySummary: invResult.rows.map(row => ({
        name: row.name,
        count: row.count,
        color: row.name.toLowerCase().includes('gold') ? '#facc15' : 
               row.name.toLowerCase().includes('silver') ? '#94a3b8' : '#6366f1'
      }))
    });
  } catch (err) {
    console.error("Dashboard Error:", err.message);
    res.json({ totalLoans: 0, activeTickets: 0, inventorySummary: [] });
  }
});

// --- DECISION SUPPORT ROUTE ---
app.get('/api/decision-support/stats', async (req, res) => {
  try {
    const [itemsQuery, breakdownQuery] = await Promise.all([
      pool.query(`
        SELECT t.id, t.description as name, t.category, t."loanAmount" as "estimatedValue", 
               t.weight, cu."fullName" as "customerName", t.status::text
        FROM "Ticket" t
        JOIN "Customer" cu ON t."customerId" = cu.id
        WHERE t.status::text = 'ACTIVE'
      `),
      pool.query(`
        SELECT category as name, SUM("loanAmount")::float as "estimatedValue"
        FROM "Ticket"
        WHERE "status"::text = 'ACTIVE'
        GROUP BY category
      `)
    ]);

    res.json({
      inventory: itemsQuery.rows.map(row => ({
        ...row,
        estimatedValue: parseFloat(row.estimatedValue || 0)
      })),
      breakdown: breakdownQuery.rows
    });
  } catch (err) {
    console.error("❌ Decision Support API Error:", err.message);
    res.status(500).json({ inventory: [], breakdown: [] });
  }
});

// --- CUSTOMERS ROUTE ---
app.get('/api/customers', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, "fullName", "contactNumber", address, "loyaltyTier" FROM "Customer"');
    res.json(result.rows.map(row => ({
      id: row.id,
      name: row.fullName,
      phone: row.contactNumber,
      tier: row.loyaltyTier
    })));
  } catch (err) {
    res.status(500).json([]);
  }
});

// --- REDEMPTION CENTER: GET ACTIVE ITEMS ---
app.get('/api/redemption/active-items', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        t.id, t."ticketNumber", cu."fullName" as "customerName", 
        t.category, t.description, t."loanAmount", t."expiryDate", t.status::text
      FROM "Ticket" t
      INNER JOIN "Customer" cu ON t."customerId" = cu.id
      WHERE t.status::text = 'ACTIVE'
      ORDER BY t."pawnDate" DESC
    `);
    
    res.json(result.rows.map(row => ({
      id: row.id,
      ticketId: row.ticketNumber,
      customerName: row.customerName,
      itemDetails: `${row.category} - ${row.description}`,
      loanAmount: parseFloat(row.loanAmount || 0),
      expiryDate: row.expiryDate ? new Date(row.expiryDate).toLocaleDateString() : 'N/A',
      totalDue: parseFloat(row.loanAmount || 0) * 1.035 
    })));
  } catch (err) {
    res.status(500).json([]);
  }
});

// --- REDEMPTION CENTER: PROCESS RELEASE ---
app.post('/api/redemption/release', async (req, res) => {
  const { ticketId } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Update status to REDEEMED (Strict Uppercase)
    await client.query('UPDATE "Ticket" SET status = \'REDEEMED\' WHERE id = $1', [ticketId]);
    // Remove from active inventory table as it is no longer physically "in vault"
    await client.query('DELETE FROM "Inventory" WHERE "ticketId" = $1', [ticketId]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// --- AUCTION HOUSE: GET ITEMS ---
app.get('/api/auction/items', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        t.id, t."ticketNumber", t.description as name, 
        t.category, t."loanAmount" as "startingBid", 
        t.weight, t.status::text
      FROM "Ticket" t
      WHERE t.status::text = 'AUCTION'
      ORDER BY t."pawnDate" DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json([]);
  }
});

// --- APPRAISAL ROUTE ---
app.post('/api/appraisal', async (req, res) => {
  const { customerName, category, weight, valuation, branchId } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let customerRes = await client.query('SELECT id FROM "Customer" WHERE "fullName" = $1', [customerName]);
    let customerId;
    if (customerRes.rows.length === 0) {
      const newCust = await client.query(
        'INSERT INTO "Customer" (id, "fullName", "contactNumber", address) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id', 
        [customerName, '000-000-0000', 'No Address Provided']
      );
      customerId = newCust.rows[0].id;
    } else {
      customerId = customerRes.rows[0].id;
    }

    const ticketRes = await client.query(`
      INSERT INTO "Ticket" ("ticketNumber", "customerId", "branchId", category, description, weight, "loanAmount", status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE') RETURNING id
    `, ['TKT-' + Date.now(), customerId, branchId || 1, category, `Pawned ${category}`, weight, valuation]);

    // Insert into physical inventory for tracking
    await client.query(
      'INSERT INTO "Inventory" ("categoryId", "ticketId", "isForAuction") VALUES ((SELECT id FROM "Category" WHERE name = $1 LIMIT 1), $2, false)', 
      [category, ticketRes.rows[0].id]
    );

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: "Transaction failed." });
  } finally {
    client.release();
  }
});

// --- INVENTORY ROUTE ---
// Fix: Use Ticket table as primary source so REDEEMED and AUCTION items don't disappear
app.get('/api/inventory', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        t.id, 
        t.category, 
        t.weight, 
        t.description as name, 
        t."pawnDate", 
        t."loanAmount" as "estimatedValue", 
        t.status::text, 
        cu."fullName" as "customerName"
      FROM "Ticket" t
      JOIN "Customer" cu ON t."customerId" = cu.id
      ORDER BY t."pawnDate" DESC
    `);
    res.json(result.rows);
  } catch (err) { 
    console.error("Inventory Error:", err.message);
    res.status(500).json([]); 
  }
});

// Use port 3000 so frontend calls to http://localhost:3000/staff succeed
const PORT = process.env.PORT || 3000;
// --- STAFF MANAGEMENT ---
app.post('/staff', async (req, res) => {
  const { fullName, email, password, role, branchId } = req.body;
  if (!email || !fullName) return res.status(400).json({ error: 'Missing required fields' });

  const id = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert into Staff table (used by some frontend components)
    await client.query(
      `INSERT INTO "Staff" (id, "fullName", email, password, role, "branchId", "isVerified", "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [id, fullName, email, password || '', role || 'STAFF', branchId || null, true]
    );

    // Insert into public.profiles (used by StaffMatrix and other UI)
    await client.query(
      `INSERT INTO profiles (id, full_name, email, role, pawnshop_id) VALUES ($1, $2, $3, $4, $5)`,
      [id, fullName, email, role || 'STAFF', branchId || null]
    );

    await client.query('COMMIT');
    res.json({ success: true, id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Staff creation error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post('/staff/:id/password', async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: 'Missing newPassword' });

  try {
    await pool.query('UPDATE "Staff" SET password = $1 WHERE id = $2', [newPassword, id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Change password error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- LOCAL AUTH FALLBACK (for dev only) ---
// This endpoint is disabled in production - use Supabase Auth instead
app.post('/auth/local-login', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Local auth disabled in production. Use Supabase Auth.' });
  }
  
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

  const client = await pool.connect();
  try {
    const staffRes = await client.query(
      'SELECT id, "fullName", email, role, "branchId" FROM "Staff" WHERE email = $1 AND password = $2 LIMIT 1', 
      [email, password]
    );
    if (staffRes.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const staff = staffRes.rows[0];
    const profileRes = await client.query(
      'SELECT id, full_name, email, role, pawnshop_id FROM profiles WHERE id = $1 LIMIT 1', 
      [staff.id]
    );
    const profile = profileRes.rows[0] || null;

    return res.json({ success: true, staff, profile });
  } catch (err) {
    console.error('[ERROR] Local auth error:', err.message);
    res.status(500).json({ error: 'Local auth failed' });
  } finally {
    client.release();
  }
});

app.delete('/staff/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM "Staff" WHERE id = $1', [id]);
    await client.query('DELETE FROM profiles WHERE id = $1', [id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Delete staff error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.listen(PORT, () => {
  console.log(`🚀 PawnGold API active on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM: closing server gracefully');
  pool.end(() => process.exit(0));
});