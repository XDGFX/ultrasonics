#!/usr/bin/env python3

from app import _ultrasonics
from ultrasonics import logs
from datetime import datetime
import json
import os
import io
import time
import math

log = logs.create_log(__name__)

handshake = {
    "name": "time trigger",
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


def run(settings_dict, **kwargs):
    """
    Creates a JSON file containing the date of creation of the applet/last run of the applet
    and takes the interval time given by the user to calculate the sleep time which will
    keep the program on hold until the next applet run
    """

    database = kwargs["database"]
    applet_id = kwargs["applet_id"]

    class Runtime:
        """
        Contains anything related to storage of runtimes.
        """
        # Address of the JSON file

        date_dict = {}
        date_dict_file = os.path.join(
            _ultrasonics["config_dir"], "up_time trigger", "date_dict.json")

        def __init__(self):

            try:
                os.mkdir(os.path.dirname(self.date_dict_file))
                exists = False
            except FileExistsError:
                exists = os.path.isfile(self.date_dict_file)

            if exists:
                with io.open(self.date_dict_file) as f:
                    self.date_dict = json.load(f)
            else:
                # create the file
                self.update_runtime()

        def update_runtime(self):
            # take the current date in seconds
            current_date = time.time()

            # store the date in a dictionary with the applet_id as a key
            self.date_dict[applet_id] = current_date

            # store the date dictionary in a JSON file (creates new file if non existant)
            with io.open(self.date_dict_file, 'w') as f:
                json.dump(self.date_dict, f)

    rt = Runtime()

    if not applet_id in rt.date_dict:
        # Otherwise create a the applet entry and store the current date
        rt.update_runtime()

    rt.update_runtime()
    # fetch the last sync date from the date_dict
    last_sync_date = rt.date_dict[applet_id]

    # load the interval time multiplier input from the settings_dict

    try:
        interval_multiplier = float(settings_dict["interval_input"])
    except Exception as e:
        log.error(e)
        # if unsuccessful set the multiplier to 1
        log.info(f"Time trigger plugin input multipler undefined, setting it to 1")
        interval_multiplier = 1

    # get the interval from the settings_dict
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

    # take the current date and time in seconds
    current_date = float(time.time())

    # create a timestamp object from the input date string in the settings dict
    try:
        start_timestamp = datetime.strptime(
            settings_dict["start_timestamp"], "%d/%m/%Y %H:%M")
        # convert the datetime object to a number of seconds float
        start_timestamp_seconds = datetime.timestamp(start_timestamp)
    except ValueError:
        # if no value is added then default is start right now
        start_timestamp_seconds = current_date

    # calculate the time to wait until starting date conditions
    time_to_firstrun = start_timestamp_seconds - current_date

    # check if starting date contions already met
    if time_to_firstrun > 0:
        sleep_time = time_to_firstrun
    elif (last_sync_date + interval - current_date) < 0:
        sleep_time = interval
    else:
        # calculate time to wait for next runtime
        sleep_time = last_sync_date + interval - current_date

    #log.debug(f"The sleep time is -{math.trunc(sleep_time*100)/100}- seconds in mode {flag}")

    # sleep until next sync date
    time.sleep(sleep_time)

    # update the date stored in the JSON file and set it to the current date (only happens if program not interrupted)
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
