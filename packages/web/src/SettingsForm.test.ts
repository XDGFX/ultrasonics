import { describe, expect, test } from "bun:test";
import {
	type JSONSchema,
	toFormSchema,
	type ValidationIssue,
	withMeta,
} from "@ultrasonics/plugin-sdk";
import { mount, type VueWrapper } from "@vue/test-utils";
import { z } from "zod";
import SettingsForm from "./SettingsForm.vue";

function form(schema: z.ZodType, options: { auth?: boolean } = {}): JSONSchema {
	const result = toFormSchema(schema, options);
	if (!result.ok) throw new Error(`fixture not renderable: ${JSON.stringify(result.issues)}`);
	return result.jsonSchema;
}

function render(schema: JSONSchema, props: { value?: unknown; issues?: ValidationIssue[] } = {}) {
	return mount(SettingsForm, { props: { schema, ...props } });
}

async function submitted(wrapper: VueWrapper): Promise<unknown> {
	await wrapper.find("form").trigger("submit");
	const events = wrapper.emitted("submit");
	return events?.at(-1)?.[0];
}

const labelOf = (wrapper: VueWrapper, name: string) => {
	const id = wrapper.find(`[name="${name}"]`).attributes("id");
	return wrapper.find(`label[for="${id}"]`).text();
};

const leaves = form(
	z.object({
		title: withMeta(
			z
				.string()
				.min(2)
				.max(40)
				.regex(/^[a-z]+$/),
			{
				title: "playlist title",
				description: "as it appears in plex",
				placeholder: "discover weekly",
			},
		),
		limit: z.int().min(1).max(500),
		ratio: z.number(),
		shuffle: z.boolean(),
		order: z.enum(["newest", "oldest"]),
	}),
);

