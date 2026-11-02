<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { type AppletListing, type PluginInfo, useApi } from "./api-client.ts";
import AppShell from "./AppShell.vue";
import { formatWhen } from "./clock.ts";
import { queuedMessage, useRunNow } from "./run-now.ts";
import { sentence } from "./sentence.ts";

type Status = AppletListing["state"] | NonNullable<AppletListing["lastRun"]>["status"] | "never-run";

const glyphs: Record<Exclude<Status, "idle">, string> = {
	succeeded: "✓",
	partial: "◐",
	failed: "✗",
	interrupted: "↯",
	"never-run": "·",
	running: "⟳",
	queued: "⋯",
};

const api = useApi();
const router = useRouter();
const applets = ref<AppletListing[]>([]);
const catalogue = ref<PluginInfo[]>([]);
const confirming = ref<AppletListing | null>(null);

async function load() {
	[applets.value, catalogue.value] = await Promise.all([api.applets.list(), api.plugins()]);
}
onMounted(load);

const running = computed(() => applets.value.filter((applet) => applet.state === "running").length);

function statusOf(applet: AppletListing): Exclude<Status, "idle"> {
	if (applet.state !== "idle") return applet.state;
	return applet.lastRun?.status ?? "never-run";
}

function nextKind(applet: AppletListing): "scheduled" | "webhook" | "manual" {
	if (applet.nextRunAt !== null) return "scheduled";
	return applet.hasWebhook ? "webhook" : "manual";
}

function nextRun(applet: AppletListing): string {
	const kind = nextKind(applet);
	if (kind === "scheduled" && applet.nextRunAt !== null) return formatWhen(applet.nextRunAt);
	return kind === "webhook" ? "on webhook" : "manual";
}

const { runNow, queued } = useRunNow();
async function run(applet: AppletListing) {
	await runNow(applet.id);
	if (queued.value) await load();
}

async function remove(applet: AppletListing) {
	confirming.value = null;
	await api.applets.delete(applet.id);
	await load();
	if (applets.value.length === 0) await router.replace({ name: "first-run" });
}
</script>

<template>
	<AppShell :crumbs="[{ label: 'applets' }]">
		<template #actions>
			<p v-if="queued" class="queued muted" role="status" data-queued>{{ queuedMessage }}</p>
			<RouterLink :to="{ name: 'new-applet' }" class="btn primary">new applet</RouterLink>
		</template>

		<p class="heading"><span class="key">applets:</span> <span class="muted count" :data-count="applets.length" :data-running="running">{{ applets.length }} · {{ running }} running</span></p>

		<div v-for="applet in applets" :key="applet.id" class="row" :data-applet="applet.id">
			<RouterLink
				v-if="applet.lastRun"
				class="st"
				:data-status="statusOf(applet)"
				:to="{ name: 'run', params: { id: applet.lastRun.id } }"
				:title="`${statusOf(applet)} · open the last run`"
				>{{ glyphs[statusOf(applet)] }}</RouterLink
			>
			<span v-else class="st" :data-status="statusOf(applet)" title="never run">{{ glyphs[statusOf(applet)] }}</span>
			<span class="tag-cell"><span class="tag" :data-enabled="applet.enabled">{{ applet.name }}</span></span>
			<span class="sum"
				><span v-for="(part, index) in sentence(applet, catalogue)" :key="index" :class="part.kind">{{ part.text }}</span></span
			>
			<span class="times">
				<template v-if="applet.state === 'running'">
					<span class="pill running">running</span>
					<span class="progress" role="progressbar" aria-label="running"></span>
				</template>
				<template v-else>
					<span v-if="applet.state === 'queued'" class="pill queued">queued</span>
					<span :data-last="applet.lastRun ? 'ran' : 'never'">last {{ applet.lastRun ? formatWhen(applet.lastRun.at) : "never" }}</span>
					<span :data-next="nextKind(applet)">next {{ nextRun(applet) }}</span>
				</template>
			</span>
			<span class="acts">
				<button type="button" title="run now" @click="run(applet)">▶</button>
				<RouterLink :to="{ name: 'builder', params: { id: applet.id } }" title="edit">✎</RouterLink>
				<button type="button" class="del" title="delete" @click="confirming = applet">×</button>
			</span>
		</div>

		<p class="foot"><b>ultrasonics</b> by <span class="accent">XDGFX</span>. do more with your music.</p>

		<div v-if="confirming" class="scrim">
			<div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-delete">
				<p id="confirm-delete">delete {{ confirming.name }} and its runs?</p>
				<p class="muted">this can't be undone.</p>
				<div class="dialog-actions">
					<button type="button" class="btn cancel" @click="confirming = null">cancel</button>
					<button type="button" class="btn danger confirm" @click="remove(confirming)">delete</button>
				</div>
			</div>
		</div>
	</AppShell>
</template>

<style scoped>
.heading { display: flex; align-items: baseline; gap: 12px; margin: 0 0 18px; }
.row { grid-template-columns: 34px auto 1fr auto auto; }
.st { justify-content: center; background: var(--surface-1); color: var(--fg); text-decoration: none; }
.st[data-status="succeeded"] { color: var(--accent); }
.st[data-status="failed"] { color: var(--bad); }
.st[data-status="partial"], .st[data-status="queued"] { color: var(--warn); }
.st[data-status="running"] { color: var(--accent); }
.tag-cell { padding: 0; }
.tag { height: 100%; display: flex; align-items: center; padding: 4px 10px; background: var(--accent); color: var(--accent-fg); white-space: nowrap; }
.tag[data-enabled="false"] { background: #4a4a4a; color: #ddd; }
.sum { display: block; align-self: center; color: #cfcfcf; line-height: 1.5; }
.sum .plugin { color: var(--accent); }
.sum .trigger { color: var(--p2); }
.times { flex-direction: column; align-items: flex-end; justify-content: center; gap: 2px; color: var(--muted); font-size: 11px; }
.progress { width: 120px; margin-top: 4px; }
.acts { gap: 2px; padding: 0; }
.acts a, .acts button { padding: 8px 10px; color: #fff; background: none; border: 0; text-decoration: none; }
.acts a:hover { background: var(--accent); color: var(--accent-fg); }
.acts .del:hover { background: var(--p2); color: #fff; }
.queued { margin: 0; }
.foot { text-align: center; color: var(--muted); padding: 30px 0; }
.foot b { color: #fff; font-weight: 400; }
.scrim { position: fixed; inset: 0; display: grid; place-items: center; background: rgb(0 0 0 / 0.6); }
.dialog { min-width: 320px; padding: 20px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-1); }
.dialog p { margin: 0 0 8px; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
