<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { type PluginInfo, type RunSummary, useApi } from "./api-client.ts";
import AppShell from "./AppShell.vue";
import { formatClock, formatDuration, formatWhen } from "./clock.ts";
import QueuedNote from "./QueuedNote.vue";
import { useRunNow } from "./run-now.ts";
import {
	emptyRunView,
	foldRunEvent,
	headline,
	matched,
	type StageView,
} from "./run-view-state.ts";

const props = defineProps<{ id: string }>();
const api = useApi();
const { runNow, queued } = useRunNow();

const summary = ref<RunSummary | null>(null);
const catalogue = ref<PluginInfo[]>([]);
const state = ref(emptyRunView());

// Aborting a superseded or unmounted follow closes its stream, so it folds nothing more.
let following = new AbortController();
async function follow(id: string) {
	following.abort();
	const { signal } = (following = new AbortController());
	state.value = emptyRunView();
	queued.value = false;
	const [run, plugins] = await Promise.all([api.runs.get(id), api.plugins()]);
	if (signal.aborted) return;
	summary.value = run;
	catalogue.value = plugins;
	for await (const event of api.runs.events(id, signal)) {
		if (signal.aborted) return;
		state.value = foldRunEvent(state.value, event);
	}
}
watch(() => props.id, follow, { immediate: true });
onBeforeUnmount(() => following.abort());

const serviceOf = (plugin: string) => catalogue.value.find((info) => info.name === plugin)?.service;
const title = computed(() => `run ${props.id} · ${headline(state.value, serviceOf)}`);

const took = computed(() =>
	summary.value && state.value.lastAt !== null
		? formatDuration(state.value.lastAt - summary.value.startedAt)
		: "—",
);

const stageMark = (stage: StageView) => {
	if (!stage.finished) return "⟳";
	return stage.finished.error ? "✗" : "✓";
};
/** The previous stage's songs out, unless it was an output, which emits nothing. */
const flowInto = (index: number) => {
	const previous = state.value.stages[index - 1];
	if (!previous || previous.component === "outputs") return "";
	const counts = previous.finished;
	return counts ? `${counts.songs} songs · ${counts.playlists} playlists` : "…";
};

const rejections = computed(() => state.value.stages.flatMap((stage) => stage.rejections));
const cappedStages = computed(() => state.value.stages.filter((stage) => stage.notShown > 0));
const playlistLabel = (playlist: number, name?: string) => name ?? `playlist ${playlist + 1}`;
</script>

