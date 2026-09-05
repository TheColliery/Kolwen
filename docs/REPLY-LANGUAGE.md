# Reply language

**The standard, owner-set 2026-09-04:** *"ถาม English ตอบไทยกลับ ไม่ว่าด้วยวิธีใด นั่นคือความล้มเหลว
เอาไปขายต่างชาติไม่ได้."* Ask in English, get Thai back, by any mechanism — that is a failure, and
a product that does it cannot be sold abroad.

**The rule: the reply is in the language of the MESSAGE.** On every path, without exception:
a normal answer · a refusal · an error · a timeout · a proactive or follow-up message.

> **THE GATE.** Nothing in nationality-matched support proceeds until this document's acceptance
> test and the SELF-DECAP battery (`docs/NEVER-A-CLONE.md`) both pass. Recorded here and in that
> file because this room keeps no separate queue; a planner reading either one meets the gate.

## What exists today, measured

**This repo ships no reply surface.** `web/` is a static page and `/chat` is a pending unit, so
there is no path that emits a reply and nothing here can be sold abroad yet either. The parts
below are marked **ENFORCED TODAY** or **BINDS AT SURFACE** so neither pretends.

### The inventory, and the line it turns on—ENFORCED TODAY

Every tracked file that could emit user-facing text was read. **Findings: zero.**

**A REPLY is text the product emits back to a user in response to their message.** Two things are
therefore exempt BY KIND, not by exception, and both are named so nobody "fixes" them later:

| not a reply | why |
|---|---|
| `web/index.html`'s bilingual copy | It is the PAGE, not an answer to anyone. Its EN/TH toggle is the site's design, and a visitor choosing Thai is choosing what to read, not receiving a reply in a language they did not write in. |
| the Thai strings in `scripts/surface-check.mjs` | They are DETECTOR patterns—the Thai phrasings of a false trademark claim, which the checker must contain in order to catch. A detector that cannot name what it looks for is not a detector. |

`py/src/kolwen/__init__.py` holds an English docstring: package metadata, not a reply, and it is
covered by the scan anyway.

The scan that keeps this true is `scripts/reply-language-check.mjs --scan`, wired into CI.

## The system-prompt rule—BINDS AT SURFACE

The `/chat` unit builds its system prompt from this section. It is not advisory.

1. **The persona is language-neutral.** No Thai persona, no Thai name for the assistant inside the
   prompt, no Thai examples in a few-shot block. A persona written in one language pulls replies
   toward it, and that pull is exactly the failure the standard names.
2. **The FINAL rule, verbatim, and last in the prompt:** `reply in the user's language`.
   Last because a later instruction wins in practice; verbatim because a paraphrase drifts.
3. **No hard-coded reply templates in any language**—refusals, errors and timeouts are generated
   in the user's language, never selected from a canned string. This pairs with the no-canned-
   refusal rule in `docs/NEVER-A-CLONE.md`.

**This ships in the SAME unit as `/chat`**, alongside the cookie and privacy wording LWK-058 binds
to that ship. One unit, or the page is lying about one of them for the length of the gap.

## Detection is per MESSAGE—BINDS AT SURFACE

**The UI selector is a DEFAULT, never the answer.** It sets what an empty conversation starts in.
The moment a message arrives, the reply's language is decided by THAT MESSAGE.

A user who switched the page to Thai and then types in English is asking in English. A user who
never touched the selector and types in Japanese is asking in Japanese. In both cases the selector
is stale information and the message is current information.

**The exhibit this prevents, named:** the Synantic shape—a Thai template returned for an English
message, because the template was chosen by configuration rather than by the message. The reply
was well-formed, polite, and useless to the person who wrote it.

## The acceptance test—the harness is ENFORCED TODAY, the endpoint BINDS AT SURFACE

`scripts/reply-language-check.mjs` runs the same probe in **EN / TH / ZH / JA** across **all five
paths**—20 probes—and asserts the language of the REPLY.

| mode | when | what it proves |
|---|---|---|
| `--self-test` | **in CI today** | the harness detects the failure. The RED fixture is the Synantic shape: a Thai template returned whatever was asked. It must fail every non-Thai probe (15 of 20)—if it does not, the harness is not measuring anything. A conforming fixture must pass all 20. |
| `--scan` | **in CI today** | no hard-coded single-language reply template exists in shipped code |
| `KOLWEN_CHAT_ENDPOINT=<url>` | **the day `/chat` exists** | the same 20 probes against the real endpoint. One environment variable, no rewrite. |

With no mode and no endpoint the script **exits 1** rather than printing nothing: a gate that
cannot see must not report success.

**How the language is decided, and its honest limit:** by Unicode script range, not by a model —
deterministic, needs no network, and cannot itself be wrong about Thai versus Latin. It cannot
separate two languages sharing one script. That is enough for the failure this exists to catch,
which is a reply in a different SCRIPT from the message, and the limit is stated rather than
discovered later.
