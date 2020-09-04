#!/usr/bin/env python3

"""
version_check
Compares semantic version numbering strings to determine if a migration is possible.
Migration is only possible when the supplied minor or patch `version` is newer than all versions in `tests`.
If a major version, do not migrate.

`version` is never in `tests`

@returns:
False OR
Version string

XDGFX, 2020
"""


def check(version, tests):
    """
    Check if plugin `version` settings can be migrated from a previous version in `tests`.
    """
    # Split string into numbers
    new_version = [int(num)
                   for num in version.split(".")]

    # Determine length of version (e.g. 1.0.0 or 1.0 or 1)
    test_length = len(new_version)

    # Initialise max_version variable with zeros
    max_version = [0] * test_length

    # Convert tests to int
    tests = [[int(item) for item in version.split(".")] for version in tests]

    # Loop over each existing version, and find the latest old version
    for version in tests:
        # Decrease test length if needed
        test_length_min = min([test_length, len(version)])

        for i in range(test_length_min):
            if version[i] < max_version[i]:
                # Version lower
                break
            elif version[i] > max_version[i]:
                # Version higher
                max_version = version
                break

    migrate = False
    for i in range(min([test_length, len(max_version)])):
        if max_version[i] < new_version[i]:
            if i == 0:
                # Cannot migrate as major version has been incremented
                break
            else:
                # Minor or patch version is old; can migrate
                migrate = True
                break
        elif max_version[i] == new_version[i]:
            # Version is the same
            continue
        else:
            # Version is too new
            break

    if migrate:
        return ".".join([str(num) for num in max_version])
    else:
        return False
