# Incident response

> Part of Kolwen's control-family set. **Written from day one so that a future audit COLLECTS
> EVIDENCE rather than builds it** (owner ruling AR-10, 2026-09-06; what `AR-n` means is in
> [the index](README.md)). Everything under "Today" is a present-tense fact with its backing
> named; everything under "Plan" and "Drill" is preliminary: written, not yet signed off by counsel, and not yet exercised.
> **No certification is held or claimed** — see `ISO-MAP.md`.
>
> **PRELIMINARY.** The plan and the drill below are preliminary until counsel signs them, and no drill has run yet; the first runs before Kolwen first accepts a customer's personal data (B1). The plan applies from today to any incident that touches personal data Kolwen handles; its customer-data parts apply in full from the day Kolwen first accepts a customer's personal data.
>
> Thailand's PDPA requires notification to the regulator within 72 hours of becoming aware, and to affected users where the risk is high; that obligation is recorded in `PRIVACY.md` and becomes operational the day personal data is processed.

## Today

- **Reporting channel:** GitHub private vulnerability reporting, with `SECURITY.md` as the public
  instruction. A private channel exists before an incident does.
- **Backup channel:** `security@kolwen.com`, named in `SECURITY.md` and published at
  `/.well-known/security.txt`. The earlier limitation, that the address could receive but not send,
  no longer holds: the domain now sends mail.
- **Recorded history:** none since 2026-08-22, the repository's first commit — see
  `docs/TRUST.md` §5.
- **Rollback:** every deploy is a commit; reverting the commit redeploys the previous site, and
  `post-deploy-check.mjs` confirms what is actually being served.

## Plan

*Status: draft, preliminary, not yet reviewed by counsel. It applies from today to any incident that touches personal data Kolwen handles; its customer-data parts apply in full from the day Kolwen first accepts a customer's personal data. No certification is held or claimed; following these sources is not evidence of conformity.*

### A1. Policy

Kolwen keeps a written way to find out that something has gone wrong with its systems or with personal data it holds, to contain it, to tell the people and the authorities the law says to tell, to recover, and to learn from it; the drills below test it, the first before Kolwen first accepts a customer's personal data. The maintainer approves this policy and reviews it after every drill, after every real incident and when a provider, a system or the law changes.

- **Scope:** every system and every provider that holds or touches personal data of customers or visitors, and the repository, CI and release path that ship the service.
- **Definitions:** an *event* is anything that might be a security problem; an *incident* is an event that meets the criteria in A3; a *personal data breach* is a breach of security measures that causes loss, unauthorized access, use, change, correction or disclosure of personal data, whether intended or not (PDPC notice B.E. 2565, ข้อ 3), of one of three kinds: confidentiality, integrity or availability (ข้อ 4).
- **Measures of the plan itself:** time from first alert to the recorded awareness time; time from awareness to each notice; the share of drill findings closed by their date (B4).
- **Updates and access:** update by default; hold a new open-source component or model for a controlled delay before it is adopted, so that detection can run first.
- **Backup plane:** the backup systems are administered apart from production; no production server, client or agent may change its own backup configuration; standard accounts use multi-factor authentication, admin accounts are used only for admin, and external access is by VPN only.
- **Copies:** at least three copies, on two media or two providers, one offsite, and at least one copy that is offline or immutable and that the production administrator cannot delete. Cloud backup clients hold no live credentials while idle. A snapshot is not a backup: "if the source data is unavailable, the snapshots will not be usable as well."

*Sources: NIST SP 800-61 Rev. 3 (April 2025) section 2.3 and GV.PO R1; NIST SP 800-53 Rev. 5.2.0 IR-1 and IR-8; NCSC (UK) blogs "Preparing for a 'vulnerability patch wave'" (1 May 2026), "Why cyber defenders need to be ready for frontier AI" (30 March 2026) and "Retaining defensive advantage in the age of frontier AI cyber capabilities" (15 April 2026); FS-ISAC Sector Risk Advisory "Preparing the Enterprise for AI-Enabled Vulnerability Discovery" (19 April 2026); NIST SP 800-209 (October 2020), DP-SS-R4 and its passage on snapshots; NIST IR 8374 Rev. 1 (June 2026); NCSC (UK) "Offline backups in an online world" (13 August 2019) and "Mitigating malware and ransomware attacks" (v3.0, 13 February 2020); ENISA Threat Landscape for Ransomware Attacks (July 2022); US-CERT "Data Backup Options" (2012).*

### A2. Roles and authority

Kolwen is a one-person project (see `SECURITY.md`): one person holds several roles, and the plan says which, so that a second person can take one later without rewriting it.

| Role | Held by | Authority |
|---|---|---|
| Decision-maker and sender | the maintainer | approves the policy; decides containment steps that take a service offline or rotate every credential; **sends every outward notice** (to an authority, a customer, the public); nothing leaves without this person's decision |
| Incident lead, one per incident | the maintainer, unless the register entry names a stand-in | runs the checklist, starts the clock sheet, keeps the register entry, assigns work |
| Technical responder | the maintainer | may disconnect, disable, revoke and shut down any Kolwen system or credential to contain an incident |
| Outside counsel | a lawyer engaged for data-protection questions | reads the clock and the notice wording, and signs off this plan and the drill design; never signs or sends a notice for Kolwen |
| Provider contacts | listed per provider in A5 | tell Kolwen what happened on their side |

There is no backup for the maintainer today; `SECURITY.md` says so. A stand-in is named in the register entry whenever one is used. The backup plane's administrator is a separate account from production's. *Sources: NIST SP 800-61 Rev. 3 GV.RR-02 R1, R2 and RS.MA-01 C1; NIST SP 800-53 IR-8 "Explicitly designates responsibility"; NIST SP 800-209 (October 2020), DP-SS-R4.*

AI tools may help with analysis and drafting in a response. They hold no authority to contain, notify or send anything; their output is checked; and a person can intervene in, or switch off, any automated action. *Sources: Canadian Centre for Cyber Security, ITSAP.10.050 "Frontier artificial intelligence" (May 2026).*

### A3. What counts as an incident, and when the clock starts

