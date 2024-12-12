#!/usr/bin/env python3

"""
up_spotify mixer

Creates new playlists based on a seed input.

XDGFX, 2020
"""

import bz2
import json
import os
import pickle
import random
import re
from urllib.parse import urlencode, urljoin

import requests
import spotipy
from tqdm import tqdm

from app import _ultrasonics
from ultrasonics import logs
from ultrasonics.tools import api_key, fuzzymatch

log = logs.create_log(__name__)

handshake = {
    "name": "spotify mixer",
    "description": "generate brand new playlists from an input playlist",
    "type": [
        "modifiers"
    ],
    "mode": [
        "playlists",
        "songs"
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
            "label": "Fuzzy Ratio",
            "name": "fuzzy_ratio",
            "value": "Recommended: 90"
        }
    ]
}


def run(settings_dict, **kwargs):
    """
    For each playlist:
    1. Renames the title if requested.
    2. Searches for the songs in Spotify.
    3. Creates a recommended playlist based on seeds of five songs at a time.
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
            # Use same cache as up_spotify
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
                "[ (\- )\-]+(feat|ft|featuring|original|prod).+?(?=[(\n])"
            ]

            # 1. Spotify ID
            try:
                spotify_id = track["id"]["spotify"]
                confidence = 100

                return spotify_id, confidence

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
                    for artist in track["artists"]:
                        queries.append(
                            f'track:"{title}" artist:"{artist}"')
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

            spotify_id = matched_track['id']['spotify']

            return spotify_id, confidence

        def recommendations(self, seed_tracks):
            """
            Get a list of recommended tracks for input seeds.
            """
            songs = self.request(self.sp.recommendations,
                                 seed_tracks=seed_tracks, limit=100)["tracks"]

            return songs

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
                    "spotify": str(track["id"])
                }
            }

            # Remove any empty fields
            item = {k: v for k, v in item.items() if v}

            return item

    s = Spotify()

    s.api_url = global_settings["api_url"]

    auth = json.loads(database["auth"])
    s.refresh_token = auth["refresh_token"]

    s.sp = spotipy.Spotify(auth=s.token_get(), requests_timeout=60)

    playlist_titles = settings_dict["playlist_titles"].split(",")

    for playlist_index, playlist in enumerate(songs_dict):
        # Convert playlist title if requested
        new_title = playlist_titles[playlist_index] if playlist_index < len(
            playlist_titles) else playlist["name"]
        songs_dict[playlist_index]["name"] = new_title.strip(
        ) if new_title and new_title != "*" else playlist["name"]

        # Remove spotify playlist id if updated title
        if songs_dict[playlist_index]["name"] == new_title.strip():
            songs_dict[playlist_index]["id"] = {}

        spotify_ids = []

        log.info("Searching for matching songs in Spotify.")
        for song in tqdm(playlist["songs"], desc=f"Searching Spotify for songs from {playlist['name']}"):
            spotify_id, confidence = s.search(song)

            if not spotify_id:
                continue

            if confidence > float(database.get("fuzzy_ratio") or 90):
                spotify_ids.append(spotify_id)
            else:
                log.debug(
                    f"Could not find song {song['title']} in Spotify.")

        # If spotify_ids length is smaller or equal to 50, then take all of the items
        item_limit = 50
        if len(spotify_ids) > item_limit:
            spotify_ids = random.sample(spotify_ids, item_limit)

        # Slice spotify ids into sublists of len(5)
        spotify_ids = [spotify_ids[i:i+5]
                       for i in range(0, len(spotify_ids), 5)]

        # Get recommendations for each seed from Spotify, append to results
        results = []
        for seed in tqdm(spotify_ids, desc="Fetching recommendations"):
            results.extend(s.recommendations(seed))

        # Find any duplicate songs and mark as best_results
        best_results = [x for n, x in enumerate(
            results) if x in results[:n]]

        # Remove duplicates from remaining results
        results = [x for x in results if x not in best_results]

        # Concat length of best_results to 50 if > 50
        if len(best_results) > int(settings_dict["playlist_length"] or 50):
            best_results = random.sample(best_results, int(
                settings_dict["playlist_length"] or 50))

        # Fill best_results until requested playlist length is reached
        while len(best_results) < int(settings_dict["playlist_length"] or 50) and len(results) > 0:
            i = random.randint(0, len(results) - 1)
            best_results.append(results[i])
            del results[i]

        # Convert to ultrasonics format
        songs_list = [s.spotify_to_songs_dict(song) for song in best_results]

        # Update input songs_dict
        songs_dict[playlist_index]["songs"] = songs_list

    return songs_dict


def builder(**kwargs):
    database = kwargs["database"]
    global_settings = kwargs["global_settings"]
    component = kwargs["component"]

    settings_dict = [
        {
            "type": "string",
            "value": "ℹ️ This plugin will only use up to 50 randomly selected songs in each input playlist. If the input playlist is longer, the output may not be an accurate reflection of every song present."
        },
        {
            "type": "string",
            "value": "Would you like to keep the existing playlist names, or rename them?"
        },
        {
            "type": "string",
            "value": "To keep the existing playlist title, use an asterisk (*). If you input more than one playlist, you can rename multiple playlist titles by separating them with a comma (,)."
        },
        {
            "type": "text",
            "label": "Playlist Titles",
            "name": "playlist_titles",
            "value": "*"
        },
        {
            "type": "text",
            "label": "Output Playlist Length",
            "name": "playlist_length",
            "value": "50"
        }
    ]

    return settings_dict
