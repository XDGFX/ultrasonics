#!/usr/bin/env python3

"""
webapp
Provides the webserver and all routes between the front-end and the rest of ultrasonics code.

XDGFX, 2020
"""

import copy
import os

from flask import Flask, redirect, render_template, request
from flask_socketio import SocketIO, emit, send

from ultrasonics import database, logs, plugins, updater
from ultrasonics.tools import random_words

log = logs.create_log(__name__)

app = Flask(__name__)

sio = SocketIO(app, async_mode='eventlet')


# --- GENERAL ---
def server_start():
    log.debug("Starting webserver")
    sio.run(app, host="0.0.0.0", debug=os.environ.get(
        'FLASK_DEBUG') == "True" or False)


def send(event, data):
    sio.emit(str(event), {'data': data})


# --- WEBSERVER PROCESSORS ---
@app.context_processor
def inject_vars():
    return dict(version=updater.version, new_version=updater.new_version)


# --- WEBSERVER ROUTES ---
# Homepage
@app.route('/')
def html_index():
    action = request.args.get("action")

    # Catch statement if nothing was changed, and action is build
    if action in ['build'] and (Applet.current_plans == Applet.default_plans):
        log.warning(
            "At request to submit applet plans was received, but the plans were not changed from defaults.")
        return redirect(request.path, code=302)

    if action == 'build':
        # Send applet plans to builder and reset to default
        Applet.current_plans["applet_name"] = request.args.get(
            'applet_name') or random_words.name()

        plugins.applet_build(Applet.current_plans)
        Applet.current_plans = copy.deepcopy(Applet.default_plans)
        return redirect(request.path, code=302)

    elif action == 'modify':
        applet_id = request.args.get('applet_id')

        # Load database plans into current plans
        Applet.current_plans = plugins.applet_load(applet_id)

        return redirect("/new_applet", code=302)

    elif action == 'clear':
        Applet.current_plans = copy.deepcopy(Applet.default_plans)
        return redirect(request.path, code=302)

    elif action == 'remove':
        applet_id = request.args.get('applet_id')
        plugins.applet_delete(applet_id)
        return redirect(request.path, code=302)

    elif action == 'run':
        from ultrasonics.scheduler import pool

        applet_id = request.args.get('applet_id')

        # plugins.applet_run(applet_id)
        pool.submit(plugins.applet_run, applet_id)
        return redirect(request.path, code=302)

    elif action == 'new_install':
        database.Core().new_install(update=True)
        return redirect(request.path, code=302)

    elif database.Core().new_install():
        return redirect("/welcome", code=302)

    else:
        # Clear applet plans anyway
        Applet.current_plans = copy.deepcopy(Applet.default_plans)

        applet_list = plugins.applet_gather()
        return render_template('index.html', applet_list=applet_list)


class Applet:
    default_plans = {
        "applet_name": "",
        "applet_id": "",
        # "applet_mode": "",
        "inputs": [],
        "modifiers": [],
        "outputs": [],
        "triggers": []
    }

    current_plans = copy.deepcopy(default_plans)


# Create Applet Page
@app.route('/new_applet', methods=['GET', 'POST'])
def html_new_applet():
    # Applet has not been created on the backend
    if Applet.current_plans["applet_id"] == "":
        # If opening the page for the first time, generate a new applet
        import uuid

        applet_id = str(uuid.uuid1())

        Applet.current_plans["applet_id"] = applet_id

        # Applet.current_plans["applet_mode"] = request.args.get('mode')

        # Redirect to remove url parameters
        return redirect(request.path, code=302)

    # A request to add a component - use 'form' not 'args' because this is a POST request
    elif request.form.get('action') == 'add':

        component = {
            "plugin": request.form.get('plugin'),
            "version": request.form.get('version'),
            "data": {key: value for key, value in request.form.to_dict().items() if key not in [
                'action', 'plugin', 'version', 'component']}
        }

        Applet.current_plans[request.form.get('component')].append(component)

        # Redirect to remove url parameters, so that refreshing won't keep adding more plugin instances
        return redirect(request.path, code=302)

    elif request.args.get('action') == 'remove':
        import ast
        component = ast.literal_eval(request.args.get('component'))
        component_type = request.args.get('component_type')

        Applet.current_plans[component_type].remove(component)

        # Redirect to update applet build on front end
        return redirect(request.path, code=302)

    return render_template('new_applet.html', current_plans=Applet.current_plans)


