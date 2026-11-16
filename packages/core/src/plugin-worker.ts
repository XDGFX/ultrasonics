// The plugin's side of the `WorkerExecutor`: the module each worker loads first. It imports the
// plugin from its resolved path, rebuilds the run context with the SDK's harness, runs one handler
// and posts the result (ADR-0010 §4).
import {
	createRunContext,
	type HostPort,
	type Plugin,
	type RunPayload,
} from "@ultrasonics/plugin-sdk";
import { describeError } from "./plugin-executor.ts";
import type { CredentialsReply, FromWorker, ToWorker } from "./worker-executor.ts";

declare const self: Worker;

const send = (message: FromWorker) => postMessage(message);

const waiting = new Map<number, (reply: CredentialsReply) => void>();
let nextId = 0;

/** The host port as the plugin sees it: credentials as request and reply, log fire-and-forget. */
const port: HostPort = {
	credentials: () =>
		new Promise((resolve, reject) => {
			const id = nextId++;
			waiting.set(id, (reply) => {
				if (reply.ok) resolve(reply.value);
				else reject(reply.reason);
			});
			send({ kind: "credentials", id });
		}),
	log: (entry) => send({ kind: "log", entry }),
};

async function run(path: string, payload: RunPayload): Promise<void> {
	try {
		const plugin = ((await import(path)) as { default: Plugin }).default;
		const handler = plugin.run[payload.component];
		if (!handler) throw new Error(`No ${payload.component} handler`);
		const context = createRunContext(payload, port, { declaresAuth: plugin.auth !== undefined });
		send({ kind: "result", result: { ok: true, value: await handler(context) } });
	} catch (error) {
		send({ kind: "result", result: { ok: false, message: describeError(error) } });
	}
}

// An uncaught throw or a floating rejection ends the worker; say what it was before it does.
self.addEventListener("error", (event: ErrorEvent) => {
	send({ kind: "crashed", message: describeError(event.error ?? event.message) });
});

self.addEventListener("message", (event: MessageEvent<ToWorker>) => {
	const message = event.data;
	if (message.kind === "run") {
		void run(message.path, message.payload);
		return;
	}
	waiting.get(message.id)?.(message.reply);
	waiting.delete(message.id);
});
