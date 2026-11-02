<script setup lang="ts">
import type { Component, JSONSchema, ValidationIssue } from "@ultrasonics/plugin-sdk";
import { computed, onMounted, reactive, ref, shallowRef, toRaw } from "vue";
import { useRouter } from "vue-router";
import {
	type AppletDefinition,
	type PluginInfo,
	type Schedule,
	type ServiceStatus,
	useApi,
} from "./api-client.ts";
import AppShell from "./AppShell.vue";
import CopyValue from "./CopyValue.vue";
import { defaultsOf, isEmptyForm } from "./form-model.ts";
import QueuedNote from "./QueuedNote.vue";
import { useRunNow } from "./run-now.ts";
import { summarise } from "./slot-summary.ts";
import { scheduleForm, scheduleFormValue, scheduleOf, browserTimeZone, newSchedule } from "./schedule-form.ts";
import { describeSchedule, sentence } from "./sentence.ts";
import SettingsForm from "./SettingsForm.vue";
import { useUnsavedChanges } from "./unsaved-changes.ts";

interface PlacedSlot {
	/** Stable across reordering, so a slot's open form survives a move. */
	key: number;
	plugin: string;
	settings: unknown;
}

type Selection =
	| { kind: "slot"; column: Component; key: number }
	| { kind: "add"; column: Component }
	| { kind: "schedule" }
	| { kind: "webhook" };

const columns: Component[] = ["inputs", "modifiers", "outputs"];
const singular: Record<Component, string> = { inputs: "input", modifiers: "modifier", outputs: "output" };

const props = defineProps<{ id?: string }>();
const api = useApi();
const router = useRouter();

const catalogue = ref<PluginInfo[]>([]);
const services = ref<ServiceStatus[]>([]);
const appletId = ref(props.id);
const name = ref("new applet");
const enabled = ref(true);
const slots = reactive<Record<Component, PlacedSlot[]>>({ inputs: [], modifiers: [], outputs: [] });
const schedule = shallowRef<Schedule | null>(null);
/** The schedule form's issues while what it holds isn't a schedule. */
const scheduleProblem = ref<ValidationIssue[] | null>(null);
const showScheduleIssues = ref(false);
const hasWebhook = ref(false);
/** The hook URL, held only by the builder that generated it (ADR-0018 §5). */
const revealedUrl = ref<string | null>(null);
const issues = ref<ValidationIssue[]>([]);
const selected = ref<Selection | null>(null);
/** The open form's starting value, kept apart from the slot so the form isn't refilled as it emits. */
const panelValue = ref<unknown>();
const savedState = ref("");
const savedSchedule = ref("null");
const loaded = ref(false);
let nextKey = 1;

const toPlaced = (saved: AppletDefinition[Component]): PlacedSlot[] =>
	saved.map(({ plugin, settings }) => ({ key: nextKey++, plugin, settings }));

const stored = (column: Component) =>
	slots[column].map(({ plugin, settings }) => ({ plugin, settings: structuredClone(toRaw(settings)) }));
const definition = (): AppletDefinition => ({
	inputs: stored("inputs"),
	modifiers: stored("modifiers"),
	outputs: stored("outputs"),
});

const state = () =>
	JSON.stringify({ name: name.value, enabled: enabled.value, definition: definition(), schedule: schedule.value });
const dirty = computed(() => loaded.value && (state() !== savedState.value || scheduleProblem.value !== null));

onMounted(async () => {
	const [plugins, statuses, applet] = await Promise.all([
		api.plugins(),
		api.services.list(),
		props.id ? api.applets.get(props.id) : undefined,
	]);
	catalogue.value = plugins;
	services.value = statuses;
	if (applet) {
		name.value = applet.name;
		enabled.value = applet.enabled;
		for (const column of columns) slots[column] = toPlaced(applet.definition[column]);
		schedule.value = applet.schedule;
		hasWebhook.value = applet.hasWebhook;
	}
	markSaved();
	loaded.value = true;
});

