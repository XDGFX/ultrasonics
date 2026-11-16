-- A v1 install with one applet per plugin v2 dropped, and one using a plugin v2 has never heard of.
-- `deezer` and `spotify mixer` hold saved auth, which must never reach the report or the log.
-- `Mixed` puts an unknown input before its dropped modifier, and must still get the dropped reason.
CREATE TABLE ultrasonics (key TEXT, value TEXT);
INSERT INTO ultrasonics (key, value) VALUES ('version', '1.0.0');

CREATE TABLE plugins (id INTEGER PRIMARY KEY, plugin TEXT, version FLOAT, settings TEXT);
INSERT INTO plugins (plugin, version, settings) VALUES
	('deezer', '0.4', '{''auth'': ''access_token=DEEZER-TOKEN-5a8b&expires=0'', ''fuzzy_ratio'': ''90'', ''created_playlists'': ''Private''}'),
	('spotify mixer', '0.1', '{''auth'': ''{"refresh_token": "MIXER-TOKEN-3c6d"}'', ''fuzzy_ratio'': ''90''}');

CREATE TABLE applets (id TEXT PRIMARY KEY, lastrun TEXT, data TEXT);
INSERT INTO applets (id, lastrun, data) VALUES
	('d1', 'False', '{''applet_name'': ''Mixed'', ''applet_id'': ''d1'', ''inputs'': [{''plugin'': ''homebrew'', ''version'': ''0.2'', ''data'': {''path'': ''/music''}}], ''modifiers'': [{''plugin'': ''spotify mixer'', ''version'': ''0.1'', ''data'': {''count'': ''30''}}], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': []}'),
	('d2', 'False', '{''applet_name'': ''From Deezer'', ''applet_id'': ''d2'', ''inputs'': [{''plugin'': ''deezer'', ''version'': ''0.4'', ''data'': {''filter'': ''chill''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': []}'),
	('d3', 'False', '{''applet_name'': ''To Deezer'', ''applet_id'': ''d3'', ''inputs'': [{''plugin'': ''fixture source'', ''version'': ''1.0'', ''data'': {''playlist'': ''Mix'', ''filter'': ''''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''deezer'', ''version'': ''0.4'', ''data'': {''existing_playlists'': ''Update''}}], ''triggers'': []}'),
	('d4', 'False', '{''applet_name'': ''Run a script'', ''applet_id'': ''d4'', ''inputs'': [{''plugin'': ''fixture source'', ''version'': ''1.0'', ''data'': {''playlist'': ''Mix'', ''filter'': ''''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''system command'', ''version'': ''0.1'', ''data'': {''command'': ''touch /tmp/synced''}}], ''triggers'': []}'),
	('d5', 'False', '{''applet_name'': ''Never gonna'', ''applet_id'': ''d5'', ''inputs'': [{''plugin'': ''fixture source'', ''version'': ''1.0'', ''data'': {''playlist'': ''Mix'', ''filter'': ''''}}], ''modifiers'': [{''plugin'': ''rickroll'', ''version'': ''0.1'', ''data'': {}}], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': []}'),
	('d6', 'False', '{''applet_name'': ''Bones'', ''applet_id'': ''d6'', ''inputs'': [{''plugin'': ''skeleton'', ''version'': ''0.1'', ''data'': {}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': []}'),
	('d7', 'False', '{''applet_name'': ''My own plugin'', ''applet_id'': ''d7'', ''inputs'': [{''plugin'': ''homebrew'', ''version'': ''0.2'', ''data'': {''path'': ''/music''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': []}');
