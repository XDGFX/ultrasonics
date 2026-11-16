<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useApi, type V1ImportReport } from "./api-client.ts";
import AppShell from "./AppShell.vue";
import { formatWhen } from "./clock.ts";

const api = useApi();
const report = ref<V1ImportReport | null>(null);
const loaded = ref(false);
onMounted(async () => {
	report.value = await api.v1Import.get();
	loaded.value = true;
});
</script>

<template>
	<AppShell :crumbs="[{ label: 'applets', to: '/' }, { label: 'v1 import' }]">
		<template v-if="report">
			<p class="heading">
				<span class="key">imported:</span> <span data-v1-imported-at>{{ formatWhen(report.importedAt) }}</span>
				<span class="muted">&nbsp;· also in v1-import-report.md in the data directory</span>
			</p>
			<!-- The report is Markdown written to be read as it stands, as it is in the file. -->
			<pre class="report" data-v1-report>{{ report.markdown }}</pre>
		</template>
		<p v-else-if="loaded" class="muted" data-v1-none>no v1 import has run on this install.</p>
	</AppShell>
</template>

<style scoped>
.heading { margin: 0 0 18px; }
.report { margin: 0; padding: 16px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-1); white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; }
</style>
