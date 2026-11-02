/** Folds case, accents and punctuation so that formatting alone never separates two songs. */
export function normalise(text: string): string {
	return text
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/['’`]/g, "")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

/** A credit for a guest or producer, which some services put in the title and others in `artists`. */
const credit = /^(?:feat|ft|featuring|prod|produced)\b/i;

/** Bracketed segments, and a suffix after a spaced dash such as "- Remastered 2011". */
const decoration = /\(([^()]*)\)|\[([^[\]]*)\]|\{([^{}]*)\}|\s[-‐–—]\s(.*)$/gu;

const unbracketedCredit = /\s(?:feat|ft|featuring|prod)\.?\s.*$/iu;

/** A title split into what names the song and the decorations that describe the version. */
export interface Title {
	readonly core: string;
	readonly decorations: readonly string[];
}

export function parseTitle(raw: string): Title {
	const decorations: string[] = [];
	let core = raw.normalize("NFKC").replace(decoration, (_, ...groups: (string | undefined)[]) => {
		const text = groups.slice(0, 4).find((g) => g !== undefined) ?? "";
		if (!credit.test(text.trim())) decorations.push(normalise(text));
		return " ";
	});
	core = core.replace(unbracketedCredit, "");
	const normalised = normalise(core);
	// A title that is all decoration, such as "(untitled)", is its own name.
	return normalised === ""
		? { core: normalise(raw), decorations: [] }
		: { core: normalised, decorations };
}

const separator = /\s*(?:[,;&/+]|\s(?:and|x|with|vs\.?|feat\.?|ft\.?|featuring|[-‐–—])\s)\s*/iu;

/** Each artist named in the list, so "Flume & Kai" and `["Flume", "Kai"]` agree. */
export function artistNames(artists: readonly string[]): string[] {
	return artists
		.flatMap((artist) => artist.split(separator))
		.map(normalise)
		.filter((name) => name !== "");
}
