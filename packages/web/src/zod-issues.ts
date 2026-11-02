import type { IssuePath, ValidationIssue } from "@ultrasonics/plugin-sdk";
import type { z } from "zod";

/** A Zod error as the `ValidationIssue`s the API answers with, each path under `prefix`. */
export function issuesOf(error: z.ZodError, prefix: IssuePath = []): ValidationIssue[] {
	return error.issues.map((issue) => ({
		path: [...prefix, ...issue.path.map((key) => (typeof key === "symbol" ? String(key) : key))],
		message: issue.message,
	}));
}
