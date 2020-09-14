#!/usr/bin/env python3

"""
up_lastfm

Integrate with your last.fm scrobbles. Take your loved music, your top tracks,
or scrobbles from a specific time period and turn them into a playlist.

XDGFX, 2020
"""

import json

import requests
from tqdm import tqdm

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
    "version": "0.1",
    "settings": [
        {
            "type": "text",
            "label": "Last.fm Username",
            "name": "username",
            "value": "XDGFX",
            "required": True
        }
    ]
}


def run(settings_dict, **kwargs):
    """
    1. Determines which mode the plugin is running in:
        - Loved songs
        - Top songs
        - Recent songs (time period)
    2. Gets the songs from last.fm, up to the specified limit.
    3. Converts the songs to ultrasonics songs_dict, making more requests for album data if needed.
    """

    database = kwargs["database"]
    global_settings = kwargs["global_settings"]
    component = kwargs["component"]
    applet_id = kwargs["applet_id"]
    songs_dict = kwargs["songs_dict"]

    url = global_settings["api_url"] + "lastfm"

    def get_songs(params):
        """
        Sends requests to the lastfm api to return a list of songs.
        The number of songs will not exceed settings_dict["limit"].
        Checks for invalid responses.

        @return: list of songs in lastfm format
        """
        default_params = {
            "user": database["username"],
            "format": "json"
        }

        # Add params for all requests
        params.update(default_params)

        limit = int(settings_dict["limit"])

        left = limit
        page = 1

        log.info(f"Song limit set to: {limit}")

        tracks = []

        while left > 0:
            params["page"] = page
            params["limit"] = 50

            r = requests.get(url, params=params)

            if r.status_code == 429:
                import time
                log.warning("Rate limit reached, sleeping for a while...")
                time.sleep(60)
                r = requests.get(url, params=params)

            if r.status_code != 200:
                log.error(f"Unexpected status code: {r.status_code}")
                log.error(r.text)
                raise Exception("Unexpected status code")

            r = json.loads(r.content)

            # Add all new songs to existing data list
            new_songs = list(r.values())[0]["track"]

            # Check for now playing, and remove if so
            now_playing = new_songs[0].get("@attr", {}).get("nowplaying")
            if now_playing:
                new_songs.pop(0)
                left += 1

            # Update tracks list with required number of tracks
            tracks_selection = left if left < 50 else 50
            tracks.extend(new_songs[:tracks_selection])

            # Check if there are no more songs left to get
            if int(list(r.values())[0]["@attr"]["totalPages"]) <= page:
                left = -1

            left -= 50
            page += 1

        log.info(f"Found {len(tracks)} tracks.")
        return tracks

    def convert_songs(songs):
        """
        Converts a list of songs in lastfm format to ultrasonics format.

        @return: list of songs in ultrasonics format.
        """
        params = {
            "format": "json",
            "method": "track.getinfo",
            "autocorrect": "0"
        }

        new_songs = []

        log.info("Getting updated tags for all songs from lastfm...")

        for song in tqdm(songs):
            temp_dict = {
                "title": song["name"],
                "artists": [
                    song["artist"].get("name") or song["artist"].get("#text"),
                ],
                "album": song.get("album", {}).get("#text"),
                "id": {
                    "lastfm": song["url"]
                }
            }

            # Make request to get album info
            if not temp_dict["album"]:
                params["track"] = song["name"]
                params["artist"] = temp_dict["artists"][0]

                r = requests.get(url, params=params)

                if r.status_code == 429:
                    import time
                    log.warning("Rate limit reached, sleeping for a while...")
                    time.sleep(60)
                    r = requests.get(url, params=params)

                if r.status_code != 200:
                    log.error(f"Unexpected status code: {r.status_code}")
                    log.error(r.text)
                    raise Exception("Unexpected status code")

                album = json.loads(r.content).get("track", {}).get(
                    "album", {}).get("title")

                if album:
                    temp_dict["album"] = album

            if not temp_dict["album"]:
                del temp_dict["album"]

            new_songs.append(temp_dict)

        return new_songs

    if settings_dict["select"] == "Loved Tracks":
        log.info("Getting loved tracks from last.fm")
        params = {
            "method": "user.getlovedtracks"
        }

    elif settings_dict["select"] == "Recent Tracks":
        log.info("Getting recent tracks from last.fm")
        from datetime import datetime

        converter = {
            "Now": 0,
            "1 Day": 86400,
            "7 Days": 604800,
            "1 Month": 2629800,
            "3 Months": 7889400,
            "6 Months": 15778800,
            "1 Year": 31557600,
            "2 Years": 62208000,
        }

        time_to = (datetime.utcnow() - datetime(1970, 1, 1)
                   ).total_seconds() - converter[settings_dict["period-end"].rstrip(" Ago")]

        duration = converter[settings_dict["period-duration"]]

        time_from = time_to - duration

        params = {
            "method": "user.getrecenttracks",
            "from": str(int(time_from)),
            "to": str(int(time_to))
        }

    elif settings_dict["select"] == "Top Tracks":
        log.info("Getting top tracks from last.fm")

        # Get period and convert to valid parameter
        period = settings_dict["period"]
        period = period.lower().replace(" ", "").rstrip("s")

        params = {
            "method": "user.gettoptracks",
            "period": period
        }

    else:
        raise Exception(f"Invalid select option: {settings_dict['select']}")

    songs = get_songs(params)
    songs = convert_songs(songs)

    songs_dict = [
        {
            "name": settings_dict.get("playlist_title") or "Last.fm Music",
            "id": {},
            "songs": songs
        }
    ]
    return songs_dict


def test(database, **kwargs):
    """
    Checks if the username entered exists on last.fm.
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
        <label class="label">Song Limit (Ordered by Most Recent)</label>
        <div class="control">
            <input class="input" type="text" name="limit" min="1" pattern="\d+" value="50">
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
                        <option>12 Months</option>
                    </select>
                </div>
            </div>
        </div>

        <div class="field shy recent-only">
            <label class="label">Time Period End</label>
            <div class="control">
                <div class="select">
                    <select name="period-end">
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
                    <select name="period-duration">
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
                    unhide = document.querySelectorAll(
                        ".shy-elements .shy.recent-only")
                    break
                case "Top Tracks":
                    unhide = document.querySelectorAll(
                        ".shy-elements .shy.top-tracks-only")
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
        """,
        {
            "type": "string",
            "value": "This plugin will pass the songs in playlist form. What would you like this playlist to be called?"
        },
        {
            "type": "text",
            "label": "Playlist Title",
            "name": "playlist_title",
            "value": "Last.fm Songs",
            "required": True
        },
    ]

    return settings_dict
