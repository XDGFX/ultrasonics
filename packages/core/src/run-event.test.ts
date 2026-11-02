import { expectTypeOf, test } from "bun:test";
import type { FinishedRunStatus as StoredFinishedRunStatus } from "@ultrasonics/db";
import type { FinishedRunStatus } from "./run-event.ts";

test("an end event's status is a status the runs table can store", () => {
	// Checked by the type-check, not at run time.
	expectTypeOf<FinishedRunStatus>().toEqualTypeOf<StoredFinishedRunStatus>();
});
