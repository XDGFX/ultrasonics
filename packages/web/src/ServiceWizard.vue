<script setup lang="ts">
import type { AuthRequirement, JSONSchema, Service, ValidationIssue } from "@ultrasonics/plugin-sdk";
import { computed, ref, watch } from "vue";
import { type LocationQuery, useRoute, useRouter } from "vue-router";
import { type ConnectOutcome, type ServiceStatus, useApi } from "./api-client.ts";
import AppShell from "./AppShell.vue";
import CopyValue from "./CopyValue.vue";
import SettingsForm from "./SettingsForm.vue";

// Driven by the flow and the requirement list alone, never by the service's name (ADR-0025 §6).

const props = defineProps<{ service: string }>();
const service = computed(() => props.service as Service);
const api = useApi();
const route = useRoute();
const router = useRouter();

const status = ref<ServiceStatus>();
const requirements = ref<AuthRequirement[]>([]);
const redirectUri = ref("");
const clientForm = ref<JSONSchema>();
const fieldIssues = ref<ValidationIssue[]>([]);
const clientIssues = ref<ValidationIssue[]>([]);
const outcome = ref<ConnectOutcome>();

async function load() {
	const [statuses, needed] = await Promise.all([
		api.services.list(),
		api.services.requirements(service.value),
	]);
	status.value = statuses.find((entry) => entry.service === service.value);
	requirements.value = needed;
	if (needed.some((requirement) => requirement.kind === "client")) {
		[redirectUri.value, clientForm.value] = await Promise.all([
			api.services.redirectUri(service.value),
			api.services.clientForm(service.value),
		]);
	}
}

const callbackOf = (query: LocationQuery): Record<string, string> =>
	Object.fromEntries(
		Object.entries(query).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])),
	);

// The OAuth return lands on this route with the outcome in its query.
watch(
	[service, () => route.query],
	async ([, query]) => {
		const callback = callbackOf(query);
		if (callback.code !== undefined || callback.error !== undefined) {
			outcome.value = await api.services.outcome(service.value, callback);
			// A code is single-use, so a reload must not send it again.
			await router.replace({ query: {} });
		}
		await load();
	},
	{ immediate: true },
);

const detail = computed(() => {
	const current = status.value?.status;
	if (!current) return "";
	if (current.kind === "failed") return current.failure.message;
	return current.kind === "connected" ? "connected" : "not connected";
});

async function testAndSave(input: Record<string, unknown>) {
	const result = await api.services.configure(service.value, input);
	if (result.kind === "invalid") {
		fieldIssues.value = result.issues;
	} else if (result.kind === "test-failed") {
		fieldIssues.value = [{ path: [], message: result.message }];
	} else {
		fieldIssues.value = [];
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
	// An in-app path (the fake's) stays in the router; a service's page is a full navigation.
	if (authoriseUrl.startsWith("/") && !authoriseUrl.startsWith("//")) await router.push(authoriseUrl);
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

			<p v-if="outcome" class="outcome" :class="outcome.kind" role="status" data-outcome>
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
							<p class="muted">{{ service }} asks you to approve; you come straight back here.</p>
							<button type="button" class="btn primary" data-connect @click="connect">connect</button>
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
.steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.step { display: grid; grid-template-columns: 34px 1fr; gap: 12px; padding: 14px; border-radius: var(--radius); background: var(--surface-3); }
.step .n { color: var(--p2); }
.what { display: grid; gap: 10px; }
.what p { margin: 0; }
</style>
