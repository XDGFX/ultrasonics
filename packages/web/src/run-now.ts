import { ref } from "vue";
import { useRouter } from "vue-router";
import { useApi } from "./api-client.ts";

export const queuedMessage = "queued: it will run when the current run finishes";

/** Run now for ▶, the builder and run again: open the run, or say it queued (ADR-0026 §5). */
export function useRunNow() {
	const api = useApi();
	const router = useRouter();
	const queued = ref(false);

	async function runNow(appletId: string) {
		const result = await api.applets.runNow(appletId);
		queued.value = result.kind === "queued";
		if (result.kind === "started") await router.push({ name: "run", params: { id: result.runId } });
	}

	return { runNow, queued };
}
