// GPU heat guard (from Bunnys Search): watches an NVIDIA GPU while the app works. Warm -> small pauses between AI
// calls, hot -> waits until it cools down, lost -> stops local AI work and raises an alert.
const { execFile } = require('child_process');
const { EventEmitter } = require('events');

function query() {
  return new Promise((resolve) => {
    execFile('nvidia-smi', ['--query-gpu=temperature.gpu,utilization.gpu,power.draw,power.limit', '--format=csv,noheader,nounits'],
      { timeout: 6000, windowsHide: true }, (err, stdout, stderr) => {
        const out = `${stdout || ''}${stderr || ''}`;
        if (/GPU is lost|Unable to determine the device handle|No devices were found/i.test(out)) return resolve({ lost: true });
        if (err && !stdout) return resolve(null);
        const [temp, util, power, limit] = String(stdout).split(/\r?\n/)[0].split(',').map((x) => Number(String(x).trim()));
        if (isNaN(temp)) return resolve(null);
        resolve({ temp, util, power, limit });
      });
  });
}

class GpuGuard extends EventEmitter {
  constructor() {
    super();
    this.timer = null;
    this.last = null;
    this.state = 'ok'; // ok | warm | hot | critical | lost | none
    // warm: short pauses between AI calls; hot: long pauses (work goes on, slower); critical: waits until cool
    this.cfg = { enabled: true, warm: 76, hot: 82, stop: 88, cool: 68 };
    this.users = 0;
  }
  configure(cfg) { Object.assign(this.cfg, cfg || {}); }
  // only polls while some AI work is running (no background cost when idle)
  acquire() { this.users++; this.start(); }
  release() { this.users = Math.max(0, this.users - 1); if (!this.users) setTimeout(() => { if (!this.users) this.stop(); }, 30000); }
  start() {
    if (this.timer || this.state === 'none') return;
    const tick = async () => {
      const r = await query();
      if (r === null) { this.stop(); this.state = 'none'; this.last = null; this.emit('reading', null); return; }
      this.last = { ...r, at: Date.now() };
      const prev = this.state;
      if (r.lost) this.state = 'lost';
      else if (!this.cfg.enabled) this.state = 'ok';
      else if (r.temp >= (this.cfg.stop || this.cfg.hot + 6)) this.state = 'critical';
      else if (prev === 'critical' && r.temp > this.cfg.cool) this.state = 'critical';
      else if (r.temp >= this.cfg.hot) this.state = 'hot';
      else if (r.temp >= this.cfg.warm) this.state = 'warm';
      else this.state = 'ok';
      this.emit('reading', this.last);
      if (prev !== this.state) this.emit('state', this.state, this.last);
    };
    tick();
    this.timer = setInterval(tick, 5000);
  }
  stop() { clearInterval(this.timer); this.timer = null; }
  // call before each local AI step: waits while hot, small pause when warm
  async gate(signal) {
    if (this.state === 'lost') throw new Error('The GPU stopped responding (driver reports it lost). Save your work and restart the PC.');
    if (this.state === 'warm') await new Promise((r) => setTimeout(r, 3000));
    if (this.state === 'hot') await new Promise((r) => setTimeout(r, 12000));
    while (this.state === 'critical') {
      if (signal?.aborted) throw new Error('ABORTED');
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

module.exports = new GpuGuard();
module.exports.query = query;
