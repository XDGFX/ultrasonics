#!/usr/bin/env python3

"""
up_tidal

input and output plugin for Tidal, based off of up_spotify so it will do most of the things it does

Steve-Tech & XDGFX, 2022
"""

import os
import re
import sqlite3
import time

import tidalapi
from tqdm import tqdm
from datetime import datetime

from app import _ultrasonics
from ultrasonics import logs
from ultrasonics.tools import fuzzymatch, name_filter

log = logs.create_log(__name__)

handshake = {
    "name": "tidal",
    "description": "sync your playlists to and from tidal",
    "type": ["inputs", "outputs"],
    "mode": ["playlists"],
    "version": "0.1",  # Optionally, "0.0.0"
    "settings": [
        {
            "type": "string",
            "value": "Tidal Login, run tidal_login.py for these values",
        },
        {
            "type": "text",
            "label": "Token Type",
            "name": "token_type",
        },
        {
            "type": "text",
            "label": "Access Token",
            "name": "access_token",
        },
        {
            "type": "text",
            "label": "Refresh Token",
            "name": "refresh_token",
        },
        {
            "type": "text",
            "label": "Expiry Time",
            "name": "expiry_time",
        },
        {
            "type": "string",
            "value": "Songs will always attempt to be matched using fixed values like ISRC, however if you're trying to sync music without these tags, fuzzy matching will be used instead.",
        },
        {
            "type": "string",
            "value": "This means that the titles 'You & Me - Flume Remix', and 'You & Me (Flume Remix)' will probably qualify as the same song [with a fuzzy score of 96.85 if all other fields are identical]. However, 'You, Me, & the Log Flume Ride' probably won't 🎢 [the score was 88.45 assuming *all* other fields are identical]. The fuzzyness of this matching is determined with the below setting. A value of 100 means all song fields must be identical to pass as duplicates. A value of 0 means any song will quality as a match, even if they are completely different. 👽",
        },
        {
            "type": "text",
            "label": "Default Global Fuzzy Ratio",
            "name": "fuzzy_ratio",
            "value": "Recommended: 90",
        },
    ],
}


