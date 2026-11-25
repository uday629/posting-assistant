// Detects GPU/VRAM/RAM and is used to show which local models fit this PC.
const os = require('os');
const { execFile } = require('child_process');

function run(cmd, args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

let cache = null;
async function detect(force = false) {
  if (cache && !force) return cache;
  const ramGB = Math.round(os.totalmem() / 1073741824);
  const gpus = [];
  const smi = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
  for (const line of smi.split(/\r?\n/).filter(Boolean)) {
    const [name, mem] = line.split(',').map((s) => s.trim());
    if (name) gpus.push({ name, vramGB: Math.round(Number(mem) / 1024 * 10) / 10, vendor: 'NVIDIA' });
  }
  if (!gpus.length && process.platform === 'win32') {
    // qwMemorySize in the display-adapter registry keys reports the real VRAM (WMI caps it at 4 GB)
    const ps = await run('powershell', ['-NoProfile', '-Command',
      "Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -ErrorAction SilentlyContinue | Where-Object { $_.DriverDesc } | ForEach-Object { \"$($_.DriverDesc)|$($_.'HardwareInformation.qwMemorySize')\" }"], 12000);
    for (const line of ps.split(/\r?\n/).filter(Boolean)) {
      const [name, mem] = line.split('|');
      const v = Number(mem) || 0;
      if (/basic display|remote|virtual/i.test(name)) continue;
      gpus.push({ name: name.trim(), vramGB: Math.round(v / 1073741824 * 10) / 10, vendor: /amd|radeon/i.test(name) ? 'AMD' : /intel/i.test(name) ? 'Intel' : 'Other' });
    }
  }
  if (process.platform === 'darwin' && /arm64/.test(process.arch)) {
    gpus.push({ name: 'Apple Silicon (unified memory)', vramGB: Math.round(ramGB * 0.65), vendor: 'Apple' });
  }
  const best = gpus.slice().sort((a, b) => b.vramGB - a.vramGB)[0];
  const usable = best && best.vendor !== 'Intel' ? best.vramGB : 0;
  cache = { ramGB, gpus, vramGB: usable, cpu: os.cpus()[0]?.model, cores: os.cpus().length, platform: process.platform };
  return cache;
}

module.exports = { detect };
