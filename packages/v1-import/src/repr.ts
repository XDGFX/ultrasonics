import type { JsonObject, JsonValue } from "@ultrasonics/db";

/**
 * A blob outside v1's `repr` subset. The message names what was found and where, never the text
 * itself, because a `plugins` blob holds credentials.
 */
export class ReprError extends Error {
	override readonly name = "ReprError";

	constructor(
		what: string,
		readonly offset: number,
	) {
		super(`Unexpected ${what} at offset ${offset}`);
	}
}

const SIMPLE_ESCAPES: Record<string, string> = {
	"\\": "\\",
	"'": "'",
	'"': '"',
	n: "\n",
	r: "\r",
	t: "\t",
};

const HEX_ESCAPE_DIGITS: Record<string, number> = { x: 2, u: 4, U: 8 };

const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
const NAMED_CONSTANTS: Record<string, JsonValue> = { True: true, False: false, None: null };

/**
 * Parses the Python literal subset v1 wrote with `str(dict)` (ADR-0017 §2): quoted strings, `True`,
 * `False`, `None`, numbers, lists and dicts with string keys. Anything else throws {@link ReprError}.
 */
export function parseRepr(text: string): JsonValue {
	let at = 0;

	const skipSpace = () => {
		while (at < text.length && " \t\n\r".includes(text.charAt(at))) at++;
	};

	const expect = (char: string) => {
		skipSpace();
		if (text[at] !== char) throw new ReprError(`'${describe()}' (expected '${char}')`, at);
		at++;
	};

	/** Names a character of syntax only; a quote or letter would start a value, which is not named. */
	const describe = () => {
		const char = text[at];
		if (char === undefined) return "end";
		return "{}[](),:".includes(char) ? char : "value";
	};

	const string = (): string => {
		const start = at;
		const quote = text[at++];
		let value = "";
		for (;;) {
			const char = text[at];
			if (char === undefined || char === "\n") throw new ReprError("unterminated string", start);
			at++;
			if (char === quote) return value;
			if (char !== "\\") {
				value += char;
				continue;
			}
			const escaped = text[at] ?? "";
			const simple = SIMPLE_ESCAPES[escaped];
			const digits = HEX_ESCAPE_DIGITS[escaped];
			if (simple !== undefined) {
				value += simple;
				at++;
			} else if (digits !== undefined) {
				const hex = text.slice(at + 1, at + 1 + digits);
				const codePoint = Number.parseInt(hex, 16);
				if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== digits || codePoint > 0x10ffff) {
					throw new ReprError("malformed escape", at - 1);
				}
				value += String.fromCodePoint(codePoint);
				at += 1 + digits;
			} else {
				throw new ReprError("escape", at - 1);
			}
		}
	};

	const sequence = <T>(close: string, item: () => T): T[] => {
		const items: T[] = [];
		for (;;) {
			skipSpace();
			if (text[at] === close) {
				at++;
				return items;
			}
			items.push(item());
			skipSpace();
			if (text[at] === ",") at++;
			else if (text[at] !== close) throw new ReprError(`'${describe()}'`, at);
		}
	};

	const dict = (): JsonObject => {
		const start = at++;
		const entries = sequence("}", () => {
			skipSpace();
			const keyAt = at;
			const key = value();
			if (typeof key !== "string") throw new ReprError("non-string dict key", keyAt);
			skipSpace();
			if (text[at] === "," || text[at] === "}") throw new ReprError("set", start);
			expect(":");
			return [key, value()] as const;
		});
		return Object.fromEntries(entries);
	};

	const value = (): JsonValue => {
		skipSpace();
		const char = text[at];
		if (char === "'" || char === '"') return string();
		if (char === "{") return dict();
		if (char === "[") {
			at++;
			return sequence("]", value);
		}
		if (char === "(") throw new ReprError("tuple", at);
		NUMBER.lastIndex = at;
		const number = NUMBER.exec(text);
		if (number) {
			at += number[0].length;
			return Number(number[0]);
		}
		NAME.lastIndex = at;
		const name = NAME.exec(text)?.[0];
		if (name !== undefined && Object.hasOwn(NAMED_CONSTANTS, name)) {
			at += name.length;
			return NAMED_CONSTANTS[name] ?? null;
		}
		throw new ReprError(name === undefined ? `'${describe()}'` : "name", at);
	};

	const parsed = value();
	skipSpace();
	if (at < text.length) throw new ReprError("trailing text", at);
	return parsed;
}
