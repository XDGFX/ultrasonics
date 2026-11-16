-- A v1 install, in the shape v1's `ultrasonics/database.py` writes it: the three tables, and blobs
-- written with Python's `str(dict)`. Plugin names `fixture source` and `fixture sink` are mapped by
-- the importer tests' own mapping modules; the rest are left unmapped on purpose.
CREATE TABLE ultrasonics (key TEXT, value TEXT);
INSERT INTO ultrasonics (key, value) VALUES
	('version', '1.0.0-rc.1'),
	('config_dir', '/app/config'),
	('new_install', '0'),
	('api_url', 'http://private-api.lan:8000/api/'),
	('trigger_poll', '120');

CREATE TABLE plugins (id INTEGER PRIMARY KEY, plugin TEXT, version FLOAT, settings TEXT);
INSERT INTO plugins (plugin, version, settings) VALUES
	('fixture source', '0.9', '{''region'': ''gb'', ''token'': ''OLD-TOKEN-7c41''}'),
	('fixture source', '1.0', '{''region'': ''au'', ''token'': ''RECOGNISABLE-TOKEN-1f2e''}'),
	('fixture sink', '1.0', NULL),
	('spotify', '0.6', '{''auth'': ''{"refresh_token": "SPOTIFY-TOKEN-9d03"}''}'),
	('time trigger', '0.2', NULL);

CREATE TABLE applets (id TEXT PRIMARY KEY, lastrun TEXT, data TEXT);
INSERT INTO applets (id, lastrun, data) VALUES
	('a1', 'False', '{''applet_name'': ''Daily'', ''applet_id'': ''a1'', ''inputs'': [{''plugin'': ''fixture source'', ''version'': ''1.0'', ''data'': {''playlist'': ''Chill'', ''filter'': ''^chill''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music [3]''}}], ''triggers'': [{''plugin'': ''time trigger'', ''version'': ''0.2'', ''data'': {''interval_input'': ''1'', ''update_frequency'': ''Days'', ''start_timestamp'': ''01/03/2021 07:30''}}]}'),
	('a2', 'True', '{''applet_name'': "Cal''s old source", ''applet_id'': ''a2'', ''inputs'': [{''plugin'': ''fixture source'', ''version'': ''0.9'', ''data'': {''playlist'': ''Café'', ''filter'': ''''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': []}'),
	('a3', 'False', '{''applet_name'': ''Hourly-ish'', ''applet_id'': ''a3'', ''inputs'': [{''plugin'': ''fixture source'', ''version'': ''1.0'', ''data'': {''playlist'': ''Mix'', ''filter'': ''mix$''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': [{''plugin'': ''time trigger'', ''version'': ''0.2'', ''data'': {''interval_input'': ''1.5'', ''update_frequency'': ''Hours'', ''start_timestamp'': ''''}}, {''plugin'': ''time trigger'', ''version'': ''0.2'', ''data'': {''interval_input'': ''1'', ''update_frequency'': ''Weeks'', ''start_timestamp'': ''''}}]}'),
	('a4', 'False', '{''applet_name'': ''Monthly'', ''applet_id'': ''a4'', ''inputs'': [{''plugin'': ''fixture source'', ''version'': ''1.0'', ''data'': {''playlist'': ''Mix'', ''filter'': ''mix''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': [{''plugin'': ''time trigger'', ''version'': ''0.2'', ''data'': {''interval_input'': ''2'', ''update_frequency'': ''Months'', ''start_timestamp'': ''''}}]}'),
	('a5', 'False', '{''applet_name'': ''Hooked'', ''applet_id'': ''a5'', ''inputs'': [{''plugin'': ''fixture source'', ''version'': ''1.0'', ''data'': {''playlist'': ''Mix'', ''filter'': ''mix''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': [{''plugin'': ''webhook'', ''version'': ''0.1'', ''data'': {''port'': ''8008'', ''path'': ''/hook''}}]}'),
	('a6', 'False', '{''applet_name'': ''Bad library'', ''applet_id'': ''a6'', ''inputs'': [{''plugin'': ''fixture source'', ''version'': ''1.0'', ''data'': {''playlist'': ''Mix'', ''filter'': ''mix''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''''}}], ''triggers'': []}'),
	('a7', 'False', '{''applet_name'': ''Manual filter'', ''applet_id'': ''a7'', ''inputs'': [{''plugin'': ''fixture source'', ''version'': ''1.0'', ''data'': {''playlist'': ''Mix'', ''filter'': ''[Cc]hill''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': []}'),
	('a8', 'False', '{''applet_name'': ''TIDAL fork'', ''applet_id'': ''a8'', ''inputs'': [{''plugin'': ''tidal'', ''version'': ''0.3'', ''data'': {''playlist'': ''Favourites''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': []}'),
	('a9', 'False', '{''applet_name'': ''Broken mapping'', ''applet_id'': ''a9'', ''inputs'': [{''plugin'': ''fixture source'', ''version'': ''1.0'', ''data'': {''playlist'': ''Mix''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music'', ''explode'': ''yes''}}], ''triggers'': []}'),
	('a10', 'False', '{''applet_name'': ''No output'', ''applet_id'': ''a10'', ''inputs'': [{''plugin'': ''fixture source'', ''version'': ''1.0'', ''data'': {''playlist'': ''Mix'', ''filter'': ''mix''}}], ''modifiers'': [], ''outputs'': [], ''triggers'': []}'),
	('a11', 'False', '{''applet_name'': ''Corrupt'', ''created'': datetime(2021, 3, 1)}');
