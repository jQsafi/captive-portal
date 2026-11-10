const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
let firewall;
try { firewall = require('./firewall.js'); } catch (e) { firewall = null; }
let hostsManager;
try { hostsManager = require('./hosts-manager.js'); } catch (e) { hostsManager = null; }
let hotspot;
try { hotspot = require('./hotspot.js'); } catch (e) { hotspot = null; }

const PORT = 80;
const DB_PATH = path.join(__dirname, 'leads.db');
const CUSTOMERS_DIR = path.join(__dirname, 'customers');

// Ensure root customers directory exists
if (!fs.existsSync(CUSTOMERS_DIR)) {
  fs.mkdirSync(CUSTOMERS_DIR, { recursive: true });
}

const KNOWN_COUNTRY_CODES = ['+880', '+971', '+966', '+91', '+44', '+65', '+61', '+49', '+92', '+33', '+81', '+62', '+234', '+1'];

// Normalize mobile number: guarantees numbers are always standardized to +8801616332313
// Even if customer enters with +880, with 0, with 88, or without 0
function normalizePhoneNumber(rawPhone, countryCode = '') {
  let cleaned = String(rawPhone || '').trim().replace(/[\s\-\(\)\.]/g, '');
  let code = String(countryCode || '').trim();

  // If user explicitly provided another international code (+91, +1, +44, etc.)
  const OTHER_CODES = ['+971', '+966', '+91', '+44', '+65', '+61', '+49', '+92', '+33', '+81', '+62', '+234', '+1'];

  if (cleaned.startsWith('+')) {
    for (const oc of OTHER_CODES) {
      if (cleaned.startsWith(oc)) {
        let national = cleaned.slice(oc.length).replace(/^0+/, '');
        return oc + national;
      }
    }
  } else if (code && code !== '+880') {
    for (const oc of OTHER_CODES) {
      if (code === oc) {
        let national = cleaned.replace(/^0+/, '');
        return oc + national;
      }
    }
  }

  // Handle Bangladesh numbers (always format as +8801XXXXXXXXX)
  let digits = cleaned.replace(/[^0-9]/g, '');

  // Strip international / country prefixes (00880, 0088, 880, 88)
  if (digits.startsWith('00880')) {
    digits = digits.slice(5);
  } else if (digits.startsWith('0088')) {
    digits = digits.slice(4);
  } else if (digits.startsWith('880')) {
    digits = digits.slice(3);
  } else if (digits.startsWith('88') && digits.length >= 12) {
    digits = digits.slice(2);
  }

  // Strip any leading zeros (e.g. 01616332313 or 001616332313)
  digits = digits.replace(/^0+/, '');

  if (digits.length > 0) {
    return '+880' + digits;
  }
  return cleaned;
}

// Clean phone number (strip spaces, dashes, parentheses)
function cleanPhoneNumber(phone) {
  return phone.replace(/[^0-9+]/g, '');
}

// Clean phone digits only (strictly required for WhatsApp wa.me links)
function getWhatsAppDigits(phone) {
  return phone.replace(/[^0-9]/g, '');
}

// Helper to get folder name created strictly by using provided mobile number (with starting 0 removed)
function getCustomerFolderName(customer) {
  const phone = normalizePhoneNumber(customer.phone || '');
  const folderName = phone.replace(/[^0-9+]/g, '');
  return folderName || 'unknown_customer';
}

