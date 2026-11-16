// A prototype WorkerExecutor's plugin side: loads a plugin by its registry path and runs one handler
// per message, answering the host port over postMessage (ADR-0010 §4). Reusable, so it serves both
// worker-per-run and a warm worker.
import {
	createRunContext,
	type HostPort,
	type Plugin,
	type RunPayload,
} from "@ultrasonics/plugin-sdk";

declare const self: Worker;

export type ToWorker =
	| { kind: "run"; path: string; payload: RunPayload }
	| { kind: "credentials"; id: number; value: unknown }
	| { kind: "ping"; data: unknown };
export type FromWorker =
	| { kind: "result"; ok: true; value: unknown }
	| { kind: "result"; ok: false; message: string }
	| { kind: "credentials"; id: number }
	| { kind: "log"; level: string; message: string }
	| { kind: "pong"; data: unknown }
	| { kind: "ready" };

const pending = new Map<number, (value: unknown) => void>();
let nextId = 0;
const send = (message: FromWorker) => postMessage(message);

const port: HostPort = {
	credentials: () =>
		new Promise((resolve) => {
			const id = nextId++;
			pending.set(id, resolve);
			send({ kind: "credentials", id });
		}),
	log: (entry) => send({ kind: "log", level: entry.level, message: entry.message }),
};

self.onmessage = async (event: MessageEvent<ToWorker>) => {
	const message = event.data;
	if (message.kind === "ping") return send({ kind: "pong", data: message.data });
	if (message.kind === "credentials") {
		pending.get(message.id)?.(message.value);
		pending.delete(message.id);
		return;
	}
	try {
		const plugin = ((await import(message.path)) as { default: Plugin }).default;
		const handler = plugin.run[message.payload.component];
		if (!handler) throw new Error(`No ${message.payload.component} handler`);
		const context = createRunContext(message.payload, port, {
			declaresAuth: plugin.auth !== undefined,
		});
		send({ kind: "result", ok: true, value: await handler(context) });
	} catch (error) {
		send({
			kind: "result",
			ok: false,
			message: error instanceof Error ? error.message : String(error),
		});
	}
};
send({ kind: "ready" });