function markSaved() {
	savedState.value = state();
	savedSchedule.value = JSON.stringify(schedule.value);
}

const sentenceParts = computed(() =>
	sentence({ definition: definition(), schedule: schedule.value, hasWebhook: hasWebhook.value }, catalogue.value),
);

const pluginOf = (name: string) => catalogue.value.find((plugin) => plugin.name === name);
const schemaOf = (column: Component, placed: PlacedSlot) => pluginOf(placed.plugin)?.instanceSettings[column];

function unconnectedService(placed: PlacedSlot) {
	const service = pluginOf(placed.plugin)?.service;
	if (!service) return undefined;
	const status = services.value.find((entry) => entry.service === service);
	return status?.status.kind === "connected" ? undefined : service;
}

const summaryOf = (column: Component, placed: PlacedSlot) =>
	summarise(placed.settings, schemaOf(column, placed), pluginOf(placed.plugin)?.description ?? "");

/** A save's issues for one slot, with the path made relative to its settings form. */
function issuesOf(column: Component, index: number): ValidationIssue[] {
	return issues.value.flatMap((issue) => {
		const [head, at, settings, ...rest] = issue.path;
		if (head !== column || at !== index) return [];
		return [{ ...issue, path: settings === "settings" ? rest : [] }];
	});
}

const unplaced = computed(() =>
	issues.value.filter((issue) => !columns.includes(issue.path[0] as Component)),
);

const selectedSlot = computed(() => {
	const selection = selected.value;
	if (selection?.kind !== "slot") return undefined;
	const index = slots[selection.column].findIndex((placed) => placed.key === selection.key);
	const placed = slots[selection.column][index];
	return placed ? { column: selection.column, index, placed } : undefined;
});

const isSelected = (column: Component, placed: PlacedSlot) =>
	selected.value?.kind === "slot" && selected.value.column === column && selected.value.key === placed.key;

function selectSlot(column: Component, placed: PlacedSlot) {
	panelValue.value = structuredClone(toRaw(placed.settings));
	selected.value = { kind: "slot", column, key: placed.key };
}

const offers = (column: Component) =>
	catalogue.value.filter((plugin) => plugin.components.includes(column));

function add(column: Component, plugin: PluginInfo) {
	const schema = plugin.instanceSettings[column];
	const placed = { key: nextKey++, plugin: plugin.name, settings: schema ? defaultsOf(schema) : {} };
	slots[column].push(placed);
	issues.value = [];
	selectSlot(column, placed);
}

function move(column: Component, index: number, by: -1 | 1) {
	const list = slots[column];
	const [placed] = list.splice(index, 1);
	if (placed) list.splice(index + by, 0, placed);
	// Issue paths name slots by index, so they no longer point at the right slot.
	issues.value = [];
}

function remove(column: Component, index: number) {
	const [placed] = slots[column].splice(index, 1);
	if (placed && isSelected(column, placed)) selected.value = null;
	issues.value = [];
}

function addSchedule() {
	schedule.value = newSchedule();
	selectSchedule();
}

function selectSchedule() {
	if (schedule.value) panelValue.value = scheduleFormValue(schedule.value);
	selected.value = { kind: "schedule" };
}

function editSchedule(value: Record<string, unknown>) {
	const result = scheduleOf(value);
	if (result.ok) schedule.value = result.schedule;
	scheduleProblem.value = result.ok ? null : result.issues;
}

function removeSchedule() {
	schedule.value = null;
	scheduleProblem.value = null;
	showScheduleIssues.value = false;
	selected.value = null;
}

async function addWebhook() {
	selected.value = { kind: "webhook" };
	if (appletId.value) await generateWebhook(appletId.value);
}

async function generateWebhook(id: string) {
	revealedUrl.value = (await api.triggers.generateWebhook(id)).url;
	hasWebhook.value = true;
}

