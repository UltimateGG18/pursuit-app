/**
 * Small helpers used to keep a single source of truth for every controlled
 * option list: the value tuple drives the Zod enum, the label record forces
 * every value to be labelled, and `toOptions` builds the UI option list.
 */
export interface SelectOption<T extends string = string> {
  readonly value: T;
  readonly label: string;
}

export type LabelMap<T extends string> = Readonly<Record<T, string>>;

export function toOptions<T extends string>(
  values: readonly T[],
  labels: LabelMap<T>,
): readonly SelectOption<T>[] {
  return values.map((value) => ({ value, label: labels[value] }));
}
