import {
  Fragment,
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
import { CheckIcon, ChevronDownIcon, SearchIcon } from './icons.js';
import { POPOVER_PANEL_CLASS, usePopover } from './usePopover.js';

export interface SelectControlProps<T extends string> {
  /** Becomes the trigger id, so the field label points at it. */
  id: string;
  /** Id of the visible label element; supplies the accessible name. */
  labelledBy: string;
  describedBy?: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  /** Forced on for long catalogs; leave undefined to decide by option count. */
  searchable?: boolean;
  /**
   * Groups the listbox under headings. Options must already be ordered by
   * group; headings are suppressed while a search is active because the
   * matches no longer form contiguous runs.
   */
  groupBy?: (option: SelectOption<T>) => string;
  /** Compact geometry for controls that sit inside a dense row. */
  size?: 'sm' | 'md';
}

const SEARCH_THRESHOLD = 8;

/**
 * Select-only combobox (ARIA 1.2 pattern): a button that reports the current
 * value as its own content, plus a listbox popup.
 *
 * The value set is always one of the shared option catalogs, so there is no
 * "clear" affordance - the schema has no empty state for these fields and the
 * UI must not be able to express one.
 */
export function SelectControl<T extends string>({
  id,
  labelledBy,
  describedBy,
  value,
  options,
  onChange,
  disabled,
  invalid,
  placeholder = 'Select an option',
  searchable,
  groupBy,
  size = 'md',
}: SelectControlProps<T>) {
  const { open, containerRef, openPopover, closePopover, dropUp } = usePopover();
  const listboxId = `${useId()}listbox`;
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const withSearch = searchable ?? options.length > SEARCH_THRESHOLD;
  const selected = options.find((option) => option.value === value);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return options;
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, query]);

  // Opening restarts the search and parks the active option on the current value.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return;
    if (withSearch) searchRef.current?.focus();
    else listRef.current?.focus();
  }, [open, withSearch]);

  // Keep the active option visible while arrowing through a long catalog.
  useEffect(() => {
    if (!open) return;
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    // Optional call: jsdom does not implement scrollIntoView.
    active?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, open]);

  const commit = useCallback(
    (option: SelectOption<T> | undefined) => {
      if (option) onChange(option.value);
      closePopover();
    },
    [closePopover, onChange],
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
      case 'Enter':
        event.preventDefault();
        commit(filtered[activeIndex]);
        break;
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

  const activeOptionId = filtered[activeIndex] ? `${listboxId}-${activeIndex}` : undefined;

  // Group headings only make sense over the unfiltered, group-ordered list.
  const showGroups = Boolean(groupBy) && query.trim().length === 0;
  const groupHeading = (index: number): string | null => {
    if (!groupBy) return null;
    const option = filtered[index];
    if (!option) return null;
    const previous = index === 0 ? undefined : filtered[index - 1];
    const group = groupBy(option);
    if (previous && groupBy(previous) === group) return null;
    return group;
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        id={id}
        data-popover-trigger
        role="combobox"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        className={cn(
          'pu-control justify-between',
          size === 'sm' && 'min-h-8 px-2.5 py-1 text-[13px]',
          !selected && 'text-ink-faint',
        )}
        onClick={() => (open ? closePopover() : openPopover())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDownIcon
          className={cn(
            'h-4 w-4 flex-none text-ink-muted transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>

      {open ? (
        <div className={cn(POPOVER_PANEL_CLASS, dropUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5')}>
          {withSearch ? (
            <div className="flex items-center gap-2 border-b border-line px-3 py-2">
              <SearchIcon className="h-3.5 w-3.5 flex-none text-ink-faint" />
              <input
                ref={searchRef}
                type="text"
                className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
                placeholder="Search options"
                aria-label="Search options"
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
            aria-labelledby={labelledBy}
            tabIndex={withSearch ? -1 : 0}
            aria-activedescendant={withSearch ? undefined : activeOptionId}
            className="pu-scroll max-h-60 overflow-y-auto p-1 outline-none"
            onKeyDown={withSearch ? undefined : onPanelKeyDown}
          >
            {filtered.length === 0 ? (
              <li className="px-2.5 py-6 text-center text-xs text-ink-muted">
                No options match your search
              </li>
            ) : null}

            {filtered.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === activeIndex;
              const heading = showGroups ? groupHeading(index) : null;
              return (
                <Fragment key={option.value}>
                  {heading ? (
                    <li
                      role="presentation"
                      className="px-2.5 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint"
                    >
                      {heading}
                    </li>
                  ) : null}
                  <li
                    id={`${listboxId}-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    data-active={isActive}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px]',
                      isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-soft',
                      isSelected && 'font-medium text-ink',
                    )}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => commit(option)}
                  >
                    <CheckIcon
                      className={cn(
                        'h-3.5 w-3.5 flex-none text-brand-600',
                        !isSelected && 'invisible',
                      )}
                    />
                    <span className="truncate">{option.label}</span>
                  </li>
                </Fragment>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
