<script setup lang="ts">
defineProps<{ light?: boolean }>();
</script>

<template>
	<div class="lockup" :class="{ light }" role="img" aria-label="ultrasonics" data-logo="lockup">
		<span class="name" aria-hidden="true">ultrasonics</span>
		<span class="kana" aria-hidden="true"><span v-for="c in 'ソニックス'" :key="c">{{ c }}</span></span>
	</div>
</template>

<style scoped>
/* ADR-0027 §1: the chromatic name, and ソニックス across its full width beneath, quieter. */
.lockup { display: inline-grid; justify-items: stretch; line-height: 1; }
.name {
	font-family: "Montserrat Alternates", sans-serif;
	font-weight: 700;
	color: #fff;
	text-shadow: -0.04em 0.03em 0 #1ce5b5, 0.04em -0.03em 0 #e234ce;
}
.kana {
	display: flex;
	justify-content: space-between;
	margin-top: 0.16em;
	padding: 0 0.1em;
	font-family: "Noto Sans JP", sans-serif;
	font-weight: 700;
	font-size: 0.34em;
	color: #e234ce;
}
.light .name { color: #111; }
.light .kana { color: #b5179e; }
</style>
