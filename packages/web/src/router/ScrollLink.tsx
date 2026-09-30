import type { AnchorHTMLAttributes } from 'react';

export interface ScrollLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** Id of the element to jump to, without the leading `#`. */
  targetId: string;
  /** Also move keyboard focus to the target - for a skip link. */
  focusTarget?: boolean;
}

/**
 * A jump to a position within the current page.
 *
 * The application's route lives in the hash, so letting the browser follow a
 * plain `#section` fragment would replace the route and unmount the page the
 * user was trying to move around in. Every in-page jump therefore scrolls
 * imperatively and never writes to the hash - including modified clicks, since
 * opening a position on the page in a new tab means nothing.
 */
export function ScrollLink({
  targetId,
  focusTarget = false,
  onClick,
  children,
  ...rest
}: ScrollLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
        const target = document.getElementById(targetId);
        if (!target) return;
        target.scrollIntoView({ block: 'start' });
        if (focusTarget) target.focus();
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
