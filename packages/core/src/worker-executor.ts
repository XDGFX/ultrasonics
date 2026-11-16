import { type HostPort, LogEntry, type RunPayload } from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import {
	describeError,
	type ExecutionResult,
	type PluginExecutor,
	type RegistryEntry,
} from "./plugin-executor.ts";

/** How a credentials request settled. A rejection, such as an `AuthFailure`, crosses as itself. */
export type CredentialsReply = { ok: true; value: unknown } | { ok: false; reason: unknown };

/** What the host sends the plugin worker. Only the host sends these, so the worker trusts them. */
export type ToWorker =
	| { kind: "run"; path: string; payload: RunPayload }
	| { kind: "credentials"; id: number; reply: CredentialsReply };

/**
 * Everything the plugin worker may send. Parsed, since the plugin's own code shares its thread and
 * its `postMessage`: a plugin could forge a result, which the runner then validates (ADR-0021).
 */
const FromWorker = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("result"),
		result: z.discriminatedUnion("ok", [
			z.object({ ok: z.literal(true), value: z.unknown() }),
			z.object({ ok: z.literal(false), message: z.string() }),
		]),
	}),
	z.object({ kind: z.literal("crashed"), message: z.string() }),
	z.object({ kind: z.literal("credentials"), id: z.number() }),
	z.object({ kind: z.literal("log"), entry: LogEntry }),
]);
export type FromWorker = z.infer<typeof FromWorker>;

const pluginWorker = new URL("./plugin-worker.ts", import.meta.url).href;

/** The most plugin workers running at once, server-wide: about 60 MB of live workers (ADR-0031). */
export const WORKER_CAP = 4;

/** Resolves when `deadlineMs` arrives, or never once `signal` aborts. */
export type DeadlineTimer = (deadlineMs: number, signal: AbortSignal) => Promise<void>;

const atDeadline: DeadlineTimer = (deadlineMs, signal) =>
	new Promise((resolve) => {
		const timer = setTimeout(resolve, Math.max(0, deadlineMs - Date.now()));
		signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
	});

export interface WorkerExecutorOptions {
	/** The most workers running at once. A call beyond it waits for a slot, in arrival order. */
	cap?: number;
	/** When a call's deadline arrives; replaceable, to stop a call at a moment the caller picks. */
	deadline?: DeadlineTimer;
}

const TIMED_OUT: ExecutionResult = {
	ok: false,
	message: "The plugin was still running at the run's deadline",
	timedOut: true,
};

/**
 * Runs each handler call in its own web `Worker`, loading the plugin from the entry's resolved
 * `path` (ADR-0031). A fresh worker per call means no module state outlives a call, so none can
 * cross between accounts. A call still running at the payload's `deadlineMs` is stopped and settles
 * as timed out, and no more than the cap run at once.
 */
export class WorkerExecutor implements PluginExecutor {
	readonly #cap: number;
	readonly #deadline: DeadlineTimer;
	#running = 0;
	/** Calls waiting for a slot, oldest first. */
	readonly #waiting: (() => void)[] = [];

	constructor({ cap = WORKER_CAP, deadline = atDeadline }: WorkerExecutorOptions = {}) {
		this.#cap = cap;
		this.#deadline = deadline;
	}

	run(entry: RegistryEntry, payload: RunPayload, host: HostPort): Promise<ExecutionResult> {
		return new Promise((resolve) => {
			const listening = new AbortController();
			const { signal } = listening;
			let worker: Worker | undefined;
			let holdsSlot = false;
			let settled = false;

			/**
			 * Settles the call once; the worker's later messages are dropped (ADR-0031, mitigation 1) and
			 * its stop is never awaited (ADR-0010).
			 */
			const settle = (result: ExecutionResult) => {
				if (settled) return;
				settled = true;
				listening.abort();
				worker?.terminate();
				if (holdsSlot) this.#release();
				else this.#abandon(start);
				resolve(result);
			};
			const fail = (message: string) => settle({ ok: false, message });
			const crashed = (what: string) => fail(`The plugin crashed: ${what}`);

			const answerCredentials = async (id: number) => {
				let reply: CredentialsReply;
				try {
					reply = { ok: true, value: await host.credentials() };
				} catch (reason) {
					reply = { ok: false, reason };
				}
				if (settled) return;
				try {
					worker?.postMessage({ kind: "credentials", id, reply } satisfies ToWorker);
				} catch (error) {
					fail(`Could not pass the plugin its credentials: ${describeError(error)}`);
				}
			};

			/** Runs the call once it holds a slot, unless its deadline passed while it waited. */
			const start = () => {
				holdsSlot = true;
				if (Date.now() >= payload.deadlineMs) return settle(TIMED_OUT);
				try {
					worker = new Worker(pluginWorker, { ref: false });
				} catch (error) {
					return fail(`Could not start the plugin's worker: ${describeError(error)}`);
				}
				worker.addEventListener(
					"message",
					(event: MessageEvent) => {
						const parsed = FromWorker.safeParse(event.data);
						if (!parsed.success)
							return fail(
								`The plugin sent a message the host does not accept: ${kindOf(event.data)}`,
							);
						const message = parsed.data;
						switch (message.kind) {
							case "result":
								return settle(message.result);
							case "crashed":
								return crashed(message.message);
							case "credentials":
								void answerCredentials(message.id);
								return;
							case "log":
								host.log(message.entry);
								return;
						}
					},
					{ signal },
				);
				// The plugin side reports a crash itself; these catch one it could not report.
				worker.addEventListener(
					"error",
					(event: ErrorEvent) => crashed(event.message || "an uncaught error"),
					{ signal },
				);
				worker.addEventListener(
					"messageerror",
					() => fail("The plugin sent a message that could not be read"),
					{ signal },
				);
				worker.addEventListener(
					"close",
					(event: CloseEvent) =>
						fail(`The plugin exited with code ${event.code} before returning a result`),
					{ signal },
				);
				worker.postMessage({ kind: "run", path: entry.path, payload } satisfies ToWorker);
			};

			void this.#deadline(payload.deadlineMs, signal).then(() => settle(TIMED_OUT));
			this.#acquire(start);
		});
	}

	#acquire(start: () => void): void {
		if (this.#running < this.#cap) {
			this.#running++;
			start();
		} else this.#waiting.push(start);
	}

	/** Hands a settled call's slot to the oldest waiting call, or frees it. */
	#release(): void {
		const next = this.#waiting.shift();
		if (next) next();
		else this.#running--;
	}

	/** Drops a call that settled while it waited. */
	#abandon(start: () => void): void {
		const index = this.#waiting.indexOf(start);
		if (index !== -1) this.#waiting.splice(index, 1);
	}
}

/** Names what an unparseable message was, without echoing a payload of any size. */
function kindOf(data: unknown): string {
	const kind = typeof data === "object" && data !== null && "kind" in data ? data.kind : undefined;
	return typeof kind === "string" ? `"${kind.slice(0, 100)}"` : typeof data;
}
