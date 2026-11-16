import { join } from "node:path";
import { type EncryptionKey, resolveEncryptionKey } from "@ultrasonics/db";
import { z } from "zod";
import { type IpRange, parseIpRange } from "./ip-range.ts";

/** ADR-0015 §2: `oauth` stays a valid value; Phase 1 refuses to boot with it. */
export const AuthSource = z.enum(["bootstrapped", "proxy", "oauth"]);
export type AuthSource = z.infer<typeof AuthSource>;

/** The sources Phase 1 boots with. */
export type BootableAuthSource = Exclude<AuthSource, "oauth">;

/** Named apart from {@link V1_DATABASE_FILE}, which shares the data directory under Docker. */
export const DATABASE_FILE = "ultrasonics-v2.db";

/** Where v1 keeps its database, which the importer reads and never changes (ADR-0017 §1). */
export const V1_DATABASE_FILE = "ultrasonics.db";

// Phase 5 must lock down `PUT /api/services/:service/client` before lifting this refusal: under
// `oauth`, any hosted account could replace the operator's client for everyone.
export const HOSTED_LOGIN_REFUSAL =
	"AUTH_SOURCE=oauth is not available yet: hosted login arrives with the hosted tier. Use bootstrapped or proxy.";

export interface Configuration {
	encryptionKey: EncryptionKey;
	authSource: BootableAuthSource;
	trustedProxies: IpRange[];
	proxyUserHeader: string;
	dataDir: string;
	databasePath: string;
	port: number;
}

/** One setting boot cannot accept, with what the operator should do about it. */
export interface ConfigurationProblem {
	setting: string;
	message: string;
}

export type ConfigurationResult =
	| { ok: true; configuration: Configuration }
	| { ok: false; problems: ConfigurationProblem[] };

const AUTH_SOURCE_CHOICES = `Set AUTH_SOURCE to one of:
  bootstrapped  no login: whoever reaches the app is its owner. For a trusted network.
  proxy         a reverse proxy in front (Authelia, Authentik) logs people in; set TRUSTED_PROXIES too.`;

/**
 * Parses the environment before anything else happens (ADR-0015 §1). Every problem is collected,
 * so a first run needs one restart, not one per setting.
 */
export async function parseConfiguration(
	env: Record<string, string | undefined>,
	defaults: { dataDir: string },
): Promise<ConfigurationResult> {
	const problems: ConfigurationProblem[] = [];
	/** A setting's value, with blank read as unset. */
	const setting = (name: string) => env[name]?.trim() || undefined;
	const dataDir = setting("DATA_DIR") ?? defaults.dataDir;
	const databasePath = join(dataDir, DATABASE_FILE);

	const key = await resolveEncryptionKey(env.ENCRYPTION_KEY, databasePath);
	if (!key.ok) {
		problems.push({
			setting: "ENCRYPTION_KEY",
			message: `${key.error.message}. It encrypts your service credentials at rest. Set it to this freshly generated key:
  ENCRYPTION_KEY=${key.error.freshKey}
or to "auto" to keep a key file beside the database, which a backup of the data directory then carries with it.`,
		});
	}

	const authSource = AuthSource.safeParse(setting("AUTH_SOURCE"));
	if (!authSource.success) {
		problems.push({
			setting: "AUTH_SOURCE",
			message: `${setting("AUTH_SOURCE") === undefined ? "AUTH_SOURCE is not set" : `AUTH_SOURCE "${env.AUTH_SOURCE}" is not a session source`}. ${AUTH_SOURCE_CHOICES}`,
		});
	} else if (authSource.data === "oauth") {
		problems.push({ setting: "AUTH_SOURCE", message: HOSTED_LOGIN_REFUSAL });
	}

	const trustedProxies: IpRange[] = [];
	const proxyEntries = (env.TRUSTED_PROXIES ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");
	const unparsed = proxyEntries.filter((entry) => {
		const range = parseIpRange(entry);
		if (range) trustedProxies.push(range);
		return !range;
	});
	if (unparsed.length > 0) {
		problems.push({
			setting: "TRUSTED_PROXIES",
			message: `TRUSTED_PROXIES must be comma-separated addresses or CIDRs; these are neither: ${unparsed.join(", ")}`,
		});
	} else if (authSource.data === "proxy" && trustedProxies.length === 0) {
		problems.push({
			setting: "TRUSTED_PROXIES",
			message:
				"AUTH_SOURCE=proxy needs TRUSTED_PROXIES: your reverse proxy's own address, such as 172.30.0.2 in compose.proxy.yaml. Name that one address, not its subnet, and publish no port of ultrasonics' own: anything else that can reach the port from a trusted address is let in as the owner.",
		});
	}

	const port = z.coerce
		.number()
		.int()
		.min(0)
		.max(65_535)
		.safeParse(env.PORT ?? "5000");
	if (!port.success) {
		problems.push({ setting: "PORT", message: `PORT must be a port number, not "${env.PORT}"` });
	}

	if (
		problems.length > 0 ||
		!key.ok ||
		!port.success ||
		!authSource.success ||
		authSource.data === "oauth"
	) {
		return { ok: false, problems };
	}
	return {
		ok: true,
		configuration: {
			encryptionKey: key.key,
			authSource: authSource.data,
			trustedProxies,
			proxyUserHeader: setting("PROXY_USER_HEADER") ?? "Remote-User",
			dataDir,
			databasePath,
			port: port.data,
		},
	};
}
