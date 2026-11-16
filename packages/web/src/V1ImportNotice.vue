<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useApi, type V1ImportReport } from "./api-client.ts";

const api = useApi();
const report = ref<V1ImportReport | null>(null);
onMounted(async () => {
	report.value = await api.v1Import.get();
});

// Shown even when no applet was imported or skipped: the report may still name services to reconnect.
const shown = computed(() => report.value && !report.value.dismissed);
const appletWord = (count: number) => (count === 1 ? "applet" : "applets");

async function dismiss() {
	await api.v1Import.dismiss();
	report.value = null;
}
</script>

<template>
	<div v-if="shown && report" class="notice" role="status" data-notice="v1-import">
		<p>
			<span class="key">v1 import:</span> imported
			<b data-count="imported">{{ report.imported }}</b> {{ appletWord(report.imported) }} from ultrasonics v1,
			disabled until you check them, and skipped <b data-count="skipped">{{ report.skipped }}</b>.
			the report says what needs your attention.
		</p>
		<RouterLink :to="{ name: 'v1-import' }" class="btn" data-action="open-v1-report">report</RouterLink>
		<button type="button" class="btn" data-action="dismiss-v1-import" @click="dismiss">dismiss</button>
	</div>
</template>

<style scoped>
.notice { display: flex; align-items: center; gap: 12px; margin: 0 0 18px; padding: 10px 14px; border: 1px solid var(--accent); border-radius: var(--radius); background: var(--surface-1); }
.notice p { flex: 1; margin: 0; line-height: 1.5; }
.notice b { color: var(--accent); font-weight: 400; }
</style>
