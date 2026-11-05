const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const HOSTS_FILE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32\\drivers\\etc\\hosts');
const TAG_START = '# === CAPTIVE PORTAL PROBE REDIRECTS (START) ===';
const TAG_END   = '# === CAPTIVE PORTAL PROBE REDIRECTS (END) ===';

const PROBE_DOMAINS = [
  // Android / Chrome / Google
  'connectivitycheck.gstatic.com',
  'connectivitycheck.android.com',
  'clients3.google.com',
  'clients1.google.com',
  'play.googleapis.com',
  'www.google.com',
  'g.cn',
  // Samsung
  'connectivity.samsung.com',
  // Xiaomi / MIUI / HyperOS
  'connect.rom.miui.com',
  // Huawei / Honor
  'connectivitycheck.platform.hicloud.com',
  // Apple iOS / macOS / iPadOS
  'captive.apple.com',
  'www.apple.com',
  'appleiphonecell.com',
  'www.airport.us',
  'www.ibook.info',
  'www.itools.info',
  'www.thinkdifferent.us',
  // Windows
  'www.msftconnecttest.com',
  'www.msftncsi.com',
  'ipv6.msftconnecttest.com'
];

function enableProbeRedirects(gatewayIp = '192.168.137.1') {
  try {
    let content = fs.readFileSync(HOSTS_FILE, 'utf8');
    // Remove old block if exists
    content = removeOldBlock(content);

    const blockLines = [
      TAG_START,
      ...PROBE_DOMAINS.map(d => `${gatewayIp} ${d}`),
      TAG_END
    ];

    content = content.trimEnd() + '\r\n\r\n' + blockLines.join('\r\n') + '\r\n';
    fs.writeFileSync(HOSTS_FILE, content, 'utf8');
    try { execSync('ipconfig /flushdns', { stdio: 'ignore' }); } catch (e) {}
    console.log(`[DNS/Hosts] ✓ Redirected mobile probe domains to ${gatewayIp} for automatic sign-in popup.`);
    return true;
  } catch (err) {
    console.log(`[DNS/Hosts] (Notice) Could not modify hosts file: ${err.message}. Run as Administrator for auto-popup.`);
    return false;
  }
}

function disableProbeRedirects() {
  try {
    let content = fs.readFileSync(HOSTS_FILE, 'utf8');
    if (content.includes(TAG_START)) {
      content = removeOldBlock(content);
      fs.writeFileSync(HOSTS_FILE, content, 'utf8');
      try { execSync('ipconfig /flushdns', { stdio: 'ignore' }); } catch (e) {}
      console.log('[DNS/Hosts] ✓ Removed mobile probe redirects from hosts file.');
    }
    return true;
  } catch (err) {
    return false;
  }
}

function removeOldBlock(content) {
  const startIndex = content.indexOf(TAG_START);
  const endIndex = content.indexOf(TAG_END);
  if (startIndex !== -1 && endIndex !== -1) {
    const before = content.slice(0, startIndex);
    const after = content.slice(endIndex + TAG_END.length);
    return (before + after).trimEnd() + '\r\n';
  }
  return content;
}

module.exports = {
  enableProbeRedirects,
  disableProbeRedirects
};
