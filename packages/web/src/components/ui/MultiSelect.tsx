import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { SelectOption } from '@pursuit/shared';
import { cn } from './cn.js';
import { CheckIcon, ChevronDownIcon, CloseIcon, SearchIcon } from './icons.js';
import { POPOVER_PANEL_CLASS, usePopover } from './usePopover.js';

export interface MultiSelectControlProps<T extends string> {
  /** Becomes the trigger id, so the field label points at it. */
  id: string;
  /** Id of the visible label element; supplies the accessible name. */
  labelledBy: string;
  describedBy?: string;
  label: string;
  values: readonly T[];
  options: readonly SelectOption<T>[];
  onChange: (values: T[]) => void;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
}

/** Beyond this the trigger collapses the tail into a "+n more" chip. */
const VISIBLE_CHIPS = 4;
const SEARCH_THRESHOLD = 8;

/**
 * Searchable multi-select with a token trigger.
 *
 * Selection order is irrelevant to the contract but stability is not: the
 * committed array is always rebuilt in catalog order, which is exactly what the
 * checkbox grid this replaces did, so an edited ICP round-trips byte-identical.
 */
export function MultiSelectControl<T extends string>({
  id,
  labelledBy,
  describedBy,
  label,
  values,
  options,
  onChange,
  disabled,
  invalid,
  placeholder = 'Select options',
}: MultiSelectControlProps<T>) {
  const { open, containerRef, openPopover, closePopover, dropUp } = usePopover(360);
  const listboxId = `${useId()}listbox`;
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const withSearch = options.length > SEARCH_THRESHOLD;
  const selectedSet = useMemo(() => new Set(values), [values]);
  const selectedOptions = useMemo(
    () => options.filter((option) => selectedSet.has(option.value)),
    [options, selectedSet],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return options;
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    if (withSearch) searchRef.current?.focus();
    else listRef.current?.focus();
  }, [open, withSearch]);

  useEffect(() => {
    if (!open) return;
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    // Optional call: jsdom does not implement scrollIntoView.
    active?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, open]);

  /** Always emits catalog order, never click order. */
  const commit = useCallback(
    (next: Set<T>) => {
      onChange(options.map((option) => option.value).filter((value) => next.has(value)));
    },
    [onChange, options],
  );

  const toggle = useCallback(
    (value: T) => {
      const next = new Set(selectedSet);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      commit(next);
    },
    [commit, selectedSet],
  );

  const move = useCallback(
    (delta: number) => {
      setActiveIndex((current) => {
        if (filtered.length === 0) return 0;
        const next = current + delta;
        if (next < 0) return filtered.length - 1;
        if (next >= filtered.length) return 0;
        return next;
      });
    },
    [filtered.length],
  );

  const onPanelKeyDown = (event: ReactKeyboardEvent): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(Math.max(0, filtered.length - 1));
        break;
      case 'Enter': {
        event.preventDefault();
        const option = filtered[activeIndex];
        // Multi-select stays open on Enter so several values can be picked.
        if (option) toggle(option.value);
        break;
      }
      case 'Escape':
        event.preventDefault();
        closePopover();
        break;
      case 'Tab':
        closePopover({ restoreFocus: false });
        break;
      default:
        break;
    }
  };

  const onTriggerKeyDown = (event: ReactKeyboardEvent): void => {
    if (disabled) return;
    const opensPopover =
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Enter' ||
      event.key === ' ';
    if (!opensPopover) return;
    event.preventDefault();
    openPopover();
  };

  const shownChips = selectedOptions.slice(0, VISIBLE_CHIPS);
  const overflowCount = selectedOptions.length - shownChips.length;
  const activeOptionId = filtered[activeIndex] ? `${listboxId}-${activeIndex}` : undefined;
  const summary =
    selectedOptions.length === 0
      ? placeholder
      : `${selectedOptions.length} of ${options.length} selected`;

  return (
    <div className="relative" ref={containerRef}>
      <div
        className={cn(
          'pu-control h-auto flex-wrap items-center gap-1.5 py-1.5',
          disabled && 'pointer-events-none',
        )}
        aria-invalid={invalid || undefined}
      >
        {shownChips.map((option) => (
          <span
            key={option.value}
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-surface-sunken py-0.5 pl-2 pr-1 text-xs text-ink-soft"
          >
            <span className="truncate">{option.label}</span>
            <button
              type="button"
              className="flex-none rounded p-0.5 text-ink-faint transition-colors hover:bg-canvas-deep hover:text-critical-600 disabled:pointer-events-none"
              aria-label={`Remove ${option.label} from ${label}`}
              disabled={disabled}
              onClick={() => toggle(option.value)}
            >
              <CloseIcon className="h-3 w-3" />
            </button>
          </span>
        ))}

        {overflowCount > 0 ? (
          <span className="inline-flex items-center rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
            +{overflowCount} more
          </span>
        ) : null}

        <button
          type="button"
          id={id}
          data-popover-trigger
          role="combobox"
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          aria-controls={listboxId}
          aria-expanded={open}
          disabled={disabled}
          className="flex min-w-8 flex-1 items-center justify-between gap-1 self-stretch rounded text-left outline-none"
          onClick={() => (open ? closePopover() : openPopover())}
          onKeyDown={onTriggerKeyDown}
        >
          <span
            className={cn(
              selectedOptions.length > 0 ? 'sr-only' : 'truncate text-ink-faint',
            )}
          >
            {summary}
          </span>
          <ChevronDownIcon
            className={cn(
              'ml-auto h-4 w-4 flex-none text-ink-muted transition-transform duration-150',
              open && 'rotate-180',
            )}
          />
        </button>
      </div>

      {open ? (
        <div className={cn(POPOVER_PANEL_CLASS, dropUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5')}>
          {withSearch ? (
            <div className="flex items-center gap-2 border-b border-line px-3 py-2">
              <SearchIcon className="h-3.5 w-3.5 flex-none text-ink-faint" />
              <input
                ref={searchRef}
                type="text"
                className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
                placeholder={`Search ${label.toLowerCase()}`}
                aria-label={`Search ${label}`}
                aria-controls={listboxId}
                aria-activedescendant={activeOptionId}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={onPanelKeyDown}
              />
            </div>
          ) : null}

          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-multiselectable
            aria-labelledby={labelledBy}
            tabIndex={withSearch ? -1 : 0}
            aria-activedescendant={withSearch ? undefined : activeOptionId}
            className="pu-scroll max-h-56 overflow-y-auto p-1 outline-none"
            onKeyDown={withSearch ? undefined : onPanelKeyDown}
          >
            {filtered.length === 0 ? (
              <li className="px-2.5 py-6 text-center text-xs text-ink-muted">
                Nothing matches that search
              </li>
            ) : null}

            {filtered.map((option, index) => {
              const isSelected = selectedSet.has(option.value);
              const isActive = index === activeIndex;
              return (
                <li
                  key={option.value}
                  id={`${listboxId}-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  data-active={isActive}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px]',
                    isActive ? 'bg-brand-50' : '',
                    isSelected ? 'font-medium text-ink' : 'text-ink-soft',
                  )}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => toggle(option.value)}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex h-4 w-4 flex-none items-center justify-center rounded border',
                      isSelected
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : 'border-line-strong bg-surface',
                    )}
                  >
                    {isSelected ? <CheckIcon className="h-3 w-3" /> : null}
                  </span>
                  <span className="truncate">{option.label}</span>
                </li>
              );
            })}
          </ul>

          <div className="flex items-center justify-between gap-2 border-t border-line bg-surface-subtle px-3 py-2">
            <span className="pu-numeric text-[11px] text-ink-muted">
              {selectedOptions.length} selected
            </span>
            <button
              type="button"
              className="rounded text-[11px] font-medium text-ink-muted underline-offset-2 transition-colors hover:text-critical-600 hover:underline disabled:pointer-events-none disabled:text-ink-faint"
              disabled={selectedOptions.length === 0}
              onClick={() => commit(new Set<T>())}
            >
              Clear all
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
