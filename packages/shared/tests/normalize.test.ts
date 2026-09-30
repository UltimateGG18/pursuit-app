import { describe, expect, it } from 'vitest';
import {
  createExampleIcpConfig,
  detailsByPath,
  formatIssuePath,
  icpConfigSchema,
  icpSlug,
  normalizeIcpConfig,
  slugify,
  type IcpConfig,
} from '../src/index.js';

function parse(config: unknown): IcpConfig {
  const parsed = icpConfigSchema.safeParse(config);
  if (!parsed.success) throw new Error(`fixture is invalid: ${parsed.error.message}`);
  return parsed.data;
}

describe('normalizeIcpConfig', () => {
  it('produces a configuration that still validates', () => {
    const normalized = normalizeIcpConfig(parse(createExampleIcpConfig()));
    expect(icpConfigSchema.safeParse(normalized).success).toBe(true);
  });

  it('is idempotent', () => {
    const once = normalizeIcpConfig(parse(createExampleIcpConfig()));
    const twice = normalizeIcpConfig(once);
    expect(twice).toEqual(once);
  });

  it('orders and de-duplicates option lists by catalog order', () => {
    const config = structuredClone(createExampleIcpConfig());
    config.geography.includedCountries = ['LU', 'NL', 'BE', 'NL'];
    const normalized = normalizeIcpConfig(parse(config));
    expect(normalized.geography.includedCountries).toEqual(['NL', 'BE', 'LU']);
  });

  it('collapses whitespace in the name and drops an empty description', () => {
    const config = structuredClone(createExampleIcpConfig());
    config.basicProfile.name = '  Benelux    modernization  ';
    config.basicProfile.description = '   ';
    const normalized = normalizeIcpConfig(parse(config));
    expect(normalized.basicProfile.name).toBe('Benelux modernization');
    expect(normalized.basicProfile.description).toBeUndefined();
  });

  it('assigns an id to a rule that arrived without one', () => {
    const config = structuredClone(createExampleIcpConfig()) as unknown as {
      mustNiceExclude: { mustHave: Array<Record<string, unknown>> };
    };
    config.mustNiceExclude.mustHave = [
      { field: 'company.industry', operator: 'EQUALS', value: 'MANUFACTURING' },
    ];
    const normalized = normalizeIcpConfig(parse(config));
    expect(normalized.mustNiceExclude.mustHave[0]!.id).toBeTruthy();
  });

  it('drops value slots the operator does not use', () => {
    const config = structuredClone(createExampleIcpConfig());
    config.mustNiceExclude.mustHave = [
      {
        id: 'r1',
        field: 'company.domain',
        operator: 'EXISTS',
        unknownHandling: 'TREAT_AS_UNKNOWN',
      },
    ];
    const normalized = normalizeIcpConfig(parse(config));
    const rule = normalized.mustNiceExclude.mustHave[0]!;
    expect(rule.value).toBeUndefined();
    expect(rule.values).toBeUndefined();
    expect(rule.range).toBeUndefined();
  });

  it('sorts rule value lists', () => {
    const config = structuredClone(createExampleIcpConfig());
    config.mustNiceExclude.mustHave = [
      {
        id: 'r1',
        field: 'company.country',
        operator: 'IN',
        values: ['LU', 'NL', 'BE'],
        unknownHandling: 'TREAT_AS_UNKNOWN',
      },
    ];
    const normalized = normalizeIcpConfig(parse(config));
    expect(normalized.mustNiceExclude.mustHave[0]!.values).toEqual(['BE', 'LU', 'NL']);
  });

  it('lower-cases and sorts keyword terms', () => {
    const config = structuredClone(createExampleIcpConfig());
    config.evidenceDiscovery.discoveryStrategies = ['FIRMOGRAPHIC', 'SEMANTIC'];
    config.evidenceDiscovery.keywordGroups = [
      { label: ' Modernization ', terms: ['Replatform', 'Legacy Migration'] },
    ];
    const normalized = normalizeIcpConfig(parse(config));
    expect(normalized.evidenceDiscovery.keywordGroups).toEqual([
      { label: 'Modernization', terms: ['legacy migration', 'replatform'] },
    ]);
  });

  // Validation already rejects duplicates, so these assertions call the
  // normalizer directly: it must stay defensive for payloads that reach it
  // from a future non-HTTP path (jobs, imports, migrations).
  it('de-duplicates defensively when called directly', () => {
    const config = structuredClone(createExampleIcpConfig());
    config.mustNiceExclude.mustHave = [
      {
        id: 'r1',
        field: 'company.country',
        operator: 'IN',
        values: ['NL', 'BE', 'NL'],
        unknownHandling: 'TREAT_AS_UNKNOWN',
      },
    ];
    config.evidenceDiscovery.suppressedAccounts = [
      { id: 'acc-1', name: 'Alpha BV', domain: 'ALPHA.NL' },
      { id: 'acc-1', name: 'Alpha BV duplicate' },
    ];

    const normalized = normalizeIcpConfig(config);
    expect(normalized.mustNiceExclude.mustHave[0]!.values).toEqual(['BE', 'NL']);
    expect(normalized.evidenceDiscovery.suppressedAccounts).toEqual([
      { id: 'acc-1', name: 'Alpha BV', domain: 'alpha.nl' },
    ]);
  });

  it('sorts triggers by catalog order', () => {
    const config = structuredClone(createExampleIcpConfig());
    const normalized = normalizeIcpConfig(parse(config));
    expect(normalized.triggersIntent.triggers.map((trigger) => trigger.type)).toEqual([
      'RECENT_HIRING',
      'TECHNOLOGY_MIGRATION',
    ]);
  });
});

describe('slug helpers', () => {
  it('slugifies an ICP name', () => {
    expect(slugify('Benelux mid-market platform modernization')).toBe(
      'benelux-mid-market-platform-modernization',
    );
  });

  it('strips diacritics and punctuation', () => {
    expect(slugify('Zürich & Köln / DACH!')).toBe('zurich-koln-dach');
  });

  it('derives the slug from the configuration name', () => {
    expect(icpSlug(parse(createExampleIcpConfig({ name: 'DACH Data Platform' })))).toBe(
      'dach-data-platform',
    );
  });
});

describe('validation helpers', () => {
  it('formats nested paths with array indexes', () => {
    expect(formatIssuePath(['config', 'mustNiceExclude', 'mustHave', 0, 'value'])).toBe(
      'config.mustNiceExclude.mustHave[0].value',
    );
  });

  it('groups details by path', () => {
    const grouped = detailsByPath([
      { path: 'a.b', message: 'first' },
      { path: 'a.b', message: 'second' },
      { path: '', message: 'root' },
    ]);
    expect(grouped['a.b']).toEqual(['first', 'second']);
    expect(grouped._root).toEqual(['root']);
  });
});