async function removeWebhook(id: string) {
	await api.triggers.removeWebhook(id);
	hasWebhook.value = false;
	revealedUrl.value = null;
	selected.value = null;
}

async function save() {
	if (scheduleProblem.value) {
		showScheduleIssues.value = true;
		selectSchedule();
		return;
	}
	const draft = { name: name.value, enabled: enabled.value, definition: definition() };
	const result = appletId.value
		? await api.applets.update(appletId.value, draft)
		: await api.applets.create(draft);
	if (!result.ok) {
		issues.value = result.issues;
		return;
	}
	issues.value = [];
	const isNew = appletId.value === undefined;
	appletId.value = result.value.id;
	const scheduled =
		JSON.stringify(schedule.value) === savedSchedule.value
			? undefined
			: await api.triggers.setSchedule(result.value.id, schedule.value);
	if (scheduled?.ok !== false) markSaved();
	if (isNew) await moveTo(result.value.id);
	if (scheduled?.ok === false) {
		scheduleProblem.value = scheduled.issues;
		showScheduleIssues.value = true;
		selectSchedule();
	}
}

/** The applet now exists, so its address moves to it whatever is still unsaved. */
const moving = ref(false);
async function moveTo(id: string) {
	moving.value = true;
	try {
		await router.replace({ name: "builder", params: { id } });
	} finally {
		moving.value = false;
	}
}

const leaving = useUnsavedChanges(computed(() => dirty.value && !moving.value));
const { runNow, queued } = useRunNow();
</script>

