#!/usr/bin/env python3

import importlib
import os
import re
import json

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
            handshake_version = plugin.handshake["version"]
            handshake_settings = json.dumps(plugin.handshake["settings"])

            # Verify that the name in the plugin handshake matches the filename
            if handshake_name != title:
                print("Error: plugin name must match the filename!")
                continue

            # Add the plugin handshake to the list of handshakes, and the plugin to the list of found plugins
            handshakes.append(plugin.handshake)
            found[title] = plugin

            # If a database entry is not found for the plugin and version, create one
            if not (handshake_version in database.plugin_entry_exists(title)):
                database.plugin_create_entry(
                    title, handshake_version, handshake_settings)


def gather_applets():
    """
    Gather the list of existing applets.
    """
    pass


def applet_add_plugin(plugin, settings):
    """
    Function which takes a plugin as an input and adds it to the current applet.
    """
    pass


def applet_remove_plugin(plugin):
    """
    Function which removes a plugin from the current applet.
    """
    pass


def applet_clear():
    """
    Clears the current applet to start from fresh.
    """
    pass


def applet_load(applet):
    """
    Load an existing applet to be edited.
    """


def applet_build():
    """
    Function which takes the current applet and builds the config, and saves it to the database. It will update if the applet came from applet_load.
    """
    pass
