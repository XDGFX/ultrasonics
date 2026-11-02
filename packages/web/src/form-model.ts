import type { JSONSchema, ValidationIssue } from "@ultrasonics/plugin-sdk";

// Works from form JSON Schema and its `FormMeta` keys alone; it never sees Zod (ADR-0019 §1).

export type FieldKind = "text" | "password" | "number" | "integer" | "boolean" | "enum";

export interface Field {
	key: string;
	kind: FieldKind;
	schema: JSONSchema;
	/** Neither required nor defaulted: labelled "optional". */
	optional: boolean;
	required: boolean;
}

export interface Variant {
	/** The discriminator's value, or "" for a plain object. */
	value: string;
	schema: JSONSchema;
	fields: Field[];
}

export interface FormShape {
	/** The discriminator key, when the form is a discriminated union. */
	discriminator?: { key: string; title: string };
	variants: Variant[];
}

/** One input's raw state: text as typed, a toggle's state, or undefined when never set. */
export type Raw = string | boolean | undefined;

const isSchema = (node: unknown): node is JSONSchema => typeof node === "object" && node !== null;

function kindOf(schema: JSONSchema): FieldKind {
	if (Array.isArray(schema.enum)) return "enum";
	if (schema.type === "boolean") return "boolean";
	if (schema.type === "integer") return "integer";
	if (schema.type === "number") return "number";
	return schema.secret === true ? "password" : "text";
}

function fieldsOf(object: JSONSchema, skip?: string): Field[] {
	const required = new Set(object.required ?? []);
	return Object.entries(object.properties ?? {}).flatMap(([key, schema]) =>
		key === skip || !isSchema(schema)
			? []
			: [
					{
						key,
						kind: kindOf(schema),
						schema,
						required: required.has(key),
						optional: !required.has(key) && schema.default === undefined,
					},
				],
	);
}

export function shapeOf(schema: JSONSchema): FormShape {
	const variants = (schema.oneOf ?? []).filter(isSchema);
	if (variants.length === 0) return { variants: [{ value: "", schema, fields: fieldsOf(schema) }] };

	const constOf = (variant: JSONSchema, key: string) => {
		const property = variant.properties?.[key];
		return isSchema(property) ? property.const : undefined;
	};
	const key =
		Object.keys(variants[0]?.properties ?? {}).find((candidate) =>
			variants.every((variant) => constOf(variant, candidate) !== undefined),
		) ?? "";
	const titled = variants
		.map((variant) => variant.properties?.[key])
		.find((property) => isSchema(property) && typeof property.title === "string");
	return {
		discriminator: { key, title: isSchema(titled) && titled.title ? titled.title : key },
		variants: variants.map((variant) => ({
			value: String(constOf(variant, key)),
			schema: variant,
			fields: fieldsOf(variant, key),
		})),
	};
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** A stored value as raw input, keeping only what still fits its field; secrets are never filled. */
function rawOf(field: Field, stored: unknown): Raw {
	if (field.kind === "password") return "";
	const fits = (value: unknown) => {
		switch (field.kind) {
			case "boolean":
				return typeof value === "boolean";
			case "number":
				return typeof value === "number";
			case "integer":
				return Number.isInteger(value);
			case "enum":
				return field.schema.enum?.includes(value as never) ?? false;
			default:
				return typeof value === "string";
		}
	};
	const value = fits(stored)
		? stored
		: fits(field.schema.default)
			? field.schema.default
			: undefined;
	if (value === undefined) return field.kind === "boolean" ? undefined : "";
	return typeof value === "boolean" ? value : String(value);
}

/** The raw state of every variant, filled from the stored value where it belongs to that variant. */
export function initialRaw(shape: FormShape, value: unknown): Record<string, Record<string, Raw>> {
	const stored = isRecord(value) ? value : {};
	const storedVariant = shape.discriminator ? stored[shape.discriminator.key] : "";
	return Object.fromEntries(
		shape.variants.map((variant) => [
			variant.value,
			Object.fromEntries(
				variant.fields.map((field) => [
					field.key,
					rawOf(field, variant.value === storedVariant ? stored[field.key] : undefined),
				]),
			),
		]),
	);
}

/** The variant a stored value names, else the first. */
export function initialVariant(shape: FormShape, value: unknown): string {
	const named = shape.discriminator && isRecord(value) ? value[shape.discriminator.key] : undefined;
	return (
		shape.variants.find((variant) => variant.value === named)?.value ??
		shape.variants[0]?.value ??
		""
	);
}

/** The value to submit: the active variant only, with every empty input dropped (ADR-0019 §5). */
export function emitted(
	shape: FormShape,
	variant: Variant,
	raw: Record<string, Raw>,
): Record<string, unknown> {
	const value: Record<string, unknown> = shape.discriminator
		? { [shape.discriminator.key]: variant.value }
		: {};
	for (const field of variant.fields) {
		const input = raw[field.key];
		if (input === undefined || input === "") continue;
		value[field.key] = field.kind === "number" || field.kind === "integer" ? Number(input) : input;
	}
	return value;
}

/** Splits issues into those under a field of the active variant and those shown above the form. */
export function placeIssues(
	shape: FormShape,
	variant: Variant,
	issues: ValidationIssue[],
): { byField: Map<string, string[]>; above: string[] } {
	const byField = new Map<string, string[]>();
	const above: string[] = [];
	const discriminator = shape.discriminator?.key;
	const fieldKeys = new Set([
		...variant.fields.map((field) => field.key),
		...(discriminator ? [discriminator] : []),
	]);
	for (const issue of issues) {
		let path = issue.path;
		const [head] = path;
		if (discriminator && typeof head === "string" && head.startsWith(`${discriminator}=`)) {
			path = head === `${discriminator}=${variant.value}` ? path.slice(1) : [];
		}
		const [key] = path;
		if (path.length === 1 && typeof key === "string" && fieldKeys.has(key)) {
			byField.set(key, [...(byField.get(key) ?? []), issue.message]);
		} else {
			above.push(issue.message);
		}
	}
	return { byField, above };
}
