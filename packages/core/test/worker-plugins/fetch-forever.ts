// A fixture plugin for the worker soak: its input fetches a URL that never finishes, and logs
// `IN_FETCH` once the request is under way, so the soak can stop it mid-request.
import { definePlugin } from "@ultrasonics/plugin-sdk";
import { z } from "zod";

export const IN_FETCH = "in-fetch";

export default definePlugin({
	name: "fetch-forever",
	description: "A fixture plugin caught inside a fetch that never finishes",
	version: "1.0.0",
	mode: ["playlists"],
	instanceSettings: {
		inputs: z.object({ url: z.string(), mode: z.enum(["hang", "stream"]) }),
	},
	run: {
		async inputs(ctx) {
			const { url, mode } = ctx.instance;
			if (mode === "hang") {
				const response = fetch(url);
				ctx.log.info(IN_FETCH);
				await response;
			} else {
				const reader = (await fetch(url)).body?.getReader();
				let first = true;
				while (reader && !(await reader.read()).done) {
					if (first) ctx.log.info(IN_FETCH);
					first = false;
				}
			}
			throw new Error("the fetch finished, which it never should");
		},
	},
});
