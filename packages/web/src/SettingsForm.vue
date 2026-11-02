<script setup lang="ts">
import type { JSONSchema, ValidationIssue } from "@ultrasonics/plugin-sdk";
import { computed, ref, useId, watch } from "vue";
import {
	emitted,
	type Field,
	initialRaw,
	initialVariant,
	placeIssues,
	type Raw,
	shapeOf,
} from "./form-model.ts";

const props = withDefaults(
	defineProps<{
		schema: JSONSchema;
		value?: unknown;
		issues?: ValidationIssue[];
		submitLabel?: string;
	}>(),
	{ value: undefined, issues: () => [], submitLabel: "save" },
);
const emit = defineEmits<{ submit: [value: Record<string, unknown>] }>();

const id = useId();
const shape = computed(() => shapeOf(props.schema));
const raw = ref(initialRaw(shape.value, props.value));
const active = ref(initialVariant(shape.value, props.value));
// A caller may pass the stored value after mounting, once its fetch resolves.
watch([shape, () => props.value], () => {
	raw.value = initialRaw(shape.value, props.value);
	active.value = initialVariant(shape.value, props.value);
});
const variant = computed(
	() => shape.value.variants.find((candidate) => candidate.value === active.value) ?? shape.value.variants[0],
);
const placed = computed(() =>
	variant.value ? placeIssues(shape.value, variant.value, props.issues) : { byField: new Map(), above: [] },
);
const isEmpty = computed(
	() => !shape.value.discriminator && (variant.value?.fields.length ?? 0) === 0,
);

// Issues mean the server rejected what is shown, so submitting it again waits for a change (ADR-0019 §7).
const changedSinceIssues = ref(false);
watch(
	() => props.issues,
	() => {
		changedSinceIssues.value = false;
	},
);
const blocked = computed(() => props.issues.length > 0 && !changedSinceIssues.value);

const inputId = (field: Field) => `${id}-${active.value}-${field.key}`;

function set(field: Field, value: Raw) {
	const branch = raw.value[active.value];
	if (branch) branch[field.key] = value;
	changedSinceIssues.value = true;
}

function choose(value: string) {
	active.value = value;
	changedSinceIssues.value = true;
}

function textOf(field: Field): string {
	const value = raw.value[active.value]?.[field.key];
	return typeof value === "string" ? value : "";
}

function submit() {
	if (blocked.value || !variant.value) return;
	emit("submit", emitted(shape.value, variant.value, raw.value[active.value] ?? {}));
}

const placeholderOf = ({ schema }: Field) =>
	typeof schema.placeholder === "string" ? schema.placeholder : undefined;

const hints = (field: Field) => {
	const { schema } = field;
	switch (field.kind) {
		case "number":
		case "integer":
			return { min: schema.minimum, max: schema.maximum, step: field.kind === "integer" ? 1 : "any" };
		case "text":
		case "password":
			return { minlength: schema.minLength, maxlength: schema.maxLength, pattern: schema.pattern };
		default:
			return {};
	}
};
</script>

