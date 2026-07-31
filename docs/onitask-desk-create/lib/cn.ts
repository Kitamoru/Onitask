import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges conditional class names and resolves Tailwind class conflicts
 * (e.g. cn("p-4", condition && "p-6") -> "p-6").
 * Requires `clsx` and `tailwind-merge` — already dependencies in most
 * Next.js + shadcn-flavored setups; add them if missing:
 *   npm i clsx tailwind-merge
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
