# Day 5 — Candidate processing: entity resolution, suppression, hard filters

The deterministic stage between discovery and qualification. Normalized Apollo
leads become canonical companies, survivors, and a recoverable cold pool with
structured reasons — plan section 7, stage 1, steps 4 to 10.

It extends [Day 4](./DAY4_APOLLO_PROSPECTS.md) rather than changing it. The
Apollo client, the ICP → people mapping, the normalizer and the search endpoint
are untouched; this hangs off the end of the same request.

---

## Architecture

```
POST /api/icps/:id/prospects           the existing endpoint, extended
        │
        ▼
  ProspectService                      loads ICP + optional analysis
        │
        ▼
  PeopleDiscoveryProvider  ──────────▶ ApolloPeopleService (unchanged)
        │
        ▼  PersonCandidate[]           provider-neutral
        │
        ▼
  CandidateProcessingService           the new stage; no provider HTTP, no model
        │
        ├── dedupePersonCandidates()   exact identity only
        ├── EntityResolutionService    modules/companies/
        ├── SuppressionService         modules/filtering/
        ├── FilteringService           modules/filtering/  (+ rule-evaluation)
        ├── checkReachability()        modules/filtering/
        └── CandidateRepository        search_runs → candidates → companies → sources
        │
        ▼
  ProspectRunDto { people, pagination, meta, processing }
        │
        ▼
  ProspectResults + ProspectProcessing   React; renders the neutral contract only
```

### Why this lives inside the existing endpoint

A processed run needs the ICP, the analysis selection and the search results at
once. A second endpoint would either re-run the Apollo search — spending a
credit to answer the same question twice — or accept a lead list in a request
body, which means posting personal data back to the server it came from. The
processing stage is the second half of what a prospect search *is*, so it runs
in the same request.

`people` is deliberately **not** narrowed to the survivors. The pagination block
describes that list; filtering it server-side would leave `totalEntries` and
`hasMore` describing a result set the caller cannot see. `processing` labels the
people instead, joined on `rawSourceRef`.

---

## The pipeline, and why the order is what it is

| Stage | Rejection reason | Why here |
| --- | --- | --- |
| Deduplication | `DUPLICATE` | Cheapest and most certain. Two copies of one person must not be filtered twice. |
| Entity resolution | — | Every later stage asks questions about the *company*, so the company has to exist first. |
| Suppression | `SUPPRESSED` | Overrides fit entirely. An account we may not contact is not "a poor industry match". |
| Hard ICP filters | `HARD_*` | Deterministic criteria the ICP declares. Every failing criterion is collected, not just the first. |
| Reachability sanity | `UNREACHABLE` | Last, because it is the weakest statement: it says nothing about whether a candidate *should* be contacted. |

Each stage is more certain than the one after it, so a candidate is always
recorded against the most fundamental thing wrong with it. A suppressed account
is never reported as an industry mismatch that happens to also be suppressed —
otherwise the cold pool misstates why the list is short.

### What "survivor" means, and what it does not

A survivor is: **not suppressed**, **not rejected by a supported hard
criterion**, and **not obviously unreachable**. That is the whole claim. There
is no score, no band, no rank and no confidence anywhere in this stage — the
contract has no field to put one in, and two tests assert the serialized
response contains none of those words.

Scoring is deterministic and comes after evidence and signals exist. That is the
next stage, not this one.

---

## Entity resolution

`EntityResolutionService` (`modules/companies/`) merges the company blocks
carried by people into canonical companies.

**Merge keys, and only these two:**

1. `domain:<normalized domain>` — durable across providers; the plan's "resolve
   by domain first".
2. `ref:<provider>:<external id>` — exact inside the provider that issued it.

Grouping is union-find, not first-match-wins, because the common case defeats
the simpler loop: person A seen with both a domain and an org id, person B with
only that org id, person C with only that domain. Without union those become two
companies that both contain A. It also makes the result order-independent, so
the same company gets the same id whichever person the provider returned first.

**There is deliberately no name key.** `candidateIdentityKeys` has one as a last
resort for firmographic dedupe; this does not. Companies seen through their
employees frequently have no country, and merging two firms on a name collision
silently deletes one from the result. An unmerged duplicate is a visible,
harmless flaw; a wrong merge is a silent, wrong one.

A company with neither key becomes its own company, keyed by the source record
and reporting `identityBasis: 'UNRESOLVED'`.

**Field merging is first-non-empty.** Within one run every record is equally
fresh and from one provider, so "newest" is meaningless and "best" would be a
judgement. First-seen wins per field; later sources only fill gaps. Nothing is
derived: no domain from a name, no country from a TLD, no headcount from a band.

---

## The hard filters that are actually implemented

`FilteringService` (`modules/filtering/`) applies two things the ICP declares as
hard, and nothing else.

### 1. Section criteria

