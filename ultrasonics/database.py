#!/usr/bin/env python3

"""
database
Handles all connections with the ultrasonics sqlite database.

XDGFX, 2020
"""

import ast
import os
import sqlite3
import uuid

from ultrasonics import logs

log = logs.create_log(__name__)

db_file = "config/ultrasonics.db"
conn = None
cursor = None

try:
    os.mkdir("config")
except FileExistsError:
    # Folder already exists
    pass


class Core:
    """
    Core ultrasonics database functions.
    """

    # Global settings builder for the frontend settings page.
    # Values here are defaults, but will be overridden with database values if they exist.
    settings = [
        {
            "type": "string",
            "value": "Many plugins utilise third party apis, which often require sensitive api keys 🔑 to access (Spotify, Last.fm, Deezer, etc). The ultrasonics-api program acts as a proxy server for these apis, while keeping secret api keys... secret."
        },
        {
            "type": "string",
            "value": "You can host this yourself alongside ultrasonics, and set up all the required api keys for the services you want to use. Alternatively, use the official hosted server for faster setup."
        },
        {
            "type": "string",
            "value": "If you don't need / want to use any of these services, just leave the url empty 😊."
        },
        {
            "type": "link",
            "value": "https://github.com/XDGFX/ultrasonics-api"
        },
        {
            "type": "text",
            "label": "ultrasonics-api URL",
            "name": "api_url",
            "value": "https://ultrasonics-api.herokuapp.com/api/"
        },
        {
            "type": "string",
            "value": "While applets are waiting on triggers, ultrasonics will poll them at a specified interval 🕗 to check if they have triggered or not. Higher values are less resource intensive, but mean a larger delay between a trigger activating and the applet running."
        },
        {
            "type": "string",
            "value": "Once an applet has triggered, it cannot be triggered again until this interval has passed."
        },
        {
            "type": "text",
            "label": "Trigger Update Polling Interval (s)",
            "name": "trigger_poll",
            "value": "120"
        }
    ]

    def connect(self):
        """
        Initial connection to database to create tables.
        """
        with sqlite3.connect(db_file) as conn:
            from app import _ultrasonics

            cursor = conn.cursor()
            log.info("Database connection successful")

            if self.new_install() is None:
                _ultrasonics["new_install"] = True

                # Create tuple with default settings
                global_settings_database = [(item["name"], item["value"])
                                            for item in self.settings if item["type"] in ["text", "radio", "select"]]

                # Create persistent settings table if needed
                query = "CREATE TABLE IF NOT EXISTS ultrasonics (key TEXT, value TEXT)"
                cursor.execute(query)

                query = "INSERT INTO ultrasonics (key, value) VALUES(?, ?)"
                cursor.executemany(query, list(_ultrasonics.items()))

                query = "INSERT INTO ultrasonics (key, value) VALUES(?, ?)"
                cursor.executemany(query, global_settings_database)

            # Create persistent settings table if needed
            query = "CREATE TABLE IF NOT EXISTS plugins (id INTEGER PRIMARY KEY, plugin TEXT, version FLOAT, settings TEXT)"
            cursor.execute(query)

            # Create applet table if needed
            query = "CREATE TABLE IF NOT EXISTS applets (id TEXT PRIMARY KEY, lastrun TEXT, data TEXT)"
            cursor.execute(query)

            conn.commit()

            # Version check
            query = "SELECT value FROM ultrasonics WHERE key = 'version'"
            cursor.execute(query)
            rows = cursor.fetchall()
            version = rows[0][0]

            if version != _ultrasonics["version"]:
                log.warning(
                    "Installed ultrasonics version does not match database version! Proceed with caution.")

    def new_install(self, update=False):
        """
        Check if this is a new installation of ultrasonics.
        """
        with sqlite3.connect(db_file) as conn:
            cursor = conn.cursor()
            if update:
                query = "UPDATE ultrasonics SET value = 0 WHERE key = 'new_install'"
                cursor.execute(query)
                conn.commit()
                log.info("Welcome to ultrasonics! 🔊")
            else:
                # Check if database exists
                query = "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'ultrasonics'"
                cursor.execute(query)
                rows = cursor.fetchall()

                result = rows[0][0]

                # Table does not exist
                if not result:
                    return None

                query = "SELECT value FROM ultrasonics WHERE key = 'new_install'"
                cursor.execute(query)
                rows = cursor.fetchall()

                result = rows[0][0]

                return result == '1'

    def load(self, raw=False):
        """
        Return all the current global settings in full dict format.
        If raw, return only key: value dict
        """
        import copy

        with sqlite3.connect(db_file) as conn:
            cursor = conn.cursor()
            query = "SELECT key, value FROM ultrasonics"
            cursor.execute(query)
            rows = cursor.fetchall()

            if raw:
                data = {}

                for key, value in rows:
                    data[key] = value

            else:
                data = copy.deepcopy(self.settings)

                db_compatible_settings = [
                    item["name"] for item in data if item["type"] in ["text", "radio", "select"]]

                for key, value in rows:
                    # Check if database setting is to be displayed (excluding version, new_install)
                    if key in db_compatible_settings:
                        for i, item in enumerate(data):
                            if "name" in item and item["name"] == key:
                                # If setting matches database item, update the value
                                item["value"] = value
                                data[i] = item
            return data

    def save(self, settings):
        """
        Save a list of global settings tuples to the database.
        """
        # Add trailing slash to auth url
        if settings["api_url"][-1] != "/":
            settings["api_url"] = settings["api_url"] + "/"

        # Generate key, value tuples (reversed for database entry) from supplied form data
        data = [(value, key)
                for key, value in settings.items() if key != "action"]

        with sqlite3.connect(db_file) as conn:
            cursor = conn.cursor()
            query = "UPDATE ultrasonics SET value = ? WHERE key = ?"
            cursor.executemany(query, data)

            conn.commit()
            log.info("Settings database updated")

    def get(self, key):
        """
        Get a specific value from the ultrasonics core database.
        """
        with sqlite3.connect(db_file) as conn:
            cursor = conn.cursor()
            query = "SELECT value FROM ultrasonics WHERE key = ?"
            cursor.execute(query, (key,))
            rows = cursor.fetchall()

            try:
                return rows[0][0]
            except IndexError:
                return None


