# Framework crosswalk

> Part of Kolwen's control-family set. One control is implemented once, and this file maps it to
> every market framework that asks for it, so that entering a market later is evidence and
> paperwork, not a rebuild. The same controls are mapped to ISO/IEC 27001:2022 in [ISO-MAP.md](ISO-MAP.md).

**This is a map, not an attestation.** Kolwen holds no certification, has not been audited against
any framework below, and nothing here means "compliant". Which framework to pursue first, if any,
is the owner's decision; this file carries no recommendation.

## The frameworks, as read

Every row was read by the head on 2026-10-29, at the URL named.

| Framework | Edition, as the page states | Where read | Public or paywalled | What was read, and what was not |
|---|---|---|---|---|
| NIST SP 800-53 | Rev. 5, "September 2020 (includes updates as of Dec. 10, 2020)"; the page also notes a minor release 5.2.0 issued "August 27, 2025" | https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final | Public. The PDF is linked; the two-letter family IDs and the control numbers are in the PDF, not on the page read | The page title and its 20 family names (below). Control text and control numbers not read |
| FedRAMP baselines | High, Moderate, Low and LI-SaaS baseline catalogue, on the legacy page "intended only for reference during the transition" to the Consolidated Rules for 2026 | https://www.fedramp.gov/legacy/ and https://www.fedramp.gov/2026/ | Public. The baseline control lists themselves not read | The legacy page's description of the catalogue (an .xlsx, not read). The 2026 page names no baseline |
| SOC 2 Trust Services Criteria | "2017 Trust Services Criteria (With Revised Points of Focus – 2022)" | https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022 | Behind an account wall. Read at its public download page only | The five categories: Security, Availability, Processing Integrity, Confidentiality, and Privacy. Criterion numbers (the CC series) not read |
| ISO/IEC 27017 | 2026, Edition 2, published 2026-07-27 (replaces the withdrawn 2015 edition) | https://www.iso.org/standard/27017 | Paywalled. Read at its catalogue page only | "provides guidance for implementing information security controls in cloud services". Text not read |
| ISO/IEC 27018 | 2025, Edition 3, published 2025-08-26 (replaces the withdrawn 2019 edition) | https://www.iso.org/standard/27018 | Paywalled. Read at its catalogue page only | "provides guidance for protecting personally identifiable information (PII) in public cloud services", when the provider acts as a PII processor. Text not read |
| ISO/IEC 27701 | 2025, Edition 2, published 2025-10-14 (replaces the withdrawn 2019 edition); now "an independent management system standard (MSS)", no longer an extension of 27001 | https://www.iso.org/standard/27701 | Paywalled. Read at its catalogue page only | "sets out requirements for establishing, implementing, maintaining, and continually improving" a Privacy Information Management System. Text not read |
| ISO/IEC 27001:2022 and 42001:2023 | Already in [ISO-MAP.md](ISO-MAP.md), with its own note on clause numbers | — | Paywalled, as ISO-MAP says | — |

NIST SP 800-53 Rev. 5 families, as the page names them: Access Control; Awareness and Training;
Audit and Accountability; Assessment, Authorization and Monitoring; Configuration Management;
Contingency Planning; Identification and Authentication; Incident Response; Maintenance; Media
Protection; Physical and Environmental Protection; Planning; Program Management; Personnel Security;
PII Processing and Transparency; Risk Assessment; System and Services Acquisition; System and
Communications Protection; System and Information Integrity; Supply Chain Risk Management.

## The column rules

- The ISO/IEC 27001:2022 column uses only the Annex A numbers that [ISO-MAP.md](ISO-MAP.md) already
  carries. A dash means none is carried.
- NIST SP 800-53 is named by family, never by control number.
- SOC 2 is named by category.
- "In scope" for ISO/IEC 27017, 27018 and 27701 means the row falls within that standard's published
  scope sentence, not a clause match, because their texts are paywalled. A blank cell is outside
  that sentence.
- FedRAMP is not a column. Its baselines are selections of SP 800-53 Rev. 5 controls, so a row's
  NIST family is its path. Which baseline includes which control was not read.

## The controls