An event becomes an incident when the maintainer, after the first check below, has grounds to believe that confidentiality, integrity or availability of Kolwen systems or of personal data has really been compromised, or that a provider has told Kolwen so. Declaring it is written down with the time.

**First check (verify first).** On any report, from anyone, by any channel, or on Kolwen's own discovery, the maintainer assesses how credible the report is and verifies the facts without delay as far as possible, looking at Kolwen's own security measures and those of its providers, and assesses the risk to people (PDPC notice B.E. 2565, ข้อ 5(1)). A short investigation before awareness is allowed (EDPB Guidelines 9/2022 v2.0, para 34); it is not allowed to drift: the guideline expects it to start at once and to settle with a reasonable degree of certainty (para 31, 34).

**The clock.** The 72 hours run from the moment there are grounds to believe a breach really occurred, not from the first alert (ข้อ 5(3); PDPA s 37(4); GDPR Art 33(1); EDPB para 31). The maintainer writes that moment down in the register at once. A provider's notice is treated as the moment Kolwen is told; whether the Thai notice treats Kolwen as aware at that moment, or only after Kolwen's own check, is [to be confirmed with counsel before this plan is final]. Until counsel answers, the plan runs the shorter reading: the clock starts when the provider's notice is read.

**Encrypted or wiped data.** Data that is encrypted, or wiped, is an availability breach where it is not in a ready-to-use state as normal (PDPC notice B.E. 2565, ข้อ 4(3)), even when a backup restores it. Whether it must be notified is a separate question, decided on the risk (ข้อ 5(3); PDPA s 37(4)). Where Kolwen will claim that no notice to the Office is needed, the exemption file (A8(vi)) is written at once, with its proof: the exfiltration check and the restore log. With no usable backup, the Office's own example treats the breach as notifiable on clock 1 (Playbook 4, step 4); with exfiltration it is a second breach (Playbook 8, step 5), and its notice is decided on the risk like any other. This reading is preliminary and for counsel [to be confirmed with counsel before this plan is final].

*Sources: PDPC notice B.E. 2565 (Royal Gazette vol. 139, special part 292 ง, 15 December B.E. 2565) ข้อ 5; PDPA B.E. 2562 s 37(4); EDPB Guidelines 9/2022 v2.0 paras 31, 34, 44; NIST SP 800-61 Rev. 3 DE.AE-08; PDPC notice B.E. 2565 ข้อ 4(3).*

### A4. Severity