function createCustomerFolder(customer) {
  try {
    const folderName = getCustomerFolderName(customer);
    const folderPath = path.join(CUSTOMERS_DIR, folderName);

    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    // Save customer summary profile in JSON
    const infoPath = path.join(folderPath, 'customer_info.json');
    if (!fs.existsSync(infoPath)) {
      fs.writeFileSync(infoPath, JSON.stringify({
        id: customer.id || null,
        name: customer.name,
        phone: customer.phone,
        customer_type: customer.customer_type || 'Hotspot',
        ip: customer.ip || '',
        created_at: customer.created_at || new Date().toISOString()
      }, null, 2), 'utf8');
    }

    // Create a starter notes/receipts file for the shop
    const notesPath = path.join(folderPath, 'notes.txt');
    if (!fs.existsSync(notesPath)) {
      const notesContent = `====================================================
🏪 SMART COMPUTER - CUSTOMER RECORD
====================================================
Customer Name : ${customer.name}
Phone Number  : ${customer.phone}
Customer Type : ${customer.customer_type || 'Hotspot'}
Registered On : ${customer.created_at || new Date().toLocaleString()}
Device IP     : ${customer.ip || 'In-Store Walk-in (No IP)'}
Folder Path   : customers/${folderName}
----------------------------------------------------
In-Store Notes / Service Orders / Invoices:
----------------------------------------------------

`;
      fs.writeFileSync(notesPath, notesContent, 'utf8');
    }

    console.log(`[Folder] ✓ Verified folder for: ${folderName}`);
    return folderName;
  } catch (err) {
    console.error(`[Folder] Failed to create folder for ${customer.name}:`, err.message);
    return null;
  }
}

// --- Marketing Settings ---
const CONFIG = {
  businessName: 'Smart Computer',
  promoHeadline: 'Welcome to Smart Computer! 🎁',
  promoSubtext: 'Enter your name and mobile number to unlock instant unlimited high-speed internet.',
  // Default country dialing code for the mobile input (e.g. +880 for Bangladesh, +1 for US, +91 for India)
  defaultCountryCode: '+880',
  // Where to send users after they connect (e.g. your Instagram, Google Reviews page, or website)
  redirectUrl: 'https://www.google.com',
  // Wi-Fi Session Control & Duration Limit
  session: {
    durationMinutes: 120, // 2 hours default Wi-Fi access limit
    checkIntervalSeconds: 30 // Check expiration every 30 seconds
  },
  // Windows Hotspot Auto-Start Settings
  hotspot: {
    autoStart: true,
    ssid: 'Smart Computer Guest',
    // Note: Windows requires at least 8 characters (WPA2-Personal)
    password: '11111111'
  }
};

// --- 1. Database Initialization ---
const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    ip TEXT DEFAULT '',
    customer_type TEXT DEFAULT 'Hotspot',
    marketing_opt_in INTEGER DEFAULT 1,
    user_agent TEXT,
    session_expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

// Add customer_type column if upgrading existing database
try {
  db.exec("ALTER TABLE leads ADD COLUMN customer_type TEXT DEFAULT 'Hotspot'");
} catch (e) {
  // column already exists
}

// Add session_expires_at column if upgrading existing database
try {
  db.exec("ALTER TABLE leads ADD COLUMN session_expires_at TIMESTAMP");
} catch (e) {
  // column already exists
}

const authorizedIps = new Set();
const activeSessions = new Map(); // ip => { id, name, phone, connectedAt, expiresAt }

const sessionDurationMinutes = (CONFIG.session && CONFIG.session.durationMinutes) || 120;
const sessionDurationMs = sessionDurationMinutes * 60 * 1000;
const startupNow = Date.now();

try {
  const recentLeadsStmt = db.prepare("SELECT * FROM leads WHERE ip IS NOT NULL AND ip != '' ORDER BY id DESC");
  for (const row of recentLeadsStmt.all()) {
    if (!row.ip || activeSessions.has(row.ip)) continue;

    let expiresAt;
    if (row.session_expires_at) {
      expiresAt = new Date(row.session_expires_at).getTime();
    } else if (row.created_at) {
      const createdTime = new Date(row.created_at).getTime();
      expiresAt = createdTime + sessionDurationMs;
    }

    if (expiresAt && expiresAt > startupNow) {
      authorizedIps.add(row.ip);
      activeSessions.set(row.ip, {
        id: row.id,
        name: row.name,
        phone: row.phone,
        connectedAt: row.created_at ? new Date(row.created_at).getTime() : startupNow,
        expiresAt: expiresAt
      });
    }
  }
} catch (err) {
  console.warn('[Database] Warning loading active sessions:', err.message);
}
console.log(`[Database] Loaded ${authorizedIps.size} active authorized client(s) with ${activeSessions.size} active session(s).`);

