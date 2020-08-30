#!/usr/bin/env python3

import ast
import io
import os
from urllib.parse import urlencode, urljoin

import requests
import spotipy

from ultrasonics import logs
from ultrasonics.tools.name_filter import name_filter

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
            "type": "text",
            "label": "Auth",
            "name": "auth",
            "value": "Auth token goes here"
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
        }
    ]
}


def run(settings_dict, **kwargs):
    """
    The function called when the applet runs.

    Inputs:
    settings_dict      Settings specific to this plugin instance
    database           Global persistent settings for this plugin
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

    class Spotify:
        """
        Class for interactions with Spotify through the Spotipy api.
        """

        def __init__(self):
            self.cache_file = os.path.join(os.path.dirname(__file__), ".cache")

        def request(self, sp_func, *args, **kwargs):
            """
            Used to call a spotipy function, with automatic catching and renewing on access token errors.
            """
            errors = 0

            while errors <= 1:
                try:
                    return sp_func(*args, **kwargs)

                except spotipy.exceptions.SpotifyException as e:
                    if e.startswith("http status: 401"):
                        # Renew token
                        self.sp = spotipy.Spotify(auth=token_get())
                        errors += 1
                        continue

                    else:
                        log.error(
                            "An error occured while trying to contact the Spotify api.")
                        raise Exception(e)

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

            return playlists

        def playlist_tracks(self, playlist_id, **kwargs):
            """
            Wrapper for Spotify `playlist_tracks` which overcomes the request item limit.
            """
            limit = 100
            tracks = self.request(self.sp.playlist_tracks, playlist_id,
                                  limit=limit, offset=0, **kwargs)

            tracks_count = len(tracks)
            i = 1

            # Get all tracks from the playlist
            while tracks_count == limit:
                buffer = self.request(self.sp.playlist_tracks, playlist_id,
                                      limit=limit, offset=limit * i, **kwargs)

                tracks.extend(buffer)
                tracks_count = len(buffer)
                i += 1

            return tracks

        def token_get(self):
            """
            Updates the global access_token variable, in the following order of preference:
            1. A locally saved access token.
            2. Renews token using the database refresh_token.

            If #2, the access token is saved to a .cache file.
            """
            if os.path.isfile(self.cache_file):
                with io.open(self.cache_file, "r") as f:
                    raw = ast.literal_eval(f.read())
                    token = raw["access_token"]

                # Checks that the cached token is valid
                if self.token_validate(token):
                    return token

            # In all other cases, renew the token
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
                "refresh_token": self.refresh_token
            }

            # Request with a long timeout to account for free Heroku startup 😉
            resp = requests.post(url, data=data, timeout=60)

            if resp.status_code == 200:
                log.debug(f"Spotify renew data: {resp.text}")

                with io.open(self.cache_file, "w") as f:
                    f.write(resp.text)

                token = resp.json()["access_token"]

                return token

            else:
                log.error(resp.text)
                raise Exception(
                    f"The response `when renewing Spotify token was unexpected: {resp.status_code}")

    s = Spotify()

    s.api_url = global_settings["api_url"]

    auth = ast.literal_eval(database["auth"])
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
        fields = "items(track(album(name,release_date),artists,id,name,track_number,external_ids))"
        for i, playlist in enumerate(songs_dict):
            tracks = s.playlist_tracks(
                playlist["id"]["spotify"], fields=fields)["items"]

            track_list = []
            for track in [track["track"] for track in tracks]:
                artists = [artist["name"] for artist in track["artists"]]

                item = {
                    "title": track["name"],
                    "artists": artists,
                    "album": track["album"]["name"],
                    "date": track["album"]["release_date"],
                    "isrc": track["external_ids"]["isrc"],
                    "id": {
                        "spotify": track["id"]
                    }
                }

                track_list.append(item)

            songs_dict[i]["songs"] = track_list

        return songs_dict

    else:
        # 1.
        pass


# def test(database, **kwargs):
#     """
#     An optional test function. Used to validate persistent settings supplied in settings_dict.
#     Any errors raised will be caught and displayed to the user for debugging.
#     If this function is present, test failure will prevent the plugin being added.
#     """

#     global_settings = kwargs["global_settings"]
#     auth = ast.literal_eval(database["auth"])

#     pass


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
