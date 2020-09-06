#!/usr/bin/env python3

import requests

from ultrasonics import logs

log = logs.create_log(__name__)

handshake = {
    "name": "lastfm",
    "description": "rediscover your past favourites, and curate based on your listening history.",
    "type": [
        "inputs"
    ],
    "mode": [
        "songs"
    ],
    "version": "0.1",  # Optionally, "0.0.0"
    "settings": [
        {
            "type": "text",
            "label": "Last.fm Username",
            "name": "username",
            "value": "XDGFX"
        }
    ]
}


def run(settings_dict, **kwargs):
    """
    The function called when the applet runs.

    Inputs:
    settings_dict      Settings specific to this plugin instance
    database           Global persistent settings for this plugin
    global_settings    Global settings for ultrasonics (e.g. api proxy)
    component          Either "inputs", "modifiers", "outputs", or "trigger"
    applet_id          The unique identifier for this specific applet
    songs_dict         If a modifier or output, the songs dictionary to be used

    @return:
    If an input or modifier, the new songs_dict must be returned.
    """

    database = kwargs["database"]
    global_settings = kwargs["global_settings"]
    component = kwargs["component"]
    applet_id = kwargs["applet_id"]
    songs_dict = kwargs["songs_dict"]

    log.debug("This is a debug message")
    log.info("This is a info message")
    log.warning("This is a warning message")
    log.error("This is a error message")
    log.critical("This is a critical message")

    pass


def test(database, **kwargs):
    """
    An optional test function. Used to validate persistent settings supplied in database.
    Any errors raised will be caught and displayed to the user for debugging.
    If this function is present, test failure will prevent the plugin being added.
    """

    global_settings = kwargs["global_settings"]

    url = global_settings["api_url"] + "lastfm"

    params = {
        "method": "user.getinfo",
        "user": database["username"],
        "format": "json"
    }

    log.info(f"Trying last.fm api at url: {url}")
    log.info(f"Using username: {params['user']}")

    r = requests.get(url, params=params)

    if r.status_code != 200:
        log.error(f"Unexpected status code: {r.status_code}")
        log.error(r.text)
        raise Exception("Unexpected status code")

    log.info(r.text)

    pass


def builder(**kwargs):
    """
    This function is run when the plugin is selected within a flow. It may query names of playlists or how many recent songs to include in the list.
    It returns a dictionary containing the settings the user must input in this case

    Inputs:
    database           Persistent database settings for this plugin
    component          Either "inputs", "modifiers", "outputs", or "trigger"

    @return:
    settings_dict      Used to build the settings page for this plugin instance

    """

    database = kwargs["database"]
    global_settings = kwargs["global_settings"]
    component = kwargs["component"]

    settings_dict = [
        {
            "type": "string",
            "value": "Build a dedicated playlist based on your scrobbling history."
        },
        """
<div class="field">
        <label class="label">Selection</label>
        <div class="control">
            <input class="is-checkradio" type="radio" name="select" id="Loved Tracks" value="Loved Tracks" checked=true>
            <label for="Loved Tracks">Loved Tracks</label>

            <input class="is-checkradio" type="radio" name="select" id="Recent Tracks" value="Recent Tracks">
            <label for="Recent Tracks">Recent Tracks</label>

            <input class="is-checkradio" type="radio" name="select" id="Top Tracks" value="Top Tracks">
            <label for="Top Tracks">Top Tracks</label>
        </div>
    </div>

    <div class="field">
        <label class="label">Song Limit</label>
        <div class="control">
            <input class="input" type="number" name="limit" step="1" min="-1" pattern="\d+" placeholder="-1">
        </div>
    </div>

    <div class="shy-elements field">
        <div class="field shy top-tracks-only">
            <label class="label">Time Period</label>
            <div class="control">
                <div class="select">
                    <select name="period">
                        <option>Overall</option>
                        <option>7 Days</option>
                        <option>1 Month</option>
                        <option>3 Months</option>
                        <option>6 Months</option>
                        <option>1 Year</option>
                    </select>
                </div>
            </div>
        </div>

        <div class="field shy recent-only">
            <label class="label">Time Period Start</label>
            <div class="control">
                <div class="select">
                    <select name="period-start">
                        <option>Now</option>
                        <option>7 Days Ago</option>
                        <option>1 Month Ago</option>
                        <option>3 Months Ago</option>
                        <option>6 Months Ago</option>
                        <option>1 Year Ago</option>
                        <option>2 Years Ago</option>
                    </select>
                </div>
            </div>
        </div>

        <div class="field shy recent-only">
            <label class="label">Time Period Duration</label>
            <div class="control">
                <div class="select">
                    <select name="period-end">
                        <option>1 Day</option>
                        <option>7 Days</option>
                        <option>1 Month</option>
                        <option>3 Months</option>
                        <option>6 Months</option>
                        <option>1 Year</option>
                    </select>
                </div>
            </div>
        </div>
    </div>

    <script type="text/javascript">

        radios = document.querySelectorAll(".control input.is-checkradio")

        for (i = 0; i < radios.length; i++) {
            radios[i].addEventListener("change", updateInputs)
        }

        updateInputs()

        function updateInputs() {
            shyElements = document.querySelectorAll(".shy-elements .shy")
            for (i = 0; i < radios.length; i++) {
                if (radios[i].checked) {
                    selected = radios[i].value;
                }
            }

            var unhide

            switch (selected) {
                case "Loved Tracks":
                    unhide = []
                    break
                case "Recent Tracks":
                    unhide = document.querySelectorAll(".shy-elements .shy.recent-only")
                    break
                case "Top Tracks":
                    unhide = document.querySelectorAll(".shy-elements .shy.top-tracks-only")
                    break
            }

            for (j = 0; j < shyElements.length; j++) {
                shyElements[j].style.display = "none"
            }
            for (k = 0; k < unhide.length; k++) {
                unhide[k].style.display = "block"
            }
        }

    </script>
        """
    ]

    return settings_dict
