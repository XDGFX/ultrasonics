import type { OpenDatabase } from "@ultrasonics/db";
import {
	createTestContext,
	issuesOf,
	type Plugin,
	type Service,
	TestResult,
} from "@ultrasonics/plugin-sdk";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
	type ConfigureResult,
	type ConnectOutcome,
	JsonBody,
	OAuthCallback,
	type RedirectUri,
	ServiceParams,
	type ServiceStatus,
} from "./api.ts";
import type { AppEnv } from "./app-env.ts";
import { createLocalAuthProvider } from "./auth/local-auth-provider.ts";
import type { Catalogue, CatalogueService } from "./catalogue.ts";
import { notFound } from "./error-response.ts";
import type { Logger } from "./logger.ts";
import { operatorSettings } from "./operator-settings.ts";
import { pluginConfigDir } from "./plugin-config-dir.ts";
import { requestOrigin } from "./request-source.ts";
import { jsonBody, pathParams } from "./validation.ts";

export interface ServiceRouteDeps {
	db: OpenDatabase;
	catalogue: Catalogue;
	dataDir: string;
	logger: Logger;
}

/** Service auth: status, requirements, the operator's client, token test-and-save, and OAuth. */
export function serviceRoutes(deps: ServiceRouteDeps) {
	const { db, catalogue, dataDir, logger } = deps;
	const operator = operatorSettings(db);
	const providerFor = (accountId: string) =>
		createLocalAuthProvider(db.storeFor(accountId), operator, catalogue.services.keys());
	const serviceOf = (service: Service): CatalogueService =>
		catalogue.services.get(service) ?? notFound(`A plugin using the service ${service}`);
	/** The service's declared spec, and the provider bound to the session's account. */
	const bound = async (service: Service, accountId: string) => ({
		...serviceOf(service),
		provider: await providerFor(accountId),
	});

	/**
	 * Runs the first declaring plugin's `test()` with the candidate credentials, before anything is
	 * stored (spec #134, decision 3). A throw means the plugin is broken: a `500` naming it.
	 */
	const testCandidate = async (
		accountId: string,
		service: CatalogueService,
		candidate: unknown,
	): Promise<TestResult | undefined> => {
		const tester = service.usedBy
			.map((name) => catalogue.plugins.get(name))
			.find((plugin): plugin is Plugin & Required<Pick<Plugin, "test">> => !!plugin?.test);
		if (!tester) return undefined;
		const raw = await db.storeFor(accountId).pluginSettings.get(tester.name);
		const persistent = tester.persistentSettings?.safeParse(raw ?? {}) ?? {
			success: true as const,
			data: {},
		};
		if (!persistent.success) {
			return {
				ok: false,
				code: "misconfigured",
				message: `Fix ${tester.name}'s settings before connecting: ${issuesOf(persistent.error)
					.map((issue) => issue.message)
					.join("; ")}`,
			};
		}
		const context = createTestContext(
			{
				persistent: persistent.data as Record<string, unknown>,
				configDir: await pluginConfigDir(dataDir, accountId, tester.name),
			},
			{
				credentials: async () => candidate,
				log: (entry) =>
					logger[entry.level === "debug" ? "info" : entry.level](
						`${tester.name} test: ${entry.message}`,
					),
			},
			{ declaresAuth: true },
		);
		let result: unknown;
		try {
			result = await tester.test(context);
		} catch (error) {
			logger.error(`${tester.name}'s test() threw`, error);
			throw new HTTPException(500, {
				message: `The ${tester.name} plugin is broken: its connection test threw`,
			});
		}
		const parsed = TestResult.safeParse(result);
		if (!parsed.success) {
			throw new HTTPException(500, {
				message: `The ${tester.name} plugin is broken: its connection test returned no result`,
			});
		}
		return parsed.data;
	};

	return new Hono<AppEnv>()
		.get("/", async (c) => {
			const provider = await providerFor(c.var.session.accountId);
			const statuses: ServiceStatus[] = [];
			for (const [service, declared] of catalogue.services) {
				statuses.push({
					service,
					flow: declared.spec.flow,
					status: await provider.status(declared.spec),
					usedBy: [...declared.usedBy],
				});
			}
			return c.json(statuses);
		})
		.get("/:service/requirements", pathParams(ServiceParams), async (c) => {
			const { spec, provider } = await bound(c.req.valid("param").service, c.var.session.accountId);
			return c.json(provider.requirements(spec));
		})
		.get("/:service/redirect-uri", pathParams(ServiceParams), async (c) => {
			const { spec, provider } = await bound(c.req.valid("param").service, c.var.session.accountId);
			return c.json({
				redirectUri: provider.redirectUri(spec, requestOrigin(c)),
			} satisfies RedirectUri);
		})
		.get("/:service/client-form", pathParams(ServiceParams), async (c) => {
			const { spec, provider } = await bound(c.req.valid("param").service, c.var.session.accountId);
			return c.json(provider.clientForm(spec));
		})
		.put("/:service/client", pathParams(ServiceParams), jsonBody(JsonBody), async (c) => {
			const { spec, provider } = await bound(c.req.valid("param").service, c.var.session.accountId);
			const issues = await provider.registerClient(spec, c.req.valid("json"));
			return issues.length > 0 ? c.json({ issues }, 422) : c.body(null, 204);
		})
		.post("/:service/configure", pathParams(ServiceParams), jsonBody(JsonBody), async (c) => {
			const { accountId } = c.var.session;
			const declared = serviceOf(c.req.valid("param").service);
			const { spec } = declared;
			if (spec.flow !== "token") {
				return c.json({ message: `${spec.service} does not take pasted credentials` }, 400);
			}
			const parsed = spec.fields.safeParse(c.req.valid("json"));
			if (!parsed.success) {
				const invalid: ConfigureResult = { kind: "invalid", issues: issuesOf(parsed.error) };
				return c.json(invalid, 422);
			}
			const tested = await testCandidate(accountId, declared, parsed.data);
			if (tested && !tested.ok) {
				const failed: ConfigureResult = { kind: "test-failed", message: tested.message };
				return c.json(failed);
			}
			const provider = await providerFor(accountId);
			await provider.configure(spec, c.req.valid("json"));
			const saved: ConfigureResult = { kind: "saved" };
			return c.json(saved);
		})
		.post("/:service/begin", pathParams(ServiceParams), async (c) => {
			const { spec, provider } = await bound(c.req.valid("param").service, c.var.session.accountId);
			return c.json(await provider.begin(spec));
		})
		.post("/:service/complete", pathParams(ServiceParams), jsonBody(OAuthCallback), async (c) => {
			const { spec, provider } = await bound(c.req.valid("param").service, c.var.session.accountId);
			await provider.complete(spec, c.req.valid("json"));
			return c.json({ kind: "connected" } satisfies ConnectOutcome);
		});
}
