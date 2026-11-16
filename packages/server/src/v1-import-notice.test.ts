import { describe, expect, test } from "bun:test";
import { V1_IMPORT_MARKER_KEY, type V1ImportMarker } from "@ultrasonics/db";
import { ErrorBody, V1ImportReport } from "./api.ts";
import { bodyOf, CLIENT_ADDRESS_HEADER, type TestApp, useTestApp } from "./test-support.ts";

const testApp = useTestApp();

const marker: V1ImportMarker = {
	importedAt: Date.UTC(2026, 10, 16, 9),
	report: { imported: 3, skipped: 2, markdown: "# ultrasonics v1 import\n\n…" },
	dismissed: false,
};

const seedMarker = (raw: TestApp["raw"], value: unknown) =>
	raw((sqlite) =>
		sqlite
			.query("INSERT INTO instance_settings (key, value) VALUES (?, ?)")
			.run(V1_IMPORT_MARKER_KEY, JSON.stringify(value)),
	);

const storedMarker = (raw: TestApp["raw"]) =>
	raw((sqlite) => {
		const row = sqlite
			.query("SELECT value FROM instance_settings WHERE key = ?")
			.get(V1_IMPORT_MARKER_KEY) as { value: string } | null;
		return row && (JSON.parse(row.value) as unknown);
	});

describe("the v1 import notice", () => {
	test("serves the stored report with its counts", async () => {
		const { call, raw } = await testApp();
		seedMarker(raw, marker);
		const response = await call("GET", "/api/instance/v1-import");
		expect(response.status).toBe(200);
		expect(await bodyOf(response, V1ImportReport.nullable())).toEqual({
			importedAt: marker.importedAt,
			imported: 3,
			skipped: 2,
			markdown: marker.report.markdown,
			dismissed: false,
		});
	});

	test("is null when no import ran", async () => {
		const { call } = await testApp();
		const response = await call("GET", "/api/instance/v1-import");
		expect(await bodyOf(response, V1ImportReport.nullable())).toBeNull();
	});

	test("dismissing keeps the marker, so the import never runs again, and the report stays readable", async () => {
		const { call, raw } = await testApp();
		seedMarker(raw, marker);
		const response = await call("POST", "/api/instance/v1-import/dismiss");
		expect(response.status).toBe(204);

		expect(storedMarker(raw)).toEqual({ ...marker, dismissed: true });
		const after = await bodyOf(
			await call("GET", "/api/instance/v1-import"),
			V1ImportReport.nullable(),
		);
		expect(after).toMatchObject({ dismissed: true, markdown: marker.report.markdown });
	});

	test("dismissing when no import ran is a 404 and writes nothing", async () => {
		const { call, raw } = await testApp();
		const response = await call("POST", "/api/instance/v1-import/dismiss");
		expect(response.status).toBe(404);
		expect(await bodyOf(response, ErrorBody)).toEqual({ message: expect.any(String) });
		expect(storedMarker(raw)).toBeNull();
	});

	test("both routes are behind the session like the rest of the API", async () => {
		const { call, raw } = await testApp({ authSource: "proxy", trustedProxies: ["172.18.0.0/16"] });
		seedMarker(raw, marker);
		const untrusted = { [CLIENT_ADDRESS_HEADER]: "192.168.1.20", "Remote-User": "cal" };
		for (const [method, path] of [
			["GET", "/api/instance/v1-import"],
			["POST", "/api/instance/v1-import/dismiss"],
		] as const) {
			const response = await call(method, path, undefined, untrusted);
			expect({ path, status: response.status }).toEqual({ path, status: 401 });
		}
		expect(storedMarker(raw)).toEqual(marker);
	});
});
