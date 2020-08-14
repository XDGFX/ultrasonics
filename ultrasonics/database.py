#!/usr/bin/env python3

import sqlite3
import uuid
from ultrasonics import logs

log = logs.create_log(__name__)

db_file = "ultrasonics/ultrasonics.db"
conn = None
cursor = None

# --- GENERAL ---


def connect():
    with sqlite3.connect(db_file) as conn:
        cursor = conn.cursor()
        log.info("Database connection successful")

        try:
            # Create persistent settings table if needed
            query = "CREATE TABLE IF NOT EXISTS plugins (id INTEGER PRIMARY KEY, plugin TEXT, version FLOAT, settings TEXT)"
            cursor.execute(query)

            # Create applet table if needed
            query = "CREATE TABLE IF NOT EXISTS applets (id INTEGER PRIMARY KEY, description TEXT, data TEXT)"
            cursor.execute(query)

            conn.commit()
            log.info("Table created")

        except sqlite3.Error as e:
            log.info("Error while creating table", e)


# --- PLUGINS ---


def plugin_create_entry(name, version, settings):
    with sqlite3.connect(db_file) as conn:
        cursor = conn.cursor()
        try:
            query = "INSERT INTO plugins(plugin, version, settings) VALUES(?,?,?)"
            cursor.execute(query, (str(name), str(version), str(settings)))
            conn.commit()
            log.info("Plugin database entry created")

        except sqlite3.Error as e:
            log.info("Error while creating database entry", e)


def plugin_update_entry(name, settings):
    with sqlite3.connect(db_file) as conn:
        cursor = conn.cursor()
        try:
            query = "UPDATE plugins SET settings = ? WHERE plugin = ?"
            cursor.execute(query, (str(settings), str(name)))
            conn.commit()
            log.info("Plugin database entry updated")

        except sqlite3.Error as e:
            log.info("Error while updating database entry", e)


def plugin_entry_exists(name):
    with sqlite3.connect(db_file) as conn:
        cursor = conn.cursor()
        try:
            query = "SELECT version FROM plugins WHERE plugin = ?"
            cursor.execute(query, (name,))
            rows = cursor.fetchall()

            if len(rows) > 0:
                versions = list()
                for item in rows:
                    versions.append(item[0])
                return versions
            else:
                return [False]

        except sqlite3.Error as e:
            log.info("Error while checking for plugin entry", e)


def plugin_load_entry(name, version):
    with sqlite3.connect(db_file) as conn:
        cursor = conn.cursor()
        try:
            query = "SELECT settings FROM plugins WHERE plugin = ? AND version = ?"
            cursor.execute(query, (name, version))
            rows = cursor.fetchall()
            return rows[0][0]

        except sqlite3.Error as e:
            log.info("Error while loading plugin database entry", e)

# def table_exists(table):
#     try:
#         query = """
#         SELECT name
#         FROM sqlite_master
#         WHERE name = '{table}'
#         """

#         cursor.execute(query)
#         if cursor.fetchone()[0] == 1:
#             return True

#         return False

#     except sqlite3.Error as e:
#         log.info("Error while searching for table", e)
