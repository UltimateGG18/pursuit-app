import type { SVGProps } from 'react';

/**
 * Inline icon set.
 *
 * Icons are decoration around text labels, never the only carrier of meaning,
 * so every one of them is `aria-hidden` and the surrounding component supplies
 * the accessible name.
 */
type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>;

function Icon({ className, ...props }: IconProps & { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'h-4 w-4'}
      {...props}
    />
  );
}

export function CheckIcon(props: IconProps & { className?: string }) {
  return (
    <Icon {...props}>
      <path d="M3 8.5 6.2 11.5 13 4.5" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps & { className?: string }) {
  return (
    <Icon {...props}>
      <path d="M4 6.5 8 10.5 12 6.5" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps & { className?: string }) {
  return (
    <Icon {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Icon>
  );
}

export function SearchIcon(props: IconProps & { className?: string }) {
  return (
    <Icon {...props}>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.2 10.2 13.5 13.5" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps & { className?: string }) {
  return (
    <Icon {...props}>
      <path d="M8 3.5v9M3.5 8h9" />
    </Icon>
  );
}

export function AlertIcon(props: IconProps & { className?: string }) {
  return (
    <Icon {...props}>
      <path d="M8 2.5 14.5 13.5h-13z" />
      <path d="M8 6.5v3" />
      <path d="M8 11.6h.01" strokeWidth={2} />
    </Icon>
  );
}

export function InfoIcon(props: IconProps & { className?: string }) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.2v4" />
      <path d="M8 5h.01" strokeWidth={2} />
    </Icon>
  );
}

export function TrashIcon(props: IconProps & { className?: string }) {
  return (
    <Icon {...props}>
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.2h5.8l.6-8.2" />
    </Icon>
  );
}

export function UserIcon(props: IconProps & { className?: string }) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="5.5" r="2.75" />
      <path d="M2.75 14c0-2.6 2.35-4.25 5.25-4.25s5.25 1.65 5.25 4.25" />
    </Icon>
  );
}

export function DotIcon(props: IconProps & { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 8 8"
      className={props.className ?? 'h-2 w-2'}
      {...props}
    >
      <circle cx="4" cy="4" r="4" fill="currentColor" />
    </svg>
  );
}

export function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      className={cnSpinner(className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <circle cx="8" cy="8" r="6" opacity="0.25" />
      <path d="M14 8a6 6 0 0 0-6-6" />
    </svg>
  );
}

function cnSpinner(className: string | undefined): string {
  return `animate-spin ${className ?? 'h-4 w-4'}`;
}
