const { execSync, spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

const PS_SCRIPT = path.join(__dirname, 'hotspot.ps1');

function isWindows() {
  return os.platform() === 'win32';
}

function runPsCommand(args) {
  if (!isWindows()) return { success: false, message: 'Not running on Windows' };
  try {
    const output = execSync(`powershell -ExecutionPolicy Bypass -File "${PS_SCRIPT}" ${args}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return { success: true, output: output.trim() };
  } catch (err) {
    return { success: false, error: err.message, stderr: err.stderr ? err.stderr.toString() : '' };
  }
}

function startHotspot(options = {}) {
  const ssid = options.ssid || 'Smart Computer Guest';
  const password = options.password || '11111111';
  console.log(`[Hotspot] Starting Windows Mobile Hotspot (SSID: "${ssid}")...`);
  const res = runPsCommand(`-Action start -Ssid "${ssid}" -Password "${password}"`);
  if (res.success) {
    console.log(`[Hotspot] ✓ Hotspot is running.`);
    return true;
  } else {
    console.warn(`[Hotspot] ⚠️ Could not auto-start hotspot: ${res.error || res.stderr}`);
    return false;
  }
}

function stopHotspot() {
  console.log('[Hotspot] Stopping Windows Mobile Hotspot...');
  const res = runPsCommand('-Action stop');
  return res.success;
}

function getHotspotStatus() {
  const res = runPsCommand('-Action status');
  if (!res.success) return null;
  const lines = res.output.split('\n');
  const info = {};
  for (const line of lines) {
    const [k, ...v] = line.split(':');
    if (k && v.length) info[k.trim()] = v.join(':').trim();
  }
  return info;
}

module.exports = {
  isWindows,
  startHotspot,
  stopHotspot,
  getHotspotStatus
};
