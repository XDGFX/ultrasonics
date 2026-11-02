import { onBeforeUnmount, onMounted, type Ref, ref } from "vue";
import { onBeforeRouteLeave } from "vue-router";

/**
 * Holds a navigation away from a screen with unsaved changes, and asks the browser to warn before
 * the tab closes. The returned answer is set while the screen should ask whether to leave.
 */
export function useUnsavedChanges(dirty: Ref<boolean>) {
	const answer = ref<((leave: boolean) => void) | null>(null);

	onBeforeRouteLeave(() =>
		dirty.value
			? new Promise<boolean>((resolve) => {
					answer.value = (leave) => {
						answer.value = null;
						resolve(leave);
					};
				})
			: true,
	);

	const warn = (event: BeforeUnloadEvent) => {
		if (dirty.value) event.preventDefault();
	};
	onMounted(() => window.addEventListener("beforeunload", warn));
	onBeforeUnmount(() => window.removeEventListener("beforeunload", warn));

	return answer;
}
