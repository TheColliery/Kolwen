# Support-agent build spec

The document the `/chat` build reads. **Nothing here runs yet** — this is the set of requirements
that bind the moment a conversational surface exists, gathered in one place so the build collects
them rather than rediscovers them.

## Already-binding requirements from other units

These are not restated here; each lives in its own spec and binds at the same surface:

- **Reply language** — `docs/REPLY-LANGUAGE.md`. The reply is in the language of the MESSAGE on
  every path. Its system-prompt rule and per-message detection are the at-surface halves.
- **Never a clone** — `docs/NEVER-A-CLONE.md`. The IC label, the SELF-DECAP battery, grounding
  that is never silent, and no canned refusal templates.

## Zero Data Retention is an account-mode requirement, not a setting to remember

Whichever AI provider Kolwen's support agent uses, the account or project it runs under must be
configured for zero data retention where the provider offers it, and the retention tier must be a
stated fact rather than a default nobody checked.

The concrete shape, from AWS Bedrock's own documentation, read 2026-09-06 at
`docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html`: retention modes run `none`
(ZDR) < `default` < `aws_review`. Under `none`, *"No request or response data is written to durable storage by AWS or
shared with the model provider."* **A model can require a higher tier than `none`** — Claude models
on Bedrock require `aws_review`, under which requests are retained inside AWS for up to 30 days for
AWS's own review and are still never forwarded to the model provider. If the account is pinned to
`none` and a model requires more, the request is **blocked with an error** rather than silently
retained.

**The requirement, therefore:** the build states which retention tier each provider account runs
under, and treats a tier it did not choose as a defect. A provider that offers no such control is a
finding for the owner before it is used.

## Retention window

**[N days]** for conversation content, bracketed for the same reason `TERMS.md` brackets it: N is
set before launch, and no statute supplies it.

## The start-of-chat notice and the end-of-chat consent button

**Design-time requirements of `/chat`: a start-of-chat notice and an end-of-chat consent control
for helping improve Kolwen. Their exact text is drafted and PENDING THE OWNER'S SIGNATURE — it is
not reproduced here, and no wording in this file should be treated as final.**

## Account enforcement, appeals and the person behind the AI

**The principle: an AI agent never works alone.** A support agent that refuses a refund "due to a violation"
before the appeal is decided, sends the customer back to the appeal form, and then lets the conversation close
as "no longer monitored" has turned a dispute into a loop with nobody in it. These requirements are each the
opposite of one step in that loop. They sit beside the abuse defences (the trigger side of enforcement, which
decides when a case opens) and the support-data clause (what a support conversation may retain); this section
covers what happens to the customer once an account action is on the table.

The enforcement process itself is in `TERMS.md` ("Acceptable use and how it is enforced"): notice, suspension
rather than termination, a window to answer, a written decision, one appeal to a human, and a register of
cases. The requirements below are how the support surface behaves around that process; none replaces a step.

1. **An AI first line, with a person always behind it.** The agent hands off to a person when the user asks for
   one, on any account action, on anything about money, when the same issue is raised a second time, and when
   its own confidence in an answer is low. **The AI never closes a thread that holds an open account action or
   dispute.**
2. **Every suspension states the rule and the conduct,** unless the law or a live security investigation bars
   it, and names the appeal route. This is the "notice" step of the process, in the customer's hands.
3. **An appeal gets a case number, a status the customer can see, and a decision deadline that Kolwen sets and
   publishes** (**[N days]**, a placeholder until signed), **with an escalation when the deadline passes.**
4. **One case across support, safety and billing.** Every door sees it, and no door sends the customer back to
   a door already tried.
5. **Money waits for the decision.** No refund is refused while an appeal is open, and a reversed suspension
   restores the time, or refunds pro rata, without a second request. This is the "refund follows the outcome"
   rule of the process.
6. **Data export and account deletion stay open during a suspension.**

**Also required:** a suspended or cancelled customer keeps their entitlement to human support for as long as
their dispute or appeal is open. A suspension never removes the person.

**Phase 1.** The AI support is the maintainer's assistant, and the maintainer is the person behind it. The AI
triages, keeps the case and its deadline, and drafts every reply; the maintainer reads, decides and sends
anything that touches an account, money or an appeal. The published appeal deadline is sized to one person. A
second person joins that lane when Kolwen hires.

**Checks still open** (counsel's, not answered here): whether a decision about an account taken solely by
automated processing needs a right to human intervention, to express a view and to contest it (GDPR Art. 22);
whether the EU Digital Services Act's duty to give a statement of reasons reaches this service; and the Thai
reading.

The support tool is a provider choice, and carries the same duty as every other provider: a studied alternative
and a way out within a day.

## What does not exist yet

No endpoint, no account with any provider, no conversation storage, no deletion job. Every
paragraph above is a requirement on a thing that has not been built.
