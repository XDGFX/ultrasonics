import {
	createRunContext,
	type HostPort,
	type Plugin,
	type RunPayload,
} from "@ultrasonics/plugin-sdk";

/** What one handler call came to. Never a rejection: a throw arrives as `ok: false`. */
export type ExecutionResult = { ok: true; value: unknown } | { ok: false; message: string };

/**
 * Runs one plugin handler across the plugin boundary (ADR-0010 §2). Phase 2's `WorkerExecutor`
 * implements this too, loading the plugin by its registry `path` inside the worker.
 */
export interface PluginExecutor {
	run(plugin: Plugin, payload: RunPayload, host: HostPort): Promise<ExecutionResult>;
}

export function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Calls the handler directly. It catches a throw, but not a floating rejection, `process.exit` or
 * an infinite loop: an accepted risk while every plugin is first-party and reviewed (ADR-0010 §2).
 */
export class InProcessExecutor implements PluginExecutor {
	async run(plugin: Plugin, payload: RunPayload, host: HostPort): Promise<ExecutionResult> {
		const handler = plugin.run[payload.component];
		if (!handler) return { ok: false, message: `No ${payload.component} handler` };
		try {
			const context = createRunContext(payload, host, { declaresAuth: plugin.auth !== undefined });
			return { ok: true, value: await handler(context) };
		} catch (error) {
			return { ok: false, message: describeError(error) };
		}
	}
}
