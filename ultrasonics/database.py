#!/usr/bin/env python3

import sqlite3
import uuid

db_file = "ultrasonics/ultrasonics.db"
conn = None
cursor = None


def connect():
    global conn, cursor
    try:
        conn = sqlite3.connect(db_file)
        cursor = conn.cursor()
        print("Database connection successful")

        try:
            # Create persistent settings table if needed
            query = "CREATE TABLE IF NOT EXISTS plugins (id INTEGER PRIMARY KEY, plugin TEXT, version FLOAT, settings TEXT)"
            cursor.execute(query)

            # Create applet table if needed
            query = "CREATE TABLE IF NOT EXISTS applets (id INTEGER PRIMARY KEY, description TEXT, data TEXT)"
            cursor.execute(query)

            conn.commit()
            print("Table created")

        except sqlite3.Error as e:
            print("Error while creating table", e)

    except Error as e:
        print(e)


def plugin_create_entry(plugin, version, settings):
    try:
        query = "INSERT INTO plugins(plugin, version, settings) VALUES(?,?,?)"
        cursor.execute(query, (str(plugin), str(version), str(settings)))
        conn.commit()
        print("Plugin database entry created")

    except sqlite3.Error as e:
        print("Error while creating database entry", e)


def plugin_update_entry(plugin, settings):
    try:
        query = "UPDATE plugins SET settings = ? WHERE plugin = ?"
        cursor.execute(query, (str(settings), str(plugin)))
        conn.commit()
        print("Plugin database entry updated")

    except sqlite3.Error as e:
        print("Error while updating database entry", e)


def plugin_entry_exists(title):
    try:
        query = "SELECT version FROM plugins WHERE plugin = ?"
        cursor.execute(query, (title,))
        rows = cursor.fetchall()

        if len(rows) > 0:
            versions = list()
            for item in rows:
                versions.append(item[0])
            return versions
        else:
            return [False]

    except sqlite3.Error as e:
        print("Error while checking for plugin entry", e)


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
#         print("Error while searching for table", e)