| Criterion | Source | Behaviour |
| --- | --- | --- |
| Country | `geography.includedCountries` / `excludedCountries` / `locationScope` | Exclusion applies under every scope. **Inclusion only under `HEADQUARTERS_ONLY`** — see below. |
| Industry | `companyProfile.industries` / `excludedIndustries` | Compared against the *catalog readings* of the provider's label. |
| Company size | `companyProfile.employeeRange` | Reject below `min` or above `max`. |
| Seniority | `targetBuyer.seniorities` | Catalog readings of the provider's tier. |
| Department | `targetBuyer.departments` | Catalog readings of the provider's label. |
| Technology | `technology.required` / `excluded` | **Not applied** — no source. Reported by name. |

The location asymmetry is deliberate. Under `ANY_LOCATION` or
`OPERATING_LOCATION` the criteria ask whether *any* company location is in the
target set, and a people search reports exactly one — so rejecting a company
whose single known location falls outside would reject firms that do have an
office there. The check abstains and says so in `unsupportedHardCriteria`.

### 2. Rule buckets

`mustNiceExclude.mustHave` is the criteria contract's own declaration of the
hard filters ("must-have rules are the hard filters", as the schema tells the
user), and `exclusions` is its declaration of what disqualifies. A must-have
rule rejects when it **fails**; an exclusion rule rejects when it **matches**.

`niceToHave` is never evaluated here. Those carry a `weight`, which is what makes
them scoring inputs.

Evaluable rule fields: `company.country`, `company.industry`,
`company.employeeCount`, `company.domain`, `company.hasWebsite`,
`buyer.seniority`, `buyer.department`. Everything else has no source — see the
limitations table.

---

## Missing data, and the four verdicts

`evaluateRule` returns `PASS` / `FAIL` / `UNKNOWN` / `UNSUPPORTED`, and
collapsing the last two into either of the first is exactly how a filtering
stage starts deleting real prospects.

- **UNKNOWN** — the field is evaluable but *this* candidate has no value. What
  happens next is the rule author's `unknownHandling`, which the criteria
  contract already defaults to `TREAT_AS_UNKNOWN` (keep).
- **UNSUPPORTED** — the field has no source *for anybody*. It never rejects,
  whatever `unknownHandling` says: the data is not missing for this candidate,
  it is missing for everyone, and `TREAT_AS_FAIL` on a feature that does not
  exist yet would reject the entire result set.

Concretely: an unreported headcount is never `0`; an unrecognised industry label
is never "an industry we do not target"; a founder, whose provider tier our
catalog has no word for, is kept rather than punished for our vocabulary gap.

### Ambiguous values are read optimistically

The adapter maps provider vocabulary to *lists* of catalog values, because the
mapping is genuinely many-to-one — Apollo's `manager` is our MANAGER **and** our
LEAD; `information_technology` is our ENGINEERING **and** our IT. A candidate is
rejected only when **every** reading rejects it. Picking one arbitrarily would
reject real buyers on an ambiguity that is the vocabulary's fault.

---

## Suppression

`SuppressionService` answers "should this candidate be excluded regardless of
ICP fit?" and is kept separate from filtering so the cold pool stays
diagnosable.

Matches, in decreasing strength:

1. Normalized domain.
2. Provider organization id.
3. Normalized company name — **only** when the suppressed entry carries no
   domain of its own. An entry that names a domain has already said which
   company it means, and letting its name match a different company would
   suppress a real prospect on a collision.

**Its only input today is `evidenceDiscovery.suppressedAccounts`** — a list a
person curated on the criteria form. The criteria contract also has rule fields
for `account.isExistingCustomer`, `account.hasOpenDeal`, `account.doNotContact`
and `account.inActiveSequence`. Those are real suppression inputs and they are
deliberately **not** invented: there is no CRM, no customer table and no
sequence state in this system, so any value for them would be fabricated.
`SuppressionService` takes a list of `SuppressionList`s, which is the seam they
arrive through when a source exists.

---

## Reachability sanity

One question: does this record carry any handle a later stage could act on — a
normalized LinkedIn profile, a reported email status, or a company domain?

It is **not** email verification, calls nothing, and costs nothing. The
provider's own person id does not count as a handle: every candidate has one, so
counting it would make the check unconditionally true.

`reachabilityRequirement: NOT_REQUIRED` skips the check entirely — that setting
is the ICP author saying reachability is not part of what they want. The
stricter settings (`DECISION_MAKER_REQUIRED`, `INFLUENCER_ACCEPTED`,
`ANY_CONTACT`) are **not** told apart: distinguishing them needs buyer roles that
no provider field reports.

---

## Persistence

Four new tables, purely additive — no existing table is altered, and the
migration contains no `DROP` or `ALTER` of anything that already existed.

| Table | Purpose |
| --- | --- |
| `search_runs` | One execution: criteria version, provider, timings, funnel counts as JSON. |
| `companies` | One canonical company, keyed by its `identity_key` so it is idempotent across runs. |
| `company_sources` | Every provider account that resolved to a company — the merge stays explainable, and unpickable. |
| `prospect_candidates` | Survivors **and** the cold pool, with structured `rejections`. |

`companies` are **upserted** (a durable entity, updated by the next sighting,
only ever widened); `prospect_candidates` are always **inserted** (an
observation by one run — rewriting last week's verdict under changed criteria
would destroy exactly the history the cold pool exists for). The whole run
commits in one transaction: half a run cannot be read as an audit trail.

