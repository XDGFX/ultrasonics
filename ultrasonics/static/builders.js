function html_plugin_builder(settings_dict) {
    html = "<form id='form_plugins_builder'>"

    for (var i = 0; i < settings_dict.length; i++) {

        item = settings_dict[i]

        switch (item["type"]) {

            // Text input
            case "text":
                html = html.concat(`
                <div class="field">
                    <label class="label">${item["label"]}</label>
                    <div class="control">
                        <input class="input" type="text" name="${name + "_" + item["name"]}" placeholder="${item["value"]}">
                    </div>
                </div>
                `)
                break;

            // Radio input
            case "radio":
                html = html.concat(`
                <div class="field">
                    <label class="label">${item["label"]}</label>
                    <div class="control">
                `)

                // Append all options supplied
                for (var j = 0; j < item["options"].length; j++) {
                    html = html.concat(`
                    <input class="is-checkradio" type="radio" name="${name + "_" + item["name"]}" id="${name + "_" + item["options"][j]}">
                    <label for="${name + "_" + item["options"][j]}">${item["options"][j]}</label>
                    `)

                }

                html = html.concat(`
                    </div>
                </div>
                `)
                break;

            // Dropdown input
            case "select":
                html = html.concat(`
                <div class="field">
                    <label class="label">${item["label"]}</label>
                    <div class="control">
                        <div class="select">
                            <select name="${name + "_" + item["name"]}"`)

                // Append all options supplied
                for (var j = 0; j < item["options"].length; j++) {
                    html = html.concat(`<option>${item["options"][j]}</option>`)
                }

                html = html.concat(`
                            </select>
                        </div>
                    </div>
                </div>
                    `)
                break;

            // Checkbox input
            case "checkbox":
                html = html.concat(`
                <div class="field">
                    <input class="is-checkradio" type="checkbox" name="${name + "_" + item["name"]}" id="${name + "_" + item["id"]}" value="${name + "_" + item["value"]}">
                    <label for="${name + "_" + item["id"]}" class="checkbox">${item["label"]}</label>
                </div>
                `)
                break;
        }
    }

    html = html.concat(`
    <div class="control">
        <button type="submit" class="button is-primary">Submit</button>
    </div>
    </form>`)

    // Minify html code
    html = html.replace(/^\s+|\r\n|\n|\r|(>)\s+(<)|\s+$/gm, '$1$2')

    return html
}

