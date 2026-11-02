<script setup lang="ts">
import PendingScreen from "./PendingScreen.vue";

defineProps<{ id: string }>();
</script>

<template>
	<PendingScreen :crumbs="[{ label: 'applets', to: { name: 'applets' } }, { label: `run ${id}` }]" />
</template>
