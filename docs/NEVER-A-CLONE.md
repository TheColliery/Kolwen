# Never a clone

**The law, owner-set 2026-09-04:** *"Kolwen จะไม่เป็นร่างโคลนของใครทั้งนั้น."* Kolwen will not be
anybody's clone.

The decap ladder is a CLONE TEST—the instrument that exposed a reseller relabelling somebody
else's chip. **So Kolwen passes its own:** the chip the ladder MEASURES must equal the label the
product SHOWS.

> **THE GATE.** Nothing in nationality-matched support proceeds until this battery and the
> reply-language acceptance test (`docs/REPLY-LANGUAGE.md`) both pass. Recorded in both files
> because this room keeps no separate queue; a planner reading either one meets the gate.

## 1 · The label—the machine-readable half is LIVE TODAY

**`web/ic.json` is the ONE source of truth** for the IC this product runs: model id, cutoff,
effort. It is published at `/ic.json`, so a reader can fetch it right now.

Today it says exactly what is true:

```json
{ "status": "no-ic-running", "model_id": null, "cutoff": null, "effort": null }
```

**A placeholder is honest; a fake id is not.** No model runs here, so none is named.

**The mechanism that makes a swap change the label the same day:** every consumer READS this file.
The battery reads it to know what to assert against. The page will read it to render the label.
**Nothing retypes these values anywhere**—a retyped label is a label that can disagree with the
chip, which is the exact failure this whole document exists to prevent.

**The visible element BINDS AT SURFACE.** Rendering the label in the page waits for `/chat`,
because a visible label for an IC that does not run would only repeat what the page's own
"not yet available" line already says. What does not wait is the rule: when it renders, it renders
from `web/ic.json` and from nowhere else.

## 2 · The SELF-DECAP battery—the runner is ENFORCED TODAY, a live run BINDS AT SURFACE

Fixtures: `../warehouse/decap-battery/blocks/`—B6–B9, `B10-CN`, `B11-pin`, byte-verified
copies, with the battery's contract in that directory's README. **The fixtures live in the
warehouse; the runner lives here** (`scripts/decap-battery.mjs`).

| contract term | how the runner honours it |
|---|---|
| OpenAI-compatible socket | the owner's ruling—two ICs stay qualified at any time, so a swap is a config change, not a rewrite |
| `B11-pin`: one item per FRESH session | `isPerItem()` splits that block and asks each line separately; every other block is one session |
| `B11-pin`: no unknown-escape | the fixture forces a best guess with `(?)`; the runner never adds an "I don't know" affordance to it |
| the maker's-own-event separator | included—it is a line inside `B11-pin`, and the runner sends the block's items unedited |
| raw replies saved | every run writes per-block replies plus an index under `.decap-runs/<timestamp>/` **before** asserting. **A verdict with no raw answers is a claim.** |
| a battery with no blocks | throws. An empty fixtures directory is never reported as a pass. |

**Red-first, and the assert is the point:** a mocked WRONG CHIP that answers rungs past the
labelled cutoff must FAIL, and a conforming chip must PASS. Measured:

```
  wrong-chip fixture  -> measured 2026 vs label 2024: FAILED (correct)
  conforming fixture  -> measured 2024 vs label 2024: PASSED (correct)
```

**Why dated events and not an accuracy benchmark:** a relabelled chip is as clever as the chip it
really is, so a capability score cannot expose it. Only knowledge of dated events can.

**CI:** the self-test runs on every push. **A real run is keyed to the label changing**—the day
`web/ic.json` names a model, the battery runs against it, because a swap that does not re-run the
battery is a label nobody checked. With a label and no endpoint the runner exits 1 rather than
reporting a pass.

## 3 · Grounding is never silent—BINDS AT SURFACE

An answer about anything after the labelled cutoff **carries a citation from Kolwen's verified
facts, or says it does not know.** Never a fluent answer with an invisible source.

The reason is in the fixtures themselves: `B9` is a MIXED ladder—known-old items among
post-cutoff ones—precisely so a silently-grounded model reads as GROUNDED rather than as fresh.
A product that grounds silently cannot be measured by its own battery, which makes the battery a
decoration.

## 4 · No hard-coded refusal templates—the scan is ENFORCED TODAY

A refusal is generated, in the user's language, never selected from a canned string. This is the
same rule as `docs/REPLY-LANGUAGE.md`'s and the same scan enforces it
(`scripts/reply-language-check.mjs --scan`): a canned refusal is a single-language reply template
wearing a safety justification.

Two rules meeting on one string is the point—a canned refusal fails the clone test too, because
it is somebody else's words in Kolwen's mouth.
