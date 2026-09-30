import { useState } from 'react';
import type { KeywordGroup } from '@pursuit/shared';
import {
  Button,
  CloseIcon,
  EmptyState,
  FieldErrors,
  Input,
  PlusIcon,
  TrashIcon,
  cn,
} from '../ui/index.js';
import type { ErrorLookup } from './RuleBuilder.js';

export interface KeywordGroupEditorProps {
  path: string;
  groups: KeywordGroup[];
  onChange: (groups: KeywordGroup[]) => void;
  errorsFor: ErrorLookup;
  disabled?: boolean;
}

/**
 * Keyword groups for the semantic discovery strategy. Terms are genuinely
 * open vocabulary (company descriptions and synonyms), so this is the one
 * place in the form that accepts typed text - captured as a structured group
 * of normalized terms rather than as a free-text paragraph.
 */
export function KeywordGroupEditor({
  path,
  groups,
  onChange,
  errorsFor,
  disabled,
}: KeywordGroupEditorProps) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const bucketErrors = errorsFor(path);

  const update = (index: number, group: KeywordGroup): void => {
    onChange(groups.map((existing, position) => (position === index ? group : existing)));
  };

  const addTerm = (index: number, group: KeywordGroup): void => {
    const term = (drafts[index] ?? '').trim().toLowerCase();
    if (term.length === 0) return;
    if (group.terms.some((existing) => existing.toLowerCase() === term)) {
      setDrafts((current) => ({ ...current, [index]: '' }));
      return;
    }
    update(index, { ...group, terms: [...group.terms, term] });
    setDrafts((current) => ({ ...current, [index]: '' }));
  };

  return (
    <div className="flex flex-col gap-3">
      <FieldErrors errors={bucketErrors ?? []} />

      {groups.length === 0 ? (
        <EmptyState
          title="No keyword groups"
          description="Required only for the semantic discovery strategy."
        />
      ) : (
        <ol className="flex flex-col gap-2.5">
          {groups.map((group, index) => {
            const rowPath = `${path}[${index}]`;
            const rowId = `${path}-${index}`;
            const rowErrors = [
              ...(errorsFor(rowPath) ?? []),
              ...(errorsFor(`${rowPath}.label`) ?? []),
              ...(errorsFor(`${rowPath}.terms`) ?? []),
            ];

            return (
              <li
                key={index}
                className={cn(
                  'rounded-control border bg-surface p-3.5',
                  rowErrors.length > 0 ? 'border-critical-200 bg-critical-50/40' : 'border-line',
                )}
              >
                <div className="flex flex-col gap-3.5 lg:flex-row lg:items-start lg:gap-5">
                  <div className="flex flex-col gap-1 lg:w-56 lg:flex-none">
                    <label
                      className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-faint"
                      htmlFor={`${rowId}-label`}
                    >
                      Group label
                    </label>
                    <Input
                      id={`${rowId}-label`}
                      className="min-h-9 text-[13px]"
                      aria-label={`Keyword group ${index + 1} label`}
                      value={group.label}
                      maxLength={60}
                      disabled={disabled}
                      placeholder="e.g. platform modernization"
                      onChange={(event) => update(index, { ...group, label: event.target.value })}
                    />
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
                      Terms and synonyms
                    </span>

                    {group.terms.length === 0 ? (
                      <p className="text-xs text-ink-faint">No terms yet</p>
                    ) : (
                      <ul className="flex flex-wrap gap-1.5">
                        {group.terms.map((term) => (
                          <li
                            key={term}
                            className="inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-surface-sunken py-0.5 pl-2 pr-1 text-xs text-ink-soft"
                          >
                            <span className="truncate">{term}</span>
                            <button
                              type="button"
                              className="flex-none rounded p-0.5 text-ink-faint transition-colors hover:bg-canvas-deep hover:text-critical-600 disabled:pointer-events-none"
                              aria-label={`Remove term ${term}`}
                              disabled={disabled}
                              onClick={() =>
                                update(index, {
                                  ...group,
                                  terms: group.terms.filter((entry) => entry !== term),
                                })
                              }
                            >
                              <CloseIcon className="h-3 w-3" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="flex gap-2">
                      <Input
                        className="min-h-9 text-[13px]"
                        aria-label={`Add term to ${group.label || `group ${index + 1}`}`}
                        placeholder="e.g. legacy migration"
                        value={drafts[index] ?? ''}
                        maxLength={60}
                        disabled={disabled}
                        onChange={(event) =>
                          setDrafts((current) => ({ ...current, [index]: event.target.value }))
                        }
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter') return;
                          event.preventDefault();
                          addTerm(index, group);
                        }}
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-9 flex-none"
                        disabled={disabled}
                        onClick={() => addTerm(index, group)}
                      >
                        Add term
                      </Button>
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-none self-start px-2 hover:text-critical-600"
                    icon={<TrashIcon className="h-3.5 w-3.5" />}
                    disabled={disabled}
                    onClick={() => onChange(groups.filter((_, position) => position !== index))}
                  >
                    Remove
                  </Button>
                </div>

                {rowErrors.length > 0 ? (
                  <div className="mt-2.5">
                    <FieldErrors errors={rowErrors} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      <div>
        <Button
          variant="secondary"
          size="sm"
          icon={<PlusIcon className="h-3.5 w-3.5" />}
          disabled={disabled}
          onClick={() => onChange([...groups, { label: '', terms: [] }])}
        >
          Add keyword group
        </Button>
      </div>
    </div>
  );
}
