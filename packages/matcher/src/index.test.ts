import { expect, test } from "bun:test";
import * as matcher from "@ultrasonics/matcher";

test("the package offers match, bestMatch and the length veto, and nothing else at runtime", () => {
	expect(Object.keys(matcher).sort()).toEqual(["bestMatch", "lengthVetoMs", "match"]);
});
