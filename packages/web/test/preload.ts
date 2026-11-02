import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScript, compileTemplate, parse } from "@vue/compiler-sfc";
import { plugin } from "bun";

GlobalRegistrator.register();

// Styles are dropped: tests assert on what is shown and emitted, never on CSS.
plugin({
	name: "vue-sfc",
	setup(build) {
		build.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
			const { descriptor, errors } = parse(await Bun.file(path).text(), { filename: path });
			if (errors.length > 0) throw errors[0];
			const id = Bun.hash(path).toString(16);
			if (descriptor.scriptSetup || descriptor.script) {
				const script = compileScript(descriptor, { id, inlineTemplate: true });
				return { contents: script.content, loader: "ts" };
			}
			const template = compileTemplate({
				source: descriptor.template?.content ?? "",
				filename: path,
				id,
			});
			return { contents: `${template.code}\nexport default { render };`, loader: "ts" };
		});
	},
});
