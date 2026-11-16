<script setup lang="ts">
import type { AuthRequirement, JSONSchema, Service, ValidationIssue } from "@ultrasonics/plugin-sdk";
import { computed, ref, watch } from "vue";
import { type LocationQuery, useRoute, useRouter } from "vue-router";
import { type ConnectOutcome, type ServiceStatus, useApi } from "./api-client.ts";
import AppShell from "./AppShell.vue";
import CopyValue from "./CopyValue.vue";
import SettingsForm from "./SettingsForm.vue";
import { statusDetail } from "./service-status.ts";

// Driven by the flow and the requirement list alone, never by the service's name (ADR-0025 §6).

const props = defineProps<{ service: string }>();
// The router lets only a known service through to this screen.
const service = computed(() => props.service as Service);
const api = useApi();
const route = useRoute();
const router = useRouter();

const status = ref<ServiceStatus>();
const requirements = ref<AuthRequirement[]>([]);
const redirectUri = ref("");
const clientForm = ref<JSONSchema>();
const fieldIssues = ref<ValidationIssue[]>([]);
// Kept apart from field issues: the renderer holds submit back while it shows issues, and a test may pass on retry.
const testFailure = ref<string>();
const clientIssues = ref<ValidationIssue[]>([]);
const outcome = ref<ConnectOutcome>();

async function load() {
	const [statuses, needed] = await Promise.all([
		api.services.list(),
		api.services.requirements(service.value),
	]);
	status.value = statuses.find((entry) => entry.service === service.value);
	requirements.value = needed;
	const kinds = new Set(needed.map((requirement) => requirement.kind));
	if (kinds.has("client") || kinds.has("connect")) {
		redirectUri.value = await api.services.redirectUri(service.value);
	}
	if (kinds.has("client")) clientForm.value = await api.services.clientForm(service.value);
}

const callbackOf = (query: LocationQuery): Record<string, string> =>
	Object.fromEntries(
		Object.entries(query).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])),
	);

/**
 * A loopback redirect URI while the wizard is open on another origin: the service sends the browser
 * to an address that won't load here, so the user pastes it back (spec #136, decision 1).
 */
const pasteBack = computed(() => {
	if (!redirectUri.value) return false;
	const target = new URL(redirectUri.value);
	const loopback = target.hostname === "127.0.0.1" || target.hostname === "[::1]";
	return loopback && target.origin !== window.location.origin;
});
const landed = ref("");
const pasteIssue = ref<string>();

/** The pasted address's query, if it carries the service's answer: a code or an error. */
function pastedCallback(address: string): Record<string, string> | undefined {
	let parsed: URL;
	try {
		parsed = new URL(address.trim());
	} catch {
		return undefined;
	}
	const callback = Object.fromEntries(parsed.searchParams);
	return callback.code !== undefined || callback.error !== undefined ? callback : undefined;
}

async function finishFromPaste() {
	const callback = pastedCallback(landed.value);
	if (!callback) {
		pasteIssue.value = `that isn't the address ${service.value} sent you to: it should start ${redirectUri.value}?`;
		return;
	}
	pasteIssue.value = undefined;
	outcome.value = await api.services.outcome(service.value, callback);
	landed.value = "";
	await load();
}

// The OAuth return lands on this route with the outcome in its query.
watch(
	[service, () => route.query],
	async ([, query]) => {
		const callback = callbackOf(query);
		if (callback.code !== undefined || callback.error !== undefined) {
			outcome.value = await api.services.outcome(service.value, callback);
			// A code is single-use, so a reload must not send it again; the replace loads the wizard.
			await router.replace({ query: {} });
			return;
		}
		await load();
	},
	{ immediate: true },
);

const detail = computed(() => (status.value ? statusDetail(status.value.status) : ""));

async function testAndSave(input: Record<string, unknown>) {
	const result = await api.services.configure(service.value, input);
	if (result.kind === "invalid") {
		fieldIssues.value = result.issues;
		testFailure.value = undefined;
	} else if (result.kind === "test-failed") {
		fieldIssues.value = [];
		testFailure.value = result.message;
	} else {
		fieldIssues.value = [];
		testFailure.value = undefined;
		outcome.value = { kind: "connected" };
		await load();
	}
}

async function saveClient(input: Record<string, unknown>) {
	const result = await api.services.registerClient(service.value, input);
	clientIssues.value = result.ok ? [] : result.issues;
	if (result.ok) await load();
}

