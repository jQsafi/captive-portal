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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

// Add customer_type column if upgrading existing database
try {
  db.exec("ALTER TABLE leads ADD COLUMN customer_type TEXT DEFAULT 'Hotspot'");
} catch (e) {
  // column already exists
}

const authorizedIps = new Set();
const recentLeadsStmt = db.prepare("SELECT DISTINCT ip FROM leads WHERE created_at >= datetime('now', '-1 day') AND ip IS NOT NULL AND ip != ''");
for (const row of recentLeadsStmt.all()) {
  if (row.ip) authorizedIps.add(row.ip);
}
console.log(`[Database] Loaded ${authorizedIps.size} active authorized client(s).`);

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

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// --- 2. HTML Templates ---
function getPortalHtml(clientIp, error = '', oldValues = {}) {
  const prevName = oldValues.name || '';
  const prevPhone = oldValues.phone || '';
  const prevCountry = oldValues.countryCode || CONFIG.defaultCountryCode || '+880';
  const ssid = CONFIG.hotspot && CONFIG.hotspot.ssid ? CONFIG.hotspot.ssid : `${CONFIG.businessName} Guest`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${escapeHtml(CONFIG.businessName)} - Wi-Fi Access</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-tap-highlight-color: transparent; }
    
    body {
      background: #080c14;
      background-image: 
        radial-gradient(circle at 15% 15%, rgba(37, 99, 235, 0.18) 0%, transparent 45%),
        radial-gradient(circle at 85% 85%, rgba(99, 102, 241, 0.18) 0%, transparent 45%),
        linear-gradient(180deg, #080c14 0%, #0f172a 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      color: #f8fafc;
    }

    .container {
      width: 100%;
      max-width: 440px;
      margin: 0 auto;
    }

    .card {
      background: rgba(15, 23, 42, 0.78);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 24px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.05);
      padding: 32px 26px;
      text-align: center;
      position: relative;
      overflow: hidden;
    }

    /* Glow accent bar at top of card */
    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, #2563eb, #38bdf8, #6366f1);
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      background: rgba(34, 197, 94, 0.12);
      border: 1px solid rgba(34, 197, 94, 0.3);
      color: #4ade80;
      padding: 5px 14px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.4px;
      margin-bottom: 18px;
    }

    .pulse-dot {
      width: 8px;
      height: 8px;
      background: #22c55e;
      border-radius: 50%;
      box-shadow: 0 0 10px #22c55e;
      animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    .wifi-icon-wrapper {
      width: 64px;
      height: 64px;
      margin: 0 auto 16px auto;
      background: linear-gradient(135deg, rgba(37, 99, 235, 0.25), rgba(56, 189, 248, 0.15));
      border: 1px solid rgba(56, 189, 248, 0.3);
      border-radius: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 10px 25px rgba(37, 99, 235, 0.25);
    }

    .wifi-icon-wrapper svg {
      width: 32px;
      height: 32px;
      fill: none;
      stroke: #38bdf8;
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    h1 {
      font-size: 23px;
      color: #ffffff;
      margin-bottom: 8px;
      font-weight: 800;
      letter-spacing: -0.3px;
      line-height: 1.25;
    }

    p.subtitle {
      color: #94a3b8;
      font-size: 14px;
      margin-bottom: 22px;
      line-height: 1.5;
    }

    .ssid-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 8px;
      padding: 4px 10px;
      font-size: 12px;
      color: #cbd5e1;
      margin-bottom: 18px;
      font-weight: 600;
    }

    .form-group {
      text-align: left;
      margin-bottom: 18px;
    }

    label {
      font-size: 13px;
      font-weight: 600;
      color: #cbd5e1;
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 7px;
    }

    label svg {
      width: 15px;
      height: 15px;
      stroke: #38bdf8;
      stroke-width: 2;
      fill: none;
    }

    .input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }

    input[type="text"], input[type="tel"] {
      width: 100%;
      padding: 13px 14px;
      background: rgba(30, 41, 59, 0.7);
      border: 1.5px solid rgba(148, 163, 184, 0.25);
      border-radius: 12px;
      font-size: 16px; /* 16px prevents iOS auto-zoom on input focus */
      color: #ffffff;
      outline: none;
      transition: all 0.2s ease;
    }

    input::placeholder {
      color: #64748b;
      font-size: 14px;
    }

    input:focus {
      border-color: #3b82f6;
      background: rgba(30, 41, 59, 0.95);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.25);
    }

    /* Compound Phone Input Group */
    .phone-group {
      display: flex;
      gap: 8px;
    }

    .country-select-wrapper {
      flex: 0 0 110px;
    }

    select.country-select {
      width: 100%;
      padding: 13px 8px;
      background: rgba(30, 41, 59, 0.7);
      border: 1.5px solid rgba(148, 163, 184, 0.25);
      border-radius: 12px;
      font-size: 14px;
      color: #ffffff;
      outline: none;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    select.country-select:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.25);
    }

    select.country-select option {
      background: #0f172a;
      color: #ffffff;
    }

    .phone-input-wrapper {
      flex: 1;
    }

    .field-hint {
      font-size: 11px;
      color: #64748b;
      margin-top: 5px;
      display: block;
    }

    .checkbox-group {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      text-align: left;
      margin: 20px 0 16px 0;
      font-size: 12px;
      color: #94a3b8;
      line-height: 1.45;
    }

    .checkbox-group input[type="checkbox"] {
      width: 18px;
      height: 18px;
      margin-top: 1px;
      accent-color: #2563eb;
      cursor: pointer;
      flex-shrink: 0;
    }

    .terms-link {
      color: #38bdf8;
      text-decoration: underline;
      background: none;
      border: none;
      padding: 0;
      font: inherit;
      cursor: pointer;
      font-weight: 600;
      display: inline;
    }

    .terms-link:hover {
      color: #7dd3fc;
    }

    button.btn-connect {
      width: 100%;
      padding: 15px;
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      color: #ffffff;
      border: none;
      border-radius: 14px;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 9px;
      box-shadow: 0 10px 25px -5px rgba(37, 99, 235, 0.5);
      position: relative;
      overflow: hidden;
    }

    button.btn-connect:hover {
      background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%);
      transform: translateY(-1px);
      box-shadow: 0 14px 28px -5px rgba(37, 99, 235, 0.6);
    }

    button.btn-connect:active {
      transform: translateY(0);
    }

    button.btn-connect:disabled {
      background: #334155;
      color: #94a3b8;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    .spinner {
      width: 18px;
      height: 18px;
      border: 2.5px solid rgba(255, 255, 255, 0.3);
      border-radius: 50%;
      border-top-color: #ffffff;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .error-box {
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.35);
      color: #fca5a5;
      padding: 12px 14px;
      border-radius: 12px;
      font-size: 13px;
      margin-bottom: 18px;
      display: flex;
      align-items: center;
      gap: 10px;
      text-align: left;
      line-height: 1.4;
      animation: shake 0.4s ease-in-out;
    }

    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      20%, 60% { transform: translateX(-5px); }
      40%, 80% { transform: translateX(5px); }
    }

    .error-box svg {
      width: 20px;
      height: 20px;
      stroke: #ef4444;
      flex-shrink: 0;
      stroke-width: 2;
      fill: none;
    }

    .perks-row {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-top: 24px;
      padding-top: 20px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }

    .perk-card {
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid rgba(148, 163, 184, 0.12);
      border-radius: 10px;
      padding: 10px 4px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }

    .perk-card svg {
      width: 18px;
      height: 18px;
      stroke: #38bdf8;
      stroke-width: 2;
      fill: none;
    }

    .perk-card span {
      font-size: 11px;
      color: #cbd5e1;
      font-weight: 600;
    }

    /* Interactive Terms & Privacy Modal */
    .modal-backdrop {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 999;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }

    .modal-backdrop.active {
      display: flex;
    }

    .modal-content {
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 20px;
      max-width: 440px;
      width: 100%;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 25px 50px rgba(0, 0, 0, 0.8);
      animation: modalFadeIn 0.25s ease;
      text-align: left;
    }

    @keyframes modalFadeIn {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }

    .modal-header {
      padding: 18px 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .modal-header h2 {
      font-size: 16px;
      color: #ffffff;
      font-weight: 700;
    }

    .modal-close-btn {
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      padding: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
    }

    .modal-close-btn:hover {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.06);
    }

    .modal-close-btn svg {
      width: 20px;
      height: 20px;
      stroke: currentColor;
      stroke-width: 2;
      fill: none;
    }

    .modal-body {
      padding: 20px;
      overflow-y: auto;
      font-size: 13px;
      color: #94a3b8;
      line-height: 1.6;
    }

    .modal-body h3 {
      font-size: 14px;
      color: #e2e8f0;
      margin: 12px 0 6px 0;
    }

    .modal-body h3:first-child {
      margin-top: 0;
    }

    .modal-footer {
      padding: 14px 20px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      justify-content: flex-end;
    }

    .modal-footer button {
      background: #2563eb;
      color: #ffffff;
      border: none;
      padding: 10px 18px;
      border-radius: 10px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
    }

    @media (max-width: 480px) {
      .card { padding: 26px 18px; border-radius: 20px; }
      h1 { font-size: 21px; }
      .perks-row { gap: 6px; }
      .perk-card { padding: 8px 2px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      
      <!-- Live Status Pill -->
      <div class="status-badge">
        <span class="pulse-dot"></span>
        <span>FREE WI-FI GATEWAY</span>
      </div>

      <!-- Wi-Fi Vector Graphic -->
      <div class="wifi-icon-wrapper" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
          <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
          <circle cx="12" cy="20" r="1.5" fill="#38bdf8"></circle>
        </svg>
      </div>

      <!-- Headline & Subtext -->
      <h1>${escapeHtml(CONFIG.promoHeadline)}</h1>
      <p class="subtitle">${escapeHtml(CONFIG.promoSubtext)}</p>

      <div class="ssid-pill">
        <svg style="width:13px; height:13px; stroke:#38bdf8; fill:none; stroke-width:2;" viewBox="0 0 24 24"><path d="M5 12.55a11 11 0 0 1 14.08 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"></path></svg>
        <span>Network: <b>${escapeHtml(ssid)}</b></span>
      </div>

      <!-- Server-side Error Notification -->
      ${error ? `
      <div class="error-box" role="alert">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
        <span>${escapeHtml(error)}</span>
      </div>` : ''}

      <!-- Client-side Dynamic Error Notification -->
      <div id="clientErrorBox" class="error-box" style="display:none;" role="alert">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
        <span id="clientErrorMsg"></span>
      </div>

      <!-- Lead Capture Form -->
      <form id="connectForm" method="POST" action="/auth/connect" novalidate>
        
        <!-- Full Name Field -->
        <div class="form-group">
          <label for="name">
            <svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            Full Name
          </label>
          <input 
            type="text" 
            id="name" 
            name="name" 
            placeholder="Enter your name" 
            value="${escapeHtml(prevName)}" 
            required 
            autocomplete="name" 
            autocapitalize="words"
            maxlength="60"
          >
        </div>

        <!-- Mobile / WhatsApp Field with Country Code Selection -->
        <div class="form-group">
          <label for="phone">
            <svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
            WhatsApp / Mobile Number
          </label>
          <div class="phone-group">
            <div class="country-select-wrapper">
              <select class="country-select" id="country_code" name="country_code" aria-label="Country Code">
                <option value="+880" ${prevCountry === '+880' ? 'selected' : ''}>🇧🇩 +880</option>
                <option value="+1" ${prevCountry === '+1' ? 'selected' : ''}>🇺🇸 +1</option>
                <option value="+91" ${prevCountry === '+91' ? 'selected' : ''}>🇮🇳 +91</option>
                <option value="+44" ${prevCountry === '+44' ? 'selected' : ''}>🇬🇧 +44</option>
                <option value="+971" ${prevCountry === '+971' ? 'selected' : ''}>🇦🇪 +971</option>
                <option value="+65" ${prevCountry === '+65' ? 'selected' : ''}>🇸🇬 +65</option>
                <option value="+61" ${prevCountry === '+61' ? 'selected' : ''}>🇦🇺 +61</option>
                <option value="+49" ${prevCountry === '+49' ? 'selected' : ''}>🇩🇪 +49</option>
                <option value="+92" ${prevCountry === '+92' ? 'selected' : ''}>🇵🇰 +92</option>
                <option value="+966" ${prevCountry === '+966' ? 'selected' : ''}>🇸🇦 +966</option>
                <option value="+33" ${prevCountry === '+33' ? 'selected' : ''}>🇫🇷 +33</option>
                <option value="+81" ${prevCountry === '+81' ? 'selected' : ''}>🇯🇵 +81</option>
                <option value="+62" ${prevCountry === '+62' ? 'selected' : ''}>🇮🇩 +62</option>
                <option value="+234" ${prevCountry === '+234' ? 'selected' : ''}>🇳🇬 +234</option>
                <option value="" ${prevCountry === '' ? 'selected' : ''}>🌐 Other</option>
              </select>
            </div>
            <div class="phone-input-wrapper">
              <input 
                type="tel" 
                id="phone" 
                name="phone" 
                placeholder="Mobile number" 
                value="${escapeHtml(prevPhone)}" 
                required 
                inputmode="tel" 
                autocomplete="tel"
                maxlength="20"
              >
            </div>
          </div>
          <span class="field-hint">Used for Wi-Fi activation & sending exclusive VIP promo deals.</span>
        </div>

        <!-- Marketing & Terms Consent Checkbox -->
        <div class="checkbox-group">
          <input type="checkbox" id="consent" name="consent" value="1" checked required>
          <label for="consent">
            I agree to the <button type="button" class="terms-link" id="openTermsBtn">Terms & Privacy</button> and to receive updates via WhatsApp.
          </label>
        </div>

        <!-- Connect Button with Loading State -->
        <button type="submit" id="submitBtn" class="btn-connect">
          <svg id="btnIcon" style="width:18px; height:18px; stroke:currentColor; stroke-width:2.2; fill:none;" viewBox="0 0 24 24">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
          <div id="btnSpinner" class="spinner" style="display:none;" aria-hidden="true"></div>
          <span id="btnText">Unlock Wi-Fi Access</span>
        </button>

      </form>

      <!-- Trust Badges -->
      <div class="perks-row">
        <div class="perk-card">
          <svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
          <span>5G Speed</span>
        </div>
        <div class="perk-card">
          <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>
          <span>Encrypted</span>
        </div>
        <div class="perk-card">
          <svg viewBox="0 0 24 24"><polyline points="20 12 20 22 4 22 4 12"></polyline><rect x="2" y="7" width="20" height="5"></rect><line x1="12" y1="22" x2="12" y2="7"></line></svg>
          <span>VIP Deals</span>
        </div>
      </div>

    </div>
  </div>

  <!-- Zero-Dependency Terms & Privacy Modal -->
  <div class="modal-backdrop" id="termsModal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="modalTitle">Wi-Fi Terms & Privacy Policy</h2>
        <button type="button" class="modal-close-btn" id="closeTermsBtn" aria-label="Close modal">
          <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <div class="modal-body">
        <h3>1. Acceptable Use Policy</h3>
        <p>This complimentary Wi-Fi service is provided for regular browsing, social media, messaging, and business use. Unlawful activities, network interference, or excessive abuse of network bandwidth are strictly prohibited.</p>
        
        <h3>2. Privacy & Data Protection</h3>
        <p>We respect your privacy. The name and mobile number you provide are stored securely on this venue's local host system and are used solely to verify your Wi-Fi session and deliver occasional venue offers or discount coupons.</p>
        
        <h3>3. No Third-Party Data Selling</h3>
        <p>Your contact details will never be sold, leased, or distributed to third-party brokers. You may opt out of future promotional messages at any time by replying STOP on WhatsApp.</p>
      </div>
      <div class="modal-footer">
        <button type="button" id="acceptTermsBtn">I Understand & Accept</button>
      </div>
    </div>
  </div>

  <!-- Pure Vanilla Offline Script -->
  <script>
    (function() {
      var form = document.getElementById('connectForm');
      var nameInput = document.getElementById('name');
      var phoneInput = document.getElementById('phone');
      var countrySelect = document.getElementById('country_code');
      var consentCheckbox = document.getElementById('consent');
      var submitBtn = document.getElementById('submitBtn');
      var btnText = document.getElementById('btnText');
      var btnIcon = document.getElementById('btnIcon');
      var btnSpinner = document.getElementById('btnSpinner');
      var clientErrorBox = document.getElementById('clientErrorBox');
      var clientErrorMsg = document.getElementById('clientErrorMsg');
      
      var termsModal = document.getElementById('termsModal');
      var openTermsBtn = document.getElementById('openTermsBtn');
      var closeTermsBtn = document.getElementById('closeTermsBtn');
      var acceptTermsBtn = document.getElementById('acceptTermsBtn');

      function showError(msg) {
        clientErrorMsg.textContent = msg;
        clientErrorBox.style.display = 'flex';
        clientErrorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      function clearError() {
        clientErrorBox.style.display = 'none';
        clientErrorMsg.textContent = '';
      }

      // Filter non-digit characters on phone typing & automatically strip starting +880, 880, 88, or 0
      phoneInput.addEventListener('input', function() {
        clearError();
        var val = this.value;
        var cleaned = val.replace(/[^0-9+]/g, '');
        if (countrySelect && countrySelect.value === '+880') {
          if (cleaned.startsWith('+880')) cleaned = cleaned.slice(4);
          else if (cleaned.startsWith('880')) cleaned = cleaned.slice(3);
          else if (cleaned.startsWith('+88') && cleaned.length > 4) cleaned = cleaned.slice(3);
          else if (cleaned.startsWith('88') && cleaned.length > 11) cleaned = cleaned.slice(2);
        }
        if (cleaned.startsWith('0')) {
          cleaned = cleaned.replace(/^0+/, '');
        }
        if (val !== cleaned) this.value = cleaned;
      });

      nameInput.addEventListener('input', clearError);

      // Terms Modal Handlers
      function openModal() {
        termsModal.classList.add('active');
        document.body.style.overflow = 'hidden';
      }

      function closeModal() {
        termsModal.classList.remove('active');
        document.body.style.overflow = '';
      }

      openTermsBtn.addEventListener('click', function(e) {
        e.preventDefault();
        openModal();
      });

      closeTermsBtn.addEventListener('click', closeModal);
      
      acceptTermsBtn.addEventListener('click', function() {
        consentCheckbox.checked = true;
        closeModal();
      });

      termsModal.addEventListener('click', function(e) {
        if (e.target === termsModal) closeModal();
      });

      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && termsModal.classList.contains('active')) {
          closeModal();
        }
      });

      // Form submission validation & loading feedback
      form.addEventListener('submit', function(e) {
        clearError();

        var nameVal = (nameInput.value || '').trim();
        var phoneVal = (phoneInput.value || '').trim();

        if (nameVal.length < 2) {
          e.preventDefault();
          showError('Please enter your full name (minimum 2 characters).');
          nameInput.focus();
          return false;
        }

        var digitsOnly = phoneVal.replace(/[^0-9]/g, '');
        if (digitsOnly.length < 7 || digitsOnly.length > 15) {
          e.preventDefault();
          showError('Please enter a valid mobile number with at least 7 digits.');
          phoneInput.focus();
          return false;
        }

        // Repeating dummy test (e.g. 0000000, 1111111)
        if (/^(\\d)\\1+$/.test(digitsOnly)) {
          e.preventDefault();
          showError('Please enter a genuine mobile number.');
          phoneInput.focus();
          return false;
        }

        if (!consentCheckbox.checked) {
          e.preventDefault();
          showError('Please agree to the Terms of Service to continue.');
          consentCheckbox.focus();
          return false;
        }

        // Lock button and show animated spinner
        submitBtn.disabled = true;
        btnIcon.style.display = 'none';
        btnSpinner.style.display = 'inline-block';
        btnText.textContent = 'Unlocking Wi-Fi...';

        return true;
      });
    })();
  </script>
