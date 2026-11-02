import type { Applet, PluginInfo, Schedule } from "./api-client.ts";
import { months } from "./clock.ts";

/** Plugins are coloured teal and triggers magenta wherever the sentence is shown. */
export interface SentencePart {
	kind: "text" | "plugin" | "trigger";
	text: string;
}

function describeSchedule({ unit, count, anchor }: Schedule): string {
	const [date = "", time = ""] = anchor.split("T");
	const [, month = "1", day = "1"] = date.split("-");
	const clock = time.slice(0, 5);
	if (unit === "day" && count === 1) return `every day at ${clock}`;
	const every = count === 1 ? `every ${unit}` : `every ${count} ${unit}s`;
	return `${every} from ${day} ${months[Number(month) - 1]} at ${clock}`;
}

/** `a`, `a and b`, `a, b and c`, each item a part of its own kind; "…" holds an empty column's place. */
function list(items: string[], kind: SentencePart["kind"], conjunction = "and"): SentencePart[] {
	if (items.length === 0) return [text("…")];
	return items.flatMap((item, index) => {
		if (index === 0) return [{ kind, text: item }];
		const separator = index === items.length - 1 ? ` ${conjunction} ` : ", ";
		return [text(separator), { kind, text: item }];
	});
}

const text = (value: string): SentencePart => ({ kind: "text", text: value });

/** An applet as "when <trigger>, take <inputs> from <services>, <modifiers> it, and put it in <outputs>". */
export function sentence(
	applet: Pick<Applet, "definition" | "schedule" | "hasWebhook">,
	catalogue: PluginInfo[],
): SentencePart[] {
	const { inputs, modifiers, outputs } = applet.definition;
	const triggers = [
		...(applet.schedule ? [describeSchedule(applet.schedule)] : []),
		...(applet.hasWebhook ? ["on webhook"] : []),
	];
	const inputNames = inputs.map((slot) => slot.plugin);
	// A service already named by an input reads twice ("spotify from spotify"), so it is left out.
	const services = [
		...new Set(
			inputs.flatMap(
				(slot) => catalogue.find((plugin) => plugin.name === slot.plugin)?.service ?? [],
			),
		),
	].filter((service) => !inputNames.includes(service));

	return [
		...(triggers.length === 0
			? [{ kind: "trigger" as const, text: "manual only" }, text(": take ")]
			: [text("when "), ...list(triggers, "trigger", "or"), text(", take ")]),
		...list(inputNames, "plugin"),
		...(services.length > 0 ? [text(" from "), ...list(services, "text")] : []),
		...(modifiers.length > 0
			? [
					text(", "),
					...list(
						modifiers.map((slot) => slot.plugin),
						"plugin",
					),
					text(" it"),
				]
			: []),
		text(", and put it in "),
		...list(
			outputs.map((slot) => slot.plugin),
			"plugin",
		),
	];
}

export function sentenceText(parts: SentencePart[]): string {
	return parts.map((part) => part.text).join("");
}
