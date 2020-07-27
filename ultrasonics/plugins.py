#!/usr/bin/env python3

import importlib
import os
import re

# Initialise variables
found = {}
handshakes = []

# Prefix for all plugins in plugins folder
prefix = "up_"


def gather_plugins():
    """
    Used to find all variables within the ./plugins directory, and saves them to the 'found' dictionary.
    """

    from ultrasonics import database
    database.connect()

    plugins = os.listdir("./plugins")

    for item in plugins:

        # Check if file has .py extension
        if re.match(prefix + "([\w\W]+)\.py", item):

            # Extract name of file excluding extension
            title = re.search(prefix + "([\w\W]+)\.py", item)[1]

            plugin = importlib.import_module(
                "plugins." + prefix + title, ".")

            handshake_name = plugin.handshake["name"]

            # Verify that the name in the plugin handshake matches the filename
            if handshake_name != title:
                print("Error: plugin name must match the filename!")
                continue

            # Add the plugin handshake to the list of handshakes, and the plugin to the list of found plugins
            handshakes.append(plugin.handshake)
            found[title] = plugin

            # If a database table is not found, create one
            if not database.table_exists(title):
                # settings = 
                database.create_plugin_table(title, settings)
