<script setup lang="ts">
import PendingScreen from "./PendingScreen.vue";

defineProps<{ service: string }>();
</script>

<template>
	<PendingScreen :crumbs="[{ label: 'settings', to: { name: 'settings' } }, { label: service }]" />
</template>