async function connect() {
	const { authoriseUrl } = await api.services.begin(service.value);
	// An in-app path (the fake's) stays in the router; a service's page is a full navigation, in a
	// new tab when the user must come back here to paste the address it lands on.
	if (authoriseUrl.startsWith("/") && !authoriseUrl.startsWith("//")) await router.push(authoriseUrl);
	else if (pasteBack.value) window.open(authoriseUrl, "_blank", "noopener");
	else window.location.assign(authoriseUrl);
}
</script>

<template>
	<AppShell :crumbs="[{ label: 'settings', to: { name: 'settings' } }, { label: service }]">
		<div class="wizard">
			<h2>
				<span class="key">connect:</span> {{ service }}
				<span v-if="status" class="muted">· {{ status.flow }} · {{ detail }}</span>
			</h2>

			<p v-if="outcome" class="outcome" :class="outcome.kind" role="status" :data-outcome="outcome.kind">
				<template v-if="outcome.kind === 'connected'">✓ connected.</template>
				<template v-else>✗ couldn't connect: {{ outcome.message }}</template>
			</p>

			<ol v-if="requirements.length > 0" class="steps">
				<li
					v-for="(requirement, index) in requirements"
					:key="requirement.kind"
					class="step"
					:data-requirement="requirement.kind"
				>
					<span class="n">{{ index + 1 }}</span>
					<div class="what">
						<template v-if="requirement.kind === 'fields'">
							<b>enter your {{ service }} details</b>
							<p v-if="testFailure" class="test-failure" role="alert" data-test-failure>{{ testFailure }}</p>
							<SettingsForm
								:schema="requirement.schema"
								:issues="fieldIssues"
								submit-label="test and save"
								@submit="testAndSave"
							/>
						</template>
						<template v-else-if="requirement.kind === 'client'">
							<b>register an app with {{ service }}</b>
							<p class="muted">add this redirect uri to your app:</p>
							<CopyValue :value="redirectUri" />
							<SettingsForm
								v-if="clientForm"
								:schema="clientForm"
								:issues="clientIssues"
								@submit="saveClient"
							/>
						</template>
						<template v-else>
							<b>connect</b>
							<template v-if="pasteBack">
								<p class="muted">
									{{ service }} asks you to approve in a new tab, then sends it to
									<code>{{ redirectUri }}</code>, which won't load from here. that's expected.
								</p>
								<button type="button" class="btn primary" data-connect @click="connect">connect</button>
								<form class="paste" data-paste novalidate @submit.prevent="finishFromPaste">
									<label for="landed">paste the address you landed on:</label>
									<input
										id="landed"
										v-model="landed"
										name="landed"
										type="url"
										autocomplete="off"
										:placeholder="`${redirectUri}?code=…`"
										:class="{ invalid: pasteIssue }"
									/>
									<p v-if="pasteIssue" class="issue">{{ pasteIssue }}</p>
									<button type="submit" class="btn">finish connecting</button>
								</form>
							</template>
							<template v-else>
								<p class="muted">{{ service }} asks you to approve; you come straight back here.</p>
								<button type="button" class="btn primary" data-connect @click="connect">connect</button>
							</template>
						</template>
					</div>
				</li>
			</ol>
			<button v-else type="button" class="btn primary" data-connect @click="connect">connect</button>
		</div>
	</AppShell>
</template>

<style scoped>
.wizard { max-width: 640px; margin: 0 auto; }
h2 { font-size: 16px; font-weight: 400; margin: 0 0 20px; }
.outcome { padding: 10px 12px; border: 1px solid var(--accent); border-radius: var(--radius); }
.outcome.failed { border-color: var(--bad); color: var(--bad); }
.test-failure { margin: 0; padding: 10px 12px; border: 1px solid var(--bad); border-radius: var(--radius); color: var(--bad); }
.steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.step { display: grid; grid-template-columns: 34px 1fr; gap: 12px; padding: 14px; border-radius: var(--radius); background: var(--surface-3); }
.step .n { color: var(--p2); }
.what { display: grid; gap: 10px; }
.what p { margin: 0; }
.what code { color: var(--fg); overflow-wrap: anywhere; }
.paste { display: grid; gap: 6px; justify-items: start; }
.paste input { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg); color: var(--fg); }
.paste input.invalid { border-color: var(--bad); }
.paste .issue { color: var(--bad); font-size: 0.9em; }
</style>
