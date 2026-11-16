import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OpenDatabase } from "@ultrasonics/db";
import { v1ImportStore } from "@ultrasonics/db/v1-import";
import type { Plugin } from "@ultrasonics/plugin-sdk";
import { MAPPINGS, type Mapping } from "./mapping.ts";
import { planImport } from "./plan.ts";
import { emptyReport, REPORT_FILE, renderReport, summaryOf } from "./report.ts";
import { NotV1DatabaseError, readV1Database } from "./v1-database.ts";

/** Where v1's image kept its database, inside the data directory. */
const V1_DATABASE_FILE = "ultrasonics.db";

export interface V1ImportLogger {
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

export interface V1ImportOptions {
	db: OpenDatabase;
	/** The loaded v2 plugins, by name, whose schemas mapped settings are checked against. */
	plugins: ReadonlyMap<string, Plugin>;
	dataDir: string;
	/** Read for `V1_DATABASE` and `TZ`. */
	env: Record<string, string | undefined>;
	authSource: string;
	logger: V1ImportLogger;
	now?: () => number;
}

/** Why the importer would not run, as the boot log puts it. */
const REFUSALS = {
	oauth: "AUTH_SOURCE is oauth, and the hosted tier never imports",
	"several-accounts": "the install has more than one account",
	"no-account": "the install has no account",
} as const;
type RefusalReason = keyof typeof REFUSALS;

export type V1ImportOutcome =
	| { kind: "no-v1-database" }
	| { kind: "already-imported" }
	| { kind: "refused"; reason: RefusalReason }
	| { kind: "aborted"; reason: string }
	| { kind: "imported"; imported: number; skipped: number; reportPath: string };

function isTimeZone(zone: string): boolean {
	try {
		new Intl.DateTimeFormat("en-GB", { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

/** {@link importV1} with its mapping table supplied, so tests can map fixture plugins. */
export async function importWith(
	options: V1ImportOptions,
	mappings: readonly Mapping<string>[],
): Promise<V1ImportOutcome> {
	const { logger, env } = options;
	const store = v1ImportStore(options.db);
	if ((await store.marker()) !== undefined) return { kind: "already-imported" };

	const path = env.V1_DATABASE?.trim() || join(options.dataDir, V1_DATABASE_FILE);
	if (!existsSync(path)) return { kind: "no-v1-database" };

	// Self-host has one account and never oauth, so this keeps the hosted tier out (#177 decision 1).
	const [accountId, another] = await store.accountIds();
	const refusal: RefusalReason | undefined =
		options.authSource === "oauth"
			? "oauth"
			: another !== undefined
				? "several-accounts"
				: accountId === undefined
					? "no-account"
					: undefined;
	if (refusal || accountId === undefined) {
		const reason = refusal ?? "no-account";
		logger.warn(`Found v1's database at ${path} but not importing it: ${REFUSALS[reason]}.`);
		return { kind: "refused", reason };
	}

	let v1: ReturnType<typeof readV1Database>;
	try {
		v1 = readV1Database(path);
	} catch (error) {
		if (!(error instanceof NotV1DatabaseError)) throw error;
		logger.error(
			`Not importing ${path}: it is not a v1 ultrasonics database. ${error.message} Boot carries on without an import.`,
		);
		return { kind: "aborted", reason: error.message };
	}

	const zone = env.TZ?.trim() || "UTC";
	const timeZone = isTimeZone(zone) ? zone : "UTC";
	if (timeZone !== zone)
		logger.warn(`TZ "${zone}" is not a time zone, so imported schedules use UTC.`);
	const now = (options.now ?? Date.now)();
	const report = emptyReport({ importedAt: now, timeZone, firstInstalledAs: v1.firstInstalledAs });
	const plan = planImport(v1, { mappings, plugins: options.plugins, now, timeZone }, report);
	const markdown = renderReport(report);
	const written = await store.commit({
		accountId,
		...plan,
		marker: {
			importedAt: now,
			report: { imported: report.imported.length, skipped: report.skipped.length, markdown },
			dismissed: false,
		},
	});
	if (!written) return { kind: "already-imported" };

	const reportPath = join(options.dataDir, REPORT_FILE);
	try {
		writeFileSync(reportPath, markdown);
	} catch (error) {
		logger.error(`The v1 import report could not be written to ${reportPath}: ${String(error)}`);
	}
	const summary = summaryOf(report, reportPath);
	if (report.skipped.length > 0) logger.warn(summary);
	else logger.info(summary);
	return {
		kind: "imported",
		imported: report.imported.length,
		skipped: report.skipped.length,
		reportPath,
	};
}

/**
 * Imports v1's database once, at boot (ADR-0017 §1): after migrations and the account, before the
 * scheduler. It never changes v1's file, and a file it cannot use leaves boot running.
 */
export function importV1(options: V1ImportOptions): Promise<V1ImportOutcome> {
	return importWith(options, MAPPINGS);
}
