#!/usr/bin/env python3

import io
import json
import math
import os
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
    "version": "0.1",
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

        date_dict = {}
        date_dict_file = os.path.join(
            _ultrasonics["config_dir"], "up_time trigger", "date_dict.json")

        def __init__(self):
            """
            Create cache file if needed, load values from the file.
            """
            try:
                os.mkdir(os.path.dirname(self.date_dict_file))
                exists = False
            except FileExistsError:
                if os.path.isfile(self.date_dict_file):
                    # File already exists, load existing values
                    with io.open(self.date_dict_file) as f:
                        self.date_dict = json.load(f)
                else:
                    # Create the file
                    self.update_runtime()

        def update_runtime(self):
            """
            Save the current time to the latest runtime for this applet.
            """
            # Get the latest version of the date_dict file
            with io.open(self.date_dict_file) as f:
                self.date_dict = json.load(f)

            # Take the current time in seconds
            current_time = (datetime.utcnow() -
                            datetime(1970, 1, 1)).total_seconds()

            # Update the dictionary with the latest runtime
            self.date_dict[applet_id] = current_time

            # Update the cache file
            with io.open(self.date_dict_file, 'w') as f:
                json.dump(self.date_dict, f)

    rt = Runtime()

    if not applet_id in rt.date_dict:
        # Create the applet entry and store the current date
        rt.update_runtime()

    # Fetch the last sync date from the date_dict
    last_sync_date = rt.date_dict[applet_id]

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

    # Calculate the time to wait until starting date conditions
    time_to_firstrun = start_timestamp_seconds - current_time

    # Check if starting date contions already met
    if time_to_firstrun > 0:
        # Applet has never run
        sleep_time = time_to_firstrun

    elif (last_sync_date + interval - current_time) < 0:
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
