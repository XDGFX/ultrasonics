import { describe, expect, test } from "bun:test";
import type { Applet, PluginInfo, Schedule } from "./api-client.ts";
import { sentence, sentenceText } from "./sentence.ts";

const plugin = (name: string, service?: PluginInfo["service"]): PluginInfo => ({
	name,
	description: "",
	version: "2.0.0",
	components: ["inputs"],
	mode: ["playlists"],
	...(service ? { service } : {}),
	instanceSettings: {},
});
const catalogue = [
	plugin("spotify", "spotify"),
	plugin("discover weekly", "spotify"),
	plugin("local files"),
	plugin("deduplicate"),
	plugin("shuffle"),
	plugin("plex", "plex"),
];
const slot = (name: string) => ({ plugin: name, settings: {} });

const applet = (overrides: Partial<Applet> = {}): Applet => ({
	id: "a1",
	name: "weekly",
	enabled: true,
	definition: {
		inputs: [slot("discover weekly")],
		modifiers: [slot("deduplicate")],
		outputs: [slot("plex")],
	},
	schedule: null,
	hasWebhook: false,
	...overrides,
});

const every = (unit: Schedule["unit"], count: number, anchor: string): Schedule => ({
	kind: "interval",
	unit,
	count,
	anchor,
	timeZone: "Australia/Sydney",
});

describe("the sentence", () => {
	test("reads a daily schedule, an input's service, a modifier and an output", () => {
		const daily = applet({ schedule: every("day", 1, "2026-11-01T07:00:00") });
		expect(sentenceText(sentence(daily, catalogue))).toBe(
			"when every day at 07:00, take discover weekly from spotify, deduplicate it, and put it in plex",
		);
	});

	test("reads an interval of several units from its anchor date", () => {
		const fortnightly = applet({ schedule: every("week", 2, "2026-11-01T03:00:00") });
		expect(sentenceText(sentence(fortnightly, catalogue))).toStartWith(
			"when every 2 weeks from 01 nov at 03:00,",
		);
	});

	test("reads a single hour or week from its anchor", () => {
		expect(
			sentenceText(sentence(applet({ schedule: every("hour", 1, "2026-11-05T09:30:00") }), [])),
		).toStartWith("when every hour from 05 nov at 09:30,");
		expect(
			sentenceText(sentence(applet({ schedule: every("week", 1, "2026-12-25T18:00:00") }), [])),
		).toStartWith("when every week from 25 dec at 18:00,");
	});

	test("reads a webhook alone, and joined to a schedule with 'or'", () => {
		expect(sentenceText(sentence(applet({ hasWebhook: true }), catalogue))).toStartWith(
			"when on webhook,",
		);
		const both = applet({ hasWebhook: true, schedule: every("day", 1, "2026-11-01T07:00:00") });
		expect(sentenceText(sentence(both, catalogue))).toStartWith(
			"when every day at 07:00 or on webhook,",
		);
	});

	test("reads an applet with no trigger as manual only", () => {
		expect(sentenceText(sentence(applet(), catalogue))).toStartWith("manual only: take");
	});

	test("joins several plugins in a column with commas and 'and'", () => {
		const many = applet({
			definition: {
				inputs: [slot("discover weekly"), slot("local files"), slot("spotify")],
				modifiers: [slot("deduplicate"), slot("shuffle")],
				outputs: [slot("plex"), slot("local files")],
			},
		});
		expect(sentenceText(sentence(many, catalogue))).toBe(
			"manual only: take discover weekly, local files and spotify, deduplicate and shuffle it, and put it in plex and local files",
		);
	});

	test("leaves out the services when no input uses one, and a modifier clause when there are none", () => {
		const plain = applet({
			definition: { inputs: [slot("local files")], modifiers: [], outputs: [slot("plex")] },
		});
		expect(sentenceText(sentence(plain, catalogue))).toBe(
			"manual only: take local files, and put it in plex",
		);
	});

	test("tags plugins and triggers so they can be coloured", () => {
		const parts = sentence(applet({ hasWebhook: true }), catalogue);
		expect(parts.filter((part) => part.kind === "trigger").map((part) => part.text)).toEqual([
			"on webhook",
		]);
		expect(parts.filter((part) => part.kind === "plugin").map((part) => part.text)).toEqual([
			"discover weekly",
			"deduplicate",
			"plex",
		]);
	});
});