Systems are named generically: sign-in, key service, metering, billing ledger, inference gateway,
data lifecycle, access audit log, abuse handling, notifications, status page, monitoring.

| # | Control (ours) | Carried by | Evidence it leaves | ISO/IEC 27001:2022 | NIST SP 800-53 Rev. 5 family | SOC 2 category | ISO/IEC 27017 | ISO/IEC 27018 | ISO/IEC 27701 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Access control and least privilege | sign-in, key service, every system that opens customer data | [`access-control.md`](access-control.md); access audit log entries | A.5.15, A.8.2 | Access Control | Security | in scope | in scope | in scope |
| 2 | Authentication of people and API keys | sign-in, key service | the key service's tests; sign-in configuration records | — | Identification and Authentication | Security | in scope | | |
| 3 | Audit logging, including who opened customer data | access audit log, monitoring | [`logging.md`](logging.md); append-only log records | A.8.15 | Audit and Accountability | Security | in scope | in scope | in scope |
| 4 | Incident response and breach notice | monitoring, notifications | [`incident-response.md`](incident-response.md); incident records | A.5.24 | Incident Response | Security | in scope | in scope | in scope |
| 5 | Retention and deletion | data lifecycle | [`retention-deletion.md`](retention-deletion.md); deletion records | A.5.33, A.8.10 | Media Protection; PII Processing and Transparency | Confidentiality; Privacy | | in scope | in scope |
| 6 | Data subject requests: access, erasure, export | data lifecycle | [`PRIVACY.md`](../PRIVACY.md); request and answer records | A.5.34 | PII Processing and Transparency | Privacy | | in scope | in scope |
| 7 | Change management | every system | [`change-management.md`](change-management.md); CI runs and review records | A.8.32 | Configuration Management | Security | in scope | | |
| 8 | Asset inventory | every system | [`inventory.md`](inventory.md) | A.5.9 | Configuration Management | Security | in scope | | |
| 9 | Supplier and provider management | every system that uses a provider | the supplier security assessment (planned); the house's custody bar | A.5.19, A.5.21 | Supply Chain Risk Management; System and Services Acquisition | Security | in scope | in scope | in scope |
| 10 | Risk assessment | every system | [`risk-register.md`](risk-register.md) | A.5.7 | Risk Assessment | Security | in scope | | in scope |
| 11 | Policies | the whole service | [`policies.md`](policies.md) | A.5.1 | Planning; Program Management | Security | in scope | | in scope |
| 12 | Business continuity and backup | billing ledger, data lifecycle, every store | business continuity (planned) | A.5.29 | Contingency Planning | Availability | in scope | | |
| 13 | Monitoring and availability | monitoring, status page | monitoring alert records; the public status history | — | System and Information Integrity; Assessment, Authorization and Monitoring | Availability; Security | in scope | | |
| 14 | Awareness and training | the team | awareness and training (planned) | A.6.3 | Awareness and Training | Security | in scope | | in scope |
| 15 | Encryption in transit and at rest | inference gateway, every store, every provider | provider trust readings; configuration records | — | System and Communications Protection | Security; Confidentiality | in scope | in scope | |
| 16 | Acceptable use enforcement with due process | abuse handling | [`TERMS.md`](../TERMS.md) (the AUP section); decision and appeal records | A.5.20 | — | — | | | |

16 controls; carried by the 11 systems named above.

## What no control covers

A control framework governs how the service is run; it cannot change where the base model comes
from. A government buyer's restriction tied to the base model's origin (the United States' Section
1260H list is the example the house has read) is answered by the base model itself, not by any row
above. A second base model kept ready on the bench is the part of market readiness no control covers.

## Owed

- Frameworks not read, named as owed: Singapore's Multi-Tier Cloud Security standard (the IMDA URL
  tried answered with an unrelated page); each allow-list market's own government cloud scheme.
- Baseline control lists not read: the FedRAMP High, Moderate, Low and LI-SaaS catalogue (an .xlsx).
- Texts not read: the SOC 2 criterion numbers (the CC series); the ISO/IEC 27017, 27018 and 27701
  texts, which are paywalled; the SP 800-53 control numbers, which are in the PDF.
