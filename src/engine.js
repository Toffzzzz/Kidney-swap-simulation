/*
 * Kidney paired exchange - Monte Carlo simulation engine.
 *
 * One call to simulate(params, seed) plays out several years of an exchange
 * scheme day by day: incompatible donor-recipient pairs join, matching runs
 * happen on a timetable, agreed swaps either go ahead or fall through, and
 * pairs who wait too long leave. Running it many times with different random
 * seeds (runMany) gives the spread of outcomes - the Monte Carlo part.
 *
 * Works in a browser (global KidneySim) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Fixed inputs (sources in README.md)
  // ---------------------------------------------------------------------------

  // ABO blood group frequencies by region.
  const REGIONS = {
    uk: { name: 'UK & Europe', abo: { O: 0.47, A: 0.42, B: 0.08, AB: 0.03 } },
    sa: { name: 'South Asia', abo: { O: 0.371, A: 0.229, B: 0.323, AB: 0.077 } },
    me: { name: 'Gulf / Middle East', abo: { O: 0.518, A: 0.259, B: 0.18, AB: 0.043 } },
  };
  const REGION_KEYS = Object.keys(REGIONS);
  const ABO = ['O', 'A', 'B', 'AB'];

  // Sensitisation (calculated reaction frequency, cRF) of patients who have a
  // willing living donor, before anyone decides to join. Each band:
  // [share, lowest, highest, label]. The shares are back-calculated so that the
  // pairs who JOIN match the NHSBT 2021-25 registrations (Table 4.3):
  // 0-9% 43%, 10-84% 30%, 85-94% 7%, 95-99% 13%, 100% 7%.
  const CPRA_BANDS = [
    [0.619, 0.00, 0.09, '0-9%'],
    [0.236, 0.10, 0.84, '10-84%'],
    [0.041, 0.85, 0.94, '85-94%'],
    [0.067, 0.95, 0.99, '95-99%'],
    [0.037, 0.998, 1.0, '100%'],
  ];

  const DEFAULTS = {
    arrivals: { uk: 231, sa: 0, me: 0 }, // incompatible pairs joining per year (NHSBT: 272 registrations a year in non-COVID years 2019/20 and 2021/22-2024/25, 85% incompatible)
    crossBorder: true,           // can pairs from different regions swap?
    matchEveryDays: 91,          // 91 = quarterly (UK today)
    maxCycle: 3,                 // 2 = two-way swaps only, 3 = also three-way
    altruisticPer100: 13,        // altruistic donors starting chains, per 100 incompatible pairs (UK: ~35 chains a year in non-COVID years 2016/17-2024/25 excluding 2020/21)
    maxChainPairs: 2,            // pairs in a chain before it ends on the waiting list
    compatibleJoin: 0.18,        // share of compatible pairs that join anyway (gives ~41 a year at UK scale: 15% of registrations)
    protectO: false,             // group O donors may only give to group O patients
    a2Donors: false,             // use A2-subtype donors for O/B patients with low antibody levels
    searchCap: 4000,             // max links checked per patient when looking for a three-way swap (speed limit)
    priorityNoise: 0.15,         // how strictly hardest-to-match patients go first (lower = stricter); calibrated
    acceptance: 0.14,            // share of crossmatch-negative, blood-group-compatible donors the clinical team would accept (age, HLA mismatch, size, distance); calibrated
    fallThrough: 0.28,           // share of agreed swaps that don't go ahead (NHSBT: 72% proceed)
    daysToSurgery: 90,           // average days from matching run to operation (median ~2.5 months; NHSBT 2021-25: altruistic donation takes a median 3 months from notification)
    extraDaysCrossBorder: 30,    // extra time for travel, visas and paperwork
    daysToDiscoverFailure: 45,   // how long before a failed swap is known and pairs re-enter
    leaveRatePerYear: 0.25,      // share of waiting pairs who leave each year (illness, death, deceased-donor kidney, withdraw)
    warmupYears: 2,              // run-in so the pool fills up before measuring
    cohortYears: 3,              // pairs joining in this window are followed
    followUpYears: 3,            // extra time to see what happens to them
  };

  // ---------------------------------------------------------------------------
  // Random numbers (seeded, so every run can be reproduced)
  // ---------------------------------------------------------------------------
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pickABO(rng, dist) {
    const u = rng();
    let c = 0;
    for (const g of ABO) { c += dist[g]; if (u < c) return g; }
    return 'O';
  }
  function poisson(rng, mean) {
    if (mean <= 0) return 0;
    if (mean > 30) { // normal approximation for big means
      const u1 = rng() || 1e-12, u2 = rng();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return Math.max(0, Math.round(mean + z * Math.sqrt(mean)));
    }
    const L = Math.exp(-mean);
    let k = 0, p = 1;
    do { k++; p *= rng(); } while (p > L);
    return k - 1;
  }
  function drawCpra(rng) {
    const u = rng();
    let c = 0;
    for (const [w, lo, hi] of CPRA_BANDS) {
      c += w;
      if (u < c) return lo + (hi - lo) * rng();
    }
    return 0;
  }

  // Blood group rule: O gives to all; A to A/AB; B to B/AB; AB to AB.
  function aboOK(d, r) {
    return d === 'O' || r === 'AB' || d === r;
  }

  // Share of willing pairs (in a region) who are incompatible, so the number
  // of willing pairs can be scaled to give the requested joiners per year.
  function incompatibleShare(regionKey, seed) {
    const rng = makeRng(seed);
    const dist = REGIONS[regionKey].abo;
    let inc = 0;
    const N = 40000;
    for (let i = 0; i < N; i++) {
      const d = pickABO(rng, dist), r = pickABO(rng, dist), c = drawCpra(rng);
      if (!aboOK(d, r) || rng() < c) inc++;
    }
    return inc / N;
  }

  // ---------------------------------------------------------------------------
  // One simulated history
  // ---------------------------------------------------------------------------
  function simulate(userParams, seed) {
    const P = Object.assign({}, DEFAULTS, userParams || {});
    P.arrivals = Object.assign({}, DEFAULTS.arrivals, (userParams || {}).arrivals || {});
    const rng = makeRng(seed);
    const DAY0 = P.warmupYears * 365;
    const DAY1 = DAY0 + P.cohortYears * 365;
    const T = DAY1 + P.followUpYears * 365;
    const leavePerDay = 1 - Math.pow(1 - P.leaveRatePerYear, 1 / 365);

    // Willing pairs per day for each region.
    const willingPerDay = {};
    for (const k of REGION_KEYS) {
      const n = P.arrivals[k] || 0;
      willingPerDay[k] = n > 0 ? n / incompatibleShare(k, 12345) / 365 : 0;
    }

    const pairs = [];          // every pair ever created, indexed by id
    const OUT = new Map();     // id -> Set of pair ids this pair's donor can give to
    const IN = new Map();      // id -> Set of pair ids whose donor can give to this pair
    let active = [];           // pairs in the scheme (waiting or in a pending swap)
    let ndads = [];            // altruistic donors waiting to start a chain
    const pending = [];        // agreed swaps waiting to happen or fall through

    const stats = {
      cycles2: 0, cycles3: 0, chains: 0, failed: 0,
      txPairs: 0, txFromChains: 0, txWaitingList: 0, txCrossBorder: 0,
      poolSamples: 0, poolSum: 0,
    };

    // Can donor of pair d (or altruistic donor) give to recipient of pair r?
    function edge(dABO, dA2, dRegion, r) {
      if (!P.crossBorder && dRegion !== r.region) return false;
      let ok = aboOK(dABO, r.rABO);
      if (!ok && P.a2Donors && dA2 && (r.rABO === 'O' || r.rABO === 'B') && r.lowTitre) ok = true;
      if (!ok) return false;
      if (P.protectO && dABO === 'O' && r.rABO !== 'O') return false;
      if (rng() < r.cpra) return false;          // positive crossmatch
      return rng() < P.acceptance;                // clinical acceptance criteria
    }

    function addPair(day, region, compatible, dABO, rABO, cpra) {
      const p = {
        id: pairs.length, region, dABO, rABO, cpra,
        dA2: dABO === 'A' && rng() < 0.2,
        lowTitre: rABO === 'O' ? rng() < 0.63 : rng() < 0.97,
        compatible, arrive: day, status: 'pool', runsUnmatched: 0, txDay: -1, dirty: true,
      };
      pairs.push(p);
      const out = new Set(), inn = new Set();
      for (const q of active) {
        if (edge(p.dABO, p.dA2, p.region, q)) { out.add(q.id); IN.get(q.id).add(p.id); q.dirty = true; }
        if (edge(q.dABO, q.dA2, q.region, p)) { inn.add(q.id); OUT.get(q.id).add(p.id); q.dirty = true; }
      }
      OUT.set(p.id, out); IN.set(p.id, inn);
      for (const n of ndads) if (edge(n.abo, n.a2, n.region, p)) n.out.add(p.id);
      active.push(p);
    }

    function removeFromGraph(p) {
      for (const j of OUT.get(p.id)) IN.get(j).delete(p.id);
      for (const j of IN.get(p.id)) OUT.get(j).delete(p.id);
      OUT.delete(p.id); IN.delete(p.id);
      for (const n of ndads) n.out.delete(p.id);
    }

    function addNdad(day) {
      // Altruistic donors come from the regions in proportion to pair numbers.
      const tot = REGION_KEYS.reduce((s, k) => s + (P.arrivals[k] || 0), 0) || 1;
      let u = rng() * tot, region = 'uk';
      for (const k of REGION_KEYS) { u -= P.arrivals[k] || 0; if (u <= 0) { region = k; break; } }
      const abo = pickABO(rng, REGIONS[region].abo);
      const n = { abo, a2: abo === 'A' && rng() < 0.2, region, arrive: day, runs: 0, out: new Set() };
      for (const q of active) if (edge(abo, n.a2, region, q)) n.out.add(q.id);
      ndads.push(n);
    }

    const inSize = (id) => IN.get(id).size;

    function matchingRun(day) {
      const avail = active.filter((p) => p.status === 'pool');
      // Hardest-to-match first (fewest compatible donors), random tie-break.
      const key = new Map();
      for (const p of avail) key.set(p.id, inSize(p.id) * (P.priorityNoise + rng()) + rng() * 0.5);
      avail.sort((a, b) => key.get(a.id) - key.get(b.id));
      const used = new Set();
      const free = (id) => !used.has(id) && pairs[id].status === 'pool';

      for (const p of avail) {
        if (used.has(p.id)) continue;
        // A pair whose links haven't changed since the last run can't have a new
        // swap of its own; it can still be picked as a partner by others.
        if (!p.dirty) continue;
        p.dirty = false;
        const outP = OUT.get(p.id), inP = IN.get(p.id);
        // Two-way swap: p gives to j and j gives to p.
        let best = -1, bestScore = Infinity;
        for (const j of inP) {
          if (!free(j) || !outP.has(j)) continue;
          const s = key.get(j);
          if (s < bestScore) { bestScore = s; best = j; }
        }
        if (best >= 0) { propose(day, [p.id, best], null); used.add(p.id); used.add(best); continue; }
        if (P.maxCycle < 3) continue;
        // Three-way swap: p -> j -> k -> p.
        let bj = -1, bk = -1; bestScore = Infinity; let work = 0;
        for (const k of inP) {
          if (!free(k)) continue;
          for (const j of IN.get(k)) {
            if (++work > P.searchCap) break;
            if (j === p.id || !free(j) || !outP.has(j)) continue;
            const s = key.get(j) + key.get(k);
            if (s < bestScore) { bestScore = s; bj = j; bk = k; }
          }
          if (work > P.searchCap) break;
        }
        if (bj >= 0) { propose(day, [p.id, bj, bk], null); used.add(p.id); used.add(bj); used.add(bk); }
      }

      // Chains from altruistic donors: donor -> pair -> (pair) -> waiting list.
      const keep = [];
      for (const n of ndads) {
        let first = -1, s1 = Infinity;
        for (const j of n.out) if (free(j) && key.get(j) < s1) { s1 = key.get(j); first = j; }
        if (first < 0) {
          n.runs++;
          if (n.runs >= 2) { stats.txWaitingList++; } else keep.push(n); // gives to waiting list instead
          continue;
        }
        const chain = [first];
        used.add(first);
        if (P.maxChainPairs >= 2) {
          let second = -1, s2 = Infinity;
          for (const j of OUT.get(first)) if (free(j) && key.get(j) < s2) { s2 = key.get(j); second = j; }
          if (second >= 0) { chain.push(second); used.add(second); }
        }
        propose(day, chain, n);
      }
      ndads = keep;

      // Compatible pairs who weren't matched in two runs just go ahead directly.
      for (const p of avail) {
        if (!p.compatible || used.has(p.id)) continue;
        p.runsUnmatched++;
        if (p.runsUnmatched >= 2) { p.status = 'direct'; removeFromGraph(p); }
      }
      active = active.filter((p) => p.status === 'pool' || p.status === 'pending');
    }

    function propose(day, ids, ndad) {
      for (const id of ids) pairs[id].status = 'pending';
      const regions = new Set(ids.map((id) => pairs[id].region));
      if (ndad) regions.add(ndad.region);
      const cross = regions.size > 1;
      const success = rng() >= P.fallThrough;
      // Time to surgery varies: at least 45 days (final tests), with a tail
      // (scheduling, illness, re-testing). The average is daysToSurgery.
      const minDays = Math.min(45, P.daysToSurgery);
      const delay = minDays - (P.daysToSurgery - minDays) * Math.log(1 - rng());
      const when = success
        ? day + Math.round(delay) + (cross ? P.extraDaysCrossBorder : 0)
        : day + P.daysToDiscoverFailure;
      pending.push({ when, ids, ndad, success, cross });
    }

    function resolve(item, day) {
      if (item.success) {
        for (const id of item.ids) {
          const p = pairs[id];
          p.status = 'tx'; p.txDay = day; p.cross = item.cross;
          removeFromGraph(p);
          if (!p.compatible) { stats.txPairs++; if (item.cross) stats.txCrossBorder++; if (item.ndad) stats.txFromChains++; }
        }
        if (item.ndad) { stats.chains++; stats.txWaitingList++; }
        else if (item.ids.length === 2) stats.cycles2++; else stats.cycles3++;
      } else {
        stats.failed++;
        for (const id of item.ids) { pairs[id].status = 'pool'; pairs[id].dirty = true; }
        // The swap failed for a reason (e.g. positive crossmatch): remove one of
        // its links so the same swap isn't proposed again.
        const ids = item.ids;
        if (item.ndad) {
          item.ndad.out.delete(ids[0]);
          item.ndad.runs = 0;
          ndads.push(item.ndad);
        } else {
          const i = Math.floor(rng() * ids.length);
          const a = ids[i], b = ids[(i + 1) % ids.length];
          OUT.get(a).delete(b); IN.get(b).delete(a);
        }
      }
    }

    // ---- main loop, one step per day ----
    const totalArrivals = REGION_KEYS.reduce((s, k) => s + (P.arrivals[k] || 0), 0);
    const ndadPerDay = (P.altruisticPer100 / 100) * totalArrivals / 365;
    for (let day = 0; day < T; day++) {
      for (const k of REGION_KEYS) {
        const n = poisson(rng, willingPerDay[k]);
        for (let i = 0; i < n; i++) {
          const dist = REGIONS[k].abo;
          const d = pickABO(rng, dist), r = pickABO(rng, dist), c = drawCpra(rng);
          const incompatible = !aboOK(d, r) || rng() < c;
          if (incompatible) addPair(day, k, false, d, r, c);
          else if (P.compatibleJoin > 0 && rng() < P.compatibleJoin) addPair(day, k, true, d, r, c);
        }
      }
      const nn = poisson(rng, ndadPerDay);
      for (let i = 0; i < nn; i++) addNdad(day);

      // Swaps that happen (or fall through) today.
      let anyResolved = false;
      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i].when <= day) { const it = pending[i]; pending.splice(i, 1); resolve(it, day); anyResolved = true; }
      }
      if (anyResolved) active = active.filter((p) => p.status === 'pool' || p.status === 'pending');

      // Pairs leaving the scheme without a transplant.
      let anyLeft = false;
      for (const p of active) {
        if (p.status === 'pool' && rng() < leavePerDay) { p.status = 'left'; p.leftDay = day; removeFromGraph(p); anyLeft = true; }
      }
      if (anyLeft) active = active.filter((p) => p.status === 'pool' || p.status === 'pending');

      if (day % P.matchEveryDays === P.matchEveryDays - 1) matchingRun(day);

      if (day >= DAY0 && day % 7 === 0) {
        stats.poolSamples++;
        stats.poolSum += active.reduce((s, p) => s + (p.compatible ? 0 : 1), 0);
      }
    }

    // ---- results for the cohort (incompatible pairs who joined DAY0..DAY1) ----
    const cohort = pairs.filter((p) => !p.compatible && p.arrive >= DAY0 && p.arrive < DAY1);
    const tx = cohort.filter((p) => p.status === 'tx');
    const waits = tx.map((p) => p.txDay - p.arrive).sort((a, b) => a - b);
    const share = (arr, f) => {
      const g = arr.filter(f);
      return g.length ? g.filter((p) => p.status === 'tx').length / g.length : NaN;
    };
    const curve = []; // share of cohort transplanted by each month after joining
    for (let m = 0; m <= 36; m++) {
      const lim = m * 30.4;
      curve.push(cohort.length ? tx.filter((p) => p.txDay - p.arrive <= lim).length / cohort.length : 0);
    }
    const years = (T - DAY0) / 365;
    const byRegion = {};
    for (const k of REGION_KEYS) {
      if (!(P.arrivals[k] > 0)) continue;
      byRegion[k] = share(cohort, (p) => p.region === k);
    }
    return {
      cohortSize: cohort.length,
      pctTransplanted: cohort.length ? tx.length / cohort.length : 0,
      pctWithinYear: cohort.length ? tx.filter((p) => p.txDay - p.arrive <= 365).length / cohort.length : 0,
      pctLeft: cohort.length ? cohort.filter((p) => p.status === 'left').length / cohort.length : 0,
      medianWait: waits.length ? waits[Math.floor(waits.length / 2)] : NaN,
      pctO: share(cohort, (p) => p.rABO === 'O'),
      pctNonO: share(cohort, (p) => p.rABO !== 'O'),
      pctHighlySensitised: share(cohort, (p) => p.cpra >= 0.85),
      byBand: CPRA_BANDS.map(([, lo, hi]) => share(cohort, (p) => p.cpra >= lo - 1e-9 && p.cpra <= hi + 1e-9)),
      bandShare: CPRA_BANDS.map(([, lo, hi]) => cohort.length ? cohort.filter((p) => p.cpra >= lo - 1e-9 && p.cpra <= hi + 1e-9).length / cohort.length : 0),
      byGroup: ABO.map((g) => share(cohort, (p) => p.rABO === g)),
      compatiblePerYear: pairs.filter((p) => p.compatible).length / (T / 365),
      pctNotHS: share(cohort, (p) => p.cpra < 0.85),
      byRegion,
      shareO: cohort.length ? cohort.filter((p) => p.rABO === 'O').length / cohort.length : 0,
      shareHS: cohort.length ? cohort.filter((p) => p.cpra >= 0.85).length / cohort.length : 0,
      avgPool: stats.poolSamples ? stats.poolSum / stats.poolSamples : 0,
      pairTxPerYear: stats.txPairs / (T / 365),
      waitingListPerYear: stats.txWaitingList / (T / 365),
      crossBorderShare: stats.txPairs ? stats.txCrossBorder / stats.txPairs : 0,
      chainShare: stats.txPairs ? stats.txFromChains / stats.txPairs : 0,
      cycles2: stats.cycles2, cycles3: stats.cycles3, chains: stats.chains,
      failRate: stats.failed / Math.max(1, stats.failed + stats.cycles2 + stats.cycles3 + stats.chains),
      curve,
      waits,
      years,
    };
  }

  // ---------------------------------------------------------------------------
  // Monte Carlo: many runs, then averages and 90% ranges
  // ---------------------------------------------------------------------------
  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }
  function summarise(runs) {
    const keys = ['pctTransplanted', 'pctWithinYear', 'pctLeft', 'medianWait', 'pctO', 'pctNonO',
      'pctHighlySensitised', 'pctNotHS', 'shareO', 'shareHS', 'avgPool', 'pairTxPerYear',
      'waitingListPerYear', 'crossBorderShare', 'chainShare', 'failRate', 'cohortSize', 'compatiblePerYear'];
    const out = {};
    for (const k of keys) {
      const v = runs.map((r) => r[k]).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
      const mean = v.reduce((s, x) => s + x, 0) / (v.length || 1);
      out[k] = { mean, lo: quantile(v, 0.05), hi: quantile(v, 0.95), values: runs.map((r) => r[k]) };
    }
    for (const k of ['byBand', 'bandShare', 'byGroup']) {
      out[k] = runs[0][k].map((_, i) => {
        const v = runs.map((r) => r[k][i]).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
        return { mean: v.reduce((s, x) => s + x, 0) / (v.length || 1), lo: quantile(v, 0.05), hi: quantile(v, 0.95) };
      });
    }
    out.byRegion = {};
    for (const reg of Object.keys(runs[0].byRegion)) {
      const v = runs.map((r) => r.byRegion[reg]).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
      out.byRegion[reg] = { mean: v.reduce((s, x) => s + x, 0) / (v.length || 1), lo: quantile(v, 0.05), hi: quantile(v, 0.95) };
    }
    const n = runs[0].curve.length;
    out.curve = [];
    for (let m = 0; m < n; m++) {
      const v = runs.map((r) => r.curve[m]).sort((a, b) => a - b);
      out.curve.push({ month: m, mean: v.reduce((s, x) => s + x, 0) / v.length, lo: quantile(v, 0.05), hi: quantile(v, 0.95) });
    }
    out.waits = [].concat(...runs.map((r) => r.waits)).sort((a, b) => a - b);
    out.runs = runs.length;
    return out;
  }
  function runMany(params, nRuns, baseSeed, onProgress) {
    const runs = [];
    for (let i = 0; i < nRuns; i++) {
      runs.push(simulate(params, (baseSeed || 1) * 7919 + i * 104729));
      if (onProgress) onProgress(i + 1, nRuns);
    }
    return summarise(runs);
  }

  const api = { REGIONS, ABO, CPRA_BANDS, DEFAULTS, simulate, runMany, summarise, incompatibleShare };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KidneySim = api;
})(typeof self !== 'undefined' ? self : this);
