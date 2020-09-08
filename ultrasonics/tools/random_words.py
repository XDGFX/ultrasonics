#!/usr/bin/env python3

"""
random_words
Returns random words based on input parameters. Wordlist from @RazorSh4rk

XDGFX, 2020
"""

import io
import json
import os
import random


def words(length, separator):
    """
    Returns a string of random words of length `length`, separated by `separator`.
    """
    output = []

    with io.open(os.path.join(os.path.dirname(__file__), "wordlist.json")) as f:
        words = json.load(f)
        for i in range(length):
            n = random.randint(0, len(words))
            output.append(words[n])

    return separator.join(output)
