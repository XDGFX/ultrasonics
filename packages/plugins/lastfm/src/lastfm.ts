import { defineAuth, definePlugin, type Log, type TestResult } from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import { inputSettings } from "./input-settings.ts";
import { grantFields, LastfmClient, LastfmError, pluginVersion } from "./lastfm-client.ts";
import { readHistory } from "./listening-history.ts";

export interface LastfmPluginOptions {
	/** The API root: `https://ws.audioscrobbler.com/2.0/`, or a fake's in tests. */
	apiBase: string;
	/** How pacing and rate-limit waits are spent; tests pass one that advances a fake clock. */
	sleep?: (ms: number) => Promise<void>;
	/** The clock that paces requests and places a `recent` window, in epoch milliseconds. */
	now?: () => number;
}

/** `chart.getTopArtists` needs only a key, so `test()` can ask it with no username. */
const ChartAnswer = z.object({ artists: z.object({}) });

/**
 * The Last.fm plugin against one API, so tests can point it at a fake (spec #185). It reads public
 * listening history with the user's own API key: no session key or shared secret.
 */
export function createLastfmPlugin(options: LastfmPluginOptions) {
	const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms));
	const now = options.now ?? (() => Date.now());
	const client = (apiKey: string, log: Log) =>
		new LastfmClient({ apiBase: options.apiBase, apiKey, log, sleep, now });
	return definePlugin({
		name: "lastfm",
		description: "Reads your listening history from Last.fm. Powered by AudioScrobbler.",
		version: pluginVersion,
		mode: ["songs"],
		auth: defineAuth({ service: "lastfm", flow: "token", fields: grantFields }),
		instanceSettings: { inputs: inputSettings },
		run: {
			async inputs(ctx) {
				const { apiKey } = await ctx.auth.get();
				return readHistory(client(apiKey, ctx.log), ctx.instance, now(), ctx.log);
			},
		},
		async test(ctx): Promise<TestResult> {
			const { apiKey } = await ctx.auth.get();
			try {
				await client(apiKey, ctx.log).call(ChartAnswer, "chart.getTopArtists", { limit: "1" });
				return { ok: true };
			} catch (error) {
				if (!(error instanceof LastfmError)) throw error;
				if (error.code === "key-refused") {
					return { ok: false, code: "invalid-credentials", message: error.message };
				}
				const code = error.code === "unreachable" ? "unreachable" : "misconfigured";
				return { ok: false, code, message: error.message };
			}
		},
	});
}
