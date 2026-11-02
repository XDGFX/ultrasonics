<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useApi } from "./api-client.ts";
import PendingScreen from "./PendingScreen.vue";

const props = defineProps<{ id?: string }>();
const api = useApi();
const name = ref(props.id ? "" : "new applet");
onMounted(async () => {
	if (props.id) name.value = (await api.applets.get(props.id)).name;
});
</script>

<template>
	<PendingScreen :crumbs="[{ label: 'applets', to: { name: 'applets' } }, { label: name }]" />
</template>
