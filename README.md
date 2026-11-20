# Kidney Exchange Simulator

A Monte Carlo simulation of a kidney paired-exchange scheme. It tests how different designs would change who gets a transplant and how long they wait. Examples include a bigger pool, an international pool, more frequent matching, altruistic chains, and rules that protect group O patients. Every scenario uses two- and three-way swaps, as the UK scheme already does.

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
node tools/run.js '{"arrivals":{"uk":231,"sa":231,"me":231},"crossBorder":true}' 30
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
4. **Swaps go ahead or fall through.** Each agreed swap falls through with the set probability. If it does, the pairs re-enter the pool 45 days later and the link that failed is removed. If it goes ahead, surgery follows after a random delay: at least 45 days, 90 days on average. Swaps that cross borders get extra days.
5. **Pairs leave.** Waiting pairs leave at the set yearly rate (illness, death, a deceased-donor transplant, or withdrawal).
6. **Measurement.** Year 1–2 is a warm-up so the pool fills. Pairs joining in years 3–5 are followed until the end of year 8. All results describe these pairs.
7. **Monte Carlo.** Steps 1–6 are repeated with different random seeds. Results show the average and the 5th–95th percentile (the range covering 90% of runs).

## Calibration (non-COVID years only)

COVID-affected data is left out. In 2020/21 UKLKSS registrations fell to 91 (against 244–297 in other years) and altruistic chains fell to 24 (against 25–49). That year is excluded from every input. NHSBT's 386-day median wait is **not** used: its cohort was registered 2015–2021 and waited through the 2020 pause. Pre-COVID figures aren't used as targets either, because the scheme was much less effective then (41% transplanted and 59% of identified transplants proceeding in 2016–20, against 51% and 71% in 2021–25).

Three settings cannot be measured directly. They were tuned so that the *UK today* preset reproduces NHSBT's post-COVID (April 2021 – March 2025) figures:

- acceptance: 14%
- leaving rate: 25% a year
- priority strictness: 0.15

| Measure | NHSBT (non-COVID years) | Model (30 runs) |
|---|---|---|
| Registered patients transplanted (2021–25) | 51% | ≈50% |
| Group O patients transplanted (2021–25) | ≈40% | ≈38% |
| A / B patients transplanted (2021–25) | ≈64% / ≈54% | ≈70% / ≈67% |
| cRF 0–9 / 10–84 / 85–94 / 95–99 / 100%: transplanted (2021–25) | 57 / 61 / 53 / 31 / 3% | ≈50 / 68 / 61 / 34 / 2% |
| cRF mix of registered patients (2021–25) | 43 / 30 / 7 / 13 / 7% | 43 / 29 / 8 / 13 / 7% |
| Identified transplants that do not proceed (2021–25) | 29% | ≈28% |
| Compatible pairs registering per year | ≈41 | ≈39 |

Other inputs:

- **Pairs joining.** 272 registrations a year: the average of 2019/20 and 2021/22–2024/25, leaving out 2020/21. 15% of registered pairs are compatible, which gives 231 incompatible pairs a year.
- **Altruistic chains.** About 35 a year: 2016/17–2024/25 with 2020/21 left out. That is 13 per 100 incompatible pairs.
- **Match-to-surgery time.** 90 days on average, with a minimum of 45 and a typical swap taking about 2½ months. Based on NHSBT's 2021–25 figure that altruistic donors take a median of 3 months from notification to donation. The resulting median wait from joining to transplant is about 280 days. NHSBT publishes no post-COVID figure to compare it with.

## Fixed inputs and sources

- **UKLKSS activity.** NHS Blood and Transplant, *Annual Report on Living Donor Kidney Transplantation 2024/25*, Section 4:
  - registrations by year (Table 4.2);
  - 1,897 pairs in 2019–25, of which 286 were compatible (Table 4.1);
  - 51% of registered recipients transplanted and 71% of identified transplants proceeding (2021–25);
  - transplant rates by cRF band (Table 4.3) and by blood group (Table 4.4);
  - altruistic chains by year (Table 4.8);
  - altruistic donors taking a median 3 months from notification to donation (Table 4.9).
- **Pre-COVID comparison.** NHSBT, *Annual Report on Living Donor Kidney Transplantation 2019/20*: 41% transplanted and 59% of identified transplants proceeding, 2016–20.
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
