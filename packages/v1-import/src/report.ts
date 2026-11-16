import type { ManualEdit } from "./mapping.ts";

/** Where the report file goes, inside the data directory. */
export const REPORT_FILE = "v1-import-report.md";

/**
 * What one import did and could not do (ADR-0017 §6). Every string comes from the `applets` blobs
 * or from the importer itself, never from a `plugins` row, which holds credentials.
 */
export interface Report {
	importedAt: number;
	timeZone: string;
	firstInstalledAs: string | undefined;
	imported: { name: string; notes: string[] }[];
	skipped: { name: string; reason: string; config: string }[];
	reconnect: string[];
	apiKeys: string[];
	webhooks: string[];
	/** Applets whose v1 time trigger became a schedule. */
	scheduled: string[];
	/** Schedules that changed on the way, such as a rounded count. */
	schedules: { applet: string; note: string }[];
	manualEdits: (ManualEdit & { applet: string })[];
	pluginSettings: string[];
	schemaFailures: { where: string; path: string; message: string }[];
}

export function emptyReport(
	header: Pick<Report, "importedAt" | "timeZone" | "firstInstalledAs">,
): Report {
	return {
		...header,
		imported: [],
		skipped: [],
		reconnect: [],
		apiKeys: [],
		webhooks: [],
		scheduled: [],
		schedules: [],
		manualEdits: [],
		pluginSettings: [],
		schemaFailures: [],
	};
}

/** A code fence longer than any run of backticks in `text`, so the text cannot close it. */
function fenced(text: string): string {
	const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
	const fence = "`".repeat(longest + 1);
	return `${fence}\n${text}\n${fence}`;
}

const code = (text: string) => (text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``);

function section(title: string, intro: string | undefined, lines: string[]): string[] {
	if (lines.length === 0) return [];
	return [`## ${title}`, "", ...(intro ? [intro, ""] : []), ...lines, ""];
}

/** The report as Markdown, readable without the app. Empty sections are left out. */
export function renderReport(report: Report): string {
	const when = new Date(report.importedAt).toISOString().replace("T", " ").slice(0, 16);
	return [
		"# v1 import report",
		"",
		`Imported from ultrasonics v1 on ${when} UTC.${report.firstInstalledAs ? ` That install was first set up as ${report.firstInstalledAs}.` : ""}`,
		"",
		`${report.imported.length} applet${report.imported.length === 1 ? "" : "s"} imported, ${report.skipped.length} skipped.${report.imported.length > 0 ? " Imported applets are disabled: reconnect your services and check each applet before you enable it." : ""}`,
		"",
		...section(
			"Imported applets",
			undefined,
			report.imported.flatMap(({ name, notes }) => [
				`- **${name}**`,
				...notes.map((note) => `  - ${note}`),
			]),
		),
		...section(
			"Skipped applets",
			"These were not imported. Each is shown with its v1 settings, so you can rebuild it by hand.",
			report.skipped.flatMap(({ name, reason, config }) => [
				`### ${name}`,
				"",
				reason,
				"",
				fenced(config),
				"",
			]),
		),
		...section(
			"Services to reconnect",
			"v1's credentials for these cannot work in v2. Connect each again under Services.",
			report.reconnect.map((service) => `- ${service}`),
		),
		...section(
			"API keys to supply",
			"v1 used the ultrasonics-api proxy's keys for these. Add your own under Services.",
			report.apiKeys.map((service) => `- ${service}`),
		),
		...section(
			"Webhooks dropped",
			"These applets had a v1 webhook trigger. A v2 webhook needs a new secret: create one on the applet.",
			report.webhooks.map((applet) => `- ${applet}`),
		),
		...(report.scheduled.length > 0
			? [
					"## Schedules",
					"",
					`${report.scheduled.length} applet${report.scheduled.length === 1 ? "" : "s"} kept a v1 time trigger as a schedule, in the time zone ${report.timeZone}.`,
					"",
					...report.schedules.map(({ applet, note }) => `- ${applet}: ${note}`),
					"",
				]
			: []),
		...section(
			"Filters that need a manual edit",
			"v2 filters by name with `*` and `?` wildcards. These v1 patterns don't convert, so edit each filter.",
			report.manualEdits.map(
				({ applet, pattern, reason }) => `- ${applet}: ${code(pattern)}. ${reason}`,
			),
		),
		...section(
			"Plugin settings",
			undefined,
			report.pluginSettings.map((line) => `- ${line}`),
		),
		...section(
			"Settings that failed their plugin's checks",
			"These were imported anyway. Open each one's form to fix it.",
			report.schemaFailures.map(
				({ where, path, message }) =>
					`- ${where}: ${code(path || "(the whole value)")}: ${message}`,
			),
		),
	]
		.join("\n")
		.trimEnd()
		.concat("\n");
}

/** The boot log's one line about the import. */
export function summaryOf(report: Report, reportPath: string): string {
	return `Imported ${report.imported.length} applet${report.imported.length === 1 ? "" : "s"} from v1, disabled, and skipped ${report.skipped.length}. The report is at ${reportPath}.`;
}