// Background Session Expiration Monitor
const sessionCheckInterval = ((CONFIG.session && CONFIG.session.checkIntervalSeconds) || 30) * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [ip, session] of activeSessions.entries()) {
    if (session.expiresAt <= now) {
      console.log(`[Session Expired] ⏱️ Wi-Fi session ended for ${session.name} (${session.phone}) on IP ${ip}`);
      activeSessions.delete(ip);
      authorizedIps.delete(ip);
      if (firewall) firewall.revokeIp(ip);
    }
  }
}, sessionCheckInterval);

function getSessionRemaining(ip) {
  if (!ip) return null;
  const session = activeSessions.get(ip);
  if (!session) return null;
  const remainingMs = session.expiresAt - Date.now();
  if (remainingMs <= 0) {
    return { active: false, remainingMs: 0, text: 'Expired', isWarning: true };
  }
  const totalMins = Math.ceil(remainingMs / 60000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  const text = hours > 0 ? `${hours}h ${mins}m left` : `${mins}m left`;
  return {
    active: true,
    remainingMs,
    totalMins,
    text,
    isWarning: totalMins <= 15
  };
}

// Auto-sync customer folders on startup & migrate phone numbers to standardized +880 format
try {
  const existingCustomers = db.prepare('SELECT * FROM leads').all();
  for (const c of existingCustomers) {
    const cleanPhone = normalizePhoneNumber(c.phone);
    if (cleanPhone !== c.phone) {
      const oldFolderName = c.phone.replace(/[^0-9+]/g, '');
      const newFolderName = cleanPhone.replace(/[^0-9+]/g, '');
      if (oldFolderName && newFolderName && oldFolderName !== newFolderName) {
        const oldPath = path.join(CUSTOMERS_DIR, oldFolderName);
        const newPath = path.join(CUSTOMERS_DIR, newFolderName);
        if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
          try {
            fs.renameSync(oldPath, newPath);
            console.log(`[Folder] Auto-migrated folder: ${oldFolderName} -> ${newFolderName}`);
          } catch (err) {
            console.warn(`[Folder] Could not rename folder ${oldFolderName}:`, err.message);
          }
        }
      }
      db.prepare('UPDATE leads SET phone = ? WHERE id = ?').run(cleanPhone, c.id);
      c.phone = cleanPhone;
    }
    createCustomerFolder(c);
  }
  console.log(`[Folder] Verified ${existingCustomers.length} customer folders in ./customers/`);
} catch (e) {
  console.warn('[Folder] Folder sync warning:', e.message);
}

function getClientIp(req) {
  const rawIp = req.socket.remoteAddress || '';
  return rawIp.replace(/^.*:/, '');
}

function getLocalIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ name, ip: iface.address });
      }
    }
  }
  return ips;
}

// Validate phone number (minimum 7 digits, maximum 16 digits, not repeating dummy)
function isValidPhoneNumber(phone) {
  const digitsOnly = phone.replace(/[^0-9]/g, '');
  if (digitsOnly.length < 7 || digitsOnly.length > 15) return false;
  // Check dummy repeating digits like 0000000 or 1111111
  if (/^(\d)\1+$/.test(digitsOnly)) return false;
  return true;
}

