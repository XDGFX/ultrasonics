<script setup lang="ts">
import type { ValidationIssue } from "@ultrasonics/plugin-sdk";
import { computed, onMounted, ref } from "vue";
import { type PluginInfo, type ServiceStatus, useApi } from "./api-client.ts";
import AppShell from "./AppShell.vue";
import SettingsForm from "./SettingsForm.vue";
import { statusDetail, wizardAction } from "./service-status.ts";

const api = useApi();
const services = ref<ServiceStatus[]>([]);
const catalogue = ref<PluginInfo[]>([]);
onMounted(async () => {
	[services.value, catalogue.value] = await Promise.all([api.services.list(), api.plugins()]);
});

const configurable = computed(() => catalogue.value.filter((plugin) => plugin.persistentSettings));

const editing = ref<{ plugin: PluginInfo; value: unknown; issues: ValidationIssue[]; saved: boolean }>();

async function edit(plugin: PluginInfo) {
	const stored = await api.settings.get(plugin.name);
	editing.value = { plugin, ...stored, saved: false };
}

async function save(value: Record<string, unknown>) {
	const current = editing.value;
	if (!current) return;
	const result = await api.settings.save(current.plugin.name, value);
	current.issues = result.ok ? [] : result.issues;
	current.saved = result.ok;
}
</script>

<template>
	<AppShell :crumbs="[{ label: 'settings' }]">
		<h3 class="key">services:</h3>
		<div v-for="entry in services" :key="entry.service" class="row" :data-service="entry.service">
			<span class="st" :data-status="entry.status.kind">{{ entry.status.kind === "connected" ? "✓" : "✗" }}</span>
			<span class="tag-cell"
				><span class="tag" :data-needs-action="entry.status.kind !== 'connected'">{{ entry.service }}</span></span
			>
			<span class="muted">{{ statusDetail(entry.status) }} · used by {{ entry.usedBy.join(", ") }}</span>
			<span class="acts">
				<RouterLink :to="{ name: 'wizard', params: { service: entry.service } }" :title="`connect ${entry.service}`">{{
					wizardAction[entry.status.kind]
				}}</RouterLink>
			</span>
		</div>

		<h3 class="key">plugins:</h3>
		<div v-for="plugin in configurable" :key="plugin.name" class="row plugin" :data-plugin="plugin.name">
			<span class="what"><b>{{ plugin.name }}</b>&nbsp;<span class="muted">· {{ plugin.description }}</span></span>
			<span class="acts"><button type="button" title="edit settings" @click="edit(plugin)">✎</button></span>
		</div>

		<template v-if="editing" #panel>
			<h3><span class="key">plugin:</span> {{ editing.plugin.name }}</h3>
			<SettingsForm
				v-if="editing.plugin.persistentSettings"
				:key="editing.plugin.name"
				:schema="editing.plugin.persistentSettings"
				:value="editing.value"
				:issues="editing.issues"
				@submit="save"
			/>
			<p v-if="editing.saved" class="accent" role="status" data-saved>saved.</p>
		</template>
	</AppShell>
</template>

<style scoped>
h3 { font-weight: 400; margin: 0 0 12px; }
h3.key:not(:first-child) { margin-top: 28px; }
.row { grid-template-columns: 34px auto 1fr auto; }
.row.plugin { grid-template-columns: 1fr auto; }
.st { justify-content: center; background: var(--surface-1); }
.tag-cell { padding: 0; }
.tag { height: 100%; display: flex; align-items: center; padding: 4px 10px; background: var(--accent); color: var(--accent-fg); }
.tag[data-needs-action="true"] { background: var(--p2); color: #fff; }
.acts { padding: 0; }
.acts a, .acts button { padding: 8px 12px; color: #fff; background: none; border: 0; text-decoration: none; }
.acts a:hover, .acts button:hover { background: var(--accent); color: var(--accent-fg); }
</style>