<template>
	<AppShell :crumbs="[{ label: 'applets', to: { name: 'applets' } }, { label: name || 'unnamed' }]">
		<template #actions>
			<label class="name">
				<span class="key">name:</span>
				<input v-model="name" name="applet-name" :aria-invalid="issues.some((issue) => issue.path[0] === 'name') || undefined" />
			</label>
			<label class="toggle">
				<input
					type="checkbox"
					role="switch"
					name="applet-enabled"
					:checked="enabled"
					@change="enabled = ($event.target as HTMLInputElement).checked"
				/>
				<span>enabled</span>
			</label>
			<QueuedNote v-if="queued" />
			<button
				v-if="appletId"
				type="button"
				class="btn run-now"
				:disabled="dirty"
				:title="dirty ? 'save first: a run uses the saved applet' : undefined"
				@click="runNow(appletId)"
			>
				▶ run now
			</button>
			<button type="button" class="btn primary" :disabled="!loaded" @click="save">save</button>
		</template>

		<p class="sentence">
			<span v-for="(part, index) in sentenceParts" :key="index" :class="part.kind">{{ part.text }}</span>
		</p>

		<div v-if="unplaced.length > 0" class="form-issues" role="alert">
			<p v-for="(issue, index) in unplaced" :key="index">{{ issue.path.join(".") }}: {{ issue.message }}</p>
		</div>

		<div class="flow">
			<div class="col" data-column="when">
				<div class="h">when:</div>
				<div v-if="schedule" class="slot" data-trigger="schedule" :class="{ sel: selected?.kind === 'schedule' }">
					<button type="button" class="select" @click="selectSchedule">
						<span class="title">⏱ schedule</span>
						<span class="summary">{{ describeSchedule(schedule) }}</span>
					</button>
				</div>
				<button v-else type="button" class="slot add" data-add="schedule" @click="addSchedule">+ schedule</button>
				<div v-if="hasWebhook" class="slot" data-trigger="webhook" :class="{ sel: selected?.kind === 'webhook' }">
					<button type="button" class="select" @click="selected = { kind: 'webhook' }">
						<span class="title">⚓ webhook</span>
						<span class="summary">on webhook</span>
					</button>
				</div>
				<button v-else type="button" class="slot add" data-add="webhook" @click="addWebhook">+ webhook</button>
			</div>

			<div v-for="column in columns" :key="column" class="col" :data-column="column">
				<div class="h">{{ column }}:</div>
				<div
					v-for="(placed, index) in slots[column]"
					:key="placed.key"
					class="slot"
					:class="{ sel: isSelected(column, placed) }"
					data-slot
					:data-issues="issuesOf(column, index).length"
				>
					<button type="button" class="select" @click="selectSlot(column, placed)">
						<span class="title">{{ placed.plugin }} <span class="version">v{{ pluginOf(placed.plugin)?.version }}</span></span>
						<span class="summary">{{ summaryOf(column, placed) }}</span>
						<span v-if="unconnectedService(placed)" class="needs" data-needs-service>⚠ {{ unconnectedService(placed) }} not connected</span>
						<span v-if="issuesOf(column, index).length > 0" class="needs">✗ {{ issuesOf(column, index).length }} to fix</span>
					</button>
					<span class="tools">
						<button type="button" title="move up" :disabled="index === 0" @click="move(column, index, -1)">↑</button>
						<button type="button" title="move down" :disabled="index === slots[column].length - 1" @click="move(column, index, 1)">↓</button>
						<button type="button" title="remove" @click="remove(column, index)">×</button>
					</span>
				</div>
				<button type="button" class="slot add" data-add @click="selected = { kind: 'add', column }">+ {{ singular[column] }}</button>
			</div>
		</div>

		<div v-if="leaving" class="scrim">
			<div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-leave">
				<p id="confirm-leave">leave without saving?</p>
				<p class="muted">your changes to {{ name }} will be lost.</p>
				<div class="dialog-actions">
					<button type="button" class="btn" @click="leaving?.(false)">stay</button>
					<button type="button" class="btn danger" @click="leaving?.(true)">leave</button>
				</div>
			</div>
		</div>

		<template #panel>
			<template v-if="selectedSlot">
				<h3><span class="key">{{ singular[selectedSlot.column] }}:</span> {{ selectedSlot.placed.plugin }}</h3>
				<p v-if="unconnectedService(selectedSlot.placed)" class="needs">
					⚠ {{ unconnectedService(selectedSlot.placed) }} isn't connected.
					<RouterLink :to="{ name: 'wizard', params: { service: unconnectedService(selectedSlot.placed) } }" data-service-link
						>connect {{ unconnectedService(selectedSlot.placed) }}</RouterLink
					>
				</p>
				<SettingsForm
					v-if="!isEmptyForm(schemaOf(selectedSlot.column, selectedSlot.placed) ?? {})"
					:key="selectedSlot.placed.key"
					:schema="schemaOf(selectedSlot.column, selectedSlot.placed) as JSONSchema"
					:value="panelValue"
					:issues="issuesOf(selectedSlot.column, selectedSlot.index)"
					:submit-label="null"
					@change="(value) => { if (selectedSlot) selectedSlot.placed.settings = value; }"
				/>
				<template v-else>
					<div v-if="issuesOf(selectedSlot.column, selectedSlot.index).length > 0" class="form-issues" role="alert">
						<p v-for="(issue, index) in issuesOf(selectedSlot.column, selectedSlot.index)" :key="index">{{ issue.message }}</p>
					</div>
					<p class="muted" data-no-settings>no settings.</p>
				</template>
			</template>

			<template v-else-if="selected?.kind === 'add'">
				<h3><span class="key">add {{ singular[selected.column] }}:</span></h3>
				<button
					v-for="plugin in offers(selected.column)"
					:key="plugin.name"
					type="button"
					class="offer"
					:data-offer="plugin.name"
					@click="selected?.kind === 'add' && add(selected.column, plugin)"
				>
					<b>{{ plugin.name }}</b> <span class="version">v{{ plugin.version }}</span>
					<span class="muted">{{ plugin.description }}</span>
				</button>
			</template>

			<template v-else-if="selected?.kind === 'schedule' && schedule">
				<h3><span class="key">when:</span> schedule</h3>
				<SettingsForm
					:schema="scheduleForm"
					:value="panelValue"
					:issues="showScheduleIssues ? (scheduleProblem ?? []) : []"
					:submit-label="null"
					@change="editSchedule"
				/>
				<p class="muted" data-time-zone>time zone: {{ browserTimeZone() }}</p>
				<button type="button" class="btn" @click="removeSchedule">remove schedule</button>
			</template>

			<template v-else-if="selected?.kind === 'webhook'">
				<h3><span class="key">when:</span> webhook</h3>
				<p v-if="!appletId" class="muted">save the applet first, then add its webhook.</p>
				<template v-else>
					<template v-if="revealedUrl">
						<p>call this url to run the applet:</p>
						<CopyValue :value="revealedUrl" />
						<p class="warning" role="note" data-shown-once>⚠ it holds the token, and won't be shown again.</p>
					</template>
					<p v-else-if="hasWebhook" class="muted">a webhook is set. its token isn't shown again; regenerate it for a new one.</p>
					<div class="panel-actions">
						<button type="button" class="btn" @click="appletId && generateWebhook(appletId)">regenerate</button>
						<button v-if="hasWebhook" type="button" class="btn danger" @click="appletId && removeWebhook(appletId)">remove webhook</button>
					</div>
				</template>
			</template>

			<p v-else class="muted">select a slot to see its settings.</p>
		</template>
	</AppShell>
