<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useApi } from "./api-client.ts";
import PendingScreen from "./PendingScreen.vue";
import { queuedMessage, useRunNow } from "./run-now.ts";

const props = defineProps<{ id?: string }>();
const api = useApi();
const { runNow, queued } = useRunNow();
const name = ref(props.id ? "" : "new applet");
onMounted(async () => {
	if (props.id) name.value = (await api.applets.get(props.id)).name;
});
</script>

<template>
	<PendingScreen :crumbs="[{ label: 'applets', to: { name: 'applets' } }, { label: name }]">
		<template v-if="id" #actions>
			<p v-if="queued" class="muted" role="status" data-queued>{{ queuedMessage }}</p>
			<button type="button" class="btn run-now" @click="runNow(id)">▶ run now</button>
		</template>
	</PendingScreen>
</template>
