# legal/: the legal-state record and the switch it drives

This folder holds the state that decides whether a conditional legal clause is in force, and the clause text itself.
It is public, so it holds **state only**.

| File | What it is |
|---|---|
| `legal-state.json` | The record: the seller type and the dates on which a legal trigger was met. Nothing else. |
| `thai-7day-clause.md` | The Thai 7-day cancellation clause (English and Thai), with a `{{since}}` placeholder for the date it takes effect. |

`TERMS.md` holds one block between `<!-- legal-state:thai-7day:begin -->` and `<!-- legal-state:thai-7day:end -->`. The block is empty
while no trigger has been met, and holds the dated clause once one has. It is never edited by hand:
`node scripts/legal-state.mjs --write` renders it from the record and the clause file, `node scripts/legal-state.mjs` (or the surface
check, rule 19) refuses a `TERMS.md` whose block disagrees with the record.

## The rail: what never goes in this record

A registration number, a tax identification number (for a sole trader, a personal national number), a revenue figure or any owner
identifier **never enters this repository**. The record names a fixed set of keys whose values are `null` or a calendar date;
`scripts/lib/legal-state.mjs` and rule 19 refuse any other key or any other kind of value. Where the design needs such a value (the
revenue measurement below needs the settled amounts), its home is the future private repository, and the public build reads only the
date it needs. Until that repository exists, no such value is stored anywhere in this build.

## The triggers

The clause takes effect on the first of three events. The record carries the date of each; the clause is in force when any stands.

| Trigger | Who enters it | Record field |
|---|---|---|
| The seller is incorporated | the owner, as a dated commit | `incorporated.on` (and `sellerType` becomes `company`) |
| The seller registers as a direct-marketing business | the owner, as a dated commit | `directMarketingRegistered.on` |
| Annual revenue passes 1,800,000 baht | measured, then entered as a dated commit | `revenueThreshold.crossedOn` |

## The revenue trigger: the design (nothing is built; no billing system exists yet)

- **Measurement:** the payment provider's settled statements, net of refunds, in Thai baht. The definition of the year and of revenue is
  the lawyer's reading, not ours.
- **Crossing:** the day the net total passes the threshold is `revenueThreshold.crossedOn`. The clause is armed from that date at once.
- **Veto window:** for 14 calendar days after the crossing, a measurement error may be vetoed (`revenueThreshold.vetoedOn`), and only
  an error: the veto must fall inside the 14 days after `crossedOn`, which `scripts/lib/legal-state.mjs` checks. A vetoed crossing does
  not arm the clause.
- **One-way latch:** once the window has passed without a veto, the crossing stands and is never cleared.
- **Audit log:** git history. Every entry is a dated commit, so who entered what and when is the record of the record.
- **What is not checked in a snapshot:** the latch and the timing of a veto cannot be seen in one file. The surface check accepts a veto
  inside the window whenever it is committed; the history is what shows it was committed in time.

The measuring job reads the amounts from the private side and writes only the date (or the veto) into this record.
