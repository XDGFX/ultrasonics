#!/usr/bin/env python3

"""
app
Main ultrasonics entrypoint. Run this to start ultrasonics.

XDGFX, 2020
"""

import os

from ultrasonics import updater, database, plugins, scheduler, webapp

_ultrasonics = {
    "version": "1.0.0-rc.1",
    "config_dir": os.path.join(os.path.dirname(__file__), "config")
}

def start():
    updater.start(_ultrasonics["version"])
    database.Core().connect()
    plugins.plugin_gather()
    scheduler.scheduler_start()
    webapp.server_start()

if __name__ == "__main__":
    start()
