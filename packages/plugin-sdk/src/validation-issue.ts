import type { z } from "zod";

/** Where in the value an issue sits, from the value's root. */
export type IssuePath = (string | number)[];

export interface ValidationIssue {
	path: IssuePath;
	message: string;
}

/** A Zod error's issues, each path under `prefix`; symbol keys become their description. */
export function issuesOf(error: z.ZodError, prefix: IssuePath = []): ValidationIssue[] {
	return error.issues.map((issue) => ({
		path: [...prefix, ...issue.path.map((key) => (typeof key === "symbol" ? String(key) : key))],
		message: issue.message,
	}));
}
