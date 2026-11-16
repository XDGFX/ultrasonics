import { parseTemplate, placeholdersOf, renderTemplate, type TemplatePart } from "./template.ts";

/**
 * The only extensions a file may be written with, so a mistyped setting can't overwrite the
 * database, a key file, or anything else in the data directory (spec #180, decision 1).
 */
export const textExtensions = [".txt", ".csv", ".tsv", ".m3u", ".m3u8", ".md", ".log"] as const;

/** The extension of the template's literal tail, lower-cased; none when it ends in a placeholder. */
function extensionOf(parts: TemplatePart[]): string | undefined {
	const last = parts.at(-1);
	if (last === undefined || !("text" in last)) return undefined;
	const dot = last.text.lastIndexOf(".");
	return dot === -1 ? undefined : last.text.slice(dot).toLowerCase();
}

/** Why a file name pattern is refused: each problem, named. */
export function fileNameProblems(fileName: string): string[] {
	const problems: string[] = [];
	if (/[/\\]/.test(fileName)) {
		problems.push(
			"The file name can't hold / or \\: files are written directly inside the folder.",
		);
	}
	const parsed = parseTemplate(fileName);
	if (!parsed.ok) return [...problems, parsed.problem];
	const others = placeholdersOf(parsed.parts).filter((name) => name !== "name");
	if (others.length > 0) {
		problems.push(
			`The file name can only use {name}, not ${others.map((name) => `{${name}}`).join(", ")}.`,
		);
	}
	const extension = extensionOf(parsed.parts);
	if (!(textExtensions as readonly (string | undefined)[]).includes(extension)) {
		problems.push(`The file name must end in ${textExtensions.join(", ")}.`);
	}
	return problems;
}

/** Characters Windows forbids in a file name, and control characters other than whitespace. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it removes.
const forbidden = /[\\/:*?"<>|\u0000-\u0008\u000e-\u001f\u007f]/g;
const windowsReserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * A playlist name as a file name, by the local playlists plugin's rules (spec #178): forbidden
 * characters removed, whitespace collapsed, trailing dots and spaces trimmed, `_` before a Windows
 * reserved name.
 */
export function sanitiseName(name: string): string {
	const cleaned = name
		.replace(forbidden, "")
		.replace(/\s+/g, " ")
		.replace(/[. ]+$/, "");
	const stem = cleaned.split(".")[0] ?? "";
	return windowsReserved.test(stem.trimEnd()) ? `_${cleaned}` : cleaned;
}

/** A file name pattern, parsed once a run. Settings validation has already accepted it. */
export class FileNamePattern {
	readonly #parts: TemplatePart[];

	constructor(fileName: string) {
		const parsed = parseTemplate(fileName);
		if (!parsed.ok) throw new Error(parsed.problem);
		this.#parts = parsed.parts;
	}

	/**
	 * The file name for a playlist, or `undefined` when its sanitised name is empty. Without
	 * `{name}`, every playlist shares one file.
	 */
	fileFor(playlistName: string): string | undefined {
		const name = sanitiseName(playlistName);
		return renderTemplate(this.#parts, () => (name === "" ? undefined : name));
	}
}
