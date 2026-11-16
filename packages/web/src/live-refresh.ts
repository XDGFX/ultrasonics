import { onUnmounted, type Ref, watch } from "vue";

/** How often the applet list re-fetches while a row is running or queued (spec #134, decision 1). */
export const LIVE_REFRESH_MS = 5_000;

/**
 * Calls `refresh` every {@link LIVE_REFRESH_MS} while `live` holds, one call at a time, until the
 * component unmounts.
 */
export function useLiveRefresh(live: Readonly<Ref<boolean>>, refresh: () => Promise<void>) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let unmounted = false;

	const schedule = () => {
		if (unmounted || timer !== undefined || !live.value) return;
		timer = setTimeout(async () => {
			try {
				await refresh();
			} catch {
				// A failed poll keeps the rows it had; the next one tries again.
			} finally {
				timer = undefined;
				schedule();
			}
		}, LIVE_REFRESH_MS);
	};

	watch(live, schedule, { immediate: true });
	onUnmounted(() => {
		unmounted = true;
		clearTimeout(timer);
	});
}
