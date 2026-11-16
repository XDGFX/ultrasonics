-- A v1 install with two applets into `log tracks`: one at 0.1, the version v1 shipped, and one at a
-- later version to show the mapping takes any. v1's `log tracks` had no settings of either kind.
CREATE TABLE ultrasonics (key TEXT, value TEXT);
INSERT INTO ultrasonics (key, value) VALUES ('version', '1.0.0');
CREATE TABLE plugins (id INTEGER PRIMARY KEY, plugin TEXT, version FLOAT, settings TEXT);
INSERT INTO plugins (plugin, version, settings) VALUES ('log tracks', '0.1', NULL);
CREATE TABLE applets (id TEXT PRIMARY KEY, lastrun TEXT, data TEXT);
INSERT INTO applets (id, lastrun, data) VALUES
	('l1', 'False', '{''applet_name'': ''Check my mix'', ''applet_id'': ''l1'', ''inputs'': [{''plugin'': ''fixture source'', ''version'': ''1.0'', ''data'': {''playlist'': ''Mix'', ''filter'': ''''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''log tracks'', ''version'': ''0.1'', ''data'': {}}], ''triggers'': []}'),
	('l2', 'False', '{''applet_name'': ''Later log'', ''applet_id'': ''l2'', ''inputs'': [{''plugin'': ''fixture source'', ''version'': ''1.0'', ''data'': {''playlist'': ''Mix'', ''filter'': ''''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''log tracks'', ''version'': ''0.2'', ''data'': {}}], ''triggers'': []}');