<template>
	<form v-if="!isEmpty" class="settings-form" novalidate @submit.prevent="submit">
		<p v-if="schema.description" class="intro">{{ schema.description }}</p>
		<p v-if="schema.warning" class="warning" role="note">⚠ {{ schema.warning }}</p>
		<div v-if="placed.above.length > 0" class="form-issues" role="alert">
			<p v-for="message in placed.above" :key="message">{{ message }}</p>
		</div>

		<fieldset v-if="shape.discriminator" class="choice">
			<legend>{{ shape.discriminator.title }}</legend>
			<label
				v-for="option in shape.variants"
				:key="option.value"
				class="choice-card"
				:class="{ on: option.value === active }"
			>
				<input
					type="radio"
					:name="`${id}-${shape.discriminator.key}`"
					:value="option.value"
					:checked="option.value === active"
					@change="choose(option.value)"
				/>
				<span>
					<b>{{ option.schema.title ?? option.value }}</b>
					<span v-if="option.schema.description" class="help">{{ option.schema.description }}</span>
					<span v-if="option.schema.warning" class="warning" role="note">⚠ {{ option.schema.warning }}</span>
				</span>
			</label>
			<p v-for="message in placed.byField.get(shape.discriminator.key) ?? []" :key="message" class="issue">
				{{ message }}
			</p>
		</fieldset>

		<div
			v-for="field in variant?.fields ?? []"
			:key="`${active}-${field.key}`"
			class="field"
			:class="{ 'has-issue': placed.byField.has(field.key) }"
		>
			<template v-if="field.kind === 'boolean'">
				<label class="toggle" :for="inputId(field)">
					<input
						:id="inputId(field)"
						type="checkbox"
						role="switch"
						:name="field.key"
						:checked="raw[active]?.[field.key] === true"
						:aria-invalid="placed.byField.has(field.key) || undefined"
						@change="set(field, ($event.target as HTMLInputElement).checked)"
					/>
					<span class="lbl">{{ field.schema.title ?? field.key }}<span v-if="field.optional" class="optional"> optional</span></span>
				</label>
			</template>
			<template v-else>
				<label class="lbl" :for="inputId(field)"
					>{{ field.schema.title ?? field.key }}<span v-if="field.optional" class="optional"> optional</span></label
				>
				<select
					v-if="field.kind === 'enum'"
					:id="inputId(field)"
					:name="field.key"
					:value="textOf(field)"
					:required="field.required"
					:aria-invalid="placed.byField.has(field.key) || undefined"
					@change="set(field, ($event.target as HTMLSelectElement).value)"
				>
					<option value=""></option>
					<option v-for="option in field.schema.enum" :key="String(option)" :value="String(option)">
						{{ option }}
					</option>
				</select>
				<input
					v-else
					:id="inputId(field)"
					:type="field.kind === 'password' ? 'password' : field.kind === 'text' ? 'text' : 'number'"
					:name="field.key"
					:value="textOf(field)"
					:placeholder="placeholderOf(field)"
					:required="field.required"
					:autocomplete="field.kind === 'password' ? 'new-password' : undefined"
					v-bind="hints(field)"
					:aria-invalid="placed.byField.has(field.key) || undefined"
					@input="set(field, ($event.target as HTMLInputElement).value)"
				/>
			</template>
			<p v-if="field.schema.description" class="help">{{ field.schema.description }}</p>
			<p v-if="field.schema.warning" class="warning" role="note">⚠ {{ field.schema.warning }}</p>
			<p v-for="message in placed.byField.get(field.key) ?? []" :key="message" class="issue">{{ message }}</p>
		</div>

		<div class="actions">
			<button type="submit" class="btn primary" :disabled="blocked">{{ submitLabel }}</button>
		</div>
	</form>
</template>

<style scoped>
.settings-form { display: grid; gap: 16px; }
.intro { color: var(--muted); margin: 0; }
.choice { border: 0; padding: 0; margin: 0; display: grid; gap: 8px; }
.choice legend { color: var(--p2); margin-bottom: 8px; padding: 0; }
.choice-card { display: flex; gap: 10px; align-items: flex-start; padding: 12px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-2); cursor: pointer; }
.choice-card.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.choice-card input { accent-color: var(--accent); margin-top: 3px; }
.choice-card > span { display: grid; gap: 4px; }
.lbl { display: block; margin-bottom: 4px; }
.optional { color: var(--muted); }
.help { color: var(--muted); font-size: 0.9em; margin: 4px 0 0; }
.warning { margin: 6px 0 0; padding: 8px 10px; border: 1px solid var(--warn); border-radius: var(--radius); color: var(--fg); }
.issue { color: var(--bad); font-size: 0.9em; margin: 4px 0 0; }
.field input:not([type="checkbox"]), .field select { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg); color: var(--fg); }
.field.has-issue input, .field.has-issue select { border-color: var(--bad); }
.toggle { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; }
.toggle input { appearance: none; width: 38px; height: 22px; border-radius: 11px; background: var(--line); position: relative; margin: 0; cursor: pointer; }
.toggle input::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left 0.15s; }
.toggle input:checked { background: var(--accent); }
.toggle input:checked::after { left: 19px; }
.toggle .lbl { margin: 0; }
.form-issues { padding: 10px 12px; border: 1px solid var(--bad); border-radius: var(--radius); color: var(--bad); }
.form-issues p { margin: 0; }
</style>
