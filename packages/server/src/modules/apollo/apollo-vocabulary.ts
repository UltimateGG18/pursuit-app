import { COUNTRIES, type CountryCode, type Industry } from '@pursuit/shared';

/**
 * Translation between PURSUIT's controlled catalogs and Apollo's own
 * vocabulary.
 *
 * This file exists because the two vocabularies genuinely differ: the criteria
 * contract stores ISO-3166 alpha-2 codes and internal enums (`NL`,
 * `SOFTWARE_SAAS`), while Apollo filters on place names (`Netherlands`) and
 * free-text keyword tags. Somebody has to bridge that, and it has to be the
 * adapter - putting Apollo's words in the catalogs would leak the provider into
 * the domain, and putting the catalog's words in the request would return
 * nothing.
 *
 * Both maps below are exhaustive `Record`s over their catalog, so adding a
 * country or an industry to `@pursuit/shared` fails the build here until its
 * Apollo translation is decided. A silently untranslated country would drop a
 * filter and quietly widen the search.
 */

/**
 * ISO-2 -> the English place name Apollo's `organization_locations[]` matches.
 *
 * Apollo takes human place names for this filter rather than country codes.
 * Names are the common English forms Apollo's own location index uses.
 */
const APOLLO_COUNTRY_NAMES: Readonly<Record<CountryCode, string>> = {
  NL: 'Netherlands',
  BE: 'Belgium',
  LU: 'Luxembourg',
  DE: 'Germany',
  AT: 'Austria',
  CH: 'Switzerland',
  DK: 'Denmark',
  SE: 'Sweden',
  NO: 'Norway',
  FI: 'Finland',
  GB: 'United Kingdom',
  IE: 'Ireland',
  FR: 'France',
  ES: 'Spain',
  PT: 'Portugal',
  IT: 'Italy',
  GR: 'Greece',
  PL: 'Poland',
  CZ: 'Czechia',
  SK: 'Slovakia',
  HU: 'Hungary',
  RO: 'Romania',
  BG: 'Bulgaria',
  HR: 'Croatia',
  SI: 'Slovenia',
  EE: 'Estonia',
  LV: 'Latvia',
  LT: 'Lithuania',
  US: 'United States',
  CA: 'Canada',
  MX: 'Mexico',
  BR: 'Brazil',
  AR: 'Argentina',
  AE: 'United Arab Emirates',
  SA: 'Saudi Arabia',
  IL: 'Israel',
  TR: 'Turkey',
  ZA: 'South Africa',
  IN: 'India',
  SG: 'Singapore',
  AU: 'Australia',
  NZ: 'New Zealand',
  JP: 'Japan',
};

/** Reverse map, used to put a country code back on a normalized candidate. */
const CODE_BY_APOLLO_NAME: ReadonlyMap<string, CountryCode> = new Map(
  COUNTRIES.map((code) => [APOLLO_COUNTRY_NAMES[code].toLowerCase(), code]),
);

/**
 * Alternative spellings Apollo returns for a country whose common name differs
 * from the one we send.
 *
 * Only forms actually seen in Apollo payloads are listed, and only for
 * countries the catalog knows - Apollo returning `South Korea` maps to nothing,
 * because `KR` is not in `COUNTRIES`. This is a lookup table, not a geocoder:
 * an unrecognised country name leaves the candidate's `country` unknown rather
 * than guessing at it.
 */
const COUNTRY_NAME_ALIASES: Readonly<Record<string, CountryCode | undefined>> = {
  'the netherlands': 'NL',
  holland: 'NL',
  'united states of america': 'US',
  usa: 'US',
  'u.s.': 'US',
  'u.s.a.': 'US',
  uk: 'GB',
  'great britain': 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'northern ireland': 'GB',
  'czech republic': 'CZ',
  'slovak republic': 'SK',
  'republic of ireland': 'IE',
};

export function toApolloLocation(country: CountryCode): string {
  return APOLLO_COUNTRY_NAMES[country];
}

export function toApolloLocations(countries: readonly string[]): string[] {
  const out: string[] = [];
  for (const country of countries) {
    const name = APOLLO_COUNTRY_NAMES[country as CountryCode];
    // A value outside the catalog is skipped rather than passed through: the
    // query is built from validated criteria, so this can only be a bug, and
    // forwarding `XX` to Apollo would return nothing with no explanation.
    if (name !== undefined) out.push(name);
  }
  return out;
}

/**
 * Apollo's country name -> ISO-2, for normalization.
 *
 * Returns undefined for anything unrecognised, which keeps the candidate's
 * country unknown. That is the correct outcome: a wrong country code is worse
 * than a missing one, because a later geography filter would act on it.
 */
export function toCountryCode(value: string | undefined): CountryCode | undefined {
  if (value === undefined) return undefined;
  const key = value.trim().toLowerCase();
  if (key.length === 0) return undefined;
  return CODE_BY_APOLLO_NAME.get(key) ?? COUNTRY_NAME_ALIASES[key];
}

/**
 * Internal industry -> Apollo `q_organization_keyword_tags[]`.
 *
 * Keyword tags are used rather than Apollo's `organization_industry_tag_ids`,
 * for one reason: those ids are opaque Apollo primary keys that can only be
 * discovered by calling an endpoint this API key has no access to. Inventing
 * them would mean shipping filters that silently match nothing. Keyword tags
 * are documented, human-readable, and verifiable by reading the request.
 *
 * Several tags per industry because Apollo's tags are narrower than these
 * categories, and discovery is a recall-first stage: casting slightly wide and
 * letting the later hard-filter stage cut is the intended direction of error.
 */
