#!/usr/bin/env python3

import importlib
import json
import os
import re

from ultrasonics import database, logs

log = logs.create_log(__name__)

# Initialise variables
found = {}
handshakes = []

# Prefix for all plugins in plugins folder, up stands for ultrasonics plugin ;)
prefix = "up_"


def plugin_gather():
    """
    Used to find all variables within the ./plugins directory, and saves them to the 'found' dictionary.
    """

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
                    title, handshake_version)


def plugin_load(name, version):
    """
    Load plugin persistent settings.
    """
    plugin_settings = database.plugin_load_entry(name, version)

    return plugin_settings


def plugin_build(name, version):
    """
    Find the required settings for a plugin when building an applet.
    """
    plugin_settings = database.plugin_load_entry(name, version)

    # Plugin has not yet been configured
    if not plugin_settings:
        return None

    settings_dict = found[name].builder(plugin_settings)
    return settings_dict


def plugin_update(name, version, settings):
    """
    Send updated persistent plugin settings to the database.
    """
    database.plugin_update_entry(name, version, settings)


def applet_gather():
    """
    Gather the list of existing applets.
    """
    applet_list = database.applet_gather()
    return applet_list


def applet_load(applet_id):
    """
    Load an existing applet to be edited.
    """
    applet_plans = database.applet_load_entry(applet_id)

    # Add applet id back into plans dict
    applet_plans["applet_id"] = applet_id

    return applet_plans


def applet_build(applet_plans):
    """
    Function which takes input data from the frontend to build a new applet. If the applet ID matches an existing one, it will be updated.
    """
    applet_id = applet_plans["applet_id"]
    applet_plans.pop("applet_id")

    database.applet_create_entry(applet_id, applet_plans)


def applet_delete(applet_id):
    """
    Remove an applet from the database.
    """
    database.applet_delete_entry(applet_id)


def applet_run(applet_id):
    """
    Run the requested applet.
    """
    pass