// --- 2. HTML Templates & View Engine ---
const templates = require('./templates.js');
const escapeHtml = templates.escapeHtml;
const getCustomerTypeBadge = templates.getCustomerTypeBadge;
const getPortalHtml = (clientIp, error = '', oldValues = {}) => templates.getPortalHtml(clientIp, error, oldValues, CONFIG);
const getSuccessHtml = (name, redirectUrl) => templates.getSuccessHtml(name, redirectUrl, CONFIG);
const getAdminHtml = (leads) => templates.getAdminHtml(leads, {
  config: CONFIG,
  authorizedIps,
  getCustomerFolderName,
  getWhatsAppDigits,
  getSessionRemaining
});

// --- 3. Main HTTP Server ---
const server = http.createServer((req, res) => {
  const clientIp = getClientIp(req);
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // 3.1 Admin Dashboard
  if (parsedUrl.pathname === '/admin') {
    const leads = db.prepare('SELECT * FROM leads ORDER BY id DESC').all();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(getAdminHtml(leads));
  }

  // 3.1.1 Add Customer Record Manually
  if (parsedUrl.pathname === '/admin/customer/add' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const name = (params.get('name') || '').trim();
      const countryCode = (params.get('country_code') || '').trim();
      let rawPhone = (params.get('phone') || '').trim();
      const customerType = (params.get('customer_type') || 'Walk-in Client').trim();

      // Check if user has added any 0 at the starting of mobile number and remove 0
      const phone = normalizePhoneNumber(rawPhone, countryCode);

      if (name && phone) {
        const insertStmt = db.prepare('INSERT INTO leads (name, phone, ip, customer_type, marketing_opt_in, user_agent) VALUES (?, ?, ?, ?, 1, ?)');
        const result = insertStmt.run(name, phone, '', customerType, 'Manual Admin Entry');
        createCustomerFolder({
          id: result.lastInsertRowid,
          name,
          phone,
          customer_type: customerType,
          ip: '',
          created_at: new Date().toISOString()
        });
        console.log(`[+] MANUAL CUSTOMER ADDED: ${name} (${phone}) [${customerType}]`);
      }

      res.writeHead(302, { Location: '/admin' });
      res.end();
    });
    return;
  }

  // 3.1.2 Edit Customer Record
  if (parsedUrl.pathname === '/admin/customer/edit' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const id = parseInt(params.get('id'), 10);
      const name = (params.get('name') || '').trim();
      const countryCode = (params.get('country_code') || '').trim();
      let rawPhone = (params.get('phone') || '').trim();
      const customerType = (params.get('customer_type') || 'Walk-in Client').trim();

      if (id && name && rawPhone) {
        // Strip leading 0 and normalize phone
        const newPhone = normalizePhoneNumber(rawPhone, countryCode);

        // Fetch current record
        const currentRecord = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
        if (currentRecord) {
          const oldFolderName = getCustomerFolderName(currentRecord);
          const newFolderName = getCustomerFolderName({ phone: newPhone });

          const oldFolderPath = path.join(CUSTOMERS_DIR, oldFolderName);
          const newFolderPath = path.join(CUSTOMERS_DIR, newFolderName);

          // Update database row
          db.prepare('UPDATE leads SET name = ?, phone = ?, customer_type = ? WHERE id = ?')
            .run(name, newPhone, customerType, id);

          // If phone changed, rename folder
          if (oldFolderName !== newFolderName && fs.existsSync(oldFolderPath)) {
            try {
              if (!fs.existsSync(newFolderPath)) {
                fs.renameSync(oldFolderPath, newFolderPath);
                console.log(`[Folder] Renamed folder from ${oldFolderName} to ${newFolderName}`);
              }
            } catch (err) {
              console.warn(`[Folder] Could not rename folder: ${err.message}`);
            }
          }

          // Ensure folder exists and customer summary is updated
          const updatedCustomer = {
            id,
            name,
            phone: newPhone,
            customer_type: customerType,
            ip: currentRecord.ip || '',
            created_at: currentRecord.created_at || new Date().toISOString()
          };
          createCustomerFolder(updatedCustomer);

          // Update customer_info.json and append audit note
          try {
            const targetFolder = path.join(CUSTOMERS_DIR, newFolderName);
            if (fs.existsSync(targetFolder)) {
              const infoPath = path.join(targetFolder, 'customer_info.json');
              fs.writeFileSync(infoPath, JSON.stringify({
                ...updatedCustomer,
                updated_at: new Date().toISOString()
              }, null, 2), 'utf8');

              const notesPath = path.join(targetFolder, 'notes.txt');
              if (fs.existsSync(notesPath)) {
                const editLog = `[${new Date().toLocaleString()}] CUSTOMER UPDATED: Name="${name}", Phone="${newPhone}", Type="${customerType}"\n`;
                fs.appendFileSync(notesPath, editLog, 'utf8');
              }
            }
          } catch (err) {
            console.warn('[Folder] Could not update customer files:', err.message);
          }

          console.log(`[+] CUSTOMER EDITED: ID #${id} - ${name} (${newPhone}) [${customerType}]`);
        }
      }

      res.writeHead(302, { Location: '/admin' });
      res.end();
    });
    return;
  }

  // 3.1.3 Delete Customer Record
  if (parsedUrl.pathname === '/admin/customer/delete' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const id = parseInt(params.get('id'), 10);

      if (id) {
        const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
        if (lead) {
          // If customer has active Wi-Fi session, revoke IP
          if (lead.ip) {
            authorizedIps.delete(lead.ip);
            activeSessions.delete(lead.ip);
            if (firewall) firewall.revokeIp(lead.ip);
            console.log(`[Delete] Revoked active IP ${lead.ip} for deleted customer #${id}`);
          }

          // Remove folder in customers/
          try {
            const folderName = getCustomerFolderName(lead);
            const folderPath = path.join(CUSTOMERS_DIR, folderName);
            if (fs.existsSync(folderPath)) {
              fs.rmSync(folderPath, { recursive: true, force: true });
              console.log(`[Folder] Deleted customer folder: ${folderName}`);
            }
          } catch (err) {
            console.warn(`[Folder] Error deleting customer folder: ${err.message}`);
          }

          // Delete from database
          db.prepare('DELETE FROM leads WHERE id = ?').run(id);
          console.log(`[-] CUSTOMER DELETED: ID #${id} - ${lead.name} (${lead.phone})`);
        }
      }

      res.writeHead(302, { Location: '/admin' });
      res.end();
    });
    return;
  }

  // 3.2 1-Click CSV / Excel Export
  if (parsedUrl.pathname === '/admin/export.csv') {
    const leads = db.prepare('SELECT id, name, customer_type, phone, ip, created_at FROM leads ORDER BY id DESC').all();
    let csv = 'ID,Customer Name,Customer Type,Phone Number,Device IP,Registration Date\n';
    for (const lead of leads) {
      csv += `"${lead.id}","${lead.name.replace(/"/g, '""')}","${lead.customer_type || 'Hotspot'}","${lead.phone}","${lead.ip || 'N/A'}","${lead.created_at}"\n`;
    }
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="smart_computer_customer_records.csv"'
    });
    return res.end(csv);
  }

  // 3.3 Revoke Access
  if (parsedUrl.pathname === '/admin/revoke' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const ip = params.get('ip');
      if (ip) {
        authorizedIps.delete(ip);
        activeSessions.delete(ip);
        if (firewall) firewall.revokeIp(ip);
        console.log(`[Revoke] Access revoked for IP: ${ip}`);
      }
      res.writeHead(302, { Location: '/admin' });
      res.end();
    });
    return;
  }

  // 3.3.1 Get Customer Notes
  if (parsedUrl.pathname === '/admin/customer/notes' && req.method === 'GET') {
    const id = parseInt(parsedUrl.searchParams.get('id'), 10);
    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ success: false, error: 'Customer ID required' }));
    }

    const customer = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
    if (!customer) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ success: false, error: 'Customer record not found' }));
    }

    const folderName = getCustomerFolderName(customer);
    const folderPath = path.join(CUSTOMERS_DIR, folderName);
    if (!fs.existsSync(folderPath)) {
      createCustomerFolder(customer);
    }
    const notesPath = path.join(folderPath, 'notes.txt');
    let notes = '';
    try {
      if (fs.existsSync(notesPath)) {
        notes = fs.readFileSync(notesPath, 'utf8');
      } else {
        createCustomerFolder(customer);
        notes = fs.existsSync(notesPath) ? fs.readFileSync(notesPath, 'utf8') : '';
      }
    } catch (err) {
      notes = `[Error reading notes: ${err.message}]`;
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      success: true,
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      customer_type: customer.customer_type || 'Hotspot',
      folder: folderName,
      notes
    }));
  }

  // 3.3.2 Save Customer Notes
  if (parsedUrl.pathname === '/admin/customer/notes' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      let id, notes;
      const isJson = (req.headers['content-type'] || '').includes('application/json');
      if (isJson) {
        try {
          const parsed = JSON.parse(body);
          id = parseInt(parsed.id, 10);
          notes = parsed.notes;
        } catch (e) {}
      } else {
        const params = new URLSearchParams(body);
        id = parseInt(params.get('id'), 10);
        notes = params.get('notes');
      }

      if (!id || typeof notes !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ success: false, error: 'Customer ID and notes required' }));
      }

      const customer = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
      if (!customer) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ success: false, error: 'Customer not found' }));
      }

      const folderName = getCustomerFolderName(customer);
      const folderPath = path.join(CUSTOMERS_DIR, folderName);
      if (!fs.existsSync(folderPath)) {
        createCustomerFolder(customer);
      }
      const notesPath = path.join(folderPath, 'notes.txt');

      try {
        fs.writeFileSync(notesPath, notes, 'utf8');
        console.log(`[Notes] Saved notes for ${customer.name} (customers/${folderName}/notes.txt)`);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ success: true, message: 'Notes saved successfully' }));
      } catch (err) {
        console.error(`[Notes] Failed to write notes for ${customer.name}:`, err.message);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 3.3.3 Extend Wi-Fi Session (+1 Hour)
  if (parsedUrl.pathname === '/admin/session/extend' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const ip = (params.get('ip') || '').trim();
      const minutes = parseInt(params.get('minutes') || '60', 10);

      if (ip) {
        const nowMs = Date.now();
        let session = activeSessions.get(ip);
        const customer = db.prepare('SELECT * FROM leads WHERE ip = ? ORDER BY id DESC LIMIT 1').get(ip);
        
        const baseTime = (session && session.expiresAt > nowMs) ? session.expiresAt : nowMs;
        const newExpiresAt = baseTime + (minutes * 60 * 1000);
        const newExpiresIso = new Date(newExpiresAt).toISOString();

        if (!session) {
          session = {
            id: customer ? customer.id : null,
            name: customer ? customer.name : 'Active Guest',
            phone: customer ? customer.phone : '',
            connectedAt: nowMs,
            expiresAt: newExpiresAt
          };
        } else {
          session.expiresAt = newExpiresAt;
        }
        activeSessions.set(ip, session);
        authorizedIps.add(ip);
        if (firewall) firewall.allowIp(ip);

        if (customer) {
          try {
            db.prepare('UPDATE leads SET session_expires_at = ? WHERE id = ?').run(newExpiresIso, customer.id);
          } catch (e) {}
        }
        console.log(`[Session Extended] ⏱️ Extended +${minutes}m for IP ${ip} (New Expiration: ${new Date(newExpiresAt).toLocaleTimeString()})`);
      }

      res.writeHead(302, { Location: '/admin' });
      res.end();
    });
    return;
  }

  // 3.4 Form Submission Route (Marketing Opt-in)
  if (parsedUrl.pathname === '/auth/connect' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const name = (params.get('name') || '').trim();
      const countryCode = (params.get('country_code') || '').trim();
      let rawPhone = (params.get('phone') || '').trim();

      // Check if user has added any 0 at the starting of mobile number and remove 0
      const phone = normalizePhoneNumber(rawPhone, countryCode);

      // Validate inputs with preserved form state on error
      if (!name || !phone) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(getPortalHtml(clientIp, 'Please enter both your name and phone number.', { 
          name, 
          phone: params.get('phone') || '', 
          countryCode 
        }));
      }

      if (!isValidPhoneNumber(phone)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(getPortalHtml(clientIp, 'Please enter a valid mobile number with at least 7 digits.', { 
          name, 
          phone: params.get('phone') || '', 
          countryCode 
        }));
      }

      // Save lead to database with session expiration
      const userAgent = req.headers['user-agent'] || '';
      const durationMinutes = (CONFIG.session && CONFIG.session.durationMinutes) || 120;
      const expiresAtMs = Date.now() + (durationMinutes * 60 * 1000);
      const expiresAtIso = new Date(expiresAtMs).toISOString();

      const insertStmt = db.prepare('INSERT INTO leads (name, phone, ip, customer_type, marketing_opt_in, user_agent, session_expires_at) VALUES (?, ?, ?, ?, 1, ?, ?)');
      const result = insertStmt.run(name, phone, clientIp, 'Hotspot', userAgent, expiresAtIso);
      createCustomerFolder({
        id: result.lastInsertRowid,
        name,
        phone,
        customer_type: 'Hotspot',
        ip: clientIp,
        created_at: new Date().toISOString()
      });

      // Authorize client IP & activate session
      authorizedIps.add(clientIp);
      activeSessions.set(clientIp, {
        id: result.lastInsertRowid,
        name,
        phone,
        connectedAt: Date.now(),
        expiresAt: expiresAtMs
      });
      if (firewall) firewall.allowIp(clientIp);
      console.log(`[+] NEW HOTSPOT CUSTOMER: ${name} (${phone}) from IP: ${clientIp} [${durationMinutes}m session until ${new Date(expiresAtMs).toLocaleTimeString()}]`);

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getSuccessHtml(name, CONFIG.redirectUrl));
    });
    return;
  }

  // 3.5 Direct Portal Access
  if (parsedUrl.pathname === '/portal' || parsedUrl.pathname === '/') {
    if (!authorizedIps.has(clientIp) || parsedUrl.pathname === '/portal') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(getPortalHtml(clientIp));
    }
  }

  // 3.6 Captive Portal Probes (Triggers automatic sign-in popup on Android, Apple, Windows)
  const captiveProbes = ['/generate_204', '/gen_204', '/hotspot-detect.html', '/ncsi.txt', '/connecttest.txt', '/success.txt'];
  if (captiveProbes.includes(parsedUrl.pathname)) {
    if (!authorizedIps.has(clientIp)) {
      const portalUrl = `http://192.168.137.1${PORT === 80 ? '' : ':' + PORT}/portal`;
      // Android / Chrome: 302 redirect triggers instant OS "Sign in to Wi-Fi" notification
      if (parsedUrl.pathname === '/generate_204' || parsedUrl.pathname === '/gen_204') {
        res.writeHead(302, { 'Location': portalUrl });
        return res.end();
      }
      // Apple CNA & Windows NCSI: return portal HTML
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(getPortalHtml(clientIp));
    } else {
      if (parsedUrl.pathname === '/generate_204' || parsedUrl.pathname === '/gen_204') {
        res.writeHead(204);
        return res.end();
      }
      if (parsedUrl.pathname === '/hotspot-detect.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>');
      }
      if (parsedUrl.pathname === '/ncsi.txt' || parsedUrl.pathname === '/connecttest.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('Microsoft Connect Test');
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('success');
    }
  }

  // 3.7 Intercept Unauthenticated Browsing (Redirect to portal)
  if (!authorizedIps.has(clientIp)) {
    const portalUrl = `http://192.168.137.1${PORT === 80 ? '' : ':' + PORT}/portal`;
    res.writeHead(302, { 'Location': portalUrl });
    return res.end();
  }

  // 3.8 Authorized: Forward HTTP Traffic
  try {
    const proxyUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const options = {
      hostname: proxyUrl.hostname,
      port: proxyUrl.port || 80,
      path: proxyUrl.pathname + proxyUrl.search,
      method: req.method,
      headers: req.headers
    };

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Proxy Error: ' + err.message);
    });

    req.pipe(proxyReq);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Gateway Error');
  }
});

