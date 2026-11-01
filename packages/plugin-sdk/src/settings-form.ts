import { z } from "zod";
import type { IssuePath, ValidationIssue } from "./song-dict-validator.ts";

export type JSONSchema = z.core.JSONSchema.BaseSchema;

/** The fixed copy vocabulary a settings form renders (ADR-0019 §2). All values are plain text. */
export const FormMeta = z
	.object({
		title: z.string(),
		description: z.string(),
		placeholder: z.string(),
		/** Rendered with emphasis, for copy that prevents data loss. */
		warning: z.string(),
		/** A password input that is never echoed back; legal in auth `fields` only. */
		secret: z.boolean(),
	})
	.partial()
	.strict();
export type FormMeta = z.infer<typeof FormMeta>;

/** Attaches form copy to a field, an object, or a union variant. */
export function withMeta<T extends z.ZodType>(schema: T, meta: FormMeta): T {
	return schema.meta(FormMeta.parse(meta));
}

export type FormSchemaResult =
	| { ok: true; jsonSchema: JSONSchema }
	| { ok: false; issues: ValidationIssue[] };

const leafTypes = new Set(["string", "number", "integer", "boolean"]);

/** The value path a JSON Schema path points at: the keys under each `properties`. */
function valuePath(jsonPath: (string | number)[]): IssuePath {
	return jsonPath.filter((_, index) => jsonPath[index - 1] === "properties");
}

function describeNonLeaf(node: JSONSchema): string {
	if (Array.isArray(node.type) || node.anyOf || node.oneOf || node.allOf) {
		return "A union or nullable field cannot be rendered; use an enum or a discriminated union";
	}
	if (node.type === "object") return "A nested object or record cannot be rendered";
	if (node.type === "array") return "An array or tuple cannot be rendered";
	return "This type cannot be rendered as a form field";
}

/**
 * Converts a settings or auth `fields` schema into the input-mode JSON Schema the UI renders, and
 * rejects any node outside the renderable subset, naming its path (ADR-0019 §1, §3).
 */
export function toFormSchema(
	schema: z.ZodType,
	options: { auth?: boolean } = {},
): FormSchemaResult {
	const issues: ValidationIssue[] = [];
	const report = (path: IssuePath, message: string) => issues.push({ path, message });

	const jsonSchema = z.toJSONSchema(schema, {
		io: "input",
		unrepresentable: "any",
		// Transforms, pipes and coercion vanish from input-mode JSON Schema, so only Zod sees them.
		override({ zodSchema, path }) {
			const def = zodSchema._zod.def as { type: string; coerce?: boolean };
			if (def.type === "pipe" || def.type === "transform") {
				report(valuePath(path), "A transform or pipe changes what the form saves");
			} else if (def.coerce) {
				report(valuePath(path), "Coercion turns a blank field into a value the user never typed");
			}
		},
	}) as JSONSchema;

	const checkSecret = (node: JSONSchema, path: IssuePath) => {
		if (node.secret !== undefined && !options.auth) {
			report(path, "Only auth fields can be secret (ADR-0012 §6)");
		}
	};

	const checkLeaf = (node: JSONSchema, path: IssuePath, isDiscriminator: boolean) => {
		checkSecret(node, path);
		const isLeaf =
			typeof node.type === "string" &&
			leafTypes.has(node.type) &&
			!node.anyOf &&
			!node.oneOf &&
			!node.allOf;
		if (!isLeaf) report(path, describeNonLeaf(node));
		else if (node.const !== undefined && !isDiscriminator) {
			report(path, "A literal is renderable only as a union's discriminator; use an enum");
		}
	};

	const checkFlatObject = (node: JSONSchema, path: IssuePath, discriminator?: string) => {
		checkSecret(node, path);
		if (node.type !== "object" || typeof node.additionalProperties === "object") {
			report(path, "Expected a flat object");
			return;
		}
		for (const [key, child] of Object.entries(node.properties ?? {})) {
			if (typeof child === "object") checkLeaf(child, [...path, key], key === discriminator);
		}
	};

	const variants = (jsonSchema.oneOf ?? []).filter((v): v is JSONSchema => typeof v === "object");
	if (jsonSchema.oneOf) {
		const discriminator = Object.keys(variants[0]?.properties ?? {}).find((key) =>
			variants.every((variant) => {
				const property = variant.properties?.[key];
				return typeof property === "object" && property.const !== undefined;
			}),
		);
		if (discriminator === undefined) report([], "Expected a union to be discriminated");
		for (const variant of variants) checkFlatObject(variant, [], discriminator);
	} else if (jsonSchema.type === "object" && !jsonSchema.anyOf) {
		checkFlatObject(jsonSchema, []);
	} else {
		report([], "Expected a flat object or a discriminated union of flat objects at the top");
	}

	return issues.length === 0 ? { ok: true, jsonSchema } : { ok: false, issues: outermost(issues) };
}

/** One issue per node: a node already reported hides what was found beneath it. */
function outermost(issues: ValidationIssue[]): ValidationIssue[] {
	const key = (path: IssuePath) => JSON.stringify(path);
	const seen = new Set<string>();
	return issues.filter((issue) => {
		const hidden = issues.some(
			(other) =>
				other.path.length < issue.path.length &&
				other.path.every((segment, index) => segment === issue.path[index]),
		);
		if (hidden || seen.has(key(issue.path))) return false;
		seen.add(key(issue.path));
		return true;
	});
}