</template>

<style scoped>
.name { display: flex; align-items: center; gap: 6px; }
.name input { width: 220px; padding: 5px 8px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg); color: var(--fg); }
.name input[aria-invalid] { border-color: var(--bad); }
.toggle { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.toggle input { accent-color: var(--accent); }
.sentence { font-size: 22px; line-height: 1.5; margin: 0 0 22px; color: #ddd; text-align: center; }
.sentence .plugin { color: var(--accent-fg); background: var(--accent); padding: 0 8px; border-radius: 3px; }
.sentence .trigger { color: #fff; background: var(--p2); padding: 0 8px; border-radius: 3px; }
.form-issues { padding: 10px 12px; margin-bottom: 16px; border: 1px solid var(--bad); border-radius: var(--radius); color: var(--bad); }
.form-issues p { margin: 0; }
.flow { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 24px; align-items: start; }
.col { display: grid; gap: 10px; }
.col .h { color: var(--p2); font-size: 12px; }
.slot { display: flex; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-1); }
.slot.sel { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.slot .select { flex: 1; min-width: 0; display: grid; gap: 4px; padding: 10px; text-align: left; background: none; border: 0; color: var(--fg); }
.slot .title { display: flex; gap: 6px; }
.slot .version { color: var(--accent); font-size: 11px; margin-left: auto; }
.slot .summary { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slot .tools { display: flex; flex-direction: column; border-left: 1px solid var(--line); }
.slot .tools button { flex: 1; padding: 0 8px; background: none; border: 0; color: var(--muted); }
.slot .tools button:hover:not(:disabled) { color: var(--fg); background: var(--surface-3); }
.slot .tools button:disabled { opacity: 0.3; cursor: default; }
.slot.add { justify-content: center; padding: 10px; border-style: dashed; color: var(--muted); }
.slot.add:hover { color: var(--fg); border-color: var(--accent); }
.needs { color: var(--p2); }
h3 { font-weight: 400; margin: 0 0 12px; }
.offer { display: grid; gap: 4px; width: 100%; margin-bottom: 8px; padding: 10px; text-align: left; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-2); color: var(--fg); }
.offer:hover { border-color: var(--accent); }
.offer .version { color: var(--accent); font-size: 11px; }
.warning { padding: 8px 10px; border: 1px solid var(--warn); border-radius: var(--radius); }
.panel-actions { display: flex; gap: 8px; margin-top: 12px; }
.scrim { position: fixed; inset: 0; display: grid; place-items: center; background: rgb(0 0 0 / 0.6); }
.dialog { min-width: 320px; padding: 20px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-1); }
.dialog p { margin: 0 0 8px; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
