#!/usr/bin/env python3

"""
plugins
Handles all functions for interacting with plugins and applets.

XDGFX, 2020
"""

import importlib
import json
import os
import re

from ultrasonics import database, logs, scheduler

log = logs.create_log(__name__)

# Initialise variables
found_plugins = {}
handshakes = []

# Prefix for all plugins in plugins folder, up stands for ultrasonics plugin ;)
prefix = "up_"


def plugin_gather():
    """
    Used to find all variables within the ./plugins directory, and saves them to the 'found_plugins' dictionary.
    """
    for _, _, items in os.walk("./plugins"):
        for item in items:

            # Check if file has .py extension
            if re.match(prefix + "([\w\W]+)\.py$", item):

                # Extract name of file excluding extension
                title = re.search(prefix + "([\w\W]+)\.py$", item)[1]

                plugin = importlib.import_module(
                    f"plugins.{prefix + title}.{prefix + title}", ".")

                for key in ["name", "description"]:
                    plugin.handshake[key] = plugin.handshake[key].lower().strip(
                        " .,")

                handshake_name = plugin.handshake["name"]
                handshake_version = plugin.handshake["version"]

                # Verify that the name in the plugin handshake matches the filename
                if handshake_name != title:
                    log.error("Plugin name must match the filename!")
                    log.error(plugin)
                    continue

                # Add the plugin handshake to the list of handshakes, and the plugin to the list of found plugins
                handshakes.append(plugin.handshake)
                found_plugins[title] = plugin

                log.info(f"Found plugin: {plugin}")

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


def plugin_build(name, version, component, force=False):
    """
    Find the required settings for a plugin when building an applet.
    """
    plugin_settings = database.plugin_load_entry(name, version)

    # Plugin has not yet been configured
    if not plugin_settings and not force:
        return None

    settings_dict = found_plugins[name].builder(plugin_settings, component)
    return settings_dict


def plugin_update(name, version, settings):
    """
    Send updated persistent plugin settings to the database.
    """
    database.plugin_update_entry(name, version, settings)


def plugin_run(name, version, settings_dict, songs_dict=None, component=None, applet_id=None):
    """
    Run a specific plugin.

    INPUTS
    name:            name of plugin
    version:         version of plugin
    settings_dict:   settings to run this specific instance of the plugin, taken from the applet
    songs_dict:      passed to the plugin if not an input

    OUTPUTS
    response:        either a success message, or the new songs_dict
    """
    log.debug(f"Running plugin {name} v{version}")
    plugin_settings = database.plugin_load_entry(name, version)

    response = found_plugins[name].run(
        settings_dict, database=plugin_settings, songs_dict=songs_dict, component=component, applet_id=applet_id)

    return response


def plugin_test(name, version, database=None, component=None):
    """
    Get the test function from a specified plugin.
    If settings_dict is None, will check if a test function exists for the plugin, returning True or False.
    Otherwise, settings_dict contains the persistent settings (in standard database format) to validate.
    Plugin test function should return True or False for pass and fail respectively.
    """

    if getattr(found_plugins[name], 'test', None) is None:
        log.info(f"{name} does not have a test function.")
        return False

    elif database == {}:
        return {"response": False, "logs": "ERROR   - No database values were received!"}

    elif database:
        logs_name = f"plugins.up_plex.up_plex"
        plugin_log = logs.start_capture(logs_name)

        plugin_log.debug(f"Running settings test for plugin {name} v{version}")

        try:
            found_plugins[name].test(database)
            logs_string = logs.stop_capture(logs_name)
            return {"response": True, "logs": logs_string}

        except Exception as e:
            plugin_log.error("Plugin test failed.")
            plugin_log.error(e)
            logs_string = logs.stop_capture(logs_name)
            return {"response": False, "logs": logs_string}

    else:
        return True


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
    scheduler.applet_submit(applet_id)


def applet_delete(applet_id):
    """
    Remove an applet from the database.
    """
    database.applet_delete_entry(applet_id)


def applet_run(applet_id):
    """
    Run the requested applet in full.
    """
    from datetime import datetime

    runtime = datetime.now()

    log.info(f"Running applet: {applet_id}")

    try:
        applet_plans = database.applet_load_entry(applet_id)

        if not applet_plans["inputs"] or not applet_plans["outputs"]:
            raise Exception(
                f"An input or output plugin is missing for applet {applet_id} - will not run.")

        else:
            songs_dict = []

            def get_info(pluign):
                name = plugin["plugin"]
                version = plugin["version"]
                data = plugin["data"]

                return name, version, data

            "Inputs"
            # Get new songs from input, append to songs list
            for plugin in applet_plans["inputs"]:
                for item in plugin_run(*get_info(plugin), component="inputs", applet_id=applet_id):
                    songs_dict.append(item)

            "Modifiers"
            # Replace songs with output from modifier plugin
            for plugin in applet_plans["modifiers"]:
                songs_dict = plugin_run(
                    *get_info(plugin), songs_dict=songs_dict, component="modifiers", applet_id=applet_id)

            "Outputs"
            # Submit songs dict to output plugin
            for plugin in applet_plans["outputs"]:
                plugin_run(*get_info(plugin), songs_dict=songs_dict,
                           component="outputs", applet_id=applet_id)

            success = True

    except Exception as e:
        log.error(e)

        success = False

    if success:
        log.info(
            f"Applet {applet_id} completed successfully in {datetime.now() - runtime}")
    else:
        log.info(
            f"Applet {applet_id} failed in {datetime.now() - runtime}")

    lastrun = {
        "time": runtime.strftime("%d-%m-%Y %H:%M"),
        "result": success
    }

    database.applet_update_lastrun(applet_id, lastrun)


def applet_trigger_run(applet_id):
    """
    Run the trigger function from the requested applet.
    """
    applet_plans = database.applet_load_entry(applet_id)

    if not applet_plans["triggers"]:
        log.error(
            f"No trigger is supplied for applet {applet_id} - will not run automatically.")
        raise Exception

    for trigger in applet_plans["triggers"]:
        name = trigger["plugin"]
        version = trigger["version"]
        data = trigger["data"]

        plugin_run(name, version, data, applet_id=applet_id)
