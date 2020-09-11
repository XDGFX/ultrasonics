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
    "version": "0.1",
    "settings": [

    ]
}


def run(settings_dict, database, component=None, songs_dict=None):
    """
    Creates a JSON file containing the date of creation of the applet/last run of the applet
    and takes the interval time given by the user to calculate the sleep time which will
    keep the program on hold until the next applet run
    """

    # Create a date_dict.json file if non exists and save the current date in it
    # This only happens on creation
    if not os.path.isfile(os.path.join(os.path.dirname(__file__), "date_dict.json")):
        current_date = datetime.utcnow()
        date_str = current_date.strftime("%m/%d/%Y")
        time_str = current_date.strftime("%H:%M:%S")
        time_zone_str = current_date.strftime("%z")

        # record current date and time and store it in the JSON file
        current_date = int(time.time())
        date_dict = {
            "date": current_date
        }
        with io.open(os.path.join(os.path.dirname(__file__), "date_dict.json"), 'w') as outfile:
            json.dump(date_dict, outfile)

    # load the data stored in the JSON file
    date_dict = json.load(io.open(os.path.join(
        os.path.dirname(__file__), "date_dict.json")))
    # save it into a string
    #last_sync_datetime_str = date_dict['date'] + "," + date_dict['time'] + date_dict['time_zone']
    last_sync_datetime_str = (f"{date_dict['date']}, {date_dict['time']}")
    # create a datetime object from the string
    last_sync_datetime_obj = datetime.strptime(
        last_sync_datetime_str, "%m/%d/%Y, %H:%M:%S")

    # load the interval time selected from the settings_dict
    interval = settings_dict["sync_interval"]
    interval_seconds = {
        "Every Hour": 3600,
        "Every Day": 86400,
        "Every Week": 604800,
        "Once a Month": 2628000,
        "Once a Year": 31540000}
    # create a timedelta object with the interval time in seconds
    interval_obj = timedelta(seconds=interval_seconds[interval])

    # create object for current time
    current_datetime = datetime.utcnow()

    # Main loop, refresh every 5 seconds
    while ((last_sync_datetime_obj + interval_obj) > current_datetime):
        time.sleep(5)
        current_datetime = datetime.utcnow()

    # record current date and time and store it in the JSON file
    current_date = datetime.utcnow()
    date_str = current_date.strftime("%m/%d/%Y")
    time_str = current_date.strftime("%H:%M:%S")
    time_zone_str = current_date.strftime("%z")

    date_dict = {
        "date": date_str,
        "time": time_str,
        "time_zone": time_zone_str
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
            "type": "select",
            "label": "",
            "name": "update_frequency",
            "options": [
                "Hours",
                "Days",
                "Weeks",
                "Months"
            ]
        },

    ]

    return settings_dict
