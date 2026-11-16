-- A v1 install with one Last.fm applet per `select`, one with a blank `limit` and one with a
-- non-numeric `limit` (spec #185, ADR-0017 §5). v1's form posted every field whatever the `select`,
-- and `username` lived in the plugin's settings, not the applet's. Each applet writes to the import
-- tests' `fixture sink`.
CREATE TABLE ultrasonics (key TEXT, value TEXT);
INSERT INTO ultrasonics (key, value) VALUES
	('version', '1.0.0-rc.1'),
	('config_dir', '/app/config'),
	('new_install', '0'),
	('api_url', 'https://ultrasonics-api.example/api/'),
	('trigger_poll', '120');

CREATE TABLE plugins (id INTEGER PRIMARY KEY, plugin TEXT, version FLOAT, settings TEXT);
INSERT INTO plugins (plugin, version, settings) VALUES
	('lastfm', '0.1', '{''username'': ''rj''}'),
	('fixture sink', '1.0', NULL);

CREATE TABLE applets (id TEXT PRIMARY KEY, lastrun TEXT, data TEXT);
INSERT INTO applets (id, lastrun, data) VALUES
	('l1', 'False', '{''applet_name'': ''Loved'', ''applet_id'': ''l1'', ''inputs'': [{''plugin'': ''lastfm'', ''version'': ''0.1'', ''data'': {''select'': ''Loved Tracks'', ''limit'': ''100'', ''period'': ''Overall'', ''period-end'': ''Now'', ''period-duration'': ''7 Days'', ''playlist_title'': ''My loves''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': []}'),
	('l2', 'False', '{''applet_name'': ''Top'', ''applet_id'': ''l2'', ''inputs'': [{''plugin'': ''lastfm'', ''version'': ''0.1'', ''data'': {''select'': ''Top Tracks'', ''limit'': ''25'', ''period'': ''3 Months'', ''period-end'': ''Now'', ''period-duration'': ''7 Days'', ''playlist_title'': ''''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': []}'),
	('l3', 'False', '{''applet_name'': ''Recent'', ''applet_id'': ''l3'', ''inputs'': [{''plugin'': ''lastfm'', ''version'': ''0.1'', ''data'': {''select'': ''Recent Tracks'', ''limit'': ''1000'', ''period'': ''Overall'', ''period-end'': ''1 Month Ago'', ''period-duration'': ''1 Day'', ''playlist_title'': ''Last month''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': []}'),
	('l4', 'False', '{''applet_name'': ''Blank limit'', ''applet_id'': ''l4'', ''inputs'': [{''plugin'': ''lastfm'', ''version'': ''0.1'', ''data'': {''select'': ''Loved Tracks'', ''limit'': '''', ''period'': ''Overall'', ''period-end'': ''Now'', ''period-duration'': ''7 Days'', ''playlist_title'': ''''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': []}'),
	('l5', 'False', '{''applet_name'': ''Typo limit'', ''applet_id'': ''l5'', ''inputs'': [{''plugin'': ''lastfm'', ''version'': ''0.1'', ''data'': {''select'': ''Top Tracks'', ''limit'': ''fifty'', ''period'': ''12 Months'', ''period-end'': ''Now'', ''period-duration'': ''7 Days'', ''playlist_title'': ''''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': []}');
