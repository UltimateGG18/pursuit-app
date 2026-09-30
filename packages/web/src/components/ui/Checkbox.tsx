import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from './cn.js';

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> & {
  className?: string;
};

/** Native checkbox with the appearance replaced in CSS, so semantics stay intact. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} type="checkbox" className={cn('pu-checkbox', className)} {...rest} />;
});
