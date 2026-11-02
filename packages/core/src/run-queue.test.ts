import { describe, expect, test } from "bun:test";
import type { RunTrigger } from "@ultrasonics/db";
import { createRunQueue } from "./run-queue.ts";

/** A `start` whose runs the test settles by hand, recording the trigger each was started with. */
function manualStart() {
	const started: RunTrigger[] = [];
	const settlers: { resolve(): void; reject(error: Error): void }[] = [];
	const start = (trigger: RunTrigger) => {
		started.push(trigger);
		return new Promise<void>((resolve, reject) => settlers.push({ resolve, reject }));
	};
	return { start, started, settlers };
}

/** Lets the queue's settle handlers run. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createRunQueue", () => {
	test("an idle applet starts at once", () => {
		const queue = createRunQueue();
		const job = manualStart();

		expect(queue.state("a")).toBe("idle");
		expect(queue.submit("a", "manual", job.start)).toBe("started");
		expect(job.started).toEqual(["manual"]);
		expect(queue.state("a")).toBe("running");
	});

	test("a running applet queues one run and absorbs further triggers, keeping the first", async () => {
		const queue = createRunQueue();
		const job = manualStart();
		queue.submit("a", "manual", job.start);

		expect(queue.submit("a", "webhook", job.start)).toBe("queued");
		expect(queue.state("a")).toBe("queued");
		expect(queue.submit("a", "schedule", job.start)).toBe("queued");
		expect(job.started).toEqual(["manual"]);

		job.settlers[0]?.resolve();
		await settled();
		expect(job.started).toEqual(["manual", "webhook"]);
		expect(queue.state("a")).toBe("running");

		job.settlers[1]?.resolve();
		await settled();
		expect(job.started).toEqual(["manual", "webhook"]);
		expect(queue.state("a")).toBe("idle");
	});

	test("the pending run starts after a rejection too, with the start it was submitted with", async () => {
		const queue = createRunQueue();
		const first = manualStart();
		const second = manualStart();
		queue.submit("a", "manual", first.start);
		queue.submit("a", "webhook", second.start);

		first.settlers[0]?.reject(new Error("boom"));
		await settled();

		expect(second.started).toEqual(["webhook"]);
		expect(queue.state("a")).toBe("running");
	});

	test("a start that throws synchronously still frees the applet", async () => {
		const queue = createRunQueue();
		queue.submit("a", "manual", () => {
			throw new Error("boom");
		});
		await settled();

		expect(queue.state("a")).toBe("idle");
	});

	test("different applets never wait on each other", () => {
		const queue = createRunQueue();
		const job = manualStart();
		queue.submit("a", "manual", job.start);

		expect(queue.submit("b", "schedule", job.start)).toBe("started");
		expect(job.started).toEqual(["manual", "schedule"]);
		expect(queue.state("a")).toBe("running");
		expect(queue.state("b")).toBe("running");
	});
});
