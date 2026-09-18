# Privacy

> **Published as a DRAFT with legal gaps by the owner's order of 2026-09-05 (AR-4).** The four
> `[pending legal review]` / `[รอที่ปรึกษากฎหมาย]` markers below are the clauses awaiting counsel.
> **Not yet reviewed by a lawyer.** Every statement about this site's own behaviour was MEASURED
> on 2026-09-04 and carries the command that produced it; every statement that could not be
> measured from this repository is marked ⚠️ and is a question returned to the owner, not a
> guess. **A privacy notice is the last document that should contain an assumption** — which is
> why the unanswered parts are marked rather than filled in.
>
> **เผยแพร่เป็นฉบับร่างที่ยังมีช่องว่างทางกฎหมาย ตามคำสั่งเจ้าของ 2026-09-05 (AR-4)** —
> เครื่องหมาย `[รอที่ปรึกษากฎหมาย]` สี่จุดคือข้อที่ยังรอทนายความ **ยังไม่ผ่านการตรวจโดยทนายความ**
> **GAPPED 2026-09-06 (LWK-146, owner AR-4): every clause below that is a legal CONCLUSION —
> a statutory duty asserted as met, a controller/processor characterisation, a DPO/representative
> status determination, or any other class the lawyer must confirm — is now marked
> `[pending legal review]` at the exact spot, replacing an asserted sentence. Facts this
> repository can already back (what the site does today, the cookies, the contact) stay asserted,
> unchanged. Four gaps total; the numbered list with the exact question for the lawyer is at
> an internal gaps list held for counsel.**

Kolwen has not launched. This page describes what **kolwen.com** does today, and says plainly
which parts change on the day the assistant itself ships.

## What this site is

One static page, served by a Cloudflare Worker. **The Worker runs no code of ours**—it is
configured with an assets directory and nothing else, with no `main` entry point, so there is no
request handler, no logging, and no storage on our side.

*Measured: `grep -n 'main' wrangler.jsonc` returns nothing; the config declares only `assets`.*

## Cookies

**This site sets no cookies at all.**

*Measured: `curl -sI https://kolwen.com/` and the same on an asset—no `Set-Cookie` header on
either.*

Your language choice (English or Thai) is stored in your browser's `localStorage`, which is not a
cookie, is never sent to a server, and never leaves your device. Clearing your browser data
removes it.

*Measured: `web/index.html` uses `localStorage.setItem` / `getItem` for one key, and nothing else.*

### When the assistant ships, this changes, and here is exactly how

The chat will set **one strictly necessary cookie** so that a conversation works. There will be no
advertising cookie and no tracker.

**GAP 1 — [pending legal review]: whether this specific cookie qualifies for the "strictly
necessary" exemption that removes the need for a consent banner is a legal characterisation, not
a fact this repository can measure ahead of the feature existing. Not asserted here as settled.**

> ไม่มี cookie โฆษณา ไม่มี tracker — มี cookie จำเป็น 1 ตัวให้แชททำงาน
>
> No advertising cookies, no trackers—one necessary cookie so chat works.

Conversations will be **session-only**: they last for that session and are not kept afterwards.

**This paragraph is a commitment about a thing that does not exist yet.** It is written here now so
that the claim and the feature ship together rather than the page quietly going out of date.

## Who else sees your request

**Cloudflare** serves this site, so it necessarily handles your request: your IP address, the URL
you asked for, and your browser's user-agent reach their edge before any bytes reach you. That is
how any hosted site works, and it is not something we can turn off while remaining online.
Cloudflare also injects its own bot-detection script into the served HTML—we do not control it
and do not receive its output.

⚠️ **What Cloudflare retains, for how long, and whether any analytics product is enabled on this
account is a dashboard setting that leaves no trace in this repository. It cannot be measured from
here, and it is not stated as fact.** Returned as an owner question.

**Google Fonts** serves the two typefaces the page uses, so your browser makes a request to
Google when the page loads. That request carries your IP address to Google.

*Measured: `curl -s https://kolwen.com/ | grep -oE 'https?://[a-z0-9.-]+'`—`fonts.googleapis.com`
is the only third-party origin the page FETCHES. The github.com, huggingface.co and npmjs.com
addresses on the page are links you would have to click.*

Self-hosting the fonts would remove this last third party. It is an open decision, not an
oversight.

## Contact

`contact@kolwen.com` reaches the maintainer. Anything you send there is read by a person.

