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
        test_array = [item[key] for item in song_list]

        if song[key] in test_array:
            return True

    # Check fuzzy matches
    results = []
    artist_string = " ".join(song["artists"])

    for item in song_list:
        # Name and album scores
        for key in ["name", "album"]:
            results[key] = fuzz.ratio(song[key], song_list[key])

        # Date score
        results["date"] = fuzz.token_set_ratio(song["date"], song_list["date"])

        # Artist score can be a partial match; allowing missing artists
        results["artist"] = fuzz.partial_ratio(
            artist_string, " ".join(item["artists"]))

        total_score = results["name"] * 0.35 \
            + results["artist"] * 0.35 \
            + results["album"] * 0.2 \
            + results["date"] * 0.1

        # If threshold is surpassed, no need to keep testing
        if total_score > threshold:
            return True

    # No match was found
    return False