Not first come, first served: triage by risk (NIST SP 800-61 Rev. 3 RS.MA R1, R2). The factors are NIST's (asset criticality, functional impact, data impact, stage of the activity, recoverability) and the PDPC notice's (ข้อ 12: type of breach; kind of data; volume; who the people are, including children and vulnerable people; severity of effects and what mitigates them; wide impact on Kolwen or the public; the storage system and its measures; Kolwen's status and size).

| Level | Meaning | What it triggers |
|---|---|---|
| 1 | An event, no incident: a false alarm or a contained anomaly without effect on data or service | a register line only |
| 2 | An incident without personal data, or with personal data and no likely risk to people's rights and freedoms | containment, recovery, a register entry with the reason no notice was sent; the exemption file where one is claimed (A8) |
| 3 | A personal data breach likely to risk people's rights and freedoms | the notice to the Office within 72 hours (clock 1); customers told as clock 3 requires |
| 4 | A breach likely to be a high risk to people | level 3, and the people told without delay, with what they can do (clock 4) |

The incident lead sets the level, records the reason and revises it as facts arrive.

### A5. Providers: what each is bound to tell Kolwen, and whom to call

Kolwen asks every provider that will hold customer data for a signed data-processing agreement that names its sub-processors and commits to tell Kolwen of a breach without undue delay after the provider becomes aware of it, with the information Kolwen needs for its own notice (the term of GDPR Article 33(2)); a shorter number in a provider's agreement meets it too. Kolwen's own 72 hours to the Office (clock 1, A6) start at the grounds-to-believe time in A3, earlier independent grounds included, and do not change with any provider's term. If counsel reads the Office's breach-notification notice as binding a provider to 72 hours, this ask returns to 72 hours and the table below is re-read. Where a provider's published term is weaker, it is recorded here and the plan's clock starts when the provider tells Kolwen. The table is what the provider's own pages said when read on 2026-10-29; it is re-read at every drill (B1).

| Provider and what it holds | Its published breach term, read at its own page | Status | Contact |
|---|---|---|---|
| **Supabase**: login and identity for the hosted service (account identity, password hashes) | Data Processing Addendum (Version 1, 1 August 2026) clause 10: "without undue delay, and where feasible, within forty-eight (48) hours" | planned; no account exists; the addendum is not yet accepted | recorded here when the account exists |
| **Cloudflare**: serves the static site, terminates TLS, routes the published mail addresses, and tries to send the health-check alerts, on a change of result once the status record is bound (on every failing run until then), to one verified owner address once that is set; no customer data today | Customer DPA (Version 6.4, effective 3 April 2026) clause 3.1(e): "without undue delay notify the Customer upon becoming aware of any breach of security"; no fixed hours | live | from its trust pages and the account dashboard |
| **Paddle**: merchant of record for sales; holds the buyer's name, e-mail, payment and tax data as its own controller | Master Services Agreement clause 14.2 "each party acts as an independent Controller"; Data Sharing Addendum clause 9.1: each party must "inform the other party of any material Personal Data Breach relevant to the Shared Personal Data"; no hours. (Its separate processor addendum, for Retain and Metrics, which Kolwen does not use, says "without undue delay".) | planned | recorded here when the account exists |
| **A model provider** (none chosen): would hold customer conversation content | none exists until one is chosen; before any customer content reaches one, its agreement is read at its own pages and its notice term entered here (published provider terms today range from "without undue delay" to "within 48 hours") | planned | recorded when chosen |

At each drill, re-read how each provider handles accelerated vulnerability disclosure and patching. *Sources: European Central Bank, Banking Supervision letter SSM-2026-0301 (7 July 2026); Bank of England, FCA and HM Treasury joint statement (15 May 2026).*

For each provider the register entry for an incident records the provider's own incident contact, the time Kolwen was told, what the provider said, and what Kolwen may ask of it. A provider is not Kolwen's incident team: its notice starts Kolwen's own work (A7, playbook 1). *Sources: NIST SP 800-61 Rev. 3 GV.SC-05 R1, GV.SC-08, section 2.2 (shared responsibility); ISO/IEC 27035-4:2024 (coordination between organizations; page and abstract read).*

### A6. The five clocks, kept apart

Never one clock. Each runs from its own start. The sheet is filled in at the start of every incident and kept in the register entry.

| # | Who tells whom | Time | Starts when | Source |
|---|---|---|---|---|
| 1 | Kolwen, as controller of its own account data and logs, tells the **Thai data-protection Office** | without delay and within 72 hours "as far as can be done", unless the breach is unlikely to risk people's rights and freedoms | grounds to believe a breach occurred (A3) | PDPA s 37(4); PDPC notice ข้อ 5(3); the encrypted-data reading in A3 |
| 2 | A **provider** tells Kolwen | the provider's own term (A5) | the provider knows | the provider's agreement |
| 3 | Kolwen, as **processor** of the content a customer sends through a service, tells that **customer** | [to be confirmed with counsel before this plan is final]; a customer that is a controller under Thai law must put 72 hours in its agreement with its processor (ข้อ 8), so the number is expected to be no longer than that, subject to counsel; GDPR asks only "without undue delay" and the EDPB recommends prompt notice in phases | Kolwen knows | PDPC notice ข้อ 8; GDPR Art 33(2); EDPB paras 44 to 47 |
| 4 | Kolwen tells **the people affected** when the risk to them is high | without delay, with what they can do to protect themselves | the high-risk finding | PDPC notice ข้อ 5(4), 10; GDPR Art 34(1) |
| 5 | **The late path** | a first notice in phases with what is known; the rest "without undue further delay" (GDPR Art 33(4)); a late notice gives its reasons; under the Thai notice a controller late for necessary reasons asks the Office to excuse it, promptly, at most 15 days after knowing (ข้อ 7) | the deadline of clock 1 passes | GDPR Art 33(1), (4); PDPC notice ข้อ 7; EDPB paras 56 to 65 |

The controller and processor roles named in this section and in the notice templates (A8) are provisional and await counsel's review, as [`PRIVACY.md`](../PRIVACY.md) marks them. Whether clock 1 and the provider rule in A5 cover visitors' personal data that Kolwen's providers handle outside Kolwen's own logs is also a point for counsel.

Clock 1 is run as the shortest clock for every market Kolwen sells in: no market read so far sets less than 72 hours; the remaining markets are being confirmed with counsel. A notice to the Office does not excuse duties under other laws (ข้อ 7).

No source adds a clock: a serious-incident duty to the EU AI Office applies to providers of general-purpose AI models with systemic risk (as the EU General-Purpose AI Code of Practice, 10 July 2025, describes it), and if counsel reads Kolwen into that class it becomes a sixth clock.

### A7. Playbooks

Each is a numbered checklist; in the register entry each step carries who did it and when. The step names follow ISO/IEC 27035-3:2020 (abstract: detection, reporting, triage, analysis, response, containment, eradication, recovery, conclusion) and the checklist form follows the CISA playbooks (November 2021).

**Playbook 1: a provider tells Kolwen of a breach on its side.**
1. Write down the time the notice was read and who sent it; keep the original.
2. Open the register entry; start the clock sheet (A6); take the provider's own term from A5.
3. Verify: is the notice genuine (a known contact, a known channel, not a link in a message)? Do not act on a message that asks for a credential or a click.
4. Ask the provider for what it knows: what data, how many people, when, what it has done, what it needs from Kolwen. Record the answers as they arrive, in phases.
5. Work out what Kolwen data is in the affected system (the inventory) and set the severity (A4).
6. Contain on Kolwen's side: rotate the credentials and keys the provider held or could see; revoke sessions; pause the affected feature if needed.
7. Decide clocks 1, 3, 4 from the facts and write the decision and its reason in the register.
8. Prepare the notices (A8); the maintainer sends.
9. Recover; check restored data before use (A10).
10. Conclude: after-action report (A10); update A5 with what the provider's behaviour taught.

**Playbook 2: Kolwen's own breach (a service, an account, a deploy).**
1. Record the time of the first report and how it came (A11).
2. Verify the facts (A3); if the facts are not yet clear, keep investigating and write down why.
3. Contain: disable the affected component or account; revoke and rotate credentials; preserve logs and the deployed commit before changing anything.
4. Declare the incident and start the clock sheet at the grounds-to-believe time.
5. Scope: which people, which records, which kinds of data (confidentiality, integrity, availability); look beyond the first target for the same activity elsewhere.
6. Set the severity; decide clocks 1, 3, 4; draft and send notices (A8).
7. Eradicate: remove the cause and the entry points; fix the flaw.
8. Recover: restore from a tested backup; check it for compromise; verify; declare the end of recovery on stated criteria.
9. Conclude with the after-action report.

**Playbook 3: a leaked key or secret.**
1. Treat any key that appeared in a public place, a log, a ticket or a message as compromised from the time it was exposed.
2. Revoke it at its issuer at once, then replace it; do not wait to learn whether it was used.
3. Find what it could reach and read the provider's access log for use of it since the exposure; preserve the log.
4. If personal data could have been read with it, this is Playbook 2 from step 2.
5. Find how it leaked and remove that route; search the repository history and the deployed artifacts for the same secret.
6. Record the key's name (never its value), the exposure and revocation times, and what the log showed.

**Playbook 4: data loss or unavailability.**
1. Record the start time and what is unavailable.
2. Decide whether personal data is unavailable or destroyed (an availability breach, PDPC notice ข้อ 4(3)): if people cannot reach their data for longer than a normal outage, treat it as Playbook 2.
3. Restore from the last tested backup; check the restored data for integrity and compromise before use.
4. If no usable backup exists, say so in the register: that is a finding for the after-action report and a likely notifiable breach (the Office's example 4, ransomware with no backup, is notifiable).
5. Test backups on a schedule so that step 3 is known to work (B3).

*Sources: NIST SP 800-61 Rev. 3 RS.MA to RS.MI, RC.RP; CISA Cybersecurity Incident and Vulnerability Response Playbooks (November 2021); ISO/IEC 27035-3:2020 (abstract); the PDPC Office's guide v1.0 (15 December B.E. 2565), examples 2, 4, 7.*

**Playbook 5: a critical vulnerability with a short exploit window (a dependency, a provider, the platform).**
1. Write down the time the advisory was read, the component and its version, and who read it.
2. Triage: is it critical, does Kolwen run it, is it being exploited, and can it be reached from outside? Set the severity (A4).
3. Read the advisory and any provider patch notice. Do not run published exploit code unless an expert has assessed that it contains no backdoor or other malicious behaviour.
4. Where no fix exists yet, isolate the component or disable it.
5. Update external-facing systems first, then internal ones; within each, update the systems that are not business-critical first, through accelerated rings.
6. Check the dependency pins and lock files for the component's version.
7. If the component held a key or token, rotate it (Playbook 3, from step 2).
8. Investigate for compromise while updating; harden, re-enable, then hunt through the logs for the component's exploit window.
9. Record each step's time. Clock 1 starts at the moment there are grounds to believe that personal data was breached (A3), at whatever step that comes; record that time. Each other clock in A6 starts from its own trigger there.
*Sources: NCSC (UK), "Responding to active exploitation of vulnerabilities" v2.1 (1 May 2026); NCSC (UK) blogs "Preparing for a 'vulnerability patch wave'" (1 May 2026), "Why cyber defenders need to be ready for frontier AI" (30 March 2026) and "Retaining defensive advantage in the age of frontier AI cyber capabilities" (15 April 2026); FS-ISAC Sector Risk Advisory "Preparing the Enterprise for AI-Enabled Vulnerability Discovery" (19 April 2026); Canadian Centre for Cyber Security, ITSAP.10.050 "Frontier artificial intelligence" (May 2026); Bank of England, FCA and HM Treasury joint statement (15 May 2026); European Central Bank, Banking Supervision letter SSM-2026-0301 (7 July 2026).*

**Playbook 6: a fake call, message or file that asks the maintainer to run a command, share a key or change an account.**
1. Write down the time and the channel it came through, and keep the original.
2. Verify out of band: call back on a number already known to belong to the requester, or use a channel already in use. Never use a number, link or address that the message itself gave.
3. Run no command, change no account and open no file on the request of the message or call.
4. Share no key or credential on a call. If a secret was shared, it is Playbook 3 from step 1.
5. Check whether anything was done; if an account or file was touched, treat it as Playbook 2 from step 2.
6. Record it in the register even when nothing was lost.
*Sources: Canadian Centre for Cyber Security, ITSAP.10.050 "Frontier artificial intelligence" (May 2026).*

**Playbook 7: an attack on Kolwen's AI service itself (prompt injection, tool or agent misuse, extraction, abuse of keys and quota)** (to check against ISO/IEC 27090 when bought)
1. Write down the time and how it was found: a report, a log, or an output.
2. Verify the facts: which input, which tool or agent, and which output.
3. Preserve the logs before changing anything. Prompts may hold personal data, so handle them as sensitive.
4. Contain: disable the tool or the agent, narrow its permissions, rotate the keys it used, and tighten the rate limits.
5. Scope what the output exposed: which users, which records, which kinds of data.
6. Set the severity (A4). Clock 1 starts at the moment there are grounds to believe that personal data was breached (A3), at whatever step that comes; record that time. Each other clock in A6 starts from its own trigger there.
7. Tell the downstream stakeholders who rely on the service, as the GOVERN 2.1 line of NIST AI 600-1 asks.
8. Recover, then review the response after the fact, as the MANAGE 4.3 line of NIST AI 600-1 asks: was each step followed, and was it effective?
*Sources: NIST AI 100-2 E2025, "Adversarial Machine Learning: A Taxonomy and Terminology of Attacks and Mitigations" (March 2025); NIST AI 600-1, "Generative Artificial Intelligence Profile" (26 July 2024); OWASP Top 10 for LLM Applications 2025; OWASP Top 10 for Agentic Applications 2026 (Version 2026, December 2025); NCSC (UK) and partners, "Guidelines for secure AI system development" (27 November 2023); CISA and partners, "Careful Adoption of Agentic Artificial Intelligence (AI) Services" (1 May 2026).*

**Playbook 8: ransomware or a destructive event (encrypted, wiped or deleted data; a wiper; a destructive insider or agent).**
1. Write down the time it was found, how it was found, and what is unavailable or changed.
2. Verify the facts (A3). Isolate the affected systems at once, and use the out-of-band channel in A11 for every message about the event.
3. Preserve the deployed state and the logs before changing anything.
4. Look for tools that impair backups (for example vssadmin, wbadmin and bcdedit), and record what was found.
5. Scope the event and check for exfiltration: data copied out is a second breach, handled as Playbook 2.
6. Check the backups for integrity and for dropper malware before restoring. "Care must be taken to identify such dropper malware before rebuilding from backups to prevent continuing compromises."
7. Restore in priority order from the offline or immutable copy (A1).
8. Harden before reconnecting.
9. Record each decision and each restore time. Clock 1 starts at the moment there are grounds to believe that personal data was breached (A3), at whatever step that comes; record that time. Each other clock in A6 starts from its own trigger there. The availability reading of an encrypted-then-restored store is at the end of A3. A plain loss with no attacker is Playbook 4, and is not handled here.

*Sources: NIST IR 8374 Rev. 1, "Ransomware Risk Management: A CSF 2.0 Community Profile" (June 2026); NIST SP 800-184, Guide for Cybersecurity Event Recovery (December 2016); NIST SP 800-61 Rev. 3 (April 2025); CISA #StopRansomware Guide (September 2023, the web page read).*

### A8. Notices drafted in advance

Templates with blanks. The maintainer sends; each is read by counsel before the plan is final. The Office's notice is prepared in Thai as well [to be confirmed with counsel before this plan is final]. The Office's electronic channel is [to be confirmed with counsel before this plan is final]; until then the notice goes in writing, which the notice allows (ข้อ 6).

**(i) To the Office (PDPC notice ข้อ 6, four content items "as far as can be stated").** Notice of a personal data breach by Kolwen, a data controller. Time we became aware: ___ (and how). 1. Nature and kind of the breach (confidentiality, integrity or availability); number of people or records affected: ___ (approximate figures are allowed). 2. Contact for more information: ___. 3. Likely effects on the people: ___. 4. Measures taken or planned to prevent, stop or fix the breach and to reduce harm: ___. Information not yet known and when it will follow: ___. If sent after 72 hours: the reasons: ___.

**(ii) A request to be excused for lateness (ข้อ 7).** The facts and the reasons the notice could not be made within 72 hours: ___; the time we became aware: ___; what we have done since: ___. Sent promptly and not later than 15 days after awareness.

**(iii) To a customer, where Kolwen is the processor (clock 3).** A dedicated message, not combined with other news. What happened and when: ___. What data of yours was involved: ___. What we have done: ___. What you may need to do as the controller of that data: ___. Contact: ___. Where the controller channel is not safe to use (compromised), a second channel is used.

**(iv) To the people affected, high risk (clock 4; ข้อ 10; GDPR Art 34(2)).** A dedicated message in plain language in the language of the person's last contact: a summary of what happened; contact for questions; the likely effects; what Kolwen has done; and what the person can do to protect themselves (for example, change a password). Not sent through a channel the breach compromised. Not only a press release or a blog post. Where individual notice is impossible (no contact details), a group or public notice by mass media, online social media or electronic means, which must not cause harm (ข้อ 11).

**(v) Media holding line.** One paragraph, approved by the maintainer: that an incident is being handled, what is known, what people should do, where updates will appear. No speculation about cause or number.

**(vi) The exemption file (ข้อ 9).** Where Kolwen will claim that no notice to the Office is needed, it records at once the proof: for example data that cannot identify a person, or data not in a usable state because of adequate technical measures such as encryption, with the key intact. A decision not to notify is written down with its reason (EDPB para 125). For encrypted data restored from a copy, the proof is the exfiltration check and the restore log (A3).

*Sources: PDPC notice B.E. 2565 ข้อ 6, 7, 9, 10, 11; GDPR Arts 33(3), 34(2); EDPB Guidelines 9/2022 v2.0 paras 85 to 92, 125; NIST SP 800-61 Rev. 3 RS.CO-02.*

### A9. The breach register

One register of every breach, notified or not, kept by the incident lead, readable only by those authorized (NIST SP 800-61 Rev. 3 RS.AN-06 R1). Each entry: id; times (first report, awareness, each decision, each notice, end of recovery); source of the report; the kinds and numbers of people and records; the facts, effects and remedial action; the severity and its changes; the clock sheet; for each notice sent its text and the time; for each notice not sent its reason; the provider's contact and what it said; the incident class, named by the OWASP or NIST AI 100-2 class name where one fits (to check against ISO/IEC 27090 when bought); the after-action report and its improvement items. It is kept for the period counsel advises [to be confirmed with counsel before this plan is final].

*Sources: GDPR Art 33(5); EDPB paras 121 to 126; NIST SP 800-53 IR-5; NIST AI 100-2 E2025, "Adversarial Machine Learning: A Taxonomy and Terminology of Attacks and Mitigations" (March 2025); NIST AI 600-1, "Generative Artificial Intelligence Profile" (26 July 2024); OWASP Top 10 for LLM Applications 2025; OWASP Top 10 for Agentic Applications 2026 (Version 2026, December 2025).*

### A10. Recovery and the after-action report

Recovery starts when the incident lead says so, on stated criteria, and checks: backups are created, protected, kept and tested; restoration assets are checked for compromise and integrity before use; restored systems are checked and watched; the end of recovery is declared. The after-action report records the incident, the response and recovery actions, and what was learned (NIST SP 800-61 Rev. 3 RC.RP-03, RC.RP-05, RC.RP-06 R1, PR.DS-11). It names improvement items with an owner and a date (B4). Business continuity and incident response are kept in step; a change in one reviews the other.

**Backup inventory and recovery catalog.** Every maintained backup is listed with its media, keys, configuration and retention, and each copy is catalogued with its anti-malware scan result; obsolete snapshots are removed. *Sources: NIST SP 800-209 (October 2020), DP-SS-R1, R3(c) and R11; CISA Cross-Sector Cybersecurity Performance Goals 2.0 (December 2025), goal 3.O.*

**Backup retention and erasure.** Backup retention is set against the deletion rule. An erasure on a data subject's request "must cover" the copies or backups too (PDPC notice B.E. 2567, ข้อ 3 para 2); where data cannot be deleted in time, such as data kept in a backup until it is overwritten, ข้อ 4 requires it to be kept in a form that makes it difficult to collect, use or disclose. A locked copy therefore needs a short lock window, or per-customer keys that can be destroyed. That consequence is an inference, not a source's, and is for counsel [to be confirmed with counsel before this plan is final]. CISA's #StopRansomware Guide (September 2023) says: "Use immutable storage with caution as it does not meet compliance criteria for certain regulations and misconfiguration can impose significant cost." *Sources: PDPC notice B.E. 2567 on erasure, destruction and de-identification (Royal Gazette vol. 141, special part 217 ง, 13 August B.E. 2567), ข้อ 3 and ข้อ 4; CISA #StopRansomware Guide (September 2023).*

### A11. Reports in, evidence, sharing, media

- **Reports in.** Anyone can tell Kolwen of a problem through the channels in `## Today` (private vulnerability reporting; `security@kolwen.com`; `/.well-known/security.txt`). A report is taken seriously, read, and answered; the register records the time it was received (NIST SP 800-61 Rev. 3 RS.MA-02 R2).
- **Reporting inside Kolwen.** Anyone working on Kolwen who suspects an incident tells the incident lead at once; the number of hours is [to be confirmed with counsel before this plan is final].
- **Evidence.** What is collected, how long it is kept and who may see it follows Kolwen's retention rules; collected incident data is evidence even where no one will be prosecuted (NIST SP 800-61 Rev. 3 RS.AN-07). Deleting is narrow: named items, never a wide sweep.
- **Information sharing.** Voluntary: Kolwen may share indicators with other providers or a sector body when it helps others; nothing is required today.
- **Media.** Only the maintainer speaks; the holding line is A8(v).
- **AI service output.** Harmful or leaking output from Kolwen's AI service is a reportable event, through the same channels as any report (OWASP Top 10 for LLM Applications 2025; NIST AI 600-1). (to check against ISO/IEC 27090 when bought)
- **Out-of-band channel.** A channel plan for when the normal channels are down or watched: "a strategy for out of band communications should normal business communication channels be disrupted by the ransomware event" (NIST IR 8374 Rev. 1, June 2026). An offline copy of this plan is kept where the responder can reach it with the normal channels gone: "Ensure a hard copy of the plan and an offline version is available." (CISA #StopRansomware Guide, September 2023). Playbook 6 and queue scenario a3 already touch out-of-band channels.

### A12. The plan against NIST SP 800-53 IR-8

| IR-8 asks the plan to | Where |
|---|---|
| provide a roadmap for the incident response capability | this plan, A1 to A12 |
| describe the structure and organization of the capability | A2 |
| fit the organization's mission, size, structure and functions | A2 (one person); A5 |
| define reportable incidents | A3, A4, A6 |
| provide metrics | A1 |
| define resources and management support | A2; B (the drill is the maintainer's time) |
| address the sharing of incident information | A11 |
| be reviewed and approved by a named role; designate responsibility | A1, A2 |
| be distributed, updated after incidents, drills or change, and protected from unauthorized change | A1; this file is in a repository: every change is a commit, checked by the required status checks, which the maintainer's admin role can bypass ([`SECURITY.md`](../SECURITY.md)) |

*Source: NIST SP 800-53 Rev. 5.2.0 IR-8 (catalog of 2026-10-22).*

### A13. Sources and editions

| Source | Edition read | URL |
|---|---|---|
| NIST SP 800-61 Rev. 3 | April 2025 | https://csrc.nist.gov/pubs/sp/800/61/r3/final |
| NIST SP 800-84 | September 2006 | https://csrc.nist.gov/pubs/sp/800/84/final |
| NIST SP 800-53 Rev. 5.2.0 | catalog last modified 2026-10-22 | https://github.com/usnistgov/oscal-content/tree/main/nist.gov/SP800-53/rev5 |
| ISO/IEC 27035-1:2023, -2:2023, -3:2020, -4:2024; ISO 22398:2013 | publisher pages (abstract and scope only; the standards' clauses are not public and are not quoted) | https://www.iso.org/standard/78973.html and the pages for the others |
| CISA, Cybersecurity Incident and Vulnerability Response Playbooks | November 2021 | https://www.cisa.gov/resources-tools/resources/federal-government-cybersecurity-incident-and-vulnerability-response-playbooks |
| FEMA, HSEEP doctrine | January 2020 | https://www.fema.gov/emergency-managers/national-preparedness/exercises/hseep |
| EDPB, Guidelines 9/2022 on personal data breach notification, version 2.0 | adopted 2023 | https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-92022-personal-data-breach-notification-under_en |
| GDPR Arts 33, 34 | as read through the EDPB guideline and UK GDPR | https://www.legislation.gov.uk/eur/2016/679/article/33 |
| PDPA B.E. 2562, ss 37(4), 40 | MDES unofficial translation | https://mdes.go.th/law/detail/1905-Personal-Data-Protection-Act--B-E--2562--2019- |
| PDPC notice on criteria and procedures for personal data breach notification B.E. 2565 | Royal Gazette vol. 139, special part 292 ง, 15 December B.E. 2565 | https://www.mdes.go.th/law/detail/6336 |
| PDPC Office, guide to risk assessment and notification v1.0 | 15 December B.E. 2565 (guidance, not law) | the Office's guide on the same site |
| ECB Banking Supervision letter SSM-2026-0301 | 7 July 2026, to significant institutions | https://www.bankingsupervision.europa.eu/press/letterstobanks/shared/pdf/2026/ssm.2026_letter_on_AI_enabled_cybersecurity_threats.en.pdf |
| Bank of England, FCA and HM Treasury joint statement | 15 May 2026 | https://www.bankofengland.co.uk/news/2026/may/boe-fca-and-hm-treasury-joint-statement-on-frontier-ai-models-and-cyber-resilience |
| HKMA circular "Strengthening Cyber Resilience amid Artificial Intelligence-Empowered Cyber Threats" | 2 June 2026 | https://brdr.hkma.gov.hk/eng/doc-ldg/docId/getPdf/20260529-8-EN/20260529-8-EN.pdf |
| Canadian Centre for Cyber Security, ITSAP.10.050 "Frontier artificial intelligence" | May 2026 (modified 29 May 2026) | https://www.cyber.gc.ca/en/guidance/frontier-artificial-intelligence |
| NCSC (UK), "Responding to active exploitation of vulnerabilities" | v2.1, 1 May 2026 | https://www.ncsc.gov.uk/collection/vulnerability-management/guidance/responding-to-active-exploitation |
| NCSC (UK) blogs: "Preparing for a 'vulnerability patch wave'" (1 May 2026); "Why cyber defenders need to be ready for frontier AI" (30 March 2026); "Retaining defensive advantage in the age of frontier AI cyber capabilities" (15 April 2026) | the three blog pages | https://www.ncsc.gov.uk/blogs/prepare-for-vulnerability-patch-wave; https://www.ncsc.gov.uk/blogs/why-cyber-defenders-need-to-be-ready-for-frontier-ai; https://www.ncsc.gov.uk/blogs/retaining-defensive-advantage-in-the-age-of-frontier-ai-cyber-capabilities |
| FS-ISAC Sector Risk Advisory "Preparing the Enterprise for AI-Enabled Vulnerability Discovery" | 19 April 2026 | https://www.fsisac.com/hubfs/Knowledge/AI/SectorRiskAdvisory_PreparingtheEnterpriseforAI-EnabledVulnerabilityDiscovery.pdf |
| NIST AI 100-2 E2025, "Adversarial Machine Learning: A Taxonomy and Terminology of Attacks and Mitigations" | March 2025 (03/24/25 Final) | https://csrc.nist.gov/pubs/ai/100/2/e2025/final |
| NIST AI 600-1, "Generative Artificial Intelligence Profile" | 26 July 2024 (page updated 8 April 2026) | https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence |
| OWASP Top 10 for LLM Applications | 2025 | https://genai.owasp.org/llm-top-10/ |
| OWASP Top 10 for Agentic Applications | 2026 (Version 2026, December 2025) | https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/ |
| NCSC (UK) and partners, "Guidelines for secure AI system development" | 27 November 2023 | https://www.ncsc.gov.uk/collection/guidelines-secure-ai-system-development |
| CISA and partners, "Careful Adoption of Agentic Artificial Intelligence (AI) Services" | 1 May 2026 | https://www.cisa.gov/news-events/news/cisa-us-and-international-partners-release-guide-secure-adoption-agentic-ai |
| OWASP GenAI Red Teaming Manual | Version 1.0, 20 October 2026 | https://genai.owasp.org/resource/genai-red-teaming-manual-version-1-0/ |
| EU General-Purpose AI Code of Practice | published 10 July 2025 | https://digital-strategy.ec.europa.eu/en/policies/contents-code-gpai |
| NIST IR 8374 Rev. 1, "Ransomware Risk Management: A CSF 2.0 Community Profile" | June 2026 (final 11 June 2026) | https://csrc.nist.gov/pubs/ir/8374/r1/final |
| NIST SP 800-184, Guide for Cybersecurity Event Recovery | December 2016 | https://csrc.nist.gov/pubs/sp/800/184/final |
| NIST SP 800-209, Security Guidelines for Storage Infrastructure | October 2020 | https://csrc.nist.gov/pubs/sp/800/209/final |
| CISA #StopRansomware Guide | September 2023; the web page read, not the PDF | https://www.cisa.gov/stopransomware/ransomware-guide |
| CISA Cross-Sector Cybersecurity Performance Goals, Version 2.0 | December 2025 | https://www.cisa.gov/sites/default/files/2025-12/CPG_Report_2.0_508c.pdf |
| NCSC (UK), "Mitigating malware and ransomware attacks" | v3.0, 13 February 2020 (reviewed 9 September 2021) | https://www.ncsc.gov.uk/guidance/mitigating-malware-and-ransomware-attacks |
| NCSC (UK), "Offline backups in an online world" | 13 August 2019 | https://www.ncsc.gov.uk/blog-post/offline-backups-in-an-online-world |
| ENISA, Threat Landscape for Ransomware Attacks | July 2022 | https://www.enisa.europa.eu/sites/default/files/publications/ENISA%20Threat%20Landscape%20for%20Ransomware%20Attacks.pdf |
| US-CERT (Carnegie Mellon), "Data Backup Options" | 2012 | https://www.cisa.gov/sites/default/files/publications/data_backup_options.pdf |
| PDPC notice on erasure, destruction and de-identification B.E. 2567 | Royal Gazette vol. 141, special part 217 ง, 13 August B.E. 2567 | the Royal Gazette's own pages (URL not yet recorded) |

International standards and guides come first; Thai law is the local layer on top. The Thai notice is quoted in the section where it applies; its text was read in the Gazette's own pages.

## Drill

*Status: draft, preliminary. A drill rehearses the plan on paper or on a test; it never touches live customer data, and a notice drafted in a drill is never sent.*

### B1. When a drill runs: events only

There is no calendar. A drill runs when one of these happens:
1. once, before Kolwen first accepts a customer's personal data;
2. each time a new provider will hold customer data (the provider's own breach term is re-read at its pages at the same time);
3. each time a new sensitive system is born (an inference gateway, an access log, a data lifecycle, abuse handling);
   A new sensitive system's birth picks this topic up (abuse handling for misuse of the service, the inference gateway for attacks on the service itself), and its study visit reads the then-current OWASP lists and NIST taxonomy.
4. after every real incident, whether Kolwen's own or one at a provider Kolwen uses (a short drill of the lesson, within the review of the incident);
5. one drill in any year in which none of the above occurred.

Each drill leaves a record (B6) and changes to the plan (B4).

### B2. The shape of a drill

*Sources: NIST SP 800-84 (September 2006) sections 2 and 4; HSEEP (January 2020) chapters 3 to 6; ISO 22398:2013 (page and abstract only).*

- **Type and order.** A discussion-based **tabletop** first: a facilitator walks the participants through a short scenario with timed injects, and they decide aloud what they would do. A tabletop "does not involve deploying equipment or other resources" (NIST SP 800-84, section 4). Later a **functional** step: carry out one real action from the plan in a test setting (send a drafted notice to a test address; restore a backup to a test system) and time it. And a **test** with a measurable result of backup and recovery (NIST SP 800-84, section 6).
- **Objectives** (set before the drill, specific and measurable): validate the content of the plan (NIST SP 800-84, 4.2.3); validate that each role knows what to do; validate that the clocks are identified and started correctly; validate that the notice drafts can be completed inside 72 hours.
- **Scenario.** Short and concise, "often more effective" than long; a facilitator redirects the discussion to the objectives when the group starts dissecting the scenario (NIST SP 800-84, 4.3). Timed injects add facts.
- **Roles.** Facilitator (leads the discussion, not the incident lead); the participants (the maintainer as incident lead, counsel by invitation); a **data collector** who records every time and decision; an **evaluator** who scores the criteria. Where nobody else is available, the maintainer runs the drill from the written script, records the times as the drill goes, and a second reader checks the record afterwards. This is stated, not hidden: it is weaker evidence than a drill with another person.
- **Documents.** A one-page briefing; the facilitator's script (purpose, scope, objectives, scenario, injects, questions, the plan); the evaluation criteria fixed in advance; an after-action report template. A scenario package from CISA's Tabletop Exercise Packages (a page read; the packages themselves not yet read) may be the starting skeleton.
- **No live data.** No customer data is used; names, numbers and addresses are invented.

### B3. Tests that sit beside the drills

Backups: restore a backup to a test system on a schedule the maintainer sets, check the restored data, and record the time it took and what failed (NIST SP 800-84, section 6; NIST SP 800-61 Rev. 3 PR.DS-11).

**Restore drill.** The drill restores from the offline or immutable copy to a test system, checks the integrity of what it restores, times it against a target the maintainer sets, and records failures. It runs at least once a year (CISA Cross-Sector Cybersecurity Performance Goals 2.0, goal 3.O, December 2025) and at least monthly for critical data (NIST SP 800-209, DP-SS-R3(b)). NIST SP 800-184 asks that recovery capabilities be validated by tests and exercises.

### B4. After the drill: hotwash, report, improvement items

1. **Hotwash**, straight after: what went well; which role was unclear; was the plan followed and was it enough; which policy or procedure should change; which training or tool is missing; which indicator should be watched (CISA playbooks, post-incident questions).
2. **After-action report**, written from the data collector's record and the evaluator's scores: background, objectives, participants, scenario, observations, and recommendations.
3. **Improvement items**: each finding becomes a corrective action that is specific, measurable, achievable, relevant and time-bound, with an owner and a date (HSEEP chapter 6). Items are tracked until done and checked at the next drill that the fix worked.
4. The plan is changed where the drill showed it must be (A1, review).

### B5. The first drill

**Scenario: a provider tells Kolwen of a breach at its side, from the login door (Supabase).** *Why this one:* the login and identity provider is the first provider that will hold customer data (account identity and password hashes; its account and addendum do not yet exist), and Kolwen is the controller of that account data; a provider's notice is the case the Thai authority itself uses as its example of a processor telling a controller (the Office's example 7); it exercises clocks 1, 2 and 4 and the late path, and playbook 1; the drill is also the first of B1's events (before the first customer data) and the second (a new provider). It sits before any real account exists, so no live data is at risk. A tabletop is the right first type: nothing in the plan has been run yet.

**Participants:** the maintainer (incident lead); counsel by invitation; a facilitator and a data collector (B2). **Objectives:** (1) every clock identified and the start time written down within the first 10 minutes of the exercise's own time; (2) the first check before awareness done as A3 says; (3) the Office's notice drafted from template A8(i) with what is known, in phases; (4) the high-risk decision reasoned and recorded; (5) the customer-facing notice avoids a channel the breach compromised; (6) the register entry complete.

**Injects (all invented):**
- *T+0:* an e-mail arrives from the provider's security contact: it has found unauthorized access to a database in the project's region; the data may include account identifiers and password hashes of Kolwen's users; it is investigating and will write again in 24 hours. Questions: who reads it; is it genuine; is Kolwen "aware" now; which clocks start; what does Kolwen do in the first hour?
- *T+6 hours:* the provider confirms that hashes of a number of accounts were copied, names the hashing method, and says no plaintext passwords were stored. Questions: what severity now; does the method change the risk to people (the exemption file, A8(vi)); what is rotated?
- *T+20 hours:* a user writes to the published address that they received a phishing e-mail using the address they signed up with. Questions: is that a second incident or evidence for this one; does it change the severity; is the user's channel safe to answer on?
- *T+30 hours:* the provider says it has already told its own authority and asks Kolwen to coordinate any public statement. Questions: what does Kolwen say, and who says it?
- *T+60 hours:* the facts are still incomplete and clock 1 ends in 12 hours. Questions: what goes to the Office now, in phases; what reasons are given for what is missing?

**Criteria (set in advance, scored by the evaluator):** the awareness time is written; the clock sheet is started and correct for each clock; the severity is set with a reason; the Office notice is complete as to what is known and marked as phase 1; the notice to people is in plain language, names what to do, and avoids the compromised channel; the register entry is complete; the decisions not to notify, if any, carry reasons.

**Queue after the first drill.** Each scenario runs on a B1 event.
- a1: a critical vulnerability in a component Kolwen runs is exploited in the wild within hours of disclosure (Playbook 5).
- a2: a fake video call asks the maintainer to run "troubleshooting" commands, and a provider key leaks (Playbook 6, then Playbook 3).
- a3: an attacker tries to read the incident notes while the response runs, so the response moves to a channel the attacker cannot read. This is a design test, not a cited fact.
- b1: a prompt injected through user content makes the service return another user's data (Playbook 7; the clocks in A6). (to check against ISO/IEC 27090 when bought)
- b2: an agent with a broad key is steered into a destructive tool call (Playbook 7). (to check against ISO/IEC 27090 when bought)
- b3: a stolen provider key drains the quota (Playbook 7; Playbook 3). (to check against ISO/IEC 27090 when bought)
- c1: a third party reports that Kolwen's service is writing scam scripts for a fraud ring. This is a drill only; its procedures belong to the abuse-handling system's own design.
- d1: ransomware reaches the backup host, and the copies held there are encrypted (Playbook 8).
- d2: a destructive agent deletes a storage bucket (Playbook 8; Playbook 7).

*Sources: European Central Bank, Banking Supervision letter SSM-2026-0301 (7 July 2026), its exercise paragraph; HKMA circular "Strengthening Cyber Resilience amid Artificial Intelligence-Empowered Cyber Threats" (2 June 2026); OWASP GenAI Red Teaming Manual, Version 1.0 (20 October 2026); for d1 and d2, NIST IR 8374 Rev. 1 (June 2026), NIST SP 800-209 (October 2020) and CISA Cross-Sector Cybersecurity Performance Goals 2.0 (December 2025), goal 3.O.*

### B6. The drill checklist

Before: [ ] the trigger recorded; [ ] objectives written; [ ] scenario and injects written; [ ] roles filled (or the single-person arrangement stated); [ ] evaluation criteria fixed; [ ] the notice templates (A8) present; [ ] the provider table (A5) re-read at the providers' pages; [ ] invented data only.
During: [ ] the data collector records the time of each inject, each decision and each draft; [ ] the facilitator keeps to the objectives; [ ] no real notice is sent.
After: [ ] hotwash held; [ ] after-action report written; [ ] each improvement item has an owner, a date and a check; [ ] the plan changed where needed; [ ] the record filed in the repository's governance folder with the date, scenario, participants, times and findings.
