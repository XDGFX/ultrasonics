-- A v1 install with three playlist merger applets, one per kind of per-applet `fuzzy_ratio`: blank,
-- a number, and the placeholder text v1's builder wrote into the field.
CREATE TABLE ultrasonics (key TEXT, value TEXT);
INSERT INTO ultrasonics (key, value) VALUES ('version', '1.0.0-rc.1');

CREATE TABLE plugins (id INTEGER PRIMARY KEY, plugin TEXT, version FLOAT, settings TEXT);
INSERT INTO plugins (plugin, version, settings) VALUES
	('fixture source', '1.0', '{''region'': ''au''}'),
	('fixture sink', '1.0', NULL),
	('playlist merger', '0.1', '{''fuzzy_ratio'': ''90''}');

CREATE TABLE applets (id TEXT PRIMARY KEY, lastrun TEXT, data TEXT);
INSERT INTO applets (id, lastrun, data) VALUES
	('m1', 'False', '{''applet_name'': ''Blank ratio'', ''applet_id'': ''m1'', ''inputs'': [{''plugin'': ''fixture source'', ''version'': ''1.0'', ''data'': {''playlist'': ''Gym'', ''filter'': ''''}}, {''plugin'': ''fixture source'', ''version'': ''1.0'', ''data'': {''playlist'': ''Gym'', ''filter'': ''''}}], ''modifiers'': [{''plugin'': ''playlist merger'', ''version'': ''0.1'', ''data'': {''fuzzy_ratio'': ''''}}], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': []}'),
	('m2', 'False', '{''applet_name'': ''Ratio 85'', ''applet_id'': ''m2'', ''inputs'': [{''plugin'': ''fixture source'', ''version'': ''1.0'', ''data'': {''playlist'': ''Gym'', ''filter'': ''''}}], ''modifiers'': [{''plugin'': ''playlist merger'', ''version'': ''0.1'', ''data'': {''fuzzy_ratio'': ''85''}}], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': []}'),
	('m3', 'False', '{''applet_name'': ''Placeholder ratio'', ''applet_id'': ''m3'', ''inputs'': [{''plugin'': ''fixture source'', ''version'': ''1.0'', ''data'': {''playlist'': ''Gym'', ''filter'': ''''}}], ''modifiers'': [{''plugin'': ''playlist merger'', ''version'': ''0.1'', ''data'': {''fuzzy_ratio'': ''Currently: 90 👾''}}], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': []}');
