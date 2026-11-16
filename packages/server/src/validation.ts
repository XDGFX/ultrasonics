import { zValidator } from "@hono/zod-validator";
import { issuesOf } from "@ultrasonics/plugin-sdk";
import { z } from "zod";

/** A JSON body parsed with `schema`; a mismatch is `422` with its issues by path. */
export const jsonBody = <T extends z.ZodType>(schema: T) =>
	zValidator("json", schema, (result, c) => {
		if (!result.success)
			return c.json({ issues: issuesOf(new z.ZodError(result.error.issues)) }, 422);
	});

/** Path parameters parsed with `schema`; one that names nothing, such as an unknown service, is `404`. */
export const pathParams = <T extends z.ZodType>(schema: T) =>
	zValidator("param", schema, (result, c) => {
		if (!result.success) return c.json({ message: "Not found" }, 404);
	});