</body>
</html>`;
}

function getSuccessHtml(name, redirectUrl) {
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(redirectUrl || 'https://www.google.com');
  const businessName = escapeHtml(CONFIG.businessName || 'Venue');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta http-equiv="refresh" content="3;url=${safeUrl}">
  <title>Connected - ${businessName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-tap-highlight-color: transparent; }
    
    body {
      background: #080c14;
      background-image: 
        radial-gradient(circle at 15% 15%, rgba(34, 197, 94, 0.15) 0%, transparent 45%),
        radial-gradient(circle at 85% 85%, rgba(37, 99, 235, 0.18) 0%, transparent 45%),
        linear-gradient(180deg, #080c14 0%, #0f172a 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      color: #f8fafc;
      text-align: center;
    }

    .card {
      background: rgba(15, 23, 42, 0.78);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 24px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
      max-width: 440px;
      width: 100%;
      padding: 36px 26px;
      position: relative;
      overflow: hidden;
      animation: cardIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes cardIn {
      from { opacity: 0; transform: translateY(12px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, #22c55e, #38bdf8, #2563eb);
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      background: rgba(34, 197, 94, 0.12);
      border: 1px solid rgba(34, 197, 94, 0.3);
      color: #4ade80;
      padding: 5px 14px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.4px;
      margin-bottom: 20px;
    }

    .pulse-dot {
      width: 8px;
      height: 8px;
      background: #22c55e;
      border-radius: 50%;
      box-shadow: 0 0 10px #22c55e;
      animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    .icon-wrapper {
      width: 72px;
      height: 72px;
      margin: 0 auto 18px auto;
      background: linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(16, 185, 129, 0.1));
      border: 1.5px solid rgba(34, 197, 94, 0.35);
      border-radius: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 12px 30px rgba(34, 197, 94, 0.25);
      animation: popIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }

    @keyframes popIn {
      from { transform: scale(0.5); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    .icon-wrapper svg {
      width: 38px;
      height: 38px;
      stroke: #4ade80;
      stroke-width: 2.4;
      stroke-linecap: round;
      stroke-linejoin: round;
      fill: none;
    }

    h1 {
      font-size: 24px;
      color: #ffffff;
      margin-bottom: 8px;
      font-weight: 800;
      letter-spacing: -0.3px;
    }

    p.message {
      color: #94a3b8;
      font-size: 14px;
      line-height: 1.55;
      margin-bottom: 22px;
    }

    .venue-card {
      background: rgba(30, 41, 59, 0.55);
      border: 1px solid rgba(148, 163, 184, 0.15);
      border-radius: 14px;
      padding: 14px 16px;
      margin-bottom: 22px;
      text-align: left;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .venue-card svg {
      width: 28px;
      height: 28px;
      stroke: #38bdf8;
      stroke-width: 2;
      fill: none;
      flex-shrink: 0;
    }

    .venue-card-text {
      font-size: 12px;
      color: #cbd5e1;
      line-height: 1.45;
    }

    .venue-card-text strong {
      color: #ffffff;
      font-size: 13px;
      display: block;
      margin-bottom: 2px;
    }

    .countdown-box {
      margin-bottom: 22px;
    }

    .countdown-text {
      font-size: 13px;
      color: #94a3b8;
      margin-bottom: 8px;
    }

    .countdown-text b {
      color: #38bdf8;
      font-size: 15px;
    }

    .progress-track {
      width: 100%;
      height: 4px;
      background: rgba(30, 41, 59, 0.8);
      border-radius: 9999px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #2563eb, #38bdf8, #22c55e);
      width: 100%;
      border-radius: 9999px;
      transition: width 1s linear;
    }

    a.btn-continue {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      padding: 15px;
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      color: #ffffff;
      text-decoration: none;
      border-radius: 14px;
      font-weight: 700;
      font-size: 16px;
      transition: all 0.2s ease;
      box-shadow: 0 10px 25px -5px rgba(37, 99, 235, 0.5);
    }

    a.btn-continue:hover {
      background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%);
      transform: translateY(-1px);
      box-shadow: 0 14px 28px -5px rgba(37, 99, 235, 0.6);
    }

    a.btn-continue:active {
      transform: translateY(0);
    }

    a.btn-continue svg {
      width: 18px;
      height: 18px;
      stroke: currentColor;
      stroke-width: 2.2;
      fill: none;
    }

    .cna-note {
      margin-top: 16px;
      font-size: 11px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="card">
    
    <!-- Status Pill -->
    <div class="status-badge">
      <span class="pulse-dot"></span>
      <span>INTERNET ACTIVE</span>
    </div>

    <!-- Animated Checkmark Graphic -->
    <div class="icon-wrapper">
      <svg viewBox="0 0 24 24">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
    </div>

    <!-- Personalized Greeting -->
    <h1>You're Online, ${safeName}!</h1>
    <p class="message">Your device is authenticated. You can now use all your apps, social media, messaging, and web browsing.</p>

    <!-- Venue Greeting Card -->
    <div class="venue-card">
      <svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
      <div class="venue-card-text">
        <strong>Welcome to ${businessName}</strong>
        <span>Enjoy your high-speed access! Check WhatsApp shortly for exclusive coupons.</span>
      </div>
    </div>

    <!-- Countdown & Smooth Progress Bar -->
    <div class="countdown-box">
      <div class="countdown-text">Redirecting in <b id="countdownTimer">3</b>s...</div>
      <div class="progress-track">
        <div class="progress-fill" id="progressFill" style="width: 100%;"></div>
      </div>
    </div>

    <!-- High-Impact Manual Redirect Button -->
    <a href="${safeUrl}" class="btn-continue" id="redirectLink">
      <span>Continue to Web</span>
      <svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
    </a>

    <div class="cna-note">
      Tap "Done" or "Continue" if your phone displays a Wi-Fi prompt.
    </div>

  </div>

  <script>
    (function() {
      var targetUrl = ${JSON.stringify(redirectUrl || 'https://www.google.com')};
      var seconds = 3;
      var timerEl = document.getElementById('countdownTimer');
      var fillEl = document.getElementById('progressFill');

      var interval = setInterval(function() {
        seconds--;
        if (timerEl) timerEl.textContent = Math.max(0, seconds);
        if (fillEl) fillEl.style.width = Math.max(0, (seconds / 3) * 100) + '%';
        
        if (seconds <= 0) {
          clearInterval(interval);
          try {
            window.location.href = targetUrl;
          } catch(e) {}
        }
      }, 1000);
    })();
  </script>
</body>
</html>`;
}