⚠️ **Where that address forwards, and what the receiving mailbox retains, is account
configuration outside this repository.** Not measurable here; returned rather than described.

## What we do not do

- No advertising, no ad networks, no third-party analytics on this page.
- No account, no sign-up, and nothing to log in to.
- No sale or sharing of anything, for the simple reason that nothing is collected.

## When the assistant ships

⚠️ **Everything in this section is unwritten and must not be guessed.** These are the questions a
launch has to answer before this document can describe it:

- What a conversation sends, and to which providers.
- Whether any provider may retain or train on it, and the exact retention period.
- How someone asks for their data or its deletion, and how quickly that is answered.
- **Which Thai PDPA obligations attach once real conversation content is processed — the LAW's
  general shape is answered at primary text (Royal Gazette เล่ม 136 ตอนที่ 69 ก, 27 พฤษภาคม 2562);
  whether and how each provision applies to Kolwen's own specific processing is not yet a product
  or legal decision:**
  - **Retrieval within a conversation** — GAP 2 — **[pending legal review]: whether this needs
    separate consent, and whether §24(3) (contract necessity) or §24(5) (legitimate interest),
    read with §21, actually covers Kolwen's own specific processing here, is a legal conclusion
    applying the statute to Kolwen's own facts.** The general shape of these sections is described
    accurately at an internal record of the primary Gazette text; whether they apply to this
    product is counsel's call, not asserted here as settled.
  - **Any use beyond that purpose (training an AI model on conversation content, for example)
    is a NEW purpose under §21 and needs its own explicit, separately-obtained, written or
    electronic consent under §19** — opt-in by construction, never opt-out. *(This states the
    general rule §19/§21 impose on any new purpose; it does not itself characterise Kolwen's own
    processing as compliant — no gap needed on this general statement of law.)*
  - **A third-party AI provider Kolwen routes conversations through** — GAP 3 — **[pending legal
    review]: whether such a provider is a "processor" under §40, versus a controller in its own
    right, is a controller/processor characterisation.** §40's general shape (a processor acts
    only on documented instructions; a written agreement is required; a processor that steps
    outside those instructions becomes a controller for that processing, §40 para 2) is accurately
    described at an internal record of the primary Gazette text; which category any specific
    provider falls into, and what the written agreement must say, is counsel's determination.
  - **Retention has no PDPA-fixed number** — §37(3) requires an erasure/anonymization system once
    the (self-set) retention period lapses; §23(3) requires the period to be stated in the
    notice; §39(4) requires it be recorded. The NUMBER is Kolwen's own product/legal decision,
    not something either PDPA or GDPR supplies. *(This states that no number is set and that the
    Act fixes none — it does not assert any retention number of Kolwen's own as lawful, so no gap
    is needed on this sentence itself.)*
  - **A data breach must be notified to the PDPC within 72 hours of becoming aware, and to
    affected users too where the risk is high (§37(4)).** *(A general statement of the statutory
    duty's own terms — not an assertion that Kolwen has met or will meet it, so no gap.)*
  - **A DPO** — GAP 4 — **[pending legal review]: whether Kolwen needs a Data Protection Officer
    under §41 is a DPO-status determination.** §41's general triggers (state agencies per
    Committee designation; regular, systematic large-scale monitoring; processing of §26
    sensitive data, each per Committee-set thresholds) are accurately described at
    an internal record of the primary Gazette text; whether Kolwen's own processing crosses
    any threshold is counsel's determination, not asserted here.
  - **The PDPA's "small enterprise" exemption (PDPC Notification B.E. 2565) excuses ONLY the
    §39 record-of-processing-activities requirement, and loses even that once processing is
    non-occasional or touches §26 data — a chat product processing messages continuously is not
    "occasional."** Every other obligation above (consent, notice, security, breach notification,
    processor binding) applies regardless of company size. *(A general statement of how the
    exemption's scope works, not a claim that Kolwen qualifies or does not — no gap needed on this
    sentence itself.)*
  - **Source:** main's own primary Gazette read, and this room's legal seat's delta table against
    GDPR. **This list states WHICH obligations attach — it is not the product's own retention
    period, consent-flow copy, or DPO appointment, all of which remain unwritten per this
    section's own header until Kolwen actually ships a conversational feature.**

Until those are decided and written, this page describes a static site only. **Do not extend it by
inference.**

## Changes

This notice is versioned with the site in git; its history is the change log. There is no separate
"last updated" line to fall out of date.
