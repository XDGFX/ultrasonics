<script setup lang="ts">
import { queuedMessage } from "./run-now.ts";
</script>

<template>
	<p class="muted queued" role="status" data-queued>{{ queuedMessage }}</p>
</template>

<style scoped>
.queued { margin: 0; }
</style>
