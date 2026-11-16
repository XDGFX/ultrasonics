-- The three tables v1's `ultrasonics/database.py` creates, with a row in each.
CREATE TABLE ultrasonics (key TEXT, value TEXT);
INSERT INTO ultrasonics (key, value) VALUES ('version', '1.2.0');
CREATE TABLE plugins (id INTEGER PRIMARY KEY, plugin TEXT, version FLOAT, settings TEXT);
INSERT INTO plugins (plugin, version, settings) VALUES ('plex', 1.0, '{''server_url'': ''http://plex:32400''}');
CREATE TABLE applets (id TEXT PRIMARY KEY, lastrun TEXT, data TEXT);
INSERT INTO applets (id, lastrun, data) VALUES ('a1', 'False', '{''applet_name'': ''Weekly''}');