<template>
	<AppShell :crumbs="[{ label: 'applets', to: { name: 'applets' } }, { label: `run ${id}` }]">
		<template #actions>
			<QueuedNote v-if="queued" />
			<button v-if="summary" type="button" class="btn run-now" @click="runNow(summary.appletId)">
				▶ run again
			</button>
		</template>

		<div class="run">
			<h2>{{ title }}</h2>
			<p class="kv">
				<span><span class="key">status:</span> <span class="status" :data-status="state.status">{{ state.status }}</span></span>
				<span data-trigger><span class="key">by:</span> {{ summary?.trigger ?? "…" }}</span>
				<span data-started><span class="key">at:</span> {{ summary ? formatWhen(summary.startedAt) : "…" }}</span>
				<span data-took><span class="key">took:</span> {{ took }}</span>
			</p>

			<div class="flow">
				<template v-for="(stage, index) in state.stages" :key="`${stage.component}-${stage.index}`">
					<span v-if="index > 0" class="wire">{{ flowInto(index) }}</span>
					<div class="stage" :data-component="stage.component">
						<p class="head">
							<span class="mark" :data-failed="Boolean(stage.finished?.error)">{{ stageMark(stage) }}</span>
							<span class="plugin">{{ stage.plugin }}</span>
						</p>
						<p class="muted">{{ stage.component }}</p>
						<p v-if="stage.finished?.rejected" class="warn" data-rejected>{{ stage.finished.rejected }} rejected</p>
						<template v-if="stage.finished?.error">
							<p class="error">{{ stage.finished.error.code }}: {{ stage.finished.error.message }}</p>
							<RouterLink
								v-if="stage.finished.error.auth"
								class="btn reconnect"
								:to="{ name: 'wizard', params: { service: stage.finished.error.auth.service } }"
								>reconnect {{ stage.finished.error.auth.service }}</RouterLink
							>
						</template>
					</div>
				</template>
			</div>

			<section v-for="result in state.results" :key="result.index" class="output" :data-output="result.index">
				<h3><span class="key">output:</span> {{ result.plugin }}</h3>
				<p v-if="!result.outcome.ok" class="error">{{ result.outcome.error.code }}: {{ result.outcome.error.message }}</p>
				<table v-else>
					<thead>
						<tr><th>playlist</th><th>result</th><th>matched</th><th>unmatched</th><th>reason</th></tr>
					</thead>
					<tbody>
						<tr v-for="playlist in result.outcome.playlists" :key="playlist.playlist">
							<td class="playlist">{{ playlist.playlistName }}</td>
							<td :data-result="playlist.status" class="result">{{ playlist.status }}</td>
							<td class="matched">
								{{ playlist.status === "written" ? matched(playlist) : "—" }} of {{ playlist.supplied }}
							</td>
							<td class="unmatched muted">
								<template v-if="playlist.status === 'written'">{{
									playlist.unmatchedSongs.map((song) => `${song.title} — ${song.artists.join(", ")}`).join(" · ")
								}}</template>
							</td>
							<td class="reason muted">
								<template v-if="playlist.status !== 'written'">{{ playlist.code }}: {{ playlist.message }}</template>
							</td>
						</tr>
					</tbody>
				</table>
			</section>

			<section class="rejections">
				<template v-if="rejections.length === 0 && cappedStages.length === 0"><span class="key">rejected:</span> none</template>
				<template v-else>
					<p><span class="key">rejected:</span></p>
					<ul>
						<li v-for="rejection in rejections" :key="rejection.seq">
							{{ rejection.plugin }} ({{ rejection.component }}) · {{ playlistLabel(rejection.playlist, rejection.playlistName) }}<template v-if="rejection.song !== undefined">
								· {{ rejection.songTitle ?? `song ${rejection.song + 1}` }}</template
							>: {{ rejection.issues.map((issue) => issue.message).join("; ") }}
						</li>
					</ul>
					<p v-for="stage in cappedStages" :key="`${stage.component}-${stage.index}`" class="muted" data-not-shown>
						{{ stage.plugin }} ({{ stage.component }}): {{ stage.notShown }} not shown
					</p>
				</template>
			</section>
		</div>

		<div class="console" role="log" aria-label="run log">
			<div v-for="line in state.log" :key="line.seq" :data-level="line.level" class="line"><span class="ts">{{ formatClock(line.at) }}</span> {{ line.level }} {{ line.source }} {{ line.text }}</div>
		</div>
	</AppShell>
</template>

<style scoped>
h2 { margin: 0 0 8px; font-size: 20px; font-weight: 500; }
.kv { display: flex; flex-wrap: wrap; gap: 18px; margin: 0 0 20px; }
.status[data-status="succeeded"] { color: var(--accent); }
.status[data-status="partial"], .status[data-status="running"] { color: var(--warn); }
.status[data-status="failed"] { color: var(--bad); }
.flow { display: flex; flex-wrap: wrap; align-items: center; gap: 0; margin-bottom: 24px; }
.stage { width: 176px; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-1); }
.stage p { margin: 0 0 4px; }
.head { display: flex; gap: 8px; }
.mark { color: var(--accent); }
.mark[data-failed="true"] { color: var(--bad); }
.wire { padding: 0 10px; color: var(--accent); font-size: 11px; border-bottom: 2px solid var(--line); }
.warn { color: var(--warn); }
.error { color: var(--bad); }
.reconnect { margin-top: 6px; border-color: var(--p2); color: var(--p2); text-decoration: none; }
.output h3 { font-size: 13px; font-weight: 400; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 400; font-size: 12px; }
.result[data-result="written"] { color: var(--accent); }
.result[data-result="skipped"] { color: var(--warn); }
.result[data-result="failed"] { color: var(--bad); }
.rejections { margin: 20px 0 240px; }
.rejections ul { margin: 0; padding-left: 18px; }
.console { position: fixed; right: 0; bottom: 0; left: 56px; height: 220px; overflow: auto; padding: 10px 16px; border-top: 1px solid var(--line); background: #08090b; font-size: 12px; }
.line { white-space: pre-wrap; color: var(--muted); }
.line[data-level="warn"] { color: var(--warn); }
.line[data-level="error"] { color: var(--bad); }
.line[data-level="debug"] { color: #5a5a5a; }
.ts { color: var(--p2); }
</style>