# Select Plugin Page
@app.route('/select_plugin')
def html_select_plugin():
    component = request.args['component']
    # mode = Applet.current_plans['applet_mode']

    if not component:
        log.error("Component not supplied as argument")
        raise RuntimeError

    handshakes = plugins.handshakes
    selected_handshakes = list()

    for handshake in handshakes:
        if component in handshake["type"]:  # and mode in handshake["mode"]:
            selected_handshakes.append(handshake)

    return render_template('select_plugin.html', handshakes=selected_handshakes, component=component)


# Configure Plugin page
@app.route('/configure_plugin', methods=['GET', 'POST'])
def html_configure_plugin():
    """
    Settings page for each instance for a plugin.
    """

    global_settings = database.Core().load(raw=True)

    # Data received is to update persistent plugin settings
    if request.form.get('action') in ['add', 'test']:

        plugin = request.form.get('plugin')
        version = request.form.get('version')
        component = request.form.get('component')
        new_data = {key: value for key, value in request.form.to_dict().items() if key not in [
            'action', 'plugin', 'version', 'component'] and value != ""}

        # Merge new settings with existing database settings
        data = plugins.plugin_load(plugin, version)

        if data is None:
            data = new_data
        else:
            data.update(new_data)

        persistent = False

        if request.form.get('action') == 'test':
            response = plugins.plugin_test(plugin, version, data, component)
            sio.emit("plugin_test", response)
            return '', 204
        else:
            plugins.plugin_update(plugin, version, data)

        # # Redirect to remove url parameters, so that refreshing won't keep adding more plugin instances
        # return redirect(request.path, code=302)

    else:
        plugin = request.args.get('plugin')
        version = request.args.get('version')
        component = request.args.get('component')
        persistent = request.args.get('persistent') != '0'

    # Get persistent settings for the plugin
    for item in plugins.handshakes:
        if item["name"] == plugin and item["version"] == version:
            persistent_settings = item["settings"]

    # If persistent settings are supplied
    try:
        if persistent_settings:
            settings = plugins.plugin_build(plugin, version, component)

            # Force redirect to persistent settings if manually requested through url parameters, or if plugin has not been configured
            persistent = persistent or settings is None

            if persistent:
                settings = persistent_settings

        else:
            # No persistent settings exist
            settings = plugins.plugin_build(
                plugin, version, component, force=True)

            persistent = -1

    except Exception as e:
        log.error(
            "Could not build plugin! Check your database settings are correct.", e)
        return render_template('index.html')

    # Check if any settings are custom html strings
    custom_html = any([isinstance(setting, str) for setting in settings])

    test_exists = plugins.plugin_test(plugin, version, component=component)

    return render_template('configure_plugin.html', settings=settings, plugin=plugin, version=version, component=component, persistent=persistent, custom_html=custom_html, test_exists=test_exists, global_settings=global_settings)


@app.route('/settings', methods=['GET', 'POST'])
def html_settings():
    """
    Global ultrasonics settings page.
    """
    if request.form.get('action') == "save":
        database.Core().save(request.form.to_dict())

        return redirect("/", code=302)

    settings = database.Core().load()

    return render_template("settings.html", settings=settings)


# Welcome Page
@app.route('/welcome')
def html_welcome():
    return render_template('welcome.html')

# --- WEBSOCKET ROUTES ---


@sio.on('connect')
def connect():
    log.info("Client connected over websocket")


@sio.on('applet_update_name')
def applet_update_name(applet_name):
    """
    Receives and executes a request to update the plugin name in Applet.current_plans
    """
    log.debug(f"Updating applet name to {applet_name}")
    Applet.current_plans["applet_name"] = applet_name