class Plugin:
    """
    Functions specific to plugin data.
    """

    def new(self, name, version):
        """
        Create a database entry for a given plugin.
        """
        with sqlite3.connect(db_file) as conn:
            cursor = conn.cursor()
            query = "INSERT INTO plugins (plugin, version) VALUES (?,?)"
            cursor.execute(query, (str(name), str(version)))
            conn.commit()
            log.info("Plugin database entry created")

    def set(self, name, version, settings):
        """
        Update an existing plugin entry in the database.
        """
        with sqlite3.connect(db_file) as conn:
            cursor = conn.cursor()
            query = "UPDATE plugins SET settings = ? WHERE plugin = ? AND version = ?"
            cursor.execute(query, (str(settings), name, version))
            conn.commit()
            log.info("Plugin database entry updated")

    def versions(self, name):
        """
        Find plugins with a given name, and return the versions of plugins configured for the database.
        """
        with sqlite3.connect(db_file) as conn:
            cursor = conn.cursor()
            query = "SELECT version FROM plugins WHERE plugin = ?"
            cursor.execute(query, (name,))
            rows = cursor.fetchall()

            if len(rows) > 0:
                versions = list()
                for item in rows:
                    versions.append(str(item[0]))
                return versions
            else:
                return [False]

    def get(self, name, version):
        """
        Load the settings from a specific plugin in the database.
        """
        with sqlite3.connect(db_file) as conn:
            cursor = conn.cursor()
            query = "SELECT settings FROM plugins WHERE plugin = ? AND version = ?"
            cursor.execute(query, (name, version))
            rows = cursor.fetchall()

            settings = rows[0][0]

            if settings is not None:
                import ast
                settings = ast.literal_eval(settings)

            return settings


class Applet:
    """
    Functions specific to applet data.
    """

    def gather(self):
        """
        Return all the applets stored in the database.
        """
        with sqlite3.connect(db_file) as conn:
            cursor = conn.cursor()
            query = "SELECT id, lastrun, data FROM applets"
            cursor.execute(query)
            rows = cursor.fetchall()

            if rows is None:
                return []

            data = []

            for applet_id, applet_lastrun, applet_plans in rows:
                if applet_lastrun is None:
                    data.append(
                        {
                            "applet_id": applet_id,
                            "applet_plans": ast.literal_eval(applet_plans)
                        }
                    )
                else:
                    data.append(
                        {
                            "applet_id": applet_id,
                            "applet_plans": ast.literal_eval(applet_plans),
                            "applet_lastrun": ast.literal_eval(applet_lastrun)
                        }
                    )
            return data

    def set(self, applet_id, data):
        """
        Create or update a new applet.
        """
        with sqlite3.connect(db_file) as conn:
            cursor = conn.cursor()
            query = "REPLACE INTO applets (id, data) VALUES (?,?)"
            cursor.execute(
                query, (str(applet_id), str(data)))
            conn.commit()
            log.info("Applet database entry created")

    def get(self, applet_id):
        """
        Load an applet plans from it's unique id.
        """
        with sqlite3.connect(db_file) as conn:
            cursor = conn.cursor()
            query = "SELECT data FROM applets WHERE id = ?"
            cursor.execute(query, (applet_id, ))
            rows = cursor.fetchall()

            if rows == []:
                return None
            else:
                # Convert from string to dict
                applet_plans = ast.literal_eval(rows[0][0])
                return applet_plans

    def remove(self, applet_id):
        """
        Delete an applet from the database.
        """
        with sqlite3.connect(db_file) as conn:
            cursor = conn.cursor()
            query = "DELETE FROM applets WHERE id = ?"
            cursor.execute(query, (applet_id,))
            conn.commit()
            log.info("Applet database entry deleted")

    def lastrun(self, applet_id, data):
        """
        Update the lastrun column for an applet with the supplied data.
        """
        with sqlite3.connect(db_file) as conn:
            cursor = conn.cursor()
            query = "UPDATE applets SET lastrun = ? WHERE id = ?"
            cursor.execute(
                query, (str(data), str(applet_id)))
            conn.commit()
            log.info("Applet lastrun updated")
