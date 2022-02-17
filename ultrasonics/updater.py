#!/usr/bin/env python3

"""
updater
Checks for updates, and will possibly update everything in the future.

Steve-Tech, 2022
"""

import requests
from requests.exceptions import RequestException
from threading import Timer
from ultrasonics import logs

log = logs.create_log(__name__)

version = None
new_version = None

def get_version():
    request = requests.get("https://api.github.com/repos/XDGFX/ultrasonics/releases")
    return request.json()[0]

def update_version():
    global new_version
    log.debug("Checking for updates")
    new_version = get_version()['name']
    log.debug("Newest version: %s", new_version)
    if new_version != version:
        log.info("Update Available: %s", new_version)

def start(current):
    global version, new_version
    version = current
    new_version = current
    try:
        update_version()
        thread = Timer(3600, update_version)
    except RequestException:
        log.warning("Could not check for updates.")
