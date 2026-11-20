// Accuracy checks for the simulation engine.  Run:  node tools/test.js
// Each check runs the engine in audit mode and compares what it actually did
// with what the settings say it should do.
const S = require('../src/engine.js');
let fails = 0;
function check(name, pass, detail) {
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? '  -  ' + detail : ''));
  if (!pass) fails++;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const pct = (x) => (100 * x).toFixed(1) + '%';

const scenarios = [
  ['UK today', {}],
  ['Three regions, separate', { arrivals: { uk: 231, sa: 231, me: 231 }, crossBorder: false }],
  ['Three regions, shared + O rule + A2 + weekly', { arrivals: { uk: 231, sa: 231, me: 231 }, crossBorder: true, protectO: true, a2Donors: true, matchEveryDays: 7 }],
];

for (const [name, params] of scenarios) {
  console.log('\n== ' + name + ' ==');
  const P = Object.assign({}, S.DEFAULTS, params, { debug: true });
  P.arrivals = Object.assign({}, S.DEFAULTS.arrivals, params.arrivals || {});
  const agg = { trials: 0, hits: 0, exp: 0, prop: 0, failed: 0, dSum: 0, dN: 0, poolDays: 0, leaves: 0, inc: 0, years: 0, viol: [] };
  for (let seed = 1; seed <= 5; seed++) {
    const d = S.simulate(P, seed * 101).debug;
    agg.trials += d.edgeTrials; agg.hits += d.edgeHits; agg.exp += d.edgeExpected;
    agg.prop += d.proposed; agg.failed += d.failed; agg.dSum += d.delaySum; agg.dN += d.delayN;
    agg.poolDays += d.poolDays; agg.leaves += d.leaves; agg.inc += d.incompatibleArrivals; agg.years += d.simYears;
    agg.viol.push(...d.violations);
  }
  check('every proposed swap uses real links that obey blood-group, border and O rules', agg.viol.length === 0,
    agg.prop + ' swaps audited, ' + agg.viol.length + ' problems' + (agg.viol.length ? ' (' + agg.viol.slice(0, 3).join('; ') + ')' : ''));
  const target = Object.values(P.arrivals).reduce((s, x) => s + x, 0);
  const perYear = agg.inc / agg.years;
  check('incompatible pairs joining per year match the setting', near(perYear, target, target * 0.04),
    perYear.toFixed(0) + ' a year vs set ' + target);
  check('donor-patient links occur at (1 - antibody level) x acceptance', near(agg.hits / agg.exp, 1, 0.02),
    'observed ' + agg.hits + ' vs expected ' + agg.exp.toFixed(0) + ' links');
  check('share of swaps falling through matches the setting', near(agg.failed / agg.prop, P.fallThrough, 0.03),
    pct(agg.failed / agg.prop) + ' vs set ' + pct(P.fallThrough));
  check('average days from match to surgery matches the setting', near(agg.dSum / agg.dN, P.daysToSurgery, 4),
    (agg.dSum / agg.dN).toFixed(1) + ' days vs set ' + P.daysToSurgery);
  const leaveRate = 1 - Math.exp(-agg.leaves / (agg.poolDays / 365));
  check('share of waiting pairs leaving per year matches the setting', near(leaveRate, P.leaveRatePerYear, 0.02),
    pct(leaveRate) + ' vs set ' + pct(P.leaveRatePerYear));
}

console.log('\n== Behaviour ==');
const a = S.simulate({}, 7), b = S.simulate({}, 7);
check('same random seed gives exactly the same result (reproducible)', a.pctTransplanted === b.pctTransplanted && a.medianWait === b.medianWait);
const base = S.runMany({}, 12, 3).pctTransplanted.mean;
const big = S.runMany({ arrivals: { uk: 693 } }, 12, 3).pctTransplanted.mean;
const noFail = S.runMany({ fallThrough: 0 }, 12, 3).pctTransplanted.mean;
const noAcc = S.runMany({ acceptance: 0.001, altruisticPer100: 0 }, 6, 3).pctTransplanted.mean;
check('a bigger pool transplants a larger share', big > base, pct(base) + ' -> ' + pct(big));
check('no swaps falling through transplants a larger share', noFail > base, pct(base) + ' -> ' + pct(noFail));
check('if no donor is ever acceptable, almost nobody is transplanted', noAcc < 0.02, pct(noAcc));

console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
process.exit(fails ? 1 : 0);
