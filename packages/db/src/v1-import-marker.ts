import { z } from "zod";

/** The `instance_settings` key whose presence means the v1 import has run (ADR-0017 §1). */
export const V1_IMPORT_MARKER_KEY = "v1_import";

/**
 * What the importer leaves under {@link V1_IMPORT_MARKER_KEY}: when it ran, its report, and whether
 * the UI notice was dismissed. Dismissing sets `dismissed`, never removes the row, or the next boot
 * would import again.
 */
export const V1ImportMarker = z.object({
	/** Epoch milliseconds. */
	importedAt: z.number(),
	report: z.object({
		imported: z.int().nonnegative(),
		skipped: z.int().nonnegative(),
		markdown: z.string(),
	}),
	dismissed: z.boolean(),
});
export type V1ImportMarker = z.infer<typeof V1ImportMarker>;
