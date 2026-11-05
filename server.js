const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
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

// --- Marketing Settings ---
const CONFIG = {
  businessName: 'Smart Computer',
  promoHeadline: 'Welcome to Smart Computer! 🎁',
  promoSubtext: 'Enter your name and mobile number to unlock instant unlimited high-speed internet.',
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
    ip TEXT NOT NULL,
    marketing_opt_in INTEGER DEFAULT 1,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

const authorizedIps = new Set();
const recentLeadsStmt = db.prepare("SELECT DISTINCT ip FROM leads WHERE created_at >= datetime('now', '-1 day')");
for (const row of recentLeadsStmt.all()) {
  authorizedIps.add(row.ip);
}
console.log(`[Database] Loaded ${authorizedIps.size} active authorized client(s).`);

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

// Clean phone number (strip spaces, dashes, parentheses)
function cleanPhoneNumber(phone) {
  return phone.replace(/[^0-9+]/g, '');
}

// Validate phone number (minimum 7 digits, maximum 16 digits, not repeating dummy)
function isValidPhoneNumber(phone) {
  const digitsOnly = phone.replace(/[^0-9]/g, '');
  if (digitsOnly.length < 7 || digitsOnly.length > 15) return false;
  // Check dummy repeating digits like 0000000 or 1111111
  if (/^(\d)\1+$/.test(digitsOnly)) return false;
  return true;
}

// --- 2. HTML Templates ---
function getPortalHtml(clientIp, error = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${CONFIG.businessName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    body { background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; }
    .card { background: #ffffff; border-radius: 20px; box-shadow: 0 15px 35px rgba(0,0,0,0.3); max-width: 400px; width: 100%; padding: 32px 24px; text-align: center; }
    .badge { display: inline-block; background: #e0f2fe; color: #0284c7; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 700; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    h1 { font-size: 22px; color: #0f172a; margin-bottom: 8px; font-weight: 800; }
    p.subtitle { color: #64748b; font-size: 14px; margin-bottom: 24px; line-height: 1.5; }
    .form-group { text-align: left; margin-bottom: 16px; }
    label { font-size: 13px; font-weight: 600; color: #334155; display: block; margin-bottom: 6px; }
    input[type="text"], input[type="tel"] { width: 100%; padding: 13px 14px; border: 1.5px solid #cbd5e1; border-radius: 10px; font-size: 15px; outline: none; transition: border-color 0.2s; }
    input[type="text"]:focus, input[type="tel"]:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.15); }
    .checkbox-group { display: flex; align-items: flex-start; gap: 8px; text-align: left; margin: 18px 0 10px 0; font-size: 12px; color: #64748b; }
    .checkbox-group input { margin-top: 2px; }
    button { width: 100%; padding: 14px; background: #2563eb; color: #fff; border: none; border-radius: 10px; font-size: 16px; font-weight: 700; cursor: pointer; margin-top: 10px; transition: background 0.2s; }
    button:hover { background: #1d4ed8; }
    .error { background: #fef2f2; color: #dc2626; padding: 10px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; border: 1px solid #fecaca; }
    .perks { display: flex; justify-content: space-around; margin-top: 20px; padding-top: 16px; border-top: 1px solid #f1f5f9; }
    .perk-item { font-size: 11px; color: #64748b; font-weight: 500; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">FREE HIGH-SPEED WI-FI</div>
    <h1>${CONFIG.promoHeadline}</h1>
    <p class="subtitle">${CONFIG.promoSubtext}</p>
    
    ${error ? `<div class="error">⚠️ ${error}</div>` : ''}

    <form method="POST" action="/auth/connect">
      <div class="form-group">
        <label for="name">Full Name</label>
        <input type="text" id="name" name="name" placeholder="Enter your name" required autocomplete="name">
      </div>
      <div class="form-group">
        <label for="phone">WhatsApp / Mobile Number</label>
        <input type="tel" id="phone" name="phone" placeholder="e.g. +91 9876543210" required autocomplete="tel">
      </div>
      <div class="checkbox-group">
        <input type="checkbox" id="consent" name="consent" value="1" checked required>
        <label for="consent">I agree to receive VIP promotions, coupons & offers via WhatsApp / SMS.</label>
      </div>
      <button type="submit">Connect to Wi-Fi Now</button>
    </form>

    <div class="perks">
      <div class="perk-item">⚡ 5G Speed</div>
      <div class="perk-item">🔒 Secure Browsing</div>
      <div class="perk-item">🎁 VIP Discounts</div>
    </div>
  </div>
</body>
</html>`;
}

function getSuccessHtml(name, redirectUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="4;url=${redirectUrl}">
  <title>Connected!</title>
  <style>
    body { background: #f8fafc; font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; text-align: center; }
    .card { background: white; border-radius: 20px; padding: 36px 24px; max-width: 400px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.08); }
    .icon { font-size: 50px; margin-bottom: 12px; }
    h1 { color: #16a34a; font-size: 22px; margin-bottom: 8px; font-weight: 800; }
    p { color: #475569; font-size: 14px; line-height: 1.5; margin-bottom: 20px; }
    .redirect-note { font-size: 12px; color: #94a3b8; margin-top: 16px; }
    a.btn { display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 15px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🎉</div>
    <h1>You're Connected, ${escapeHtml(name)}!</h1>
    <p>Your high-speed Wi-Fi is active. You can now use all your apps, social media, and web browsing.</p>
    <a href="${redirectUrl}" class="btn">Continue to Internet</a>
    <div class="redirect-note">Redirecting automatically in 3 seconds...</div>
  </div>
</body>
</html>`;
}

function getAdminHtml(leads) {
  const rows = leads.map(l => `
    <tr>
      <td>#${l.id}</td>
      <td><b>${escapeHtml(l.name)}</b></td>
      <td><a href="tel:${escapeHtml(l.phone)}" style="color:#2563eb; font-weight:bold; text-decoration:none;">${escapeHtml(l.phone)}</a></td>
      <td><a href="https://wa.me/${cleanPhoneNumber(l.phone)}" target="_blank" style="background:#25D366; color:white; padding:4px 10px; border-radius:6px; text-decoration:none; font-size:12px; font-weight:bold; display:inline-block;">💬 Chat WhatsApp</a></td>
      <td><code>${l.ip}</code></td>
      <td>${l.created_at}</td>
      <td>
        <form method="POST" action="/admin/revoke" style="display:inline;">
          <input type="hidden" name="ip" value="${l.ip}">
          <button type="submit" style="background:#ef4444; color:white; border:none; padding:5px 9px; border-radius:6px; cursor:pointer; font-size:12px;">Revoke</button>
        </form>
      </td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Wi-Fi Marketing Leads Dashboard</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #f1f5f9; margin: 0; padding: 20px; }
    .container { max-width: 960px; margin: 0 auto; background: white; padding: 24px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
    h1 { font-size: 22px; color: #0f172a; margin: 0; }
    .btn-export { background: #10b981; color: white; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 14px; display: inline-flex; align-items: center; gap: 6px; }
    .btn-export:hover { background: #059669; }
    .stats { display: flex; gap: 16px; margin-bottom: 24px; }
    .stat-card { background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 12px; flex: 1; text-align: center; }
    .stat-card strong { display: block; font-size: 28px; color: #2563eb; }
    .stat-card span { font-size: 13px; color: #64748b; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 12px 10px; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
    th { background: #f8fafc; font-weight: 700; color: #475569; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1>🎯 Wi-Fi Marketing Leads</h1>
        <p style="color:#64748b; font-size:13px; margin-top:4px;">Collected customer phone numbers for marketing campaigns & offers.</p>
      </div>
      <a href="/admin/export.csv" class="btn-export">📥 Download Leads (CSV / Excel)</a>
    </div>

    <div class="stats">
      <div class="stat-card">
        <strong>${leads.length}</strong>
        <span>Total Customer Leads</span>
      </div>
      <div class="stat-card">
        <strong>${authorizedIps.size}</strong>
        <span>Currently Connected IPs</span>
      </div>
    </div>

    <table>
      <thead>
        <tr><th>ID</th><th>Name</th><th>Mobile Number</th><th>Direct WhatsApp</th><th>IP Address</th><th>Joined Date</th><th>Action</th></tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="7" style="text-align:center; padding:30px; color:#94a3b8;">No customer numbers collected yet. Connect to Wi-Fi to test!</td></tr>'}
      </tbody>
    </table>
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
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

  // 3.2 1-Click CSV / Excel Export
  if (parsedUrl.pathname === '/admin/export.csv') {
    const leads = db.prepare('SELECT id, name, phone, ip, created_at FROM leads ORDER BY id DESC').all();
    let csv = 'ID,Name,Phone Number,IP Address,Date Created\n';
    for (const lead of leads) {
      csv += `"${lead.id}","${lead.name.replace(/"/g, '""')}","${lead.phone}","${lead.ip}","${lead.created_at}"\n`;
    }
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="wifi_marketing_leads.csv"'
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
      const rawPhone = (params.get('phone') || '').trim();
      const phone = cleanPhoneNumber(rawPhone);

      // Validate inputs
      if (!name || !phone) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(getPortalHtml(clientIp, 'Please enter both your name and phone number.'));
      }

      if (!isValidPhoneNumber(phone)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(getPortalHtml(clientIp, 'Please enter a valid mobile number (e.g. +91 9876543210).'));
      }

      // Save lead to database
      const userAgent = req.headers['user-agent'] || '';
      const insertStmt = db.prepare('INSERT INTO leads (name, phone, ip, marketing_opt_in, user_agent) VALUES (?, ?, ?, 1, ?)');
      insertStmt.run(name, phone, clientIp, userAgent);

      // Authorize client IP
      authorizedIps.add(clientIp);
      if (firewall) firewall.allowIp(clientIp);
      console.log(`[+] NEW MARKETING LEAD: ${name} (${phone}) from IP: ${clientIp}`);

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
  console.log(`🎯 Wi-Fi Marketing Captive Portal running on Port ${activePort}`);
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
  console.log(`📊 Marketing Dashboard: http://localhost${portSuffix}/admin`);
  console.log(`📥 Download CSV Leads:  http://localhost${portSuffix}/admin/export.csv`);
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