No `raw_payload` column and no name/title/email columns. A provider payload is
personal data with a retention question attached, and nothing in the pipeline
reads one; `person_ref` plus the provider reference is enough to fetch the
person again from the provider that holds them.

### A write failure does not fail the request

Deliberately different from how a failed *analysis* write is handled. An
analysis whose row cannot be written has produced nothing usable; a processed
search has already spent a provider credit and holds correct results. Throwing
those away because an audit table is unavailable is the worse failure.

It is not swallowed either: the failure is logged at `warn` with its reason, and
the response carries `processing.persistence.persisted: false` with our own
frontend-safe copy. A test asserts the driver's message — which can carry a
host, a port and a password — never reaches the client.

A process built with **no** candidate store (every test suite, by default)
reports `persisted: false` with a different reason. A run that was not persisted
and a run that was must never look the same to a client.

---

## Frontend

`ProspectResults` is extended, not redesigned. `ProspectProcessing.tsx` adds:

- a funnel strip — **Passed hard filters** / **Cold pool** / **All discovered**,
  with counts, as a three-way view switch;
- a verdict badge per row, and the rejection details verbatim beneath an
  excluded one;
- the criteria that were **not applied**, always shown when present;
- a line when the run was not recorded.

The word "qualified" is not used for a survivor, and a test asserts the panel
never renders "Qualified", "Score", "Rank" or "Fit score". The Prospect Queue and
Prospect Detail experiences are out of scope.

---

## Contract changes

`PersonCandidate` and `PersonCompany` gained four optional catalog-mapped fields,
populated by the Apollo normalizer from adapter-owned reverse lookups:

| Field | Why |
| --- | --- |
| `PersonCompany.country` | `location` is a human-readable line no filter can compare against the country catalog. |
| `PersonCompany.industryCodes` | A provider label is not an internal enum, and may name more than one. |
| `PersonCandidate.seniorityCodes` | Same, for the provider's seniority tier. |
| `PersonCandidate.departmentCodes` | Same, for the provider's department label. |

All four are absent rather than empty when nothing mapped — unknown, never a
mismatch. The verbatim provider values stay untouched beside them, so the UI
still shows what the provider said. Provider vocabulary stays behind the adapter;
filtering compares catalog values and names no provider.

---

## Known limitations

| Limitation | Why, and where it is reported |
| --- | --- |
| Technology requirements are not applied | No source reports a company technology stack. Named in `unsupportedHardCriteria`. |
| `account.*` rules are not applied | No CRM. Named in `unsupportedHardCriteria`; `SuppressionService` has the seam. |
| `signal.*`, `evidence.*`, `problem.*` rules are not applied | These are the *output* of the qualification stage that comes after this one. |
| `company.region` / `companyType` / `businessModel` / `maturityStage` / `annualRevenue` / `foundedYear` / `language` / `description` rules | No source populates them. |
| `buyer.title` is not a hard filter | Criteria hold catalog titles, the provider returns free-text job titles, and no deterministic mapping exists that does not produce false negatives. Titles already widen the *search*. |
| `buyer.contactCount` is not evaluated | An account-level count; this stage evaluates one person per page of results. |
| Inclusion geography under a non-HQ scope | A people search reports one company location. Named in `unsupportedHardCriteria`. |
| Reachability tiers are not distinguished | `DECISION_MAKER_REQUIRED` is enforced no more strictly than `ANY_CONTACT`: buyer roles are not reported by any provider field. |
| Processing is per page | A run covers the page that was searched, not the whole result set. |
| Migration applied only by schema diff | Generated offline with `prisma migrate diff`; `prisma validate` and `prisma format --check` pass, but it has not been applied to a live database in this environment. |

---

## Tests

| Suite | Covers |
| --- | --- |
| `packages/shared/tests/discovery-canonical-company.test.ts` | Identity key order, provider namespacing, no name key, identity basis |
| `packages/server/tests/entity-resolution.test.ts` | Merging on org id / domain / transitively; refusing to merge on name or on a missing domain; provenance preserved; gap-filling without overwriting; nothing invented |
| `packages/server/tests/suppression.test.ts` | Domain, provider-id and fenced name matching; domain normalization; no partial matches; empty list |
| `packages/server/tests/filtering.test.ts` | Every supported hard criterion; the location-scope asymmetry; ambiguous readings; missing data in six shapes; must-have vs exclusion semantics; `unknownHandling`; unsupported fields never rejecting; nice-to-have staying a preference; reachability in five shapes |
| `packages/server/tests/candidate-processing.test.ts` | Stage order, cold-pool reasons, both duplicate shapes, full accounting, no score/rank/band, persistence success / absence / failure |
| `packages/server/tests/prospect-processing-api.test.ts` | The extended response, the `rawSourceRef` join, structured reasons, canonical companies, persistence reporting, and that no provider message, credential or DSN reaches a client |
| `packages/web/tests/ProspectProcessing.test.tsx` | The three views, per-row verdicts and reasons, unapplied criteria, unrecorded runs, and that a survivor is never called qualified |
