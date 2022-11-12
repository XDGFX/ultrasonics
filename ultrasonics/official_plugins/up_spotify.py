#!/usr/bin/env python3

"""
up_spotify

Official input and output plugin for Spotify. Can access a user's public or private playlists, and read songs from, or save songs to them.
Will not overwrite songs already in a playlist, so stuff like date added are kept accurate.

XDGFX, 2020
"""

import bz2
import json
import os
import pickle
import re
import sqlite3
import time
from urllib.parse import urljoin

import requests
import spotipy
from tqdm import tqdm

from app import _ultrasonics
from ultrasonics import logs
from ultrasonics.tools import api_key, fuzzymatch, name_filter

log = logs.create_log(__name__)

handshake = {
    "name": "spotify",
    "description": "sync your playlists to and from spotify",
    "type": ["inputs", "outputs"],
    "mode": ["playlists"],
    "version": "0.5",
    "settings": [
        {"type": "auth", "label": "Authorise Spotify", "path": "/spotify/auth/request"},
        {
            "type": "string",
            "value": "Songs will always attempt to be matched using fixed values like ISRC or Spotify URI, however if you're trying to sync music without these tags, fuzzy matching will be used instead.",
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
        {
            "type": "string",
            "value": "If you sync a playlist to Spotify which doesn't already exist, ultrasonics will create a new playlist for you automatically ✨. Would you like any new playlists to be public or private?",
        },
        {
            "type": "radio",
            "label": "Created Playlists",
            "name": "created_playlists",
            "id": "created_playlists",
            "options": ["Public", "Private"],
        },
    ],
}


def run(settings_dict, **kwargs):
    """
    Runs the up_spotify plugin.

    Important note: songs will only be appended to playlists if they are new!
    No songs will be removed from existing playlists, nothing will be over-written.
    This behaviour is different from some other plugins.
    """

    database = kwargs["database"]
    global_settings = kwargs["global_settings"]
    component = kwargs["component"]
    applet_id = kwargs["applet_id"]
    songs_dict = kwargs["songs_dict"]

    class Spotify:
        """
        Class for interactions with Spotify through the Spotipy api.
        """

        def __init__(self):
            self.cache_file = os.path.join(
                _ultrasonics["config_dir"], "up_spotify", "up_spotify.bz2"
            )

            log.info(f"Credentials will be cached in: {self.cache_file}")

            # Create the containing folder if it doesn't already exist
            try:
                os.mkdir(os.path.dirname(self.cache_file))
            except FileExistsError:
                # Folder already exists
                pass

        def token_get(self, force=False):
            """
            Updates the global access_token variable, in the following order of preference:
            1. A locally saved access token.
            2. Renews token using the database refresh_token.

            If #2, the access token is saved to a .cache file.
            """
            log.debug("Fetching your Spotify token")
            if os.path.isfile(self.cache_file) and not force:
                with bz2.BZ2File(self.cache_file, "r") as f:
                    raw = json.loads(pickle.load(f))
                    token = raw["access_token"]

                # Checks that the cached token is valid
                if self.token_validate(token):
                    log.debug("Returning cached token")
                    return token

            # In all other cases, renew the token
            log.debug("Returning renewed token")
            return self.token_renew()

        def token_validate(self, token):
            """
            Checks if an auth token is valid, by making a request to the Spotify api.
            """
            url = f"https://api.spotify.com/v1/search"
            params = {"q": "Flume", "type": "artist"}
            headers = {"Authorization": f"Bearer {token}"}

            resp = requests.get(url, headers=headers, params=params)

            if resp.status_code == 200:
                log.debug("Token is valid.")
                return True

            elif resp.status_code == 401:
                log.debug("Token is not valid.")
                return False

            else:
                log.error(f"Unexpected status code: {resp.status_code}")
                raise Exception(resp.text)

        def token_renew(self):
            """
            Using refresh_token, requests and saves a new access token.
            """

            url = urljoin(self.api_url, "spotify/auth/renew")
            data = {
                "refresh_token": self.refresh_token,
                "ultrasonics_auth_hash": api_key.get_hash(True),
            }

            log.info("Requesting a new Spotify token, this may take a few seconds...")

            # Request with a long timeout to account for free Heroku start-up 😉
            resp = requests.post(url, data=data, timeout=60)

            if resp.status_code == 200:
                token = resp.json()["access_token"]

                log.debug(
                    f"Spotify renew data: {resp.text.replace(token, '***************')}"
                )

                with bz2.BZ2File(self.cache_file, "w") as f:
                    pickle.dump(resp.text, f)

                return token

            else:
                log.error(resp.text)
                raise Exception(
                    f"The response `when renewing Spotify token was unexpected: {resp.status_code}"
                )

        def request(self, sp_func, *args, **kwargs):
            """
            Used to call a spotipy function, with automatic catching and renewing on access token errors.
            """
            errors = 0

            # Try once again when error
            while errors <= 1:
                try:
                    return sp_func(*args, **kwargs)

                except spotipy.exceptions.SpotifyException as e:
                    # Renew token
                    log.error(e)
                    self.sp = spotipy.Spotify(auth=self.token_get(force=True))
                    errors += 1
                    continue

            # raise exception if no return
            raise Exception("An error occurred while trying to contact the Spotify api.")

        def search(self, track):
            """
            Used to search the Spotify API for a song, supplied in standard songs_dict format.
            Will attempt to match using fixed values (Spotify ID, ISRC) before moving onto fuzzy values.

            @returns:
            Spotify URI, confidence score
            """

            cutoff_regex = [
                "[([](feat|ft|featuring|original|prod).+?[)\]]",
                "[ (\- )\-]+(feat|ft|featuring|original|prod).+?(?=[(\n])",
            ]

            # 1. Spotify ID
            try:
                spotify_id = track["id"]["spotify"]
                spotify_uri = f"spotify:track:{spotify_id}"
                confidence = 100

                return spotify_uri, confidence

            except KeyError:
                # Spotify ID was not supplied
                pass

            # 2. Other fields
            # Multiple searches are made as Spotify is more likely to return false negative (missing songs)
            # than false positive, when specifying many query parameters.

            queries = []

            try:
                # If ISRC exists, only use that query
                queries.append(f"isrc:{track['isrc']}")
            except KeyError:
                # If no ISRC, add all additional queries
                try:
                    title = (
                        re.sub(cutoff_regex[0], "", track["title"], flags=re.IGNORECASE)
                        + "\n"
                    )

                    title = re.sub(
                        cutoff_regex[1], " ", title, flags=re.IGNORECASE
                    ).strip()
                except KeyError:
                    pass

                try:
                    album = (
                        re.sub(cutoff_regex[0], "", track["album"], flags=re.IGNORECASE)
                        + "\n"
                    )

                    album = re.sub(
                        cutoff_regex[1], " ", album, flags=re.IGNORECASE
                    ).strip()
                except KeyError:
                    pass

                try:
                    queries.append(f"track:{title} album:{album}")
                except NameError:
                    pass

                try:
                    for artist in track["artists"]:
                        queries.append(f'track:"{title}" artist:"{artist}"')
                except NameError:
                    pass

                # try:
                #     queries.append(f"track:{title}")
                # except NameError:
                #     pass

            results_list = []

            # Execute all queries
            for query in queries:
                results = self.request(self.sp.search, query)

                # Convert to ultrasonics format and append to results_list
                for item in results["tracks"]["items"]:
                    item = s.spotify_to_songs_dict(item)
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
                    if confidence > 100:
                        break

            spotify_uri = f"spotify:track:{matched_track['id']['spotify']}"

            return spotify_uri, confidence

        def current_user_playlists(self):
            """
            Wrapper for Spotify `current_user_playlists` which overcomes the request item limit.
            """
            limit = 50
            playlists = self.request(
                self.sp.current_user_playlists, limit=limit, offset=0
            )["items"]

            playlist_count = len(playlists)
            i = 1

            # Get all playlists from the user
            while playlist_count == limit:
                buffer = self.request(
                    self.sp.current_user_playlists, limit=limit, offset=limit * i
                )["items"]

                playlists.extend(buffer)
                playlist_count = len(buffer)
                i += 1

            log.info(f"Found {len(playlists)} playlist(s) on Spotify.")

            return playlists

        def current_user_saved_tracks(self, page=0):
            """
            Wrapper for Spotipy `current_user_saved_tracks`, which allows page selection to get earlier tracks.
            """
            limit = 20
            offset = limit * page

            tracks = self.request(
                self.sp.current_user_saved_tracks, limit=limit, offset=offset
            )["items"]

            spotify_ids = [item["track"]["id"] for item in tracks]

            return spotify_ids, tracks

        def playlist_tracks(self, playlist_id):
            """
            Wrapper for Spotipy `playlist_tracks` which overcomes the request item limit.
            """
            limit = 100
            fields = "items(track(album(name,release_date),artists,id,name,track_number,external_ids))"
            tracks = self.request(
                self.sp.playlist_tracks,
                playlist_id,
                limit=limit,
                offset=0,
                fields=fields,
            )

            tracks = tracks["items"]
            i = 1

            do_extend = len(tracks) == limit

            # Get all tracks from the playlist
            while do_extend:
                buffer = self.request(
                    self.sp.playlist_tracks,
                    playlist_id,
                    limit=limit,
                    offset=limit * i,
                    fields=fields,
                )["items"]

                tracks.extend(buffer)
                do_extend = len(buffer) == limit

                i += 1

            track_list = []

            # Convert from Spotify API format to ultrasonics format
            log.info("Converting tracks to ultrasonics format.")
            for track in tqdm(
                [track["track"] for track in tracks],
                desc=f"Converting tracks in {playlist_id}",
            ):
                try:
                    track_list.append(s.spotify_to_songs_dict(track))
                except TypeError:
                    log.error(
                        f"Could not convert track {track['id']} to ultrasonics format."
                    )
                    continue

            return track_list

        def user_playlist_remove_all_occurrences_of_tracks(self, playlist_id, tracks):
            """
            Wrapper for the spotipy function of the same name.
            Removes all `tracks` from the specified playlist.
            """
            self.request(
                self.sp.user_playlist_remove_all_occurrences_of_tracks,
                self.user_id,
                playlist_id,
                tracks,
            )

        def spotify_to_songs_dict(self, track):
            """
            Convert dictionary received from Spotify API to ultrasonics songs_dict format.
            """
            artists = [artist.get("name") for artist in track.get("artists", [])]
            album = track.get("album", {}).get("name")
            date = track.get("album", {}).get("release_date")
            isrc = track.get("external_ids", {}).get("isrc")

            item = {
                "title": track.get("name"),
                "artists": artists,
                "album": album,
                "date": date,
                "isrc": isrc,
            }

            if track.get("id"):
                item["id"] = {"spotify": str(track.get("id"))}
            else:
                item["id"] = {}
                log.debug(f"Invalid spotify id for song: {track.get('name')}")

            # Remove any empty fields
            item = {k: v for k, v in item.items() if v}

            return item

        def user_id(self):
            """
            Get and return the current user's user ID.
            """
            user_info = self.request(self.sp.current_user)
            self.user_id = user_info["id"]

    class Database:
        """
        Class for interactions with the up_spotify database.
        Currently used for storing info about saved songs.
        """

        def __init__(self):
            # Create database if required
            self.saved_songs_db = os.path.join(
                _ultrasonics["config_dir"], "up_spotify", "saved_songs.db"
            )

            with sqlite3.connect(self.saved_songs_db) as conn:
                cursor = conn.cursor()

                # Create saved songs table if needed
                query = "CREATE TABLE IF NOT EXISTS saved_songs (applet_id TEXT, spotify_id TEXT)"
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

        def saved_songs_contains(self, spotify_id):
            """
            Checks if the input `spotify_id` is present in the saved songs database.
            """
            with sqlite3.connect(self.saved_songs_db) as conn:
                cursor = conn.cursor()

                query = "SELECT EXISTS(SELECT * FROM saved_songs WHERE applet_id = ? AND spotify_id = ?)"
                cursor.execute(query, (applet_id, spotify_id))

                rows = cursor.fetchone()

                return rows[0]

        def saved_songs_add(self, spotify_ids):
            """
            Adds all songs in a list of `spotify_ids` to the saved songs database for this applet.
            """
            with sqlite3.connect(self.saved_songs_db) as conn:
                cursor = conn.cursor()

                # Add saved songs to database
                query = "INSERT INTO saved_songs (applet_id, spotify_id) VALUES (?, ?)"
                values = [(applet_id, spotify_id) for spotify_id in spotify_ids]
                cursor.executemany(query, values)

                conn.commit()

    s = Spotify()
    db = Database()

    s.api_url = global_settings["api_url"]

    auth = json.loads(database["auth"])
    s.refresh_token = auth["refresh_token"]

    s.sp = spotipy.Spotify(auth=s.token_get(), requests_timeout=60)

    if component == "inputs":
        if settings_dict["mode"] == "playlists":
            # Playlists mode

            # 1. Get a list of users playlists
            playlists = s.current_user_playlists()

            songs_dict = []

            for playlist in playlists:
                item = {"name": playlist["name"], "id": {"spotify": playlist["id"]}}

                songs_dict.append(item)

            # 2. Filter playlist titles
            songs_dict = name_filter.filter(songs_dict, settings_dict["filter"])

            # 3. Fetch songs from each playlist, build songs_dict
            log.info("Building songs_dict for playlists...")
            for i, playlist in tqdm(enumerate(songs_dict)):
                tracks = s.playlist_tracks(playlist["id"]["spotify"])

                songs_dict[i]["songs"] = tracks

            return songs_dict

        elif settings_dict["mode"] == "saved":
            # Saved songs mode
            if db.lastrun_get():
                # Update songs
                songs = []

                reached_limit = False
                page = 0

                # Loop until a known saved song is found
                while not reached_limit:
                    spotify_ids, tracks = s.current_user_saved_tracks(page=page)

                    for spotify_id, track in zip(spotify_ids, tracks):
                        if db.saved_songs_contains(spotify_id):
                            reached_limit = True
                            break
                        else:
                            songs.append(s.spotify_to_songs_dict(track["track"]))

                    page += 1

                if not songs:
                    log.info("No new saved songs were found. Exiting this applet.")
                    raise Exception("No new saved songs found on this applet run.")

                songs_dict = [
                    {
                        "name": settings_dict["playlist_title"]
                        or "Spotify Saved Songs",
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
                spotify_ids, _ = s.current_user_saved_tracks()

                # 2. Update database with saved songs
                db.saved_songs_add(spotify_ids)

                # 3. Update lastrun
                db.lastrun_set()

                raise Exception(
                    "Initial run of this plugin will not return a songs_dict. Database is now updated. Next run will continue as normal."
                )

    else:
        "Outputs mode"

        # Set the user_id variable
        s.user_id()

        # Get a list of current user playlists
        current_playlists = s.current_user_playlists()

        for playlist in songs_dict:
            # Check the playlist already exists in Spotify
            playlist_id = ""
            try:
                if playlist["id"]["spotify"] in [
                    item["id"] for item in current_playlists
                ]:
                    playlist_id = playlist["id"]["spotify"]
            except KeyError:
                if playlist["name"] in [item["name"] for item in current_playlists]:
                    playlist_id = [
                        item["id"]
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
                public = database["created_playlists"] == "Public"
                description = "Created automatically by ultrasonics with 💖"

                response = s.request(
                    s.sp.user_playlist_create,
                    s.user_id,
                    playlist["name"],
                    public=public,
                    description=description,
                )

                playlist_id = response["id"]

                existing_tracks = []
                existing_uris = []

            # Get all tracks already in the playlist
            if "existing_tracks" not in vars():
                existing_tracks = s.playlist_tracks(playlist_id)
                existing_uris = [
                    f"spotify:track:{item['id']['spotify']}" for item in existing_tracks
                ]

            # Add songs which don't already exist in the playlist
            uris = []
            duplicate_uris = []

            log.info("Searching for matching songs in Spotify.")
            for song in tqdm(
                playlist["songs"],
                desc=f"Searching Spotify for songs from {playlist['name']}",
            ):
                # First check for fuzzy duplicate without Spotify api search
                duplicate = False
                for item in existing_tracks:
                    score = fuzzymatch.similarity(song, item)

                    if score > float(database.get("fuzzy_ratio") or 90):
                        # Duplicate was found
                        duplicate_uris.append(f"spotify:track:{item['id']['spotify']}")
                        duplicate = True
                        break

                if duplicate:
                    continue

                uri, confidence = s.search(song)

                if uri in existing_uris:
                    duplicate_uris.append(uri)

                if confidence > float(database.get("fuzzy_ratio") or 90):
                    uris.append(uri)
                else:
                    log.debug(
                        f"Could not find song {song['title']} in Spotify; will not add to playlist."
                    )

            if settings_dict["existing_playlists"] == "Update":
                # Remove any songs which aren't in `uris` from the playlist
                remove_uris = [
                    uri for uri in existing_uris if uri not in uris + duplicate_uris
                ]

                s.user_playlist_remove_all_occurrences_of_tracks(
                    playlist_id, remove_uris
                )

            # Add tracks to playlist in batches of 100
            while len(uris) > 100:
                s.request(
                    s.sp.user_playlist_add_tracks, s.user_id, playlist_id, uris[0:100]
                )

                uris = uris[100:]

            # Add all remaining tracks
            if uris:
                s.request(s.sp.user_playlist_add_tracks, s.user_id, playlist_id, uris)


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
                        <input class="input" type="text" name="playlist_title" placeholder="Spotify Saved Songs">
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
