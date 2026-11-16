import { stat } from "node:fs/promises";

/** Whether `path` names a file, following links; anything unreadable is not. */
export async function isFile(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}