def run(settings_dict, **kwargs):
    """
    Runs the up_tidal plugin.

    Important note: songs will only be appended to playlists if they are new!
    No songs will be removed from existing playlists, nothing will be over-written.
    This behaviour is different from some other plugins.
    """

    database = kwargs["database"]
    global_settings = kwargs["global_settings"]
    component = kwargs["component"]
    applet_id = kwargs["applet_id"]
    songs_dict = kwargs["songs_dict"]

    class Tidal:
        """
        Class for interactions with Tidal through the tidalapi library.
        """

        def __init__(self):
            self.session = tidalapi.Session()

        def login(self):
            success = self.session.load_oauth_session(database["token_type"], database["access_token"], database["refresh_token"], datetime.fromisoformat(database["expiry_time"]))
            if success:
                log.debug("Successfully loaded session")
            else:
                log.error("Error loading session")
            return success

        def request(self, tidal_func, *args, **kwargs):
            """
            Used to call a tidalapi function, with automatic catching and renewing on access token errors.
            """
            errors = 0

            # Try once again when error
            while errors <= 1:
                try:
                    return tidal_func(*args, **kwargs)

                except Exception as e:
                    # Renew token
                    log.error(e)
                    self.session.token_refresh(database["refresh_token"])
                    errors += 1
                    continue
            
            # raise exception if no return
            raise Exception("An error occurred while trying to contact the Tidal api.")

        def search(self, track):
            """
            Used to search the Tidal API for a song, supplied in standard songs_dict format.
            Will attempt to match using fixed values (Tidal ID) before moving onto fuzzy values.
            Tidal doesn't seem to support searching ISRC, and just searching is pretty sketchy compared to spotify.

            @returns:
            Tidal ID, confidence score
            """

            cutoff_regex = [
                "[([](feat|ft|featuring|original|prod).+?[)\]]",
                "[ (\- )\-]+(feat|ft|featuring|original|prod).+?(?=[(\n])",
            ]

            # 1. Tidal ID
            if "id" in track and "tidal" in track["id"]:
                tidal_id = track["id"]["tidal"]
                # tidal_uri = f"tidal:track:{tidal_id}"
                confidence = 100

                return tidal_id, confidence

            # 2. Other fields
            # Multiple searches are made as Tidal is more likely to return false negative (missing songs)
            # than false positive, when specifying many query parameters.

            queries = []

            if "title" in track:
                title = (
                    re.sub(cutoff_regex[0], "", track["title"], flags=re.IGNORECASE)
                    + "\n"
                )

                title = re.sub(
                    cutoff_regex[1], " ", title, flags=re.IGNORECASE
                ).strip()

            # Tidal doesn't search albums, it seems
            # if "album" in track:
            #     album = (
            #         re.sub(cutoff_regex[0], "", track["album"], flags=re.IGNORECASE)
            #         + "\n"
            #     )
            #
            #     album = re.sub(
            #         cutoff_regex[1], " ", album, flags=re.IGNORECASE
            #     ).strip()
            #
            # if "title" in track and "album" in track:
            #     queries.append(f"{title} {album}")

            if "title" in track:
                if "artists" in track:
                    for artist in track["artists"]:
                        queries.append(f"{title} {artist}")
                    queries.append(title)

            results_list = []

            # Search albums
            if "album" in track:
                for result in self.request(self.session.search, track["album"], models=[tidalapi.album.Album])['albums']:
                    for item in result.items():
                        if isinstance(item, tidalapi.media.Track):
                            item = s.tidal_to_songs_dict(item)
                            if item not in results_list:
                                results_list.append(item)

            # Execute all queries
            for query in queries:
                results = self.request(self.session.search, query, models=[tidalapi.media.Track])

                # Convert to ultrasonics format and append to results_list
                for result in results['tracks']:
                    item = s.tidal_to_songs_dict(result)
                    if item not in results_list:
                        results_list.append(item)

            if not results_list:
                # No items were found
                return "", 0

            # Check results with fuzzy matching
            confidence = 0

            for item in results_list:
                score = fuzzymatch.similarity(track, item)
                if score > confidence:
                    matched_track = item
                    confidence = score
                    if confidence >= 100:
                        break

            # tidal_uri = f"tidal:track:{matched_track['id']['tidal']}"

            return matched_track['id']['tidal'], confidence

        def current_user_playlists(self):
            """
            Wrapper for Tidal `current_user_playlists`.
            """
            
            playlists = self.request(self.session.user.playlists)

            log.info(f"Found {len(playlists)} playlist(s) on Tidal.")

            return [{'id':{'tidal':playlist.id},'name':playlist.name, 'description':playlist.description} for playlist in playlists]

        def current_user_saved_tracks(self):
            """
            Wrapper for TidalAPI `current_user_saved_tracks`.
            """
            tracks = self.request(self.session.user.favorites.tracks)

            tidal_ids = [item.id for item in tracks]

            return tidal_ids, tracks

        def playlist_tracks(self, playlist_id):
            """
            Wrapper for TidalAPI `playlist_tracks`.
            """
            
            tracks = self.request(self.session.playlist, playlist_id).tracks()

            track_list = []

            # Convert from Tidal API format to ultrasonics format
            log.info("Converting tracks to ultrasonics format.")
            for track in tqdm(
                tracks,
                desc=f"Converting tracks in {playlist_id}",
            ):
                try:
                    track_list.append(s.tidal_to_songs_dict(track))
                except TypeError:
                    log.error(
                        f"Could not convert track {track.id} to ultrasonics format."
                    )
                    continue

            return track_list

        def user_playlist_remove_all_occurrences_of_tracks(self, playlist_id, tracks):
            """
            Wrapper for the tidalapi function of the same name.
            Removes all `tracks` from the specified playlist.
            """
            playlist = tidalapi.playlist.UserPlaylist(self.session, playlist_id)
            for track in tqdm(
                tracks,
                desc=f"Deleting songs from Tidal",
            ):
                playlist.remove_by_id(track)

        def tidal_to_songs_dict(self, track):
            """
            Convert dictionary received from Tidal API to ultrasonics songs_dict format.
            Assumes title, artist(s), and id field are always present.
            """

            item = {
                "title": track.name,
                "artists": [artist.name for artist in track.artists],
                "album": track.album.name,
                "date": track.album.release_date,
                "isrc": track.isrc,
                "id": {"tidal": track.id}
            }

            # Remove any empty fields
            item = {k: v for k, v in item.items() if v}

            return item

        def user_id(self):
            """
            Get and return the current user's user ID.
            """
            user_info = self.request(self.session.user.id)
            self.user_id = user_info

    class Database:
        """
        Class for interactions with the up_tidal database.
        Currently used for storing info about saved songs.
        """

        def __init__(self):
            # Create database if required
            self.saved_songs_db = os.path.join(
                _ultrasonics["config_dir"], "up_tidal", "saved_songs.db"
            )
            
            # Create the containing folder if it doesn't already exist
            try:
                os.mkdir(os.path.dirname(self.saved_songs_db))
            except FileExistsError:
                # Folder already exists
                pass


            with sqlite3.connect(self.saved_songs_db) as conn:
                cursor = conn.cursor()

                # Create saved songs table if needed
                query = "CREATE TABLE IF NOT EXISTS saved_songs (applet_id TEXT, tidal_id TEXT)"
                cursor.execute(query)

                # Create lastrun table if needed
                query = "CREATE TABLE IF NOT EXISTS lastrun (applet_id TEXT PRIMARY KEY, time INTEGER)"
                cursor.execute(query)

                conn.commit()

        def lastrun_get(self):
            """
            Gets the last run time for saved songs mode.
            """
            with sqlite3.connect(self.saved_songs_db) as conn:
                cursor = conn.cursor()

                query = "SELECT time FROM lastrun WHERE applet_id = ?"
                cursor.execute(query, (applet_id,))

                rows = cursor.fetchone()

                return None if not rows else rows[0]

        def lastrun_set(self):
            """
            Updates the last run time for saved songs mode.
            """
            with sqlite3.connect(self.saved_songs_db) as conn:
                cursor = conn.cursor()

                query = "REPLACE INTO lastrun (time, applet_id) VALUES (?, ?)"
                cursor.execute(query, (int(time.time()), applet_id))

        def saved_songs_contains(self, tidal_id):
            """
            Checks if the input `tidal_id` is present in the saved songs database.
            """
            with sqlite3.connect(self.saved_songs_db) as conn:
                cursor = conn.cursor()

                query = "SELECT EXISTS(SELECT * FROM saved_songs WHERE applet_id = ? AND tidal_id = ?)"
                cursor.execute(query, (applet_id, tidal_id))

                rows = cursor.fetchone()

                return rows[0]

        def saved_songs_add(self, tidal_ids):
            """
            Adds all songs in a list of `tidal_ids` to the saved songs database for this applet.
            """
            with sqlite3.connect(self.saved_songs_db) as conn:
                cursor = conn.cursor()

                # Add saved songs to database
                query = "INSERT INTO saved_songs (applet_id, tidal_id) VALUES (?, ?)"
                values = [(applet_id, tidal_id) for tidal_id in tidal_ids]
                cursor.executemany(query, values)

                conn.commit()

    s = Tidal()
    db = Database()

    s.api_url = global_settings["api_url"]

    # auth = json.loads(database["auth"])
    s.refresh_token = database["refresh_token"]

    if not (s.login() or s.login()):
        return None

    if component == "inputs":
        if settings_dict["mode"] == "playlists":
            # Playlists mode

            # 1. Get a list of users playlists
            playlists = s.current_user_playlists()

            songs_dict = []

            for playlist in playlists:
                item = {"name": playlist["name"], "id": playlist["id"]}

                songs_dict.append(item)

            # 2. Filter playlist titles
            songs_dict = name_filter.filter(songs_dict, settings_dict["filter"])

            # 3. Fetch songs from each playlist, build songs_dict
            log.info("Building songs_dict for playlists...")
            for i, playlist in tqdm(enumerate(songs_dict)):
                tracks = s.playlist_tracks(playlist["id"]["tidal"])

                songs_dict[i]["songs"] = tracks

            return songs_dict

        elif settings_dict["mode"] == "saved":
            # Saved songs mode
            if db.lastrun_get():
                # Update songs
                songs = []

                tidal_ids, tracks = s.current_user_saved_tracks()

                for tidal_id, track in zip(tidal_ids, tracks):
                    if db.saved_songs_contains(tidal_id):
                        break
                    else:
                        songs.append(s.tidal_to_songs_dict(track["track"]))

                if not songs:
                    log.info("No new saved songs were found. Exiting this applet.")
                    raise Exception("No new saved songs found on this applet run.")

                songs_dict = [
                    {
                        "name": settings_dict["playlist_title"]
                        or "Tidal Saved Songs",
                        "id": {},
                        "songs": songs,
                    }
                ]

                return songs_dict

            else:
                log.info(
                    "This is the first time this applet plugin has run in saved songs mode."
                )
                log.info(
                    "This first run will be used to get the current state of saved songs, but will not pass any songs in songs_dict."
                )

                # 1. Get some saved songs
                tidal_ids, _ = s.current_user_saved_tracks()

                # 2. Update database with saved songs
                db.saved_songs_add(tidal_ids)

                # 3. Update lastrun
                db.lastrun_set()

                raise Exception(
                    "Initial run of this plugin will not return a songs_dict. Database is now updated. Next run will continue as normal."
                )

    else:
        "Outputs mode"

        # Remove the not found file if it exists
        if (not_found_file := os.environ.get("TIDAL_NOT_FOUND_FILE"))\
                and os.path.exists(not_found_file):
            os.remove(not_found_file)

        # Set the user_id variable
        # s.user_id()

        # Get a list of current user playlists
        current_playlists = s.current_user_playlists()

        for playlist in songs_dict:
            existing_tracks = None

            # Check the playlist already exists in Tidal
            playlist_id = ""
            try:
                if playlist["id"]["tidal"] in [
                    item["id"] for item in current_playlists
                ]:
                    playlist_id = playlist["id"]["tidal"]
            except KeyError:
                if playlist["name"] in [item["name"] for item in current_playlists]:
                    playlist_id = [
                        item["id"]["tidal"]
                        for item in current_playlists
                        if item["name"] == playlist["name"]
                    ][0]
            if playlist_id:
                log.info(
                    f"Playlist {playlist['name']} already exists, updating that one."
                )
            else:
                log.info(
                    f"Playlist {playlist['name']} does not exist, creating it now..."
                )
                # Playlist must be created
                description = "Created automatically by ultrasonics with 💖"

                response = s.request(
                    s.session.user.create_playlist,
                    playlist["name"],
                    description,
                )

                playlist_id = response.id

                existing_tracks = []

            # Get all tracks already in the playlist
            if existing_tracks is None:
                existing_tracks = s.playlist_tracks(playlist_id)

            # Add songs which don't already exist in the playlist
            ids = []
            duplicate_ids = []

            log.info("Searching for matching songs in Tidal.")
            for song in tqdm(
                playlist["songs"],
                desc=f"Searching Tidal for songs",
            ):
                # First check for fuzzy duplicate without Tidal api search
                duplicate = False
                for item in existing_tracks:
                    score = fuzzymatch.similarity(song, item)

                    if score > float(database.get("fuzzy_ratio") or 90):
                        # Duplicate was found
                        duplicate_ids.append(item['id']['tidal'])
                        duplicate = True
                        break

                if duplicate:
                    continue

                # Search for song on Tidal
                id, confidence = s.search(song)

                if id in existing_tracks:
                    duplicate_ids.append(id)

                if confidence > float(database.get("fuzzy_ratio") or 90):
                    ids.append(id)
                else:
                    log.debug(
                        f"Could not find song '{song['title'] if 'title' in song else song}' in Tidal; "
                        "will not add to playlist."
                    )

                    # Write to not found file
                    if not_found_file:
                        with open(not_found_file, "a") as f:
                            f.write(f"{playlist['name']}: {song}\n")

            if settings_dict["existing_playlists"] == "Update":
                # Remove any songs which aren't in `uris` from the playlist
                remove_ids = [
                    id['id']['tidal'] for id in existing_tracks if id['id']['tidal'] not in ids + duplicate_ids
                ]

                s.user_playlist_remove_all_occurrences_of_tracks(
                    playlist_id, remove_ids
                )

            # Add tracks to playlist
            if ids:
                api_playlist = s.request(
                        tidalapi.playlist.UserPlaylist, s.session, playlist_id
                    )

                s.request(
                    api_playlist.add, ids
                )



