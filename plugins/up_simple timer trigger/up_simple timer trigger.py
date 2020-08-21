#!/usr/bin/env python3

from ultrasonics import logs
import json
import os
import io
import time

log = logs.create_log(__name__)

handshake = {
    "name": "simple timer trigger",
    "description": "Time based trigger plugin",
    "type": [
        "triggers"
    ],
    "mode": [
        "playlists",
        "songs"
    ],
    "version": 0.2,
    "settings": [
        
    ]
}


def run(settings_dict, database, component=None, songs_dict=None):
    """
    Creates a JSON file containing the date of creation of the applet/last run of the applet
    and takes the interval time given by the user to calculate the sleep time which will
    keep the program on hold until the next applet run
    """
    # bypass the trigger run if continuous runtime is selected
    if not ("continious_runtime" in settings_dict):
        # Create a date_dict.json file if non exists and save the current date in it
        # This only happens on creation
        if not os.path.isfile(os.path.join(os.path.dirname(__file__), "date_dict.json")):

            # Variable containing the current timestamp in unix epoch format (seconds)
            date_created = int(time.time())

            # create a dictionary to store the creation date
            date_dict = {
                "date": date_created
            }
            # store the date in the JSON file
            with io.open(os.path.join(os.path.dirname(__file__), "date_dict.json"), 'w') as outfile:
                json.dump(date_dict, outfile)

        # load the data stored in the JSON file
        date_dict = json.load(io.open(os.path.join(os.path.dirname(__file__), "date_dict.json")))

        # fetch the last sync date from the date_dict
        last_sync_date = date_dict["date"]
       
        # load the interval time multiplier input from the settings_dict
        try:
            interval_multiplier = int(settings_dict["interval_input"])
            success = True
        except Exception as e:
            log.error(e)
            success = False
            # if unsuccessful set the multiplier to 1
        if not success:
            log.info(f"Trigger plugin input multipler undefined, setting it to 1")
            interval_multiplier = 1

        interval_selection = settings_dict["update_frequency"]

        # this dictionary translates the interval_selection to seconds
        interval_options = {
            "Hours": 3600,
            "Days": 86400,
            "Weeks": 604800,
            "Months": 2628000
        }

        # get the interval in seconds
        interval = interval_options[interval_selection] * interval_multiplier

        # take the current date
        current_date = int(time.time())

        # calculate the sleep time from current conditions
        sleep_time = last_sync_date + interval - current_date 
        time.sleep(sleep_time)

        # record current date and time and store it in the JSON file
        current_date = int(time.time())
        date_dict = {
            "date": current_date
        }
        with io.open(os.path.join(os.path.dirname(__file__), "date_dict.json"), 'w') as outfile:
            json.dump(date_dict, outfile)


def builder(database, component=None):
    """
    This function is run when the plugin is selected within a flow. It may query names of playlists or how many recent songs to include in the list.
    It returns a dictionary containing the settings the user must input in this case

    Inputs: Persistent database settings for this plugin
    """

    settings_dict = [
        {
            "type": "string",
            "value": "How often would you like the applet to run?"
        },
        {
            "type": "checkbox",
            "label": "Continiously",
            "name": "continious_runtime",
            "value": "true",
            "id": "continious_runtime"
        },
        {
            "type": "text",
            "label": "Run every",
            "name": "interval_input",
            "value": "10"
        },
        {
            "type": "select",
            "label": "",
            "name": "update_frequency",
            "options": [
                "Hours",
                "Days",
                "Weeks",
                "Months"
            ]
        }
     
    ]

    return settings_dict
