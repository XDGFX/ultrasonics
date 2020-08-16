#!/usr/bin/env python3

from flask import Flask, render_template, request, redirect
from flask_socketio import SocketIO, send, emit
from json import dumps, loads
from ultrasonics import logs
import json

log = logs.create_log(__name__)

app = Flask(__name__)

sio = SocketIO(app, async_mode='eventlet')


# --- GENERAL ---
def server_start():
    log.debug("Starting webserver")
    sio.run(app, host="0.0.0.0", debug=True)


def send(event, data):
    sio.emit(str(event), {'data': data})


# --- WEBSERVER ROUTES ---
# Homepage
@app.route('/')
def html_index():
    from ultrasonics import plugins
    import copy

    action = request.args.get("action")

    # Catch statement if nothing was changed, and action is build or modify
    if action in ['applet_build', 'applet_modify'] and (Applet.current_plans == Applet.default_plans):
        log.warning(
            "At request to submit applet plans was received, but the plans were not changed from defaults.")
        return redirect(request.path, code=302)

    if action == 'applet_build':
        # Send applet plans to builder and reset to default
        Applet.current_plans["applet_name"] = request.args.get(
            'applet_name')
        plugins.applet_build(Applet.current_plans)
        Applet.current_plans = copy.deepcopy(Applet.default_plans)
        return redirect(request.path, code=302)

    elif action == 'modify':
        applet_id = request.args.get('applet_id')

        # Load database plans into current plans
        Applet.current_plans = plugins.applet_load(applet_id)

        return redirect("/new_applet", code=302)

    elif action == 'applet_clear':
        Applet.current_plans = copy.deepcopy(Applet.default_plans)
        return redirect(request.path, code=302)

    elif action == 'remove':
        applet_id = request.args.get('applet_id')
        plugins.applet_delete(applet_id)
        return redirect(request.path, code=302)

    else:
        applet_list = plugins.applet_gather()
        return render_template('index.html', applet_list=applet_list)


class Applet:
    import copy

    default_plans = {
        "applet_name": "",
        "applet_id": "",
        "inputs": [],
        "modifiers": [],
        "outputs": [],
        "triggers": []
    }

    current_plans = copy.deepcopy(default_plans)


# Create Applet Page
@app.route('/new_applet', methods=['GET', 'POST'])
def html_new_applet():
    from ultrasonics import plugins

    # Applet has not been created on the backend
    if Applet.current_plans["applet_id"] == "":
        # If opening the page for the first time, generate a new applet
        import uuid

        applet_id = str(uuid.uuid4())

        # TODO Implement check for UUID already in database, and create a new one if so
        # applets = plugins.applet_gather()

        Applet.current_plans["applet_id"] = applet_id

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

    if not component:
        log.error("Component not supplied as argument")
        raise RuntimeError

    import ultrasonics.plugins

    handshakes = ultrasonics.plugins.handshakes
    selected_handshakes = list()

    # Determine text colour
    for handshake in handshakes:

        if handshake["type"] != component:
            # Plugin is not the requested type
            continue
        else:
            # hexcolour = handshake["colour"]

            # # If a leading '#' is provided, remove it
            # if hexcolour[0] == '#':
            #     hexcolour = hexcolour[1:]

            # # If a three-character hexcode, make six-character
            # if len(hexcolour) == 3:
            #     hexcolour = hexcolour[0] * 2 + \
            #         hexcolour[1] * 2 + hexcolour[2] * 2

            # # Convert to RGB value
            # r = int(hexcolour[0:2], 16)
            # g = int(hexcolour[2:4], 16)
            # b = int(hexcolour[4:6], 16)

            # # Get YIQ ratio
            # yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000

            # # Check contrast
            # if yiq >= 128:
            #     handshake["textColour"] = "#333333"
            # else:
            #     handshake["textColour"] = "#ffffff"

            selected_handshakes.append(handshake)

    return render_template('select_plugin.html', handshakes=selected_handshakes, component=component)


# Configure Plugin page
@app.route('/configure_plugin', methods=['GET', 'POST'])
def html_configure_plugin():
    """
    Settings page for each instance for a plugin.
    """
    from ultrasonics import plugins

    # Data received is to update persistent plugin settings
    if request.form.get('action') == 'add':

        plugin = request.form.get('plugin')
        version = request.form.get('version')
        data = {key: value for key, value in request.form.to_dict().items() if key not in [
                'action', 'plugin', 'version', 'component']}
        component = request.form.get('component')
        persistent = False

        plugins.plugin_update(plugin, version, data)

        # # Redirect to remove url parameters, so that refreshing won't keep adding more plugin instances
        # return redirect(request.path, code=302)

    else:
        plugin = request.args.get('plugin')
        version = request.args.get('version')
        component = request.args.get('component')
        persistent = request.args.get('persistent') != '0'

    settings = plugins.plugin_build(plugin, version)

    # Force redirect to persistent settings if manually requested through url parameters, or if plugin has not been configured
    persistent = persistent or (settings == None)

    if persistent:
        settings = [item["settings"] for item in plugins.handshakes if item["name"]
                    == plugin and item["version"] == float(version)][0]

    return render_template('configure_plugin.html', settings=settings, plugin=plugin, version=version, component=component, persistent=persistent)


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
