<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { type RouteLocationRaw, useRoute } from "vue-router";
import { useApi } from "./api-client.ts";

export interface Crumb {
	label: string;
	to?: RouteLocationRaw;
}

defineProps<{ crumbs: Crumb[] }>();

const api = useApi();
const route = useRoute();
const exposed = ref(false);
onMounted(async () => {
	exposed.value = (await api.instance()).exposed;
});

const section = computed(() => route.meta.section);
</script>

<template>
	<div class="shell">
		<nav class="rail" aria-label="main">
			<RouterLink to="/" class="brand" aria-label="ultrasonics">
				<span class="wordmark">ultrasonics</span>
			</RouterLink>
			<RouterLink to="/" class="r" :class="{ on: section === 'applets' }" :data-active="section === 'applets'" title="applets">
				<span aria-hidden="true">▦</span><small>applets</small>
			</RouterLink>
			<RouterLink to="/settings" class="r" :class="{ on: section === 'settings' }" :data-active="section === 'settings'" title="settings">
				<span aria-hidden="true">⚙</span><small>settings</small>
			</RouterLink>
		</nav>
		<div class="main">
			<p v-if="exposed" class="banner" role="status" data-banner="exposed">
				⚠ this instance is reachable from a public address and asks nobody to log in. anyone who
				finds it can use it.
			</p>
			<header class="bar">
				<nav aria-label="breadcrumb">
					<ol class="crumbs">
						<li v-for="(crumb, index) in crumbs" :key="index">
							<RouterLink v-if="crumb.to" :to="crumb.to">{{ crumb.label }}</RouterLink>
							<b v-else>{{ crumb.label }}</b>
						</li>
					</ol>
				</nav>
				<span class="spacer"></span>
				<slot name="actions" />
			</header>
			<div class="body" :class="{ full: !$slots.panel }">
				<main class="content"><div class="centred"><slot /></div></main>
				<aside v-if="$slots.panel" class="panel"><slot name="panel" /></aside>
			</div>
		</div>
	</div>
</template>

<style scoped>
.shell { display: grid; grid-template-columns: 56px 1fr; min-height: 100vh; }
.rail { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 0; border-right: 1px solid var(--line); background: rgb(17 17 17 / 0.9); }
.brand { margin-bottom: 14px; text-decoration: none; }
.brand .wordmark { writing-mode: vertical-rl; transform: rotate(180deg); font-size: 17px; }
.r { width: 48px; padding: 6px 0; border-radius: var(--radius); display: grid; place-items: center; gap: 2px; color: var(--muted); text-decoration: none; }
.r small { font-size: 9px; }
.r:hover, .r.on { background: var(--surface-2); color: var(--fg); }
.main { display: grid; grid-template-rows: auto 48px 1fr; min-width: 0; }
.banner { margin: 0; padding: 8px 16px; border-bottom: 1px solid var(--warn); color: var(--warn); background: var(--surface-1); }
.bar { grid-row: 2; display: flex; align-items: center; gap: 8px; padding: 0 16px; border-bottom: 1px solid var(--line); background: rgb(17 17 17 / 0.85); }
.crumbs { display: flex; gap: 8px; margin: 0; padding: 0; list-style: none; color: var(--muted); }
.crumbs li + li::before { content: "›"; margin-right: 8px; }
.crumbs a { color: var(--muted); text-decoration: none; }
.crumbs a:hover { color: var(--fg); }
.crumbs b { color: var(--accent); font-weight: 400; }
.spacer { flex: 1; }
.body { grid-row: 3; display: grid; grid-template-columns: 1fr 340px; min-height: 0; }
.body.full { grid-template-columns: 1fr; }
.content { min-width: 0; padding: 40px 28px; }
.centred { max-width: 1100px; margin: 0 auto; }
.panel { border-left: 1px solid var(--line); padding: 16px; background: rgb(21 21 21 / 0.95); overflow: auto; }
</style>
