#!/usr/bin/env python3
"""
up_time trigger

Official trigger plugin. 
Runs the created applet on the specified interval times starting at the specified date and time.

AspanishDude, 2020
"""

import io
import json
import math
import os
import sqlite3
import time
from datetime import datetime

from app import _ultrasonics
from ultrasonics import logs

log = logs.create_log(__name__)

handshake = {
    "name": "time trigger",
    "description": "time based trigger plugin",
    "type": [
        "triggers"
    ],
    "mode": [
        "playlists",
        "songs"
    ],
    "version": "0.2",
    "settings": []
}


def run(settings_dict, **kwargs):
    """
    Creates a json file containing the date of creation of the applet / last run of the applet
    and takes the interval time given by the user to calculate the sleep time which will
    keep the program on hold until the next applet run.
    """
    database = kwargs["database"]
    applet_id = kwargs["applet_id"]

    class Runtime:
        """
        Contains anything related to storage of runtimes.
        """

        db_file = os.path.join(
            _ultrasonics["config_dir"], "up_time trigger", "date_dict.db")

        def __init__(self):
            """
            Create cache file if needed, load values from the file.
            """
            try:
                os.mkdir(os.path.dirname(self.db_file))
            except FileExistsError:
                pass

            with sqlite3.connect(self.db_file) as conn:
                cursor = conn.cursor()

                # Create applet table if needed
                query = "CREATE TABLE IF NOT EXISTS runtimes (applet_id TEXT PRIMARY KEY, lastrun REAL)"
                cursor.execute(query)

                conn.commit()

        def update_runtime(self, firstrun=False):
            """
            Save the current time to the latest runtime for this applet.
            """
            if firstrun:
                last_sync_date = start_timestamp_seconds - interval

            else:
                # Take the current time in seconds
                last_sync_date = (datetime.utcnow() -
                                datetime(1970, 1, 1)).total_seconds()

            with sqlite3.connect(self.db_file) as conn:
                cursor = conn.cursor()

                # Create applet table if needed
                query = "REPLACE INTO runtimes (applet_id, lastrun) VALUES (?,?)"
                cursor.execute(query, (applet_id, last_sync_date))

                conn.commit()

            return last_sync_date

    rt = Runtime()

    interval_multiplier = float(settings_dict["interval_input"])
    interval_selection = settings_dict["update_frequency"]

    interval_options = {
        "Hours": 3600,
        "Days": 86400,
        "Weeks": 604800,
        "Months": 2628000
    }

    # Get the interval in seconds
    interval = interval_options[interval_selection] * interval_multiplier

    current_time = (datetime.utcnow() - datetime(1970, 1, 1)).total_seconds()

    # Create a timestamp object from the input date string in the settings dict
    try:
        start_timestamp = datetime.strptime(
            settings_dict["start_timestamp"], "%d/%m/%Y %H:%M")

        # Convert the datetime object to seconds
        start_timestamp_seconds = datetime.timestamp(start_timestamp)

    except ValueError:
        # If no value is added then default is start right now
        start_timestamp_seconds = current_time

    # Fetch the last sync date from the date_dict
    with sqlite3.connect(rt.db_file) as conn:
        cursor = conn.cursor()

        # Create applet table if needed
        query = "SELECT lastrun FROM runtimes WHERE applet_id = ?"
        cursor.execute(query, (applet_id,))

        rows = cursor.fetchone()

        if rows is None:
            last_sync_date = rt.update_runtime(firstrun=True)
        else:
            last_sync_date = rows[0]   

    if (last_sync_date + interval - current_time) < 0:
        # Applet is overdue
        sleep_time = 0

    else:
        # Still time before next run
        sleep_time = last_sync_date + interval - current_time

    log.info(f"Applet {applet_id} will run in {int(sleep_time)} seconds...")

    # Wait until next run time
    time.sleep(sleep_time)

    # Update the date stored in the json file and set it to the current date (only happens if program not interrupted)
    rt.update_runtime()


def builder(**kwargs):
    """
    This function is run when the plugin is selected within a flow. It may query names of playlists or how many recent songs to include in the list.
    It returns a dictionary containing the settings the user must input in this case

    Inputs: Persistent database settings for this plugin
    """

    database = kwargs["database"]

    settings_dict = [
        {
            "type": "string",
            "value": "How often would you like the applet to run?"
        },
        """
        <link href="https://cdn.jsdelivr.net/npm/bulma-calendar@6.0.7/dist/css/bulma-calendar.min.css" rel="stylesheet">
        <script src="https://cdn.jsdelivr.net/npm/bulma-calendar@6.0.7/dist/js/bulma-calendar.min.js"></script>

        <div class="field">
            <label class="label">Run Interval</label>
            <div class="field has-addons">
                <div class="control">
                    <input class="input" type="text" name="interval_input" placeholder="10" min="0"
                        pattern="\d{1,10}\.*\d{0,4}" required>
                </div>
                <div class="control">
                    <div class="select">
                        <select name="update_frequency">
                            <option>Hours</option>
                            <option>Days</option>
                            <option>Weeks</option>
                            <option>Months</option>
                        </select>
                    </div>
                </div>
            </div>
        </div>

        <div class="field">
            <label class="label">First Run</label>
            <input type="date" id="date_picker">
            <input type="text" hidden id="start_timestamp" name="start_timestamp">
        </div>

        <style>
            .select:not(.is-multiple):not(.is-loading)::after {
                border-color: #00d1b2;
            }

            .timepicker-input {
                height: 1.5em
            }

            .datetimepicker-dummy .datetimepicker-dummy-wrapper {
                border-radius: 4px;
            }

            .datetimepicker-dummy .datetimepicker-clear-button {
                display: none;
            }

            .datetimepicker .datetimepicker-footer {
                margin-bottom: 1em;
            }

            @media (prefers-color-scheme: dark) {
                .datetimepicker {
                    background: var(--grey-darker);
                }

                .datepicker-date {
                    background: var(--grey-darker) !important;
                }

                .datepicker-date .date-item {
                    color: white !important;
                }

                .datetimepicker-container::after,
                .datetimepicker-container::before {
                    display: none !important;
                }

                .date-item:hover {
                    background: none !important;
                }

                .timepicker-next:hover,
                .timepicker-previous:hover {
                    background: #151515 !important;
                }
            }
        </style>

        <script>
            var options = {
                type: 'datetime',
                dateFormat: 'DD/MM/YYYY',
                startTime: "12:00",
                color: "#ffffff"
            }

            // Initialize all input of type date
            var calendars = bulmaCalendar.attach('[type="date"]', options);
            var input_div = document.querySelector("#start_timestamp")
            var date_picker = document.querySelector("#date_picker")

            if (date_picker) {
                // bulmaCalendar instance is available as input_div.bulmaCalendar
                date_picker.bulmaCalendar.on('select', function (datepicker) {
                    input_div.value = datepicker.data.value();
                });
            }

        </script>
        """
    ]

    return settings_dict
