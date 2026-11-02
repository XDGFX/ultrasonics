/** The Levenshtein edit distance between two strings, by code point. */
function editDistance(a: readonly string[], b: readonly string[]): number {
	let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		for (let j = 1; j <= b.length; j++) {
			const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
			current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution));
		}
		previous = current;
	}
	return previous[b.length] ?? 0;
}

/** How alike two strings are, from 0 (nothing shared) to 1 (equal). */
export function similarity(a: string, b: string): number {
	const left = [...a];
	const right = [...b];
	const longest = Math.max(left.length, right.length);
	if (longest === 0) return 1;
	return 1 - editDistance(left, right) / longest;
}

/** The two lists, shorter first. */
export function byLength<T>(a: readonly T[], b: readonly T[]): [readonly T[], readonly T[]] {
	return a.length <= b.length ? [a, b] : [b, a];
}

const words = (text: string) => text.split(" ").filter((word) => word !== "");

/** Whether every word of the shorter text appears in the longer, as when one credit drops a first name. */
export function containsWords(a: string, b: string): boolean {
	const [shorter, longer] = byLength(words(a), words(b));
	return shorter.length > 0 && shorter.every((word) => longer.includes(word));
}

/** Whether the shorter text opens the longer, as when one side drops a subtitle; one word is too common a title to count. */
export function opens(a: string, b: string): boolean {
	const [shorter, longer] = byLength(words(a), words(b));
	return shorter.length > 1 && shorter.every((word, i) => longer[i] === word);
}
