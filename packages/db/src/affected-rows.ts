/** How many rows a write touched, counted from its `RETURNING` rows. */
export function affectedRows(write: { all(): unknown[] }): number {
	return write.all().length;
}
