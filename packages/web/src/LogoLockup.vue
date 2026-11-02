<script setup lang="ts">
import { computed } from "vue";
import { MAGENTA, TEAL, THEMES } from "./logo-palette.ts";
import { KATAKANA, WORDMARK } from "./mosaic.ts";

// ADR-0027 §1 asks for a light version as well, for logos placed on a light background.
const props = defineProps<{ light?: boolean }>();
const theme = computed(() => THEMES[props.light ? "light" : "dark"]);
</script>

<template>
	<div class="lockup" role="img" aria-label="ultrasonics" data-logo="lockup">
		<span class="name" aria-hidden="true">{{ WORDMARK }}</span>
		<span class="kana" aria-hidden="true"><span v-for="c in KATAKANA" :key="c">{{ c }}</span></span>
	</div>
</template>

<style scoped>
/* The chromatic name, and the katakana across its full width beneath, quieter. */
.lockup { display: inline-grid; justify-items: stretch; line-height: 1; }
.name {
	font-family: "Montserrat Alternates", sans-serif;
	font-weight: 700;
	color: v-bind("theme.word");
	text-shadow: -0.04em 0.03em 0 v-bind(TEAL), 0.04em -0.03em 0 v-bind(MAGENTA);
}
.kana {
	display: flex;
	justify-content: space-between;
	margin-top: 0.16em;
	padding: 0 0.1em;
	font-family: "Noto Sans JP", sans-serif;
	font-weight: 700;
	font-size: 0.34em;
	color: v-bind("theme.katakana");
}
</style>
