import { useMemo, useState } from 'react';
import type { AccountReference } from '@pursuit/shared';
import {
  Badge,
  CloseIcon,
  FieldErrors,
  Input,
  PlusIcon,
  SearchIcon,
  cn,
} from '../ui/index.js';

/**
 * Placeholder account catalog.
 *
 * Account lookup will be served by the Apollo/CRM adapter in a later slice.
 * Until then this selector reads from a fixed list so the ICP form can capture
 * real `AccountReference` values in the shape the adapter will return.
 */
export const PLACEHOLDER_ACCOUNTS: readonly AccountReference[] = [
  { id: 'acc-1001', name: 'Existing Customer BV', domain: 'existing.nl' },
  { id: 'acc-1002', name: 'Northwind Logistics', domain: 'northwind-logistics.nl' },
  { id: 'acc-1003', name: 'Bruges Financial Group', domain: 'brugesfg.be' },
  { id: 'acc-1004', name: 'Rhine Manufacturing', domain: 'rhine-mfg.de' },
  { id: 'acc-1005', name: 'Delta Insurance', domain: 'delta-insurance.nl' },
  { id: 'acc-1006', name: 'Meridian Retail Group', domain: 'meridian-retail.be' },
  { id: 'acc-1007', name: 'Zenith Health Services', domain: 'zenith-health.lu' },
  { id: 'acc-1008', name: 'Harbour Energy Partners', domain: 'harbour-energy.nl' },
];

export interface AccountSelectorProps {
  path: string;
  label: string;
  hint?: string;
  required?: boolean;
  selected: AccountReference[];
  onChange: (accounts: AccountReference[]) => void;
  errors?: string[];
  disabled?: boolean;
  emptyLabel?: string;
}

/**
 * Account picker against the placeholder catalog.
 *
 * Presented as its own panel rather than as a field, because that is what it
 * is: a stand-in for a data source that does not exist yet. The badge and the
 * footnote say so on the surface, so nobody mistakes the eight fixed rows for
 * a live CRM lookup.
 */
export function AccountSelector({
  path,
  label,
  hint,
  required,
  selected,
  onChange,
  errors,
  disabled,
  emptyLabel = 'No accounts selected',
}: AccountSelectorProps) {
  const [query, setQuery] = useState('');
  const selectedIds = useMemo(() => new Set(selected.map((account) => account.id)), [selected]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return PLACEHOLDER_ACCOUNTS.filter((account) => {
      if (selectedIds.has(account.id)) return false;
      if (needle.length === 0) return true;
      return (
        account.name.toLowerCase().includes(needle) ||
        (account.domain ?? '').toLowerCase().includes(needle)
      );
    }).slice(0, 6);
  }, [query, selectedIds]);

  const hasErrors = (errors?.length ?? 0) > 0;

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-card border bg-surface-subtle p-4',
        hasErrors ? 'border-critical-200' : 'border-line',
      )}
      role="group"
      aria-labelledby={`${path}-group-label`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-[13px] font-semibold text-ink" id={`${path}-group-label`}>
            {label}
            {required ? (
              <span className="ml-0.5 font-normal text-ink-faint" aria-hidden="true">
                *
              </span>
            ) : null}
          </h4>
          {hint ? <p className="mt-0.5 max-w-xl text-xs leading-5 text-ink-muted">{hint}</p> : null}
        </div>
        <Badge tone="caution" uppercase>
          Placeholder
        </Badge>
      </div>

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
        <Input
          id={`${path}-search`}
          type="search"
          className="pl-8.5"
          placeholder="Search accounts by name or domain"
          aria-label={`Search accounts for ${label}`}
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {matches.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {matches.map((account) => (
            <li key={account.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-control border border-transparent px-2.5 py-1.5 text-left transition-colors hover:border-line hover:bg-surface disabled:pointer-events-none disabled:opacity-60"
                disabled={disabled}
                onClick={() => {
                  onChange([...selected, account]);
                  setQuery('');
                }}
              >
                <PlusIcon className="h-3.5 w-3.5 flex-none text-ink-faint" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{account.name}</span>
                {account.domain ? (
                  <span className="flex-none text-[11px] text-ink-faint">{account.domain}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-ink-muted">No matching accounts in the placeholder catalog.</p>
      )}

      <div className="border-t border-line pt-3">
        {selected.length === 0 ? (
          <p className="text-xs text-ink-faint">{emptyLabel}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5" aria-label={`${label} selection`}>
            {selected.map((account) => (
              <li
                key={account.id}
                className="inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-surface py-0.5 pl-2 pr-1 text-xs text-ink-soft"
              >
                <span className="truncate">{account.name}</span>
                <button
                  type="button"
                  className="flex-none rounded p-0.5 text-ink-faint transition-colors hover:bg-canvas-deep hover:text-critical-600 disabled:pointer-events-none"
                  aria-label={`Remove ${account.name}`}
                  disabled={disabled}
                  onClick={() => onChange(selected.filter((entry) => entry.id !== account.id))}
                >
                  <CloseIcon className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <FieldErrors id={`${path}-error`} errors={errors ?? []} />

      <p className="text-[11px] text-ink-faint">
        Account selection will move to the Apollo/CRM adapter in a future discovery phase.
      </p>
    </div>
  );
}
