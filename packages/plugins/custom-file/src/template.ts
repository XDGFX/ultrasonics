/** One piece of a parsed template: literal text, or a placeholder's name between braces. */
export type TemplatePart = { text: string } | { placeholder: string };

export type ParsedTemplate = { ok: true; parts: TemplatePart[] } | { ok: false; problem: string };

/**
 * Splits a template such as `{artist} - {title}` into literal text and placeholders, with `{{` and
 * `}}` as literal braces. Rendering concatenates the parts, so no value is ever read as a pattern.
 */
export function parseTemplate(template: string): ParsedTemplate {
	const parts: TemplatePart[] = [];
	let text = "";
	let at = 0;
	while (at < template.length) {
		const char = template[at];
		const next = template[at + 1];
		if ((char === "{" && next === "{") || (char === "}" && next === "}")) {
			text += char;
			at += 2;
		} else if (char === "}") {
			return { ok: false, problem: "A } has no matching {. Write }} for a literal brace." };
		} else if (char === "{") {
			const close = template.indexOf("}", at + 1);
			const name = close === -1 ? undefined : template.slice(at + 1, close);
			if (name === undefined || name.includes("{")) {
				return { ok: false, problem: "A { is never closed. Write {{ for a literal brace." };
			}
			if (text !== "") parts.push({ text });
			text = "";
			parts.push({ placeholder: name });
			at = close + 1;
		} else {
			text += char;
			at += 1;
		}
	}
	if (text !== "") parts.push({ text });
	return { ok: true, parts };
}

/** The placeholders a parsed template uses, each once, in order. */
export function placeholdersOf(parts: TemplatePart[]): string[] {
	const names = parts.flatMap((part) => ("placeholder" in part ? [part.placeholder] : []));
	return [...new Set(names)];
}

/**
 * Concatenates the parts, taking each placeholder's value from `valueFor`. `undefined` when any
 * placeholder has no value.
 */
export function renderTemplate(
	parts: TemplatePart[],
	valueFor: (placeholder: string) => string | undefined,
): string | undefined {
	let out = "";
	for (const part of parts) {
		if ("text" in part) {
			out += part.text;
			continue;
		}
		const value = valueFor(part.placeholder);
		if (value === undefined) return undefined;
		out += value;
	}
	return out;
}