// --- 4. Handle HTTPS CONNECT Tunneling ---
server.on('connect', (req, clientSocket, head) => {
  const clientIp = getClientIp(req);

  if (!authorizedIps.has(clientIp)) {
    clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\n' +
                       'Proxy-Authenticate: Basic realm="Wi-Fi Marketing Portal: Visit http://portal to login"\r\n' +
                       'Connection: close\r\n\r\n');
    clientSocket.end();
    return;
  }

  const [host, port] = req.url.split(':');
  const serverSocket = net.connect(Number(port) || 443, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  serverSocket.on('error', () => {
    clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    clientSocket.end();
  });

  clientSocket.on('error', () => {
    serverSocket.destroy();
  });
});

// --- 5. Start Server ---
if (firewall) {
  firewall.initFirewall(Array.from(authorizedIps));
}
if (hostsManager) {
  hostsManager.enableProbeRedirects('192.168.137.1');
}
process.on('SIGINT', () => {
  if (firewall) firewall.cleanupFirewall();
  if (hostsManager) hostsManager.disableProbeRedirects();
  process.exit(0);
});
process.on('exit', () => {
  if (firewall) firewall.cleanupFirewall();
  if (hostsManager) hostsManager.disableProbeRedirects();
});
if (hotspot && hotspot.isWindows() && CONFIG.hotspot && CONFIG.hotspot.autoStart) {
  hotspot.startHotspot({
    ssid: CONFIG.hotspot.ssid,
    password: CONFIG.hotspot.password
  });
}

