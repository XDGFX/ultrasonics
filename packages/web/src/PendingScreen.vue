<script setup lang="ts">
import AppShell, { type Crumb } from "./AppShell.vue";

defineProps<{ crumbs: Crumb[] }>();
</script>

<template>
	<AppShell :crumbs="crumbs">
		<template v-if="$slots.actions" #actions><slot name="actions" /></template>
		<p class="muted">not built yet.</p>
	</AppShell>
</template>
