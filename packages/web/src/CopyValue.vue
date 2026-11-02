<script setup lang="ts">
import { ref, useTemplateRef } from "vue";

const props = defineProps<{ value: string }>();
const state = ref<"idle" | "copied" | "selected">("idle");
const code = useTemplateRef<HTMLElement>("code");

async function copy() {
	try {
		await navigator.clipboard.writeText(props.value);
		state.value = "copied";
	} catch {
		// Plain http on a LAN address has no clipboard API, so the value is selected for a manual copy.
		const element = code.value;
		if (!element) return;
		const range = document.createRange();
		range.selectNodeContents(element);
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(range);
		state.value = "selected";
	}
}

const labels = { idle: "copy", copied: "copied", selected: "selected: press ctrl+c" } as const;
</script>

<template>
	<div class="copy" data-copy>
		<code ref="code">{{ value }}</code>
		<button type="button" class="btn" :data-state="state" @click="copy">{{ labels[state] }}</button>
	</div>
</template>

<style scoped>
.copy { display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 10px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg); }
.copy code { flex: 1; overflow-wrap: anywhere; }
.copy .btn { padding: 2px 10px; }
</style>
