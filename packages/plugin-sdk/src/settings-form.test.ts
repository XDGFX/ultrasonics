import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { toFormSchema, withMeta } from "./index.ts";

function issuesOf(schema: z.ZodType, options?: { auth?: boolean }) {
	const result = toFormSchema(schema, options);
	return result.ok ? [] : result.issues;
}

function jsonSchemaOf(schema: z.ZodType, options?: { auth?: boolean }) {
	const result = toFormSchema(schema, options);
	if (!result.ok) throw new Error(JSON.stringify(result.issues));
	return result.jsonSchema;
}

describe("toFormSchema accepts the renderable subset (ADR-0019 §3)", () => {
	test.each<[string, z.ZodType]>([
		[
			"a string with length and regex",
			z
				.string()
				.min(1)
				.max(40)
				.regex(/^[a-z]+$/),
		],
		["a number with bounds", z.number().min(0).max(1)],
		["an integer", z.number().int()],
		["a boolean", z.boolean()],
		["an enum", z.enum(["append", "update"])],
		["an optional field", z.string().optional()],
		["a field with a default", z.boolean().default(true)],
		["a refined field", z.string().refine((value) => value !== "admin")],
	])("%s", (_, field) => {
		expect(issuesOf(z.object({ field }))).toEqual([]);
	});

	test("an empty object", () => {
		expect(issuesOf(z.object({}))).toEqual([]);
	});

	test("a discriminated union of flat objects", () => {
		const schema = z.discriminatedUnion("mode", [
			z.object({ mode: z.literal("playlists"), names: z.string() }),
			z.object({ mode: z.literal("saved"), limit: z.number().int().default(50) }),
		]);
		expect(issuesOf(schema)).toEqual([]);
	});

	test("a refined object", () => {
		expect(issuesOf(z.object({ a: z.string() }).refine((value) => value.a !== "b"))).toEqual([]);
	});

	test("serves input-mode JSON Schema, so a defaulted field is optional and prefilled", () => {
		const jsonSchema = jsonSchemaOf(z.object({ verifyTls: z.boolean().default(true) }));
		expect(jsonSchema.required ?? []).not.toContain("verifyTls");
		expect(jsonSchema.properties?.verifyTls).toMatchObject({ type: "boolean", default: true });
	});
});

describe("toFormSchema rejects what a form cannot render, naming the path", () => {
	test.each<[string, z.ZodType]>([
		["a nested object", z.object({ inner: z.string() })],
		["an array", z.array(z.string())],
		["a record", z.record(z.string(), z.string())],
		["a tuple", z.tuple([z.string()])],
		["a plain union", z.union([z.string(), z.number()])],
		["a nullable field", z.string().nullable()],
		["a literal outside a discriminator", z.literal("x")],
		["a transform", z.string().transform((value) => value.length)],
		["a pipe", z.string().pipe(z.string().min(1))],
		["a coerced number", z.coerce.number()],
		["a date", z.date()],
		["a URL string", z.url()],
		["an email string", z.email()],
		["an unknown", z.unknown()],
	])("%s", (_, field) => {
		const issues = issuesOf(z.object({ ok: z.string(), field }));
		expect(issues.map((issue) => issue.path)).toEqual([["field"]]);
	});

	test("a banned node inside a union variant", () => {
		const schema = z.discriminatedUnion("mode", [
			z.object({ mode: z.literal("a"), fine: z.string() }),
			z.object({ mode: z.literal("b"), names: z.array(z.string()) }),
		]);
		expect(issuesOf(schema).map((issue) => issue.path)).toEqual([["mode=b", "names"]]);
	});

	test("a transform inside a union variant", () => {
		const schema = z.discriminatedUnion("mode", [
			z.object({ mode: z.literal("a"), fine: z.string() }),
			z.object({ mode: z.literal("b"), size: z.string().transform((value) => value.length) }),
		]);
		expect(issuesOf(schema).map((issue) => issue.path)).toEqual([["mode=b", "size"]]);
	});

	test.each<[string, z.ZodType]>([
		["a leaf", z.string()],
		["an array", z.array(z.object({ a: z.string() }))],
		[
			"a plain union of objects",
			z.union([z.object({ a: z.string() }), z.object({ b: z.number() })]),
		],
	])("%s at the top level", (_, schema) => {
		expect(issuesOf(schema).map((issue) => issue.path)).toEqual([[]]);
	});

	test("secret outside auth fields", () => {
		const schema = z.object({ token: withMeta(z.string(), { secret: true }) });
		expect(issuesOf(schema).map((issue) => issue.path)).toEqual([["token"]]);
	});

	test("but not secret inside auth fields", () => {
		const schema = z.object({ token: withMeta(z.string(), { secret: true }) });
		expect(issuesOf(schema, { auth: true })).toEqual([]);
	});
});

describe("withMeta", () => {
	test("carries the metadata vocabulary into the JSON Schema", () => {
		const schema = withMeta(
			z.object({
				server: withMeta(z.string(), {
					title: "Server URL",
					description: "Where Plex listens",
					placeholder: "http://plex.local:32400",
				}),
				replace: withMeta(z.boolean(), { warning: "Existing tracks will be removed" }),
				token: withMeta(z.string(), { secret: true }),
			}),
			{ title: "Plex", description: "Connect your server" },
		);
		const jsonSchema = jsonSchemaOf(schema, { auth: true });
		expect(jsonSchema).toMatchObject({
			title: "Plex",
			description: "Connect your server",
			properties: {
				server: {
					title: "Server URL",
					description: "Where Plex listens",
					placeholder: "http://plex.local:32400",
				},
				replace: { warning: "Existing tracks will be removed" },
				token: { secret: true },
			},
		});
	});

	test("labels a union variant", () => {
		const schema = z.discriminatedUnion("mode", [
			withMeta(z.object({ mode: z.literal("saved") }), { title: "Saved songs" }),
		]);
		expect(jsonSchemaOf(schema).oneOf?.[0]).toMatchObject({ title: "Saved songs" });
	});

	test("keeps the field's own type, so it still parses", () => {
		const field = withMeta(z.number().int(), { title: "Limit" });
		expect(field.parse(3)).toBe(3);
	});
});
