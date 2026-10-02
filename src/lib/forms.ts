import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type FieldErrors, type FieldValues, type Resolver, type UseFormProps } from 'react-hook-form';
import type { z } from 'zod';

/**
 * A react-hook-form form driven by one Zod schema: field values are the schema's input type,
 * the submit handler receives its parsed output. Validation messages live in the schema, nowhere else.
 */
export function useZodForm<S extends z.ZodType<FieldValues, FieldValues>>(
  schema: S,
  options: Omit<UseFormProps<z.input<S>, unknown, z.output<S>>, 'resolver'>,
) {
  // zodResolver infers the same input/output pair; the generic `S` just hides it from TypeScript here.
  const resolver = zodResolver(schema) as unknown as Resolver<z.input<S>, unknown, z.output<S>>;
  return useForm<z.input<S>, unknown, z.output<S>>({ mode: 'onChange', ...options, resolver });
}

/** The first validation message in an errors tree (issues keep the schema's order) — for a one-line alert. */
export function firstError(errors: FieldErrors): string | undefined {
  const walk = (node: unknown): string | undefined => {
    if (!node || typeof node !== 'object') return undefined;
    const { message } = node as { message?: unknown };
    if (typeof message === 'string' && message) return message;
    for (const [k, child] of Object.entries(node)) {
      if (k === 'ref') continue;
      const found = walk(child);
      if (found) return found;
    }
    return undefined;
  };
  return walk(errors);
}
