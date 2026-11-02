<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { type ServiceStatus, useApi } from "./api-client.ts";
import AppShell from "./AppShell.vue";

const api = useApi();
const services = ref<ServiceStatus[]>([]);
onMounted(async () => {
	services.value = await api.services.list();
});

const steps = computed(() => {
	const all = [
		...services.value.map((service) => ({
			key: service.service,
			label: `connect ${service.service}`,
			detail: `for ${service.usedBy.join(", ")}`,
			action: "connect",
			to: { name: "wizard", params: { service: service.service } },
			done: service.status.kind === "connected",
		})),
		{
			key: "applet",
			label: "make an applet",
			detail: "when …, take …, put it in …",
			action: "new applet",
			to: { name: "new-applet" },
			done: false,
		},
	];
	const next = all.findIndex((step) => !step.done);
	return all.map((step, index) => ({ ...step, current: index === next }));
});
</script>

<template>
	<AppShell :crumbs="[{ label: 'welcome' }]">
		<div class="first-run">
			<p class="wordmark hero">ultrasonics</p>
			<p class="muted tagline">do more with your music.</p>
			<p class="welcome">welcome. this ultrasonics is yours — nothing to log in to.</p>
			<ol class="steps">
				<li
					v-for="(step, index) in steps"
					:key="step.key"
					class="row"
					:class="{ current: step.current, done: step.done }"
					:data-step="step.key"
					:data-done="step.done"
					:aria-current="step.current ? 'step' : undefined"
				>
					<span class="st">{{ step.done ? "✓" : index + 1 }}</span>
					<span class="what">{{ step.label }} <span class="muted">· {{ step.detail }}</span></span>
					<span class="acts"><RouterLink :to="step.to">{{ step.action }}</RouterLink></span>
				</li>
			</ol>
		</div>
	</AppShell>
</template>

<style scoped>
.first-run { max-width: 640px; margin: 0 auto; padding-top: 24px; }
.hero { font-size: 56px; text-align: center; margin: 0 0 8px; }
.tagline { text-align: center; margin: 0; }
.welcome { text-align: center; margin: 28px 0; }
.steps { list-style: none; margin: 0; padding: 0; }
.row { grid-template-columns: 34px 1fr auto; }
.row:not(.current) { opacity: 0.55; }
.row.done { opacity: 0.8; }
.row .what { display: block; align-self: center; }
.row .st { justify-content: center; color: var(--p2); background: var(--surface-1); }
.row .acts { padding: 0; }
.row .acts a { padding: 8px 12px; color: #fff; text-decoration: none; }
.row .acts a:hover { background: var(--accent); color: var(--accent-fg); }
.row.done .st { color: var(--accent); }
.row.current .acts a { background: var(--accent); color: var(--accent-fg); }
</style>
