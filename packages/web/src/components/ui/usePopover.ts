import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

export interface PopoverState {
  open: boolean;
  /** Ref for the wrapper that contains both the trigger and the panel. */
  containerRef: MutableRefObject<HTMLDivElement | null>;
  openPopover: () => void;
  closePopover: (options?: { restoreFocus?: boolean }) => void;
  togglePopover: () => void;
  /** True when the panel should render above the trigger, i.e. near the viewport bottom. */
  dropUp: boolean;
}

/**
 * Open/close plumbing shared by the select and multi-select popovers:
 * outside-click and Escape dismissal, focus restoration to the trigger, and a
 * flip to "drop up" when there is not enough room below.
 *
 * Kept as a hook rather than a portal component so the panel stays inside the
 * field's DOM subtree - that is what makes `aria-describedby` on the field and
 * label association keep working without extra wiring.
 */
export function usePopover(panelHeight = 320): PopoverState {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const closePopover = useCallback((options?: { restoreFocus?: boolean }) => {
    setOpen(false);
    if (options?.restoreFocus === false) return;
    const trigger = containerRef.current?.querySelector<HTMLElement>('[data-popover-trigger]');
    trigger?.focus();
  }, []);

  const openPopover = useCallback(() => {
    const trigger = containerRef.current?.querySelector<HTMLElement>('[data-popover-trigger]');
    const rect = trigger?.getBoundingClientRect();
    if (rect && typeof window !== 'undefined') {
      const below = window.innerHeight - rect.bottom;
      setDropUp(below < panelHeight && rect.top > below);
    }
    setOpen(true);
  }, [panelHeight]);

  const togglePopover = useCallback(() => {
    if (open) closePopover();
    else openPopover();
  }, [closePopover, open, openPopover]);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event: MouseEvent | TouchEvent): void => {
      const container = containerRef.current;
      if (container && !container.contains(event.target as Node)) setOpen(false);
    };
    const onFocusIn = (event: FocusEvent): void => {
      const container = containerRef.current;
      if (container && !container.contains(event.target as Node)) setOpen(false);
    };
    // Escape lives here rather than in each consumer so a popover cannot ship
    // without it. Controls that also handle Escape on their own panel (to stop
    // the key bubbling further) simply close twice, which is a no-op.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closePopover();
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [closePopover, open]);

  return { open, containerRef, openPopover, closePopover, togglePopover, dropUp };
}

/** Shared panel chrome, so both popovers sit at the same elevation and width. */
export const POPOVER_PANEL_CLASS =
  'absolute z-40 w-full min-w-[15rem] overflow-hidden rounded-control border border-line ' +
  'bg-surface shadow-popover';