describe("the settings-form renderer", () => {
	test("draws each leaf in its own control, with the schema's HTML hints", () => {
		const wrapper = render(leaves);
		const title = wrapper.find('[name="title"]');
		expect(title.attributes()).toMatchObject({
			type: "text",
			minlength: "2",
			maxlength: "40",
			pattern: "^[a-z]+$",
			placeholder: "discover weekly",
		});
		expect(title.attributes("required")).toBeDefined();
		expect(wrapper.find('[name="limit"]').attributes()).toMatchObject({
			type: "number",
			min: "1",
			max: "500",
			step: "1",
		});
		expect(wrapper.find('[name="ratio"]').attributes("step")).toBe("any");
		expect(wrapper.find('[name="shuffle"]').attributes()).toMatchObject({
			type: "checkbox",
			role: "switch",
		});
		const order = wrapper.find('select[name="order"]');
		expect(order.findAll("option").map((option) => option.attributes("value"))).toEqual([
			"",
			"newest",
			"oldest",
		]);
	});

	test("labels a field with its title and help, or its key when it has no title", () => {
		const wrapper = render(leaves);
		expect(labelOf(wrapper, "title")).toBe("playlist title");
		expect(labelOf(wrapper, "limit")).toBe("limit");
		expect(wrapper.text()).toContain("as it appears in plex");
	});

	test("emits what was typed, as the schema's types", async () => {
		const wrapper = render(leaves);
		await wrapper.find('[name="title"]').setValue("mix");
		await wrapper.find('[name="limit"]').setValue("20");
		await wrapper.find('[name="ratio"]').setValue("0.5");
		await wrapper.find('[name="shuffle"]').setValue(true);
		await wrapper.find('[name="order"]').setValue("oldest");
		expect(await submitted(wrapper)).toEqual({
			title: "mix",
			limit: 20,
			ratio: 0.5,
			shuffle: true,
			order: "oldest",
		});
	});

	test("shows a warning on a field, on the whole form, and on a variant", () => {
		const fieldAndForm = form(
			withMeta(
				z.object({
					update: withMeta(z.enum(["replace", "append"]), {
						warning: "existing tracks will be removed",
					}),
				}),
				{ description: "how playlists are written", warning: "this writes to your library" },
			),
		);
		const wrapper = render(fieldAndForm);
		const warnings = wrapper.findAll('[role="note"]').map((note) => note.text());
		expect(warnings).toEqual([
			expect.stringContaining("this writes to your library"),
			expect.stringContaining("existing tracks will be removed"),
		]);
		expect(wrapper.text()).toContain("how playlists are written");

		const variant = form(
			z.discriminatedUnion("mode", [
				withMeta(z.object({ mode: z.literal("keep") }), { title: "keep" }),
				withMeta(z.object({ mode: z.literal("wipe") }), {
					title: "wipe",
					description: "start the playlist again",
					warning: "every track goes",
				}),
			]),
		);
		const cards = render(variant);
		expect(cards.findAll('[role="note"]').map((note) => note.text())).toEqual([
			expect.stringContaining("every track goes"),
		]);
		expect(cards.text()).toContain("start the playlist again");
	});

	test("renders copy as text, never as HTML", () => {
		const wrapper = render(
			form(z.object({ x: withMeta(z.string(), { description: "<b>bold</b>" }) })),
		);
		expect(wrapper.find("b").exists()).toBe(false);
		expect(wrapper.text()).toContain("<b>bold</b>");
	});

	test("marks a field neither required nor defaulted as optional, and prefills a default", () => {
		const wrapper = render(
			form(
				z.object({
					needed: z.string(),
					maybe: z.string().optional(),
					library: z.string().default("music"),
					count: z.int().default(3),
					liked: z.boolean().default(true),
				}),
			),
		);
		expect(labelOf(wrapper, "maybe")).toBe("maybe optional");
		expect(labelOf(wrapper, "needed")).toBe("needed");
		expect(labelOf(wrapper, "library")).toBe("library");
		expect((wrapper.find('[name="library"]').element as HTMLInputElement).value).toBe("music");
		expect((wrapper.find('[name="count"]').element as HTMLInputElement).value).toBe("3");
		expect((wrapper.find('[name="liked"]').element as HTMLInputElement).checked).toBe(true);
	});

	test("treats a blank text or number field as absent, never as an empty string or zero", async () => {
		const wrapper = render(leaves, { value: { title: "mix", limit: 20 } });
		await wrapper.find('[name="title"]').setValue("");
		await wrapper.find('[name="limit"]').setValue("");
		expect(await submitted(wrapper)).toEqual({});
	});

	test("draws a secret as a password input and never fills it back in", () => {
		const auth = form(z.object({ token: withMeta(z.string(), { title: "token", secret: true }) }), {
			auth: true,
		});
		const token = render(auth, { value: { token: "stored-secret" } }).find('[name="token"]');
		expect(token.attributes("type")).toBe("password");
		expect((token.element as HTMLInputElement).value).toBe("");
	});

	describe("a discriminated union", () => {
		const union = form(
			z.discriminatedUnion("source", [
				withMeta(
					z.object({
						source: withMeta(z.literal("saved"), { title: "which playlists" }),
						liked: z.boolean().default(false),
					}),
					{ title: "all saved", description: "every playlist in your library" },
				),
				withMeta(z.object({ source: z.literal("chosen"), names: z.string() }), {
					title: "chosen",
					description: "only those you name",
				}),
			]),
		);

		test("draws radio cards headed by the discriminator's title, then the chosen variant's fields", async () => {
			const wrapper = render(union);
			expect(wrapper.find("legend").text()).toBe("which playlists");
			const radios = wrapper.findAll('input[type="radio"]');
			expect(radios.map((radio) => radio.attributes("value"))).toEqual(["saved", "chosen"]);
			expect(wrapper.find('[name="names"]').exists()).toBe(false);
			await radios[1]?.setValue(true);
			expect(wrapper.find('[name="names"]').exists()).toBe(true);
			expect(wrapper.find('[name="liked"]').exists()).toBe(false);
		});

		test("keeps a hidden branch's values but emits only the active branch", async () => {
			const wrapper = render(union, { value: { source: "chosen", names: "radar" } });
			await wrapper.find('input[value="saved"]').setValue(true);
			await wrapper.find('[name="liked"]').setValue(true);
			expect(await submitted(wrapper)).toEqual({ source: "saved", liked: true });

			await wrapper.find('input[value="chosen"]').setValue(true);
			expect((wrapper.find('[name="names"]').element as HTMLInputElement).value).toBe("radar");
			expect(await submitted(wrapper)).toEqual({ source: "chosen", names: "radar" });
		});

		test("places an issue on a union field by either path form", () => {
			for (const path of [["names"], ["source=chosen", "names"]]) {
				const wrapper = render(union, {
					value: { source: "chosen" },
					issues: [{ path, message: "name a playlist" }],
				});
				expect(wrapper.find('[name="names"]').attributes("aria-invalid")).toBe("true");
				expect(wrapper.find('[role="alert"]').exists()).toBe(false);
				expect(wrapper.text()).toContain("name a playlist");
			}
		});
	});

	test("shows a field's issue under it, and a root or unmatched issue above the form", () => {
		const wrapper = render(leaves, {
			issues: [
				{ path: ["limit"], message: "too many" },
				{ path: [], message: "the form is wrong" },
				{ path: ["gone"], message: "no such field" },
			],
		});
		expect(wrapper.find('[name="limit"]').attributes("aria-invalid")).toBe("true");
		expect(wrapper.find('[name="title"]').attributes("aria-invalid")).toBeUndefined();
		const above = wrapper.find('[role="alert"]').text();
		expect(above).toContain("the form is wrong");
		expect(above).toContain("no such field");
		expect(above).not.toContain("too many");
	});

	test("opens a stored value that no longer parses with what still fits, and blocks submit until a change", async () => {
		const wrapper = render(leaves, {
			value: { title: "mix", limit: "lots", retired: true, order: "random" },
			issues: [{ path: ["limit"], message: "expected a number" }],
		});
		expect((wrapper.find('[name="title"]').element as HTMLInputElement).value).toBe("mix");
		expect((wrapper.find('[name="limit"]').element as HTMLInputElement).value).toBe("");
		expect((wrapper.find('[name="order"]').element as HTMLSelectElement).value).toBe("");
		expect(wrapper.find('button[type="submit"]').attributes("disabled")).toBeDefined();
		expect(await submitted(wrapper)).toBeUndefined();

		await wrapper.find('[name="limit"]').setValue("5");
		expect(wrapper.find('button[type="submit"]').attributes("disabled")).toBeUndefined();
		expect(await submitted(wrapper)).toEqual({ title: "mix", limit: 5 });

		await wrapper.setProps({ issues: [{ path: ["limit"], message: "still wrong" }] });
		expect(wrapper.find('button[type="submit"]').attributes("disabled")).toBeDefined();
	});

	test("refills when the stored value arrives after the form is shown", async () => {
		const wrapper = render(leaves);
		await wrapper.setProps({ value: { title: "late" } });
		expect((wrapper.find('[name="title"]').element as HTMLInputElement).value).toBe("late");
	});

	test("renders nothing for an empty object", () => {
		expect(
			render(form(z.object({})))
				.find("form")
				.exists(),
		).toBe(false);
	});
});
