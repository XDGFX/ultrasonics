/** How a v1 plugin applied its pattern: `re.search` matches anywhere, `re.match` from the start. */
export type V1FilterSemantics = "search" | "match";

export type ConvertedFilter =
	| { ok: true; filter: string; notes: string[] }
	| { ok: false; reason: string };

export const PLUS_NOTE =
	"`.+` became `*`, which also matches nothing, where v1 needed at least one character.";

const UNESCAPED_META = new Set(["[", "]", "(", ")", "{", "}", "?", "*", "+", "^", "$", "|"]);
/** Characters v2's name filter gives a meaning, so it cannot write them literally. */
const WILDCARD_SYNTAX = new Set(["*", "?", ","]);

const manual = (reason: string) => ({ reason });

/** Splits on each `|` outside an escape; a group would hold one too, and groups never convert. */
function branchesOf(pattern: string): string[] {
	const branches = [""];
	for (let i = 0; i < pattern.length; i++) {
		const char = pattern.charAt(i);
		if (char === "|") {
			branches.push("");
			continue;
		}
		const pair = char === "\\" ? pattern.slice(i, i + 2) : char;
		branches[branches.length - 1] += pair;
		i += pair.length - 1;
	}
	return branches;
}

function convertBranch(branch: string, semantics: V1FilterSemantics, notes: Set<string>) {
	let body = branch;
	const anchoredStart = semantics === "match" || body.startsWith("^");
	if (body.startsWith("^")) body = body.slice(1);
	// `\$` is a literal dollar, so an escaped one does not anchor.
	const anchoredEnd = body.endsWith("$") && !/(^|[^\\])(\\\\)*\\\$$/.test(body);
	if (anchoredEnd) body = body.slice(0, -1);

	let filter = "";
	for (let i = 0; i < body.length; i++) {
		const char = body.charAt(i);
		const next = body.charAt(i + 1);
		if (char === "\\") {
			if (next === "" || /[A-Za-z0-9]/.test(next)) {
				return manual(next === "" ? "It ends in a lone `\\`." : `It uses \`\\${next}\`.`);
			}
			if (WILDCARD_SYNTAX.has(next)) return manual(`It matches a literal \`${next}\`.`);
			filter += next;
			i++;
		} else if (char === "." && (next === "*" || next === "+")) {
			if (body.charAt(i + 2) === "?") return manual("It uses a lazy quantifier.");
			if (next === "+") notes.add(PLUS_NOTE);
			filter += "*";
			i++;
		} else if (char === ".") {
			filter += "?";
		} else if (UNESCAPED_META.has(char)) {
			return manual(`It uses \`${char}\`, which v2's wildcards cannot express.`);
		} else if (WILDCARD_SYNTAX.has(char)) {
			return manual(`It matches a literal \`${char}\`.`);
		} else {
			filter += char;
		}
	}

	const entry = `${anchoredStart ? "" : "*"}${filter}${anchoredEnd ? "" : "*"}`.replace(
		/\*{2,}/g,
		"*",
	);
	if (entry === "") return manual("It matches only an empty name.");
	if (entry.trim() !== entry) return manual("It matches a leading or trailing space.");
	return { entry };
}

/**
 * Converts a v1 name-filter regex to v2's wildcard list, or says why it needs a manual edit. Only
 * literals, `.`, `.*`, `.+`, branch-end anchors and `|` convert; each unanchored end gains `*`.
 */
export function convertV1Filter(pattern: string, semantics: V1FilterSemantics): ConvertedFilter {
	const notes = new Set<string>();
	const entries: string[] = [];
	for (const branch of branchesOf(pattern)) {
		const converted = convertBranch(branch, semantics, notes);
		if ("reason" in converted) return { ok: false, reason: converted.reason };
		entries.push(converted.entry);
	}
	return { ok: true, filter: entries.join(", "), notes: [...notes] };
}
