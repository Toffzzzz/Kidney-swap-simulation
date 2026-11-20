# Kidney Exchange Simulator

A Monte Carlo simulation of a kidney paired-exchange scheme. It tests how different designs would change who gets a transplant and how long they wait. Examples include a bigger pool, an international pool, more frequent matching, three-way swaps, altruistic chains, and rules that protect group O patients.

The default settings are **calibrated to the UK Living Kidney Sharing Scheme (UKLKSS)**, so every scenario is measured against a baseline that matches real published figures.

## How to use it

1. Open `index.html` in any web browser (Chrome, Edge, Safari, Firefox). Nothing needs installing and it works offline.
2. Pick a preset (for example *UK today*), or change the settings on the left.
3. Press **Run simulation**. Use 10 runs for a quick look and 100 for figures you will quote.
4. Press **Save to comparison**, change something, run again, and compare. **Download as CSV** exports the comparison table.

To run scenarios from the command line (needs Node.js):

```
node tools/run.js '{}' 30                                   # UK today, 30 runs
node tools/run.js '{"matchEveryDays":7}' 30                 # UK, weekly matching
node tools/run.js '{"arrivals":{"uk":268,"sa":268,"me":268},"crossBorder":true}' 30
```

After editing `src/engine.js` or `src/ui.html`, run `python3 build.py` to rebuild `index.html`.

## Project layout

| File | What it is |
|---|---|
| `index.html` | The finished simulator: a single file you open in a browser (built from the two `src` files) |
| `src/engine.js` | The simulation engine: all the modelling lives here |
| `src/ui.html` | The page layout, controls and charts |
| `build.py` | Combines the engine and the page into `index.html` |
| `tools/run.js` | Command-line runner that prints results next to the real UK figures |

## How the model works

Each **run** simulates about 8 years, one day at a time.

1. **Pairs arrive.** New donor–recipient pairs are created at the chosen rate for each region. Each pair is given:
   - donor and recipient blood groups, drawn from that region's frequencies;
   - a recipient antibody level (calculated reaction frequency, cRF), drawn from five bands (0–9%, 10–84%, 85–94%, 95–99%, 100%).

   A pair joins if the donor and recipient are blood-group incompatible, or if their crossmatch is positive (chance = the recipient's cRF). A set share of compatible pairs also join.
2. **Who can give to whom.** For every donor and every other recipient, the model decides once whether that donor could give to that recipient. All three of these must be true:
   - the blood groups are compatible (O → all; A → A, AB; B → B, AB; AB → AB);
   - the crossmatch is negative (chance = 1 − recipient's cRF);
   - the clinical team would accept the donor on other grounds, such as age, HLA mismatch, size and distance (the "acceptance" setting).

   Optional rules: group O donors only to group O recipients; A2-subtype donors (20% of group A) to O or B recipients with low antibody titres (63% of O and 97% of B recipients).
3. **Matching runs** happen on the chosen timetable. Patients are taken hardest-to-match first, meaning those with the fewest compatible donors. For each patient the model looks first for a two-way swap, then for a three-way swap. Altruistic donors then start chains: altruistic donor → pair → pair → national waiting list.
4. **Swaps go ahead or fall through.** Each agreed swap falls through with the set probability. If it does, the pairs re-enter the pool 45 days later and the link that failed is removed. If it goes ahead, surgery follows after a random delay: at least 6 weeks, with the set average. Swaps that cross borders get extra days.
5. **Pairs leave.** Waiting pairs leave at the set yearly rate (illness, death, a deceased-donor transplant, or withdrawal).
6. **Measurement.** Year 1–2 is a warm-up so the pool fills. Pairs joining in years 3–5 are followed until the end of year 8. All results describe these pairs.
7. **Monte Carlo.** Steps 1–6 are repeated with different random seeds. Results show the average and the 5th–95th percentile (the range covering 90% of runs).

## Calibration

Four settings cannot be measured directly. They were tuned so that the *UK today* preset reproduces NHSBT figures:

- acceptance: 20%
- average match-to-surgery time: 260 days
- leaving rate: 40% a year
- priority strictness: 0.15

| Measure | NHSBT | Model (30 runs) |
|---|---|---|
| Registered patients transplanted | 51% (2021–25) | ≈50–52% |
| Median days, registration to transplant | 386 (2015–21) | ≈388 |
| Group O patients transplanted | ≈40% | ≈38–39% |
| A / B patients transplanted | ≈64% / ≈54% | ≈70% / ≈66% |
| cRF 0–9 / 10–84 / 85–94 / 95–99 / 100%: transplanted | 57 / 61 / 53 / 31 / 3% | ≈48 / 68 / 64 / 40 / 3% |
| cRF mix of registered patients | 43 / 30 / 7 / 13 / 7% | 43 / 30 / 8 / 13 / 7% |
| Identified transplants that do not proceed | 28–29% | ≈29% |
| Compatible pairs registering per year | ≈48 | ≈50 |

The overall rate, median wait, group O rate, the 100% band and the fall-through rate match closely. The model slightly favours mid-to-high cRF patients over low-cRF patients compared with the real scheme. The likely reason is that NHSBT's points system also rewards waiting time and other factors.

## Fixed inputs and sources

- **UKLKSS activity.** NHS Blood and Transplant, *Annual Report on Living Donor Kidney Transplantation 2024/25*, Section 4:
  - 1,897 pairs registered in 2019–25, of which 286 were compatible, which gives about 268 incompatible pairs a year;
  - 51% of registered recipients transplanted;
  - 71–72% of identified transplants proceed;
  - transplant rates by cRF band (Table 4.3) and by blood group (Table 4.4);
  - median 386 days from registration to transplant (Table 4.7);
  - 25–49 altruistic-donor chains a year (Table 4.8).
- **Matching every 3 months; chains of up to 2 pairs.** NHSBT / ODT, UK Living Kidney Sharing Scheme pages.
- **Blood groups, UK & Europe.** O 47%, A 42%, B 8%, AB 3% (British population data).
- **Blood groups, South Asia.** O 37.1%, A 22.9%, B 32.3%, AB 7.7%. Agrawal et al. 2014, first multicentre ABO study in India (PMC4140055).
- **Blood groups, Gulf / Middle East.** O 51.8%, A 25.9%, B 18.0%, AB 4.3% (Saudi Arabia, Rh+ and Rh− combined).
- **A2 donors and antibody titres.** About 20% of group A people are A2. A Dutch simulation found unacceptably high anti-A/B titres in 37% of O and 3% of A/B patients.

## Limitations

- HLA (tissue type) is not modelled antigen by antigen. It is summarised by each patient's cRF and the acceptance setting.
- The matching search is a fast greedy method (hardest first, two-way before three-way), not the exact integer-programming optimisation real schemes use. In large pools it may slightly understate achievable matches.
- Patients outside the UK are given the same antibody profile, acceptance rate, leaving rate and delays as UK patients. Only their blood group frequencies differ.
- Browser runs are limited to about 1,500 pairs a year per region. Larger pools need many more calculations, and the results level off well before that size.
- A failed swap returns all its pairs to the pool. Real schemes sometimes rescue part of a failed three-way swap.