def test(database, **kwargs):
    """
    An optional test function. Used to validate persistent settings supplied in database.
    Any errors raised will be caught and displayed to the user for debugging.
    If this function is present, test failure will prevent the plugin being added.
    """

    # global_settings = kwargs["global_settings"]

    session = tidalapi.Session()
    assert session.load_oauth_session(database["token_type"], database["access_token"], database["refresh_token"], datetime.fromisoformat(database["expiry_time"])), "Error logging in"


def builder(**kwargs):
    component = kwargs["component"]

    if component == "inputs":
        settings_dict = [
            """
            <div class="field">
                <label class="label">Input</label>
                <div class="control">
                    <input class="is-checkradio" type="radio" name="mode" id="playlists" value="playlists" checked=true>
                    <label for="playlists">Playlists</label>

                    <input class="is-checkradio" type="radio" name="mode" id="saved" value="saved">
                    <label for="saved">Saved Songs</label>
                </div>
            </div>

            <div class="shy-elements field">
                <div class="field shy playlists-only">
                    <label class="label">You can use regex style filters to only select certain playlists. For example,
                        'disco' would sync playlists 'Disco 2010' and 'nu_disco', or '2020$' would only sync playlists which
                        ended with the value '2020'.</label>
                </div>

                <div class="field shy playlists-only">
                    <label class="label">Leave it blank to sync everything 🤓.</label>
                </div>

                <div class="field shy playlists-only">
                    <label class="label">Filter</label>
                    <div class="control">
                        <input class="input" type="text" name="filter" placeholder="">
                    </div>
                </div>

                <div class="field shy saved-only">
                    <label class="label">Saved Songs mode will only save newly added songs. This is designed for output
                        plugins which append tracks, as opposed to overwrite existing playlist songs.</label>
                </div>

                <div class="field shy saved-only">
                    <label class="label">
                        ⚠️ The playlist will only contain songs you've saved since the last run of this applet.
                    </label>
                </div>

                <div class="field shy saved-only">
                    <label class="label">
                        This plugin will pass the songs in playlist form. What would you like this playlist to be
                        called?</label>
                </div>

                <div class="field shy saved-only">
                    <label class="label">Playlist Title</label>
                    <div class="control">
                        <input class="input" type="text" name="playlist_title" placeholder="Tidal Saved Songs">
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
                        case "playlists":
                            unhide = document.querySelectorAll(
                                ".shy-elements .shy.playlists-only")
                            break
                        case "saved":
                            unhide = document.querySelectorAll(
                                ".shy-elements .shy.saved-only")
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

    else:
        settings_dict = [
            {
                "type": "string",
                "value": "Do you want to update any existing playlists with the same name (replace any songs already in the playlist), or append to them?",
            },
            {
                "type": "radio",
                "label": "Existing Playlists",
                "name": "existing_playlists",
                "id": "existing_playlists",
                "options": ["Append", "Update"],
                "required": True,
            },
        ]

        return settings_dict
