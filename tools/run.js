// Command-line runner: node tools/run.js '{"matchEveryDays":7}' 20
// Prints the Monte Carlo summary for one scenario (defaults = UK today).
const sim = require('../src/engine.js');
const params = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const runs = Number(process.argv[3] || 20);
const t0 = Date.now();
const s = sim.runMany(params, runs, 1);
const pct = (o) => `${(100 * o.mean).toFixed(1)}% (${(100 * o.lo).toFixed(0)}-${(100 * o.hi).toFixed(0)})`;
console.log(JSON.stringify(params), `runs=${runs}`, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('  transplanted       ', pct(s.pctTransplanted));
console.log('  within 1 year      ', pct(s.pctWithinYear));
console.log('  left unmatched     ', pct(s.pctLeft));
console.log('  median wait (days) ', s.medianWait.mean.toFixed(0), `(${s.medianWait.lo.toFixed(0)}-${s.medianWait.hi.toFixed(0)})`);
console.log('  group O / non-O    ', pct(s.pctO), '/', pct(s.pctNonO));
console.log('  highly sens / not  ', pct(s.pctHighlySensitised), '/', pct(s.pctNotHS));
console.log('  share O, share HS  ', pct(s.shareO), pct(s.shareHS));
console.log('  avg pool           ', s.avgPool.mean.toFixed(0));
console.log('  pair tx / yr       ', s.pairTxPerYear.mean.toFixed(0), ' waiting-list tx/yr', s.waitingListPerYear.mean.toFixed(0));
console.log('  fall-through rate  ', pct(s.failRate), ' chain share', pct(s.chainShare), ' cross-border', pct(s.crossBorderShare));
console.log('  by cRF band        ', s.byBand.map(pct).join(' | '), ' [NHSBT 57|61|53|31|3]');
console.log('  band mix           ', s.bandShare.map(pct).join(' | '), ' [NHSBT 43|30|7|13|7]');
console.log('  by group O A B AB  ', s.byGroup.map(pct).join(' | '), ' [NHSBT 40|64|54|42]');
console.log('  compatible pairs/yr', s.compatiblePerYear.mean.toFixed(0), ' [NHSBT ~41]');
for (const [k, v] of Object.entries(s.byRegion)) console.log('  region', k, pct(v));