function getCustomerTypeBadge(type) {
  const t = (type || 'Hotspot').trim();
  if (t === 'Hotspot') {
    return `<span class="type-badge badge-hotspot">📶 Hotspot</span>`;
  }
  if (t === 'Walk-in Client') {
    return `<span class="type-badge badge-walkin">🚶 Walk-in</span>`;
  }
  if (t === 'Service / Repair') {
    return `<span class="type-badge badge-repair">🛠️ Service/Repair</span>`;
  }
  if (t === 'Sales / Purchase') {
    return `<span class="type-badge badge-sales">🛒 Sales/Buyer</span>`;
  }
  return `<span class="type-badge badge-general">${escapeHtml(t)}</span>`;
}

function getAdminHtml(leads) {
  const businessName = escapeHtml(CONFIG.businessName || 'Smart Computer');
  
  // Stats calculations
  const totalCount = leads.length;
  const hotspotCount = leads.filter(l => (l.customer_type || 'Hotspot') === 'Hotspot').length;
  const walkinCount = leads.filter(l => (l.customer_type || '') !== 'Hotspot').length;
  const activeDeviceCount = authorizedIps.size;

  const tableRows = leads.map(l => {
    const safeName = escapeHtml(l.name);
    const safePhone = escapeHtml(l.phone);
    const waDigits = getWhatsAppDigits(l.phone);
    const safeIp = escapeHtml(l.ip || '');
    const safeDate = escapeHtml(l.created_at || '');
    const cType = l.customer_type || 'Hotspot';
    const typeBadge = getCustomerTypeBadge(cType);
    const folderName = getCustomerFolderName(l);
    const escapedNameForJs = safeName.replace(/'/g, "\\'");
    const escapedTypeForJs = cType.replace(/'/g, "\\'");

    const ipCell = safeIp 
      ? `<code class="ip-tag">${safeIp}</code>` 
      : `<span class="no-ip">—</span>`;

    const actionCell = `
      <div class="action-buttons-group">
        <button type="button" class="btn-action btn-edit" onclick="openEditModal(${l.id}, '${escapedNameForJs}', '${safePhone}', '${escapedTypeForJs}')" title="Edit Customer">
          <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          <span>Edit</span>
        </button>
        <form method="POST" action="/admin/customer/delete" style="display:inline;" onsubmit="return confirm('⚠️ Are you sure you want to delete customer ${escapedNameForJs} (${safePhone})?\\n\\nThis will remove their database record and delete their folder in customers/${escapeHtml(folderName)}.');">
          <input type="hidden" name="id" value="${l.id}">
          <button type="submit" class="btn-action btn-delete" title="Delete Customer">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            <span>Delete</span>
          </button>
        </form>
        ${safeIp ? `
        <form method="POST" action="/admin/revoke" style="display:inline;" onsubmit="return confirm('Disconnect Wi-Fi access for ${escapedNameForJs} (${safeIp})?');">
          <input type="hidden" name="ip" value="${safeIp}">
          <button type="submit" class="btn-action btn-disconnect" title="Disconnect Wi-Fi">
            <svg viewBox="0 0 24 24"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path><path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>
            <span>Disconnect</span>
          </button>
        </form>` : ''}
      </div>
    `;

    return `
    <tr class="customer-row" data-search="${safeName.toLowerCase()} ${safePhone} ${safeIp.toLowerCase()} ${cType.toLowerCase()}" data-type="${escapeHtml(cType.toLowerCase())}">
      <td class="col-id">#${l.id}</td>
      <td class="col-name">
        <b>${safeName}</b>
        <div style="font-size:11px; color:#64748b; margin-top:2px;">📁 customers/${escapeHtml(folderName)}</div>
      </td>
      <td class="col-type">${typeBadge}</td>
      <td class="col-phone"><a href="tel:${safePhone}" class="phone-link">${safePhone}</a></td>
      <td class="col-wa">
        <a href="https://wa.me/${waDigits}" target="_blank" class="btn-wa">
          <svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
          <span>Chat WhatsApp</span>
        </a>
      </td>
      <td class="col-ip">${ipCell}</td>
      <td class="col-date">${safeDate}</td>
      <td class="col-action">${actionCell}</td>
    </tr>
  `;
  }).join('');

  const mobileCards = leads.map(l => {
    const safeName = escapeHtml(l.name);
    const safePhone = escapeHtml(l.phone);
    const waDigits = getWhatsAppDigits(l.phone);
    const safeIp = escapeHtml(l.ip || '');
    const safeDate = escapeHtml(l.created_at || '');
    const cType = l.customer_type || 'Hotspot';
    const typeBadge = getCustomerTypeBadge(cType);
    const folderName = getCustomerFolderName(l);
    const escapedNameForJs = safeName.replace(/'/g, "\\'");
    const escapedTypeForJs = cType.replace(/'/g, "\\'");

    return `
    <div class="mobile-lead-card customer-card" data-search="${safeName.toLowerCase()} ${safePhone} ${safeIp.toLowerCase()} ${cType.toLowerCase()}" data-type="${escapeHtml(cType.toLowerCase())}">
      <div class="card-top">
        <div>
          <span class="card-id">#${l.id}</span>
          <h3 class="card-name">${safeName}</h3>
        </div>
        <div>${typeBadge}</div>
      </div>
      <div class="card-meta">
        <div class="meta-item">
          <span>📞 Phone:</span>
          <a href="tel:${safePhone}" class="phone-link"><b>${safePhone}</b></a>
        </div>
        <div class="meta-item">
          <span>📁 Folder:</span>
          <span style="font-family:monospace; font-size:11px; color:#cbd5e1;">customers/${escapeHtml(folderName)}</span>
        </div>
        <div class="meta-item">
          <span>🌐 Device IP:</span>
          <span>${safeIp ? `<code class="ip-tag">${safeIp}</code>` : '—'}</span>
        </div>
        <div class="meta-item">
          <span>🕒 Recorded:</span>
          <span>${safeDate}</span>
        </div>
      </div>
      <div class="card-actions">
        <a href="https://wa.me/${waDigits}" target="_blank" class="btn-wa">
          <svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
          <span>WhatsApp</span>
        </a>
        <button type="button" class="btn-action btn-edit" onclick="openEditModal(${l.id}, '${escapedNameForJs}', '${safePhone}', '${escapedTypeForJs}')">
          <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          <span>Edit</span>
        </button>
        <form method="POST" action="/admin/customer/delete" onsubmit="return confirm('⚠️ Are you sure you want to delete customer ${escapedNameForJs} (${safePhone})?\\n\\nThis will remove their database record and folder.');">
          <input type="hidden" name="id" value="${l.id}">
          <button type="submit" class="btn-action btn-delete">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            <span>Delete</span>
          </button>
        </form>
        ${safeIp ? `
        <form method="POST" action="/admin/revoke" onsubmit="return confirm('Disconnect Wi-Fi access for ${escapedNameForJs} (${safeIp})?');">
          <input type="hidden" name="ip" value="${safeIp}">
          <button type="submit" class="btn-action btn-disconnect">
            <svg viewBox="0 0 24 24"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path><path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>
            <span>Disconnect</span>
          </button>
        </form>` : ''}
      </div>
    </div>
  `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${businessName} - Customer Directory</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    
    body {
      background: #0b0f19;
      color: #f8fafc;
      min-height: 100vh;
      padding: 24px 16px;
    }

    .container {
      max-width: 1140px;
      margin: 0 auto;
    }

    /* Header Bar */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      flex-wrap: wrap;
      gap: 16px;
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.08);
      padding: 22px 26px;
      border-radius: 20px;
      backdrop-filter: blur(12px);
    }

    .brand-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(37, 99, 235, 0.15);
      border: 1px solid rgba(59, 130, 246, 0.3);
      color: #60a5fa;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }

    h1 {
      font-size: 24px;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: -0.3px;
    }

    p.subtitle {
      color: #94a3b8;
      font-size: 13px;
      margin-top: 4px;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .btn-add-customer {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      color: white;
      padding: 11px 18px;
      border-radius: 12px;
      border: none;
      font-weight: 700;
      font-size: 14px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35);
    }

    .btn-add-customer:hover {
      background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%);
      transform: translateY(-1px);
    }

    .btn-export {
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid rgba(148, 163, 184, 0.2);
      color: #cbd5e1;
      padding: 11px 18px;
      border-radius: 12px;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s ease;
    }

    .btn-export:hover {
      background: rgba(30, 41, 59, 1);
      color: white;
      border-color: rgba(148, 163, 184, 0.4);
    }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }

    .stat-card {
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.08);
      padding: 18px 20px;
      border-radius: 16px;
      backdrop-filter: blur(12px);
      text-align: left;
    }

    .stat-card strong {
      display: block;
      font-size: 30px;
      font-weight: 800;
      color: #38bdf8;
      letter-spacing: -0.5px;
      margin-bottom: 3px;
    }

    .stat-card span {
      font-size: 13px;
      color: #94a3b8;
      font-weight: 600;
    }

    /* Filter & Search Toolbar */
    .toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 12px;
    }

    .search-wrapper {
      position: relative;
      flex: 1;
      max-width: 440px;
    }

    .search-wrapper input {
      width: 100%;
      padding: 12px 16px 12px 40px;
      background: rgba(15, 23, 42, 0.7);
      border: 1.5px solid rgba(148, 163, 184, 0.2);
      border-radius: 12px;
      color: #ffffff;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s ease;
    }

    .search-wrapper input:focus {
      border-color: #38bdf8;
      box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.15);
    }

    .search-wrapper svg {
      position: absolute;
      left: 14px;
      top: 50%;
      transform: translateY(-50%);
      width: 17px;
      height: 17px;
      stroke: #64748b;
      stroke-width: 2;
      fill: none;
    }

    .filter-tabs {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .filter-btn {
      background: rgba(30, 41, 59, 0.6);
      border: 1px solid rgba(148, 163, 184, 0.15);
      color: #94a3b8;
      padding: 7px 12px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .filter-btn:hover {
      background: rgba(30, 41, 59, 0.9);
      color: white;
    }

    .filter-btn.active {
      background: rgba(56, 189, 248, 0.15);
      border-color: rgba(56, 189, 248, 0.35);
      color: #38bdf8;
    }

    .count-indicator {
      font-size: 13px;
      color: #94a3b8;
      font-weight: 500;
    }

    /* Table Container */
    .table-card {
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 20px;
      overflow: hidden;
      backdrop-filter: blur(12px);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }

    th {
      background: rgba(30, 41, 59, 0.6);
      padding: 14px 16px;
      font-size: 12px;
      font-weight: 700;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    td {
      padding: 14px 16px;
      font-size: 14px;
      color: #e2e8f0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      vertical-align: middle;
    }

    tr.customer-row:hover {
      background: rgba(30, 41, 59, 0.35);
    }

    .phone-link {
      color: #38bdf8;
      text-decoration: none;
      font-weight: 600;
    }

    .phone-link:hover {
      text-decoration: underline;
    }

    .btn-wa {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #22c55e;
      color: white;
      padding: 6px 12px;
      border-radius: 8px;
      text-decoration: none;
      font-size: 12px;
      font-weight: 700;
      transition: background 0.2s ease;
    }

    .btn-wa:hover {
      background: #16a34a;
    }

    .btn-wa svg {
      width: 14px;
      height: 14px;
      stroke: white;
      stroke-width: 2;
      fill: none;
    }

    /* Customer Type Badges */
    .type-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 9px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.2px;
      white-space: nowrap;
    }

    .badge-hotspot {
      background: rgba(56, 189, 248, 0.15);
      border: 1px solid rgba(56, 189, 248, 0.35);
      color: #38bdf8;
    }

    .badge-walkin {
      background: rgba(168, 85, 247, 0.15);
      border: 1px solid rgba(168, 85, 247, 0.35);
      color: #c084fc;
    }

    .badge-repair {
      background: rgba(245, 158, 11, 0.15);
      border: 1px solid rgba(245, 158, 11, 0.35);
      color: #fbbf24;
    }

    .badge-sales {
      background: rgba(34, 197, 94, 0.15);
      border: 1px solid rgba(34, 197, 94, 0.35);
      color: #4ade80;
    }

    .badge-general {
      background: rgba(148, 163, 184, 0.15);
      border: 1px solid rgba(148, 163, 184, 0.3);
      color: #cbd5e1;
    }

    .ip-tag {
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid rgba(148, 163, 184, 0.2);
      padding: 3px 8px;
      border-radius: 6px;
      font-family: monospace;
      font-size: 12px;
      color: #cbd5e1;
    }

    .no-ip {
      color: #64748b;
      font-weight: 700;
    }

    .in-store-tag {
      display: inline-block;
      font-size: 11px;
      color: #94a3b8;
      background: rgba(30, 41, 59, 0.6);
      padding: 4px 8px;
      border-radius: 6px;
      font-weight: 600;
    }

    /* Action Buttons (Table & Cards) */
    .action-buttons-group {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .btn-action {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 6px 10px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
      text-decoration: none;
      border: 1px solid transparent;
      outline: none;
    }

    .btn-action svg {
      width: 13px;
      height: 13px;
      stroke: currentColor;
      stroke-width: 2;
      fill: none;
      flex-shrink: 0;
    }

    .btn-edit {
      background: rgba(56, 189, 248, 0.12);
      border-color: rgba(56, 189, 248, 0.3);
      color: #38bdf8;
    }

    .btn-edit:hover {
      background: #0284c7;
      color: #ffffff;
      border-color: #0284c7;
    }

    .btn-delete {
      background: rgba(239, 68, 68, 0.12);
      border-color: rgba(239, 68, 68, 0.3);
      color: #f87171;
    }

    .btn-delete:hover {
      background: #dc2626;
      color: #ffffff;
      border-color: #dc2626;
    }

    .btn-disconnect {
      background: rgba(245, 158, 11, 0.12);
      border-color: rgba(245, 158, 11, 0.3);
      color: #fbbf24;
    }

    .btn-disconnect:hover {
      background: #d97706;
      color: #ffffff;
      border-color: #d97706;
    }

    /* Mobile Cards Container */
    .mobile-cards-list {
      display: none;
      flex-direction: column;
      gap: 12px;
      padding: 16px;
    }

    .mobile-lead-card {
      background: rgba(30, 41, 59, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 14px;
      padding: 16px;
    }

    .card-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
    }

    .card-id {
      font-size: 11px;
      color: #64748b;
      font-weight: 700;
      display: block;
    }

    .card-name {
      font-size: 16px;
      font-weight: 700;
      color: #ffffff;
      margin-top: 2px;
    }

    .card-meta {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 14px;
      font-size: 13px;
      color: #94a3b8;
    }

    .meta-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .card-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .card-actions .btn-wa {
      flex: 1 1 auto;
      justify-content: center;
      padding: 8px 12px;
    }

    .card-actions .btn-edit {
      flex: 1 1 auto;
      justify-content: center;
      padding: 8px 12px;
    }

    .card-actions form {
      flex: 1 1 auto;
      display: flex;
    }

    .card-actions form .btn-action {
      width: 100%;
      justify-content: center;
      padding: 8px 12px;
    }

    .empty-state {
      text-align: center;
      padding: 48px 16px;
      color: #64748b;
      font-size: 14px;
    }

    /* Add Customer Modal */
    .modal-backdrop {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 999;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }

    .modal-backdrop.active {
      display: flex;
    }

    .modal-content {
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 20px;
      max-width: 460px;
      width: 100%;
      box-shadow: 0 25px 50px rgba(0, 0, 0, 0.8);
      animation: modalFadeIn 0.25s ease;
      text-align: left;
    }

    @keyframes modalFadeIn {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }

    .modal-header {
      padding: 18px 22px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .modal-header h2 {
      font-size: 17px;
      color: #ffffff;
      font-weight: 700;
    }

    .modal-close-btn {
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      padding: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
    }

    .modal-close-btn:hover {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.06);
    }

    .modal-close-btn svg {
      width: 20px;
      height: 20px;
      stroke: currentColor;
      stroke-width: 2;
      fill: none;
    }

    .modal-body {
      padding: 22px;
    }

    .form-group {
      margin-bottom: 18px;
    }

    .form-group label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #cbd5e1;
      margin-bottom: 6px;
    }

    .form-group input, .form-group select {
      width: 100%;
      padding: 12px 14px;
      background: rgba(30, 41, 59, 0.7);
      border: 1.5px solid rgba(148, 163, 184, 0.25);
      border-radius: 10px;
      font-size: 14px;
      color: #ffffff;
      outline: none;
      transition: border-color 0.2s ease;
    }

    .form-group select option {
      background: #0f172a;
      color: #ffffff;
    }

    .form-group input:focus, .form-group select:focus {
      border-color: #38bdf8;
      box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.15);
    }

    .phone-row {
      display: flex;
      gap: 8px;
    }

    .phone-row select {
      flex: 0 0 110px;
    }

    .phone-row input {
      flex: 1;
    }

    .modal-footer {
      padding: 16px 22px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }

    .btn-secondary {
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid rgba(148, 163, 184, 0.2);
      color: #cbd5e1;
      padding: 10px 16px;
      border-radius: 10px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
    }

    .btn-save {
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      color: #ffffff;
      border: none;
      padding: 10px 18px;
      border-radius: 10px;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
    }

    /* Mobile Responsive Switch */
    @media (max-width: 768px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      table { display: none; }
      .mobile-cards-list { display: flex; }
      .header { flex-direction: column; align-items: flex-start; }
      .header-actions { width: 100%; }
      .btn-add-customer, .btn-export { flex: 1; justify-content: center; }
      .toolbar { flex-direction: column; align-items: stretch; }
      .search-wrapper { max-width: 100%; }
    }
  </style>
</head>
<body>
  <div class="container">
    
    <!-- Top Header -->
    <div class="header">
      <div>
        <div class="brand-pill">
          <svg style="width:12px; height:12px; fill:none; stroke:currentColor; stroke-width:2;" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
          <span>${businessName.toUpperCase()} SHOP</span>
        </div>
        <h1>👥 Smart Computer — Customer Directory</h1>
        <p class="subtitle">Comprehensive customer directory for Smart Computer shop — Hotspot visitors and in-store walk-in clients.</p>
      </div>

      <div class="header-actions">
        <button type="button" class="btn-add-customer" id="openAddModalBtn">
          <svg style="width:16px; height:16px; stroke:currentColor; stroke-width:2.4; fill:none;" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          <span>Add Customer</span>
        </button>
        <a href="/admin/export.csv" class="btn-export">
          <svg style="width:16px; height:16px; stroke:currentColor; stroke-width:2.2; fill:none;" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          <span>Export CSV</span>
        </a>
      </div>
    </div>

    <!-- Quick Stats Summary -->
    <div class="stats-grid">
      <div class="stat-card">
        <strong>${totalCount}</strong>
        <span>Total Customers</span>
      </div>
      <div class="stat-card">
        <strong>${hotspotCount}</strong>
        <span>Hotspot Visitors</span>
      </div>
      <div class="stat-card">
        <strong>${walkinCount}</strong>
        <span>Walk-in Clients</span>
      </div>
      <div class="stat-card">
        <strong>${activeDeviceCount}</strong>
        <span>Active Wi-Fi Devices</span>
      </div>
    </div>

    <!-- Search & Quick Filters Toolbar -->
    <div class="toolbar">
      <div class="search-wrapper">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <input type="text" id="searchInput" placeholder="Search by name, phone, IP, or type...">
      </div>

      <div class="filter-tabs">
        <button type="button" class="filter-btn active" data-filter="all">All (${totalCount})</button>
        <button type="button" class="filter-btn" data-filter="hotspot">📶 Hotspot</button>
        <button type="button" class="filter-btn" data-filter="walk-in">🚶 Walk-in</button>
        <button type="button" class="filter-btn" data-filter="service">🛠️ Service/Repair</button>
        <button type="button" class="filter-btn" data-filter="sales">🛒 Sales</button>
      </div>

      <div class="count-indicator" id="recordsCount">
        Showing <b>${totalCount}</b> record(s)
      </div>
    </div>

    <!-- Content Table / Mobile Cards -->
    <div class="table-card">
      
      <!-- Desktop Table -->
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Customer Name</th>
            <th>Customer Type</th>
            <th>Mobile Number</th>
            <th>WhatsApp</th>
            <th>Device IP</th>
            <th>Registration Date</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody id="tableBody">
          ${tableRows || '<tr><td colspan="8" class="empty-state">No customer records yet. Add a customer or connect via Wi-Fi to test!</td></tr>'}
        </tbody>
      </table>

      <!-- Mobile Cards List -->
      <div class="mobile-cards-list" id="cardsBody">
        ${mobileCards || '<div class="empty-state">No customer records yet. Add a customer or connect via Wi-Fi to test!</div>'}
      </div>

    </div>

  </div>

  <!-- Add Customer Modal -->
  <div class="modal-backdrop" id="addCustomerModal" role="dialog" aria-modal="true" aria-labelledby="addModalTitle">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="addModalTitle">➕ Add New Customer Record</h2>
        <button type="button" class="modal-close-btn" id="closeAddModalBtn" aria-label="Close modal">
          <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <form method="POST" action="/admin/customer/add">
        <div class="modal-body">
          <div class="form-group">
            <label for="custName">Customer Full Name</label>
            <input type="text" id="custName" name="name" placeholder="e.g. Tanvir Ahmed" required autocomplete="off">
          </div>
          <div class="form-group">
            <label for="custPhone">Mobile / WhatsApp Number</label>
            <div class="phone-row">
              <select name="country_code">
                <option value="+880" selected>🇧🇩 +880</option>
                <option value="+1">🇺🇸 +1</option>
                <option value="+91">🇮🇳 +91</option>
                <option value="+44">🇬🇧 +44</option>
                <option value="+971">🇦🇪 +971</option>
                <option value="+966">🇸🇦 +966</option>
                <option value="">🌐 Other</option>
              </select>
              <input type="tel" id="custPhone" name="phone" placeholder="e.g. 1712345678" required>
            </div>
            <p style="font-size:11px; color:#94a3b8; margin-top:5px;">💡 Leading 0 will be stripped automatically; folder in <code>customers/</code> will be created automatically.</p>
          </div>
          <div class="form-group">
            <label for="custType">Customer Type</label>
            <select id="custType" name="customer_type">
              <option value="Walk-in Client" selected>🚶 Walk-in Client</option>
              <option value="Service / Repair">🛠️ Service / Repair</option>
              <option value="Sales / Purchase">🛒 Sales / Purchase</option>
              <option value="General Customer">👤 General Customer</option>
              <option value="Hotspot">📶 Hotspot</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn-secondary" id="cancelAddModalBtn">Cancel</button>
          <button type="submit" class="btn-save">Save Customer Record</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Edit Customer Modal -->
  <div class="modal-backdrop" id="editCustomerModal" role="dialog" aria-modal="true" aria-labelledby="editModalTitle">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="editModalTitle">✏️ Edit Customer Record</h2>
        <button type="button" class="modal-close-btn" id="closeEditModalBtn" aria-label="Close modal">
          <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <form method="POST" action="/admin/customer/edit">
        <input type="hidden" id="editCustId" name="id">
        <div class="modal-body">
          <div class="form-group">
            <label for="editCustName">Customer Full Name</label>
            <input type="text" id="editCustName" name="name" placeholder="e.g. Tanvir Ahmed" required autocomplete="off">
          </div>
          <div class="form-group">
            <label for="editCustPhone">Mobile / WhatsApp Number</label>
            <div class="phone-row">
              <select id="editCustCountry" name="country_code">
                <option value="+880">🇧🇩 +880</option>
                <option value="+1">🇺🇸 +1</option>
                <option value="+91">🇮🇳 +91</option>
                <option value="+44">🇬🇧 +44</option>
                <option value="+971">🇦🇪 +971</option>
                <option value="+966">🇸🇦 +966</option>
                <option value="">🌐 Other</option>
              </select>
              <input type="tel" id="editCustPhone" name="phone" placeholder="e.g. 1712345678" required>
            </div>
            <p style="font-size:11px; color:#94a3b8; margin-top:5px;">💡 Leading 0 is automatically stripped; folder in <code>customers/</code> will update automatically.</p>
          </div>
          <div class="form-group">
            <label for="editCustType">Customer Type</label>
            <select id="editCustType" name="customer_type">
              <option value="Hotspot">📶 Hotspot</option>
              <option value="Walk-in Client">🚶 Walk-in Client</option>
              <option value="Service / Repair">🛠️ Service / Repair</option>
              <option value="Sales / Purchase">🛒 Sales / Purchase</option>
              <option value="General Customer">👤 General Customer</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn-secondary" id="cancelEditModalBtn">Cancel</button>
          <button type="submit" class="btn-save">Update Customer Record</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Real-time Filter & Modal Script -->
  <script>
    (function() {
      var searchInput = document.getElementById('searchInput');
      var recordsCount = document.getElementById('recordsCount');
      var tableRows = document.querySelectorAll('tr.customer-row');
      var mobileCards = document.querySelectorAll('.mobile-lead-card');
      var filterBtns = document.querySelectorAll('.filter-btn');
      var total = ${totalCount};
      var activeFilter = 'all';

      // Add Modal Handlers
      var addModal = document.getElementById('addCustomerModal');
      var openAddBtn = document.getElementById('openAddModalBtn');
      var closeAddBtn = document.getElementById('closeAddModalBtn');
      var cancelAddBtn = document.getElementById('cancelAddModalBtn');
      var addNameInput = document.getElementById('custName');

      function openAddModal() {
        if (addModal) {
          addModal.classList.add('active');
          if (addNameInput) setTimeout(function() { addNameInput.focus(); }, 100);
        }
      }
      function closeAddModal() {
        if (addModal) addModal.classList.remove('active');
      }

      if (openAddBtn) openAddBtn.addEventListener('click', openAddModal);
      if (closeAddBtn) closeAddBtn.addEventListener('click', closeAddModal);
      if (cancelAddBtn) cancelAddBtn.addEventListener('click', closeAddModal);
      if (addModal) {
        addModal.addEventListener('click', function(e) {
          if (e.target === addModal) closeAddModal();
        });
      }

      var custPhone = document.getElementById('custPhone');
      if (custPhone) {
        custPhone.addEventListener('input', function() {
          var val = this.value;
          var cleaned = val.replace(/[^0-9+]/g, '');
          if (cleaned.startsWith('+880')) cleaned = cleaned.slice(4);
          else if (cleaned.startsWith('880')) cleaned = cleaned.slice(3);
          else if (cleaned.startsWith('+88') && cleaned.length > 4) cleaned = cleaned.slice(3);
          else if (cleaned.startsWith('88') && cleaned.length > 11) cleaned = cleaned.slice(2);
          if (cleaned.startsWith('0')) {
            cleaned = cleaned.replace(/^0+/, '');
          }
          if (val !== cleaned) this.value = cleaned;
        });
      }

      // Edit Modal Handlers
      var editModal = document.getElementById('editCustomerModal');
      var closeEditBtn = document.getElementById('closeEditModalBtn');
      var cancelEditBtn = document.getElementById('cancelEditModalBtn');
      var editPhone = document.getElementById('editCustPhone');

      window.openEditModal = function(id, name, fullPhone, type) {
        var editId = document.getElementById('editCustId');
        var editName = document.getElementById('editCustName');
        var editCountry = document.getElementById('editCustCountry');
        var editPhone = document.getElementById('editCustPhone');
        var editType = document.getElementById('editCustType');

        if (editId) editId.value = id;
        if (editName) editName.value = name || '';

        var phoneStr = String(fullPhone || '').trim();
        var detectedCode = '';
        var nationalNumber = phoneStr;

        var knownCodes = ['+880', '+971', '+966', '+91', '+44', '+65', '+61', '+49', '+92', '+33', '+81', '+62', '+234', '+1'];
        for (var i = 0; i < knownCodes.length; i++) {
          var c = knownCodes[i];
          if (phoneStr.startsWith(c)) {
            detectedCode = c;
            nationalNumber = phoneStr.slice(c.length);
            break;
          }
        }

        // Strip leading 0
        nationalNumber = nationalNumber.replace(/^0+/, '');

        if (editCountry) {
          if (detectedCode) {
            editCountry.value = detectedCode;
          } else if (phoneStr.startsWith('+')) {
            editCountry.value = '';
          } else {
            editCountry.value = '+880';
          }
        }

        if (editPhone) editPhone.value = nationalNumber;
        if (editType) editType.value = type || 'Walk-in Client';

        if (editModal) {
          editModal.classList.add('active');
          if (editName) setTimeout(function() { editName.focus(); }, 100);
        }
      };

      window.closeEditModal = function() {
        if (editModal) editModal.classList.remove('active');
      };

      if (closeEditBtn) closeEditBtn.addEventListener('click', window.closeEditModal);
      if (cancelEditBtn) cancelEditBtn.addEventListener('click', window.closeEditModal);
      if (editModal) {
        editModal.addEventListener('click', function(e) {
          if (e.target === editModal) window.closeEditModal();
        });
      }

      if (editPhone) {
        editPhone.addEventListener('input', function() {
          var val = this.value;
          var cleaned = val.replace(/[^0-9+]/g, '');
          if (cleaned.startsWith('+880')) cleaned = cleaned.slice(4);
          else if (cleaned.startsWith('880')) cleaned = cleaned.slice(3);
          else if (cleaned.startsWith('+88') && cleaned.length > 4) cleaned = cleaned.slice(3);
          else if (cleaned.startsWith('88') && cleaned.length > 11) cleaned = cleaned.slice(2);
          if (cleaned.startsWith('0')) {
            cleaned = cleaned.replace(/^0+/, '');
          }
          if (val !== cleaned) this.value = cleaned;
        });
      }

      // Close modals on Escape key
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
          if (addModal && addModal.classList.contains('active')) closeAddModal();
          if (editModal && editModal.classList.contains('active')) window.closeEditModal();
        }
      });

      // Filter & Search Logic
      function applyFilters() {
        var query = (searchInput ? searchInput.value : '').trim().toLowerCase();
        var visibleCount = 0;

        tableRows.forEach(function(row) {
          var searchStr = row.getAttribute('data-search') || '';
          var rowType = row.getAttribute('data-type') || '';
          var matchesQuery = !query || searchStr.indexOf(query) !== -1;
          var matchesType = activeFilter === 'all' || rowType.indexOf(activeFilter) !== -1;

          if (matchesQuery && matchesType) {
            row.style.display = '';
            visibleCount++;
          } else {
            row.style.display = 'none';
          }
        });

        mobileCards.forEach(function(card) {
          var searchStr = card.getAttribute('data-search') || '';
          var cardType = card.getAttribute('data-type') || '';
          var matchesQuery = !query || searchStr.indexOf(query) !== -1;
          var matchesType = activeFilter === 'all' || cardType.indexOf(activeFilter) !== -1;

          if (matchesQuery && matchesType) {
            card.style.display = '';
          } else {
            card.style.display = 'none';
          }
        });

        if (recordsCount) {
          recordsCount.innerHTML = 'Showing <b>' + visibleCount + '</b> of ' + total + ' record(s)';
        }
      }

      if (searchInput) searchInput.addEventListener('input', applyFilters);

      filterBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
          filterBtns.forEach(function(b) { b.classList.remove('active'); });
          this.classList.add('active');
          activeFilter = this.getAttribute('data-filter') || 'all';
          applyFilters();
        });
      });
    })();
  </script>
</body>
</html>`;
}

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
        if (firewall) firewall.revokeIp(ip);
        console.log(`[Revoke] Access revoked for IP: ${ip}`);
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

      // Save lead to database
      const userAgent = req.headers['user-agent'] || '';
      const insertStmt = db.prepare('INSERT INTO leads (name, phone, ip, customer_type, marketing_opt_in, user_agent) VALUES (?, ?, ?, "Hotspot", 1, ?)');
      const result = insertStmt.run(name, phone, clientIp, userAgent);
      createCustomerFolder({
        id: result.lastInsertRowid,
        name,
        phone,
        customer_type: 'Hotspot',
        ip: clientIp,
        created_at: new Date().toISOString()
      });

      // Authorize client IP
      authorizedIps.add(clientIp);
      if (firewall) firewall.allowIp(clientIp);
      console.log(`[+] NEW HOTSPOT CUSTOMER: ${name} (${phone}) from IP: ${clientIp}`);

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
