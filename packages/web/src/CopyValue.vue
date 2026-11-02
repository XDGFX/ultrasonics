<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{ value: string }>();
const copied = ref(false);

async function copy() {
	await navigator.clipboard.writeText(props.value);
	copied.value = true;
}
</script>

<template>
	<div class="copy" data-copy>
		<code>{{ value }}</code>
		<button type="button" class="btn" @click="copy">{{ copied ? "copied" : "copy" }}</button>
	</div>
</template>

<style scoped>
.copy { display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 10px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg); }
.copy code { flex: 1; overflow-wrap: anywhere; }
.copy .btn { padding: 2px 10px; }
</style>