const APOLLO_INDUSTRY_KEYWORDS: Readonly<Record<Industry, readonly string[]>> = {
  SOFTWARE_SAAS: ['software', 'saas', 'computer software'],
  IT_SERVICES: ['information technology & services', 'it services', 'managed services'],
  FINANCIAL_SERVICES: ['financial services', 'banking', 'fintech'],
  INSURANCE: ['insurance', 'insurtech'],
  HEALTHCARE: ['hospital & health care', 'healthcare', 'medical practice'],
  LIFE_SCIENCES: ['pharmaceuticals', 'biotechnology', 'medical devices'],
  MANUFACTURING: ['manufacturing', 'industrial automation', 'machinery'],
  AUTOMOTIVE: ['automotive', 'motor vehicle manufacturing'],
  ENERGY_UTILITIES: ['oil & energy', 'utilities', 'renewables & environment'],
  LOGISTICS_TRANSPORT: ['logistics & supply chain', 'transportation', 'freight'],
  RETAIL_ECOMMERCE: ['retail', 'e-commerce', 'consumer goods'],
  WHOLESALE_DISTRIBUTION: ['wholesale', 'distribution'],
  CONSTRUCTION_REAL_ESTATE: ['construction', 'real estate', 'civil engineering'],
  TELECOM_MEDIA: ['telecommunications', 'media production', 'broadcast media'],
  PUBLIC_SECTOR: ['government administration', 'public policy'],
  EDUCATION: ['education management', 'higher education', 'e-learning'],
  AGRIFOOD: ['food & beverages', 'agriculture', 'farming'],
  PROFESSIONAL_SERVICES: ['management consulting', 'professional services', 'accounting'],
  HOSPITALITY_LEISURE: ['hospitality', 'leisure, travel & tourism', 'restaurants'],
  NONPROFIT: ['nonprofit organization management', 'non-profit'],
};

/**
 * Apollo's industry label -> the internal `INDUSTRIES` values it names.
 *
 * The reverse of `APOLLO_INDUSTRY_KEYWORDS`, built from the same table so the
 * two directions can never drift: an industry whose tags change changes what
 * comes back here, with no second list to remember to update.
 *
 * Two deliberate properties:
 *
 *  - **It returns a list.** A tag is not guaranteed to belong to exactly one of
 *    our categories, and picking one arbitrarily would let a later hard filter
 *    reject a company the ICP actually targets. Every industry a label names is
 *    returned, and the filter passes if any of them matches.
 *  - **It matches exactly, after normalization only.** Case, surrounding space
 *    and `&`/`and` are normalized; nothing else. An unrecognised label returns
 *    an empty list, which the contract reads as *unknown industry* rather than
 *    as a mismatch. A guessed industry is worse than a missing one, for the
 *    same reason a guessed country is.
 */
function normalizeIndustryLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const INDUSTRIES_BY_APOLLO_LABEL: ReadonlyMap<string, readonly Industry[]> = (() => {
  const map = new Map<string, Industry[]>();
  for (const [industry, tags] of Object.entries(APOLLO_INDUSTRY_KEYWORDS)) {
    for (const tag of tags) {
      const key = normalizeIndustryLabel(tag);
      const bucket = map.get(key);
      if (bucket) {
        if (!bucket.includes(industry as Industry)) bucket.push(industry as Industry);
      } else {
        map.set(key, [industry as Industry]);
      }
    }
  }
  return map;
})();

export function toIndustryCodes(value: string | undefined): Industry[] {
  if (value === undefined) return [];
  const key = normalizeIndustryLabel(value);
  if (key.length === 0) return [];
  return [...(INDUSTRIES_BY_APOLLO_LABEL.get(key) ?? [])];
}

export function toApolloKeywordTags(industries: readonly string[]): string[] {
  const tags = new Set<string>();
  for (const industry of industries) {
    for (const tag of APOLLO_INDUSTRY_KEYWORDS[industry as Industry] ?? []) tags.add(tag);
  }
  return [...tags];
}

/**
 * Employee bounds -> Apollo's `organization_num_employees_ranges[]`.
 *
 * Apollo takes literal `"min,max"` strings for this filter, so the criteria's
 * own bounds are passed through as one range rather than being fitted to
 * Apollo's UI bands. That keeps the filter exactly as wide as the user asked,
 * and avoids hardcoding band boundaries this adapter cannot verify.
 *
 * An open bound becomes the widest value the criteria schema itself permits, so
 * "at least 500 employees" stays one-sided instead of accidentally capping.
 * Returns an empty list when neither bound is set - no filter at all, rather
 * than a range meaning "any", which is the same thing but costs a parameter.
 */
export const APOLLO_EMPLOYEE_FLOOR = 1;
export const APOLLO_EMPLOYEE_CEILING = 1000000;

export function toApolloEmployeeRanges(
  min: number | undefined,
  max: number | undefined,
): string[] {
  if (min === undefined && max === undefined) return [];
  // Apollo's own floor is 1; a criteria minimum of 0 would exclude nothing.
  const from = Math.max(APOLLO_EMPLOYEE_FLOOR, min ?? APOLLO_EMPLOYEE_FLOOR);
  const to = Math.min(APOLLO_EMPLOYEE_CEILING, max ?? APOLLO_EMPLOYEE_CEILING);
  if (from > to) return [];
  return [`${String(from)},${String(to)}`];
}
