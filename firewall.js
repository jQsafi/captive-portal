const { execSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const PS_SCRIPT = path.join(__dirname, 'firewall.ps1');
const ALLOWED_FILE = path.join(__dirname, 'allowed_ips.txt');

function isWindows() {
  return os.platform() === 'win32';
}

function runFirewallCmd(args) {
  if (!isWindows()) return { success: false, message: 'Not running on Windows' };
  try {
    const out = execSync(`powershell -ExecutionPolicy Bypass -File "${PS_SCRIPT}" ${args}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return { success: true, output: out.trim() };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    return { success: false, error: err.message, stderr };
  }
}

function initFirewall(initialAuthorizedIps = []) {
  if (!isWindows()) return;
  try {
    fs.writeFileSync(ALLOWED_FILE, initialAuthorizedIps.join('\n'), 'utf8');
    const res = runFirewallCmd(`-Action init`);
    if (res.success) {
      console.log('[Firewall] ✓ Unauthorized clients are BLOCKED from internet.');
      if (initialAuthorizedIps.length > 0) {
        runFirewallCmd(`-Action sync -AllowedIpsFile "${ALLOWED_FILE}"`);
      }
    } else {
      console.log('[Firewall] (Notice) Run as Administrator to enforce internet blocking.');
    }
  } catch (err) {
    console.error('[Firewall] Init error:', err.message);
  }
}

function allowIp(ip) {
  if (!isWindows()) return;
  try {
    const res = runFirewallCmd(`-Action allow -Ip "${ip}" -AllowedIpsFile "${ALLOWED_FILE}"`);
    if (res.success) {
      console.log(`[Firewall] ✓ Unlocked internet for IP: ${ip}`);
    }
  } catch (err) {
    console.error(`[Firewall] Failed to allow ${ip}:`, err.message);
  }
}

function revokeIp(ip) {
  if (!isWindows()) return;
  try {
    const res = runFirewallCmd(`-Action revoke -Ip "${ip}" -AllowedIpsFile "${ALLOWED_FILE}"`);
    if (res.success) {
      console.log(`[Firewall] ✓ Blocked internet for IP: ${ip}`);
    }
  } catch (err) {
    console.error(`[Firewall] Failed to revoke ${ip}:`, err.message);
  }
}

function cleanupFirewall() {
  if (!isWindows()) return;
  try {
    runFirewallCmd(`-Action cleanup`);
    if (fs.existsSync(ALLOWED_FILE)) {
      fs.unlinkSync(ALLOWED_FILE);
    }
    console.log('[Firewall] Cleaned up firewall rules.');
  } catch (err) {
    // ignore
  }
}

module.exports = {
  isWindows,
  initFirewall,
  allowIp,
  revokeIp,
  cleanupFirewall
};
