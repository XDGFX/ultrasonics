-- A v1 1.2.0 install with Plex inputs, as v1's `ultrasonics/database.py` writes them: `plex` 1.0
-- with a blank, a plain, a convertible and a complex filter, and a `plex beta` 1.0 input. v1 ran
-- `re.search(filter, title, re.IGNORECASE)` and never read an input's `section_id`.
CREATE TABLE ultrasonics (key TEXT, value TEXT);
INSERT INTO ultrasonics (key, value) VALUES ('version', '1.2.0');

CREATE TABLE plugins (id INTEGER PRIMARY KEY, plugin TEXT, version FLOAT, settings TEXT);
INSERT INTO plugins (plugin, version, settings) VALUES
	('plex', '1.0', '{''server_url'': ''http://plex.lan:32400'', ''plex_token'': ''PLEX-INPUT-TOKEN-7b21''}');

CREATE TABLE applets (id TEXT PRIMARY KEY, lastrun TEXT, data TEXT);
INSERT INTO applets (id, lastrun, data) VALUES
	('i1', 'False', '{''applet_name'': ''Every Plex playlist'', ''applet_id'': ''i1'', ''inputs'': [{''plugin'': ''plex'', ''version'': ''1.0'', ''data'': {''section_id'': ''Music [3]'', ''filter'': ''''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': []}'),
	('i2', 'False', '{''applet_name'': ''Gym playlists'', ''applet_id'': ''i2'', ''inputs'': [{''plugin'': ''plex'', ''version'': ''1.0'', ''data'': {''section_id'': ''Music [3]'', ''filter'': ''gym''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': []}'),
	('i3', 'False', '{''applet_name'': ''Chill or run'', ''applet_id'': ''i3'', ''inputs'': [{''plugin'': ''plex'', ''version'': ''1.0'', ''data'': {''section_id'': ''Music [3]'', ''filter'': ''^chill|run$''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': []}'),
	('i4', 'False', '{''applet_name'': ''Numbered gym'', ''applet_id'': ''i4'', ''inputs'': [{''plugin'': ''plex'', ''version'': ''1.0'', ''data'': {''section_id'': ''Music [3]'', ''filter'': ''gym \\d+''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': []}'),
	('i5', 'False', '{''applet_name'': ''Beta mix'', ''applet_id'': ''i5'', ''inputs'': [{''plugin'': ''plex beta'', ''version'': ''1.0'', ''data'': {''section_id'': ''Music [3]'', ''filter'': ''Mix''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': []}');
