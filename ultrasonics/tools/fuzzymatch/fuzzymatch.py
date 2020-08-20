#!/usr/bin/env python3

"""
fuzzymatch
Fuzzy-string song matching tool for ultrasonics.

Given an input song, input playlist data, and a threshold, the song is checked for duplicates,
returning True if one is found. The weighting for each song field is:

    1. 'location'               Overrides all following fields
    2. 'isrc', 'id'             Overrides all following fields
    3. 'title'                  Weighted equally important at 35%   (uses Simple Ratio)
    3. 'artist'                 Weighted equally important at 35%   (uses Partial Ratio)
    4. 'album'                  Weighted less important at 20%      (uses Simple Ratio)
    5. 'date'                   Weighted least important at 10%     (uses Token Set Ratio)

It goes without saying that inaccurate music tags (such as from local files) may produce inaccurate results.

XDGFX, 2020
"""

import re

from fuzzywuzzy import fuzz, process

from ultrasonics import logs

log = logs.create_log(__name__)


def match(song, song_list, threshold):
    """
    Determines if `song` is present in `song_list`, with a supplied fuzziness threshold.
    Uses standard ultrasonics style song dictionaries.
    """
    # Check exact matchers
    for key in ["location", "isrc", "id"]:
        if key in song:
            test_array = [item[key] for item in song_list if (key in item)]

            if song[key] in test_array:
                return True

    # Check fuzzy matches
    results = {}
    artist_string = " ".join(song["artists"])

    # List of words and patterns to ignore when testing similarity
    cutoff_regex = "[([](feat|ft|featuring|original|prod).+?\b(?<!remix)[)\]]"

    for item in song_list:
        # Name and album scores
        for key in ["title", "album"]:

            try:
                a = re.sub(cutoff_regex, "", song[key], flags=re.IGNORECASE)
                b = re.sub(cutoff_regex, "", item[key], flags=re.IGNORECASE)

                results[key] = fuzz.ratio(a, b)

            except KeyError:
                pass

        # Date score
        try:
            results["date"] = fuzz.token_set_ratio(song["date"], item["date"])
        except KeyError:
            pass

        # Artist score can be a partial match; allowing missing artists
        try:
            results["artist"] = fuzz.partial_ratio(
                artist_string, " ".join(item["artists"]))
        except KeyError:
            pass

        weight = {
            "title": 0.35,
            "artist": 0.35,
            "album": 0.2,
            "date": 0.1
        }

        # Fix weightings if values are missing
        corrector = 0
        for key in weight.keys():
            if key in results.keys():
                corrector += weight[key]

        if corrector == 0:
            return False

        # Weighted average all scores
        total_score = sum([results[key] / 100 * weight[key]
                           for key in results.keys()])
        total_score = total_score / corrector

        # If threshold is surpassed, no need to keep testing
        if total_score > threshold:
            return True

    # No match was found
    return False
