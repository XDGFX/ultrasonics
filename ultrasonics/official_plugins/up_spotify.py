#!/usr/bin/env python3

"""
up_spotify

Official input and output plugin for Spotify. Can access a user's public or private playlists,and read songs from, or save songs to them.
Will not overwrite songs already in a playlist, so stuff like date added are kept accurate.

XDGFX, 2020
"""

import bz2
import json
import os
import pickle
import re
from urllib.parse import urlencode, urljoin

import requests
import spotipy

from app import _ultrasonics
from ultrasonics import logs
from ultrasonics.tools import fuzzymatch, name_filter, api_key

log = logs.create_log(__name__)

handshake = {
    "name": "spotify",
    "description": "sync your playlists to and from spotify",
    "type": [
        "inputs",
        "outputs"
    ],
    "mode": [
        "playlists"
    ],
    "version": "0.1",
    "settings": [
        {
            "type": "auth",
            "label": "Authorise Spotify",
            "path": "/spotify/auth/request"
        },
        {
            "type": "string",
            "value": "Songs will always attempt to be matched using fixed values like ISRC or Spotify URI, however if you're trying to sync music without these tags, fuzzy matching will be used instead."
        },
        {
            "type": "string",
            "value": "This means that the titles 'You & Me - Flume Remix', and 'You & Me (Flume Remix)' will probably qualify as the same song [with a fuzzy score of 96.85 if all other fields are identical]. However, 'You, Me, & the Log Flume Ride' probably won't 🎢 [the score was 88.45 assuming *all* other fields are identical]. The fuzzyness of this matching is determined with the below setting. A value of 100 means all song fields must be identical to pass as duplicates. A value of 0 means any song will quality as a match, even if they are completely different. 👽"
        },
        {
            "type": "text",
            "label": "Default Global Fuzzy Ratio",
            "name": "fuzzy_ratio",
            "value": "Recommended: 90"
        },
        {
            "type": "string",
            "value": "If you sync a playlist to Spotify which doesn't already exist, ultrasonics will create a new playlist for you automatically ✨. Would you like any new playlists to be public or private?"
        },
        {
            "type": "radio",
            "label": "Created Playlists",
            "name": "created_playlists",
            "id": "created_playlists",
            "options": [
                "Public",
                "Private"
            ]
        }
    ]
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
                _ultrasonics["config_dir"], "up_spotify", "up_spotify.bz2")

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
            params = {
                "q": "Flume",
                "type": "artist"
            }
            headers = {
                "Authorization": f"Bearer {token}"
            }

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
                "ultrasonics_auth_hash": api_key.get_hash(True)
            }

            log.info(
                "Requesting a new Spotify token, this may take a few seconds...")

            # Request with a long timeout to account for free Heroku start-up 😉
            resp = requests.post(url, data=data, timeout=60)

            if resp.status_code == 200:
                token = resp.json()["access_token"]

                log.debug(
                    f"Spotify renew data: {resp.text.replace(token, '***************')}")

                with bz2.BZ2File(self.cache_file, "w") as f:
                    pickle.dump(resp.text, f)

                return token

            else:
                log.error(resp.text)
                raise Exception(
                    f"The response `when renewing Spotify token was unexpected: {resp.status_code}")

        def request(self, sp_func, *args, **kwargs):
            """
            Used to call a spotipy function, with automatic catching and renewing on access token errors.
            """
            errors = 0

            while errors <= 1:
                try:
                    return sp_func(*args, **kwargs)

                except spotipy.exceptions.SpotifyException as e:
                    # Renew token
                    log.error(e)
                    self.sp = spotipy.Spotify(auth=self.token_get(force=True))
                    errors += 1
                    continue

            log.error(
                "An error occurred while trying to contact the Spotify api.")
            raise Exception(e)

        def search(self, track):
            """
            Used to search the Spotify API for a song, supplied in standard songs_dict format.
            Will attempt to match using fixed values (Spotify ID, ISRC) before moving onto fuzzy values.

            @returns:
            Spotify URI, confidence score
            """

            cutoff_regex = [
                "[([](feat|ft|featuring|original|prod).+?[)\]]",
                "[ (\- )\-]+(feat|ft|featuring|original|prod).+?(?=[(\n])"
            ]

            # 1. Spotify ID
            try:
                spotify_id = track["id"]["spotify"]
                spotify_uri = f"spotify:track:{spotify_id}"
                confidence = 1

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
                    title = re.sub(cutoff_regex[0], "",
                                   track['title'], flags=re.IGNORECASE) + "\n"

                    title = re.sub(cutoff_regex[1], " ",
                                   title, flags=re.IGNORECASE).strip()
                except KeyError:
                    pass

                try:
                    album = re.sub(cutoff_regex[0], "",
                                   track['album'], flags=re.IGNORECASE) + "\n"

                    album = re.sub(cutoff_regex[1], " ",
                                   album, flags=re.IGNORECASE).strip()
                except KeyError:
                    pass

                try:
                    queries.append(f"track:{title} album:{album}")
                except NameError:
                    pass

                try:
                    queries.append(
                        f"track:{title} artist:{track['artists'][0]}")
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
                    results_list.append(s.spotify_to_songs_dict(item))

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
            playlists = self.request(self.sp.current_user_playlists,
                                     limit=limit, offset=0)["items"]

            playlist_count = len(playlists)
            i = 1

            # Get all playlists from the user
            while playlist_count == limit:
                buffer = self.request(self.sp.current_user_playlists,
                                      limit=limit, offset=limit * i)["items"]

                playlists.extend(buffer)
                playlist_count = len(buffer)
                i += 1

            log.info(f"Found {len(playlists)} playlist(s) on Spotify.")

            return playlists

        def playlist_tracks(self, playlist_id):
            """
            Wrapper for Spotify `playlist_tracks` which overcomes the request item limit.
            """
            limit = 100
            fields = "items(track(album(name,release_date),artists,id,name,track_number,external_ids))"
            tracks = self.request(self.sp.playlist_tracks, playlist_id,
                                  limit=limit, offset=0, fields=fields)

            tracks_count = len(tracks)
            i = 1

            # Get all tracks from the playlist
            while tracks_count == limit:
                buffer = self.request(self.sp.playlist_tracks, playlist_id,
                                      limit=limit, offset=limit * i, **kwargs)

                tracks.extend(buffer)
                tracks_count = len(buffer)
                i += 1

            tracks = tracks["items"]

            track_list = []

            # Convert from Spotify API format to ultrasonics format
            for track in [track["track"] for track in tracks]:
                track_list.append(s.spotify_to_songs_dict(track))

            return track_list

        def spotify_to_songs_dict(self, track):
            """
            Convert dictionary received from Spotify API to ultrasonics songs_dict format.
            Assumes title, artist(s), and id field are always present.
            """
            artists = [artist["name"] for artist in track["artists"]]

            try:
                album = track["album"]["name"]
            except KeyError:
                album = None

            try:
                date = track["album"]["release_date"]
            except KeyError:
                date = None

            try:
                isrc = track["external_ids"]["isrc"]
            except KeyError:
                isrc = None

            item = {
                "title": track["name"],
                "artists": artists,
                "album": album,
                "date": date,
                "isrc": isrc,
                "id": {
                    "spotify": track["id"]
                }
            }

            # Remove any empty fields
            item = {k: v for k, v in item.items() if v}

            return item

        def user_id(self):
            """
            Get and return the current user's user ID.
            """
            user_info = self.request(self.sp.current_user)
            self.user_id = user_info["id"]

        def current_user_playlist_add_tracks(self, playlist_id, tracks):
            """
            Add a series of tracks to a playlist.
            """
            # self.sp.user_playlist_add_tracks(self.user_id, playlist_id, tracks)
            pass

    s = Spotify()

    s.api_url = global_settings["api_url"]

    auth = json.loads(database["auth"])
    s.refresh_token = auth["refresh_token"]

    s.sp = spotipy.Spotify(auth=s.token_get())

    if component == "inputs":
        # 1. Get a list of users playlists
        playlists = s.current_user_playlists()

        songs_dict = []

        for playlist in playlists:
            item = {
                "name": playlist["name"],
                "id": {
                    "spotify": playlist["id"]
                }
            }

            songs_dict.append(item)

        # 2. Filter playlist titles
        songs_dict = name_filter.filter(songs_dict, settings_dict["filter"])

        # 3. Fetch songs from each playlist, build songs_dict
        for i, playlist in enumerate(songs_dict):
            tracks = s.playlist_tracks(playlist["id"]["spotify"])

            songs_dict[i]["songs"] = tracks

        return songs_dict

    else:
        "Outputs mode"

        # Set the user_id variable
        s.user_id()

        # Get a list of current user playlists
        current_playlists = s.current_user_playlists()

        playlist_id = ""

        for playlist in songs_dict:
            # Check the playlist already exists in Spotify
            try:
                if playlist["id"]["spotify"] in [item["id"] for item in current_playlists]:
                    playlist_id = playlist["id"]["spotify"]
            except KeyError:
                if playlist["name"] in [item["name"] for item in current_playlists]:
                    playlist_id = [
                        item["id"] for item in current_playlists if item["name"] == playlist["name"]][0]
            if playlist_id:
                log.info(
                    f"Playlist {playlist['name']} already exists, updating that one.")
            else:
                log.info(
                    f"Playlist {playlist['name']} does not exist, creating it now...")
                # Playlist must be created
                public = database["created_playlists"] == "Public"
                description = "Created automatically by ultrasonics with 💖"

                response = s.request(s.sp.user_playlist_create, s.user_id,
                                     playlist["name"], public=public, description=description)

                playlist_id = response["id"]

                existing_tracks = []

            # Get all tracks already in the playlist
            if "existing_tracks" not in vars():
                existing_tracks = s.playlist_tracks(playlist_id)
                existing_uris = ["spotify:track:" + item["id"]["spotify"]
                                 for item in existing_tracks]

            # Add songs which don't already exist in the playlist
            uris = []

            for song in playlist["songs"]:
                # First check for fuzzy duplicate without Spotify api search
                if not fuzzymatch.duplicate(song, existing_tracks, database["fuzzy_ratio"]):
                    uri, confidence = s.search(song)

                    if uri in existing_uris:
                        # Song already exists
                        continue

                    if confidence > float(database["fuzzy_ratio"]):
                        uris.append(uri)
                    else:
                        log.debug(
                            f"Could not find song {song['title']} in Spotify; will not add to playlist.")

            # Add tracks to playlist in batches of 100
            while len(uris) > 100:
                s.request(s.sp.user_playlist_add_tracks, s.user_id,
                          playlist_id, uris[0:100])

                uris = uris[100:]

            # Add all remaining tracks
            if uris:
                s.request(s.sp.user_playlist_add_tracks, s.user_id,
                          playlist_id, uris)


def builder(**kwargs):
    component = kwargs["component"]

    if component == "inputs":
        settings_dict = [
            {
                "type": "text",
                "label": "Filter",
                "name": "filter",
                "value": ""
            },
            {
                "type": "string",
                "value": "You can use regex style filters to only select certain playlists. For example, 'disco' would sync playlists 'Disco 2010' and 'nu_disco', or '2020$' would only sync playlists which ended with the value '2020'."
            },
            {
                "type": "string",
                "value": "Leave it blank to sync everything 🤓."
            }
        ]

        return settings_dict

    else:
        return ""