function printBanner(activePort) {
  const portSuffix = activePort === 80 ? '' : `:${activePort}`;
  console.log('====================================================');
  console.log(`💻 Smart Computer Wi-Fi Gateway running on Port ${activePort}`);
  console.log('----------------------------------------------------');
  if (CONFIG.hotspot && CONFIG.hotspot.autoStart) {
    console.log(`📶 Wi-Fi Hotspot SSID : ${CONFIG.hotspot.ssid}`);
    console.log(`🔑 Wi-Fi Password     : ${CONFIG.hotspot.password}`);
    console.log('----------------------------------------------------');
  }
  const ips = getLocalIps();
  for (const iface of ips) {
    console.log(`  [${iface.name}] http://${iface.ip}${portSuffix}`);
  }
  console.log('----------------------------------------------------');
  console.log(`📊 Customer Dashboard: http://localhost${portSuffix}/admin`);
  console.log(`📥 Export Customers:   http://localhost${portSuffix}/admin/export.csv`);
  console.log('====================================================');
}

// Handle port busy / access errors gracefully
server.on('error', (err) => {
  if (err.code === 'EACCES' || err.code === 'EADDRINUSE') {
    if (PORT === 80) {
      console.warn('[Notice] Port 80 is occupied by a Windows system service. Automatically falling back to Port 8080...');
      server.listen(8080, '0.0.0.0', () => {
        printBanner(8080);
      });
      return;
    }
  }
  console.error('[Error] Server error:', err.message);
});

// Start primary server
server.listen(PORT, '0.0.0.0', () => {
  printBanner(PORT);
});
