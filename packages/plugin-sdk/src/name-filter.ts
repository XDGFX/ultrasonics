/**
 * The one way a plugin filters playlists by name: comma-separated patterns, each matched against
 * the whole name, case ignored, where `*` matches any run of characters and `?` exactly one. Every
 * other character is itself, and there is no escape.
 */
export function nameFilter(patterns: string): (name: string) => boolean {
	const compiled = patterns
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "")
		.map(characters);
	return (name) => {
		const target = characters(name);
		return compiled.some((pattern) => wildcardMatch(pattern, target));
	};
}

/** Code points, so `?` takes an astral character whole. */
function characters(value: string): string[] {
	return Array.from(value.normalize("NFC").toLowerCase());
}

/** Wildcard matching without a regex: on a mismatch, the last `*` takes one more character. */
function wildcardMatch(pattern: readonly string[], name: readonly string[]): boolean {
	let p = 0;
	let n = 0;
	let star = -1;
	let resume = 0;
	while (n < name.length) {
		if (p < pattern.length && (pattern[p] === "?" || pattern[p] === name[n])) {
			p++;
			n++;
		} else if (p < pattern.length && pattern[p] === "*") {
			star = p++;
			resume = n;
		} else if (star !== -1) {
			p = star + 1;
			n = ++resume;
		} else {
			return false;
		}
	}
	while (pattern[p] === "*") p++;
	return p === pattern.length;
}
