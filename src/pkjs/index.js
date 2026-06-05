const moddableProxy = require("@moddable/pebbleproxy");
const Clay = require("@rebble/clay");
const clayConfig = require("./config");
const plain = require("./plain");
const settings = require("./settings");

const clay = new Clay(clayConfig, null, { autoHandleEvents: false });

function sendToWatch(payload) {
	const onFailure = function (error) {
		if (typeof console !== "undefined" && console.log) {
			console.log("Plain watch message failed: " + String(error));
		}
	};

	if (moddableProxy.sendAppMessage) {
		moddableProxy.sendAppMessage(payload);
	} else {
		Pebble.sendAppMessage(payload, null, onFailure);
	}
}

function sendError(message) {
	sendToWatch({ ERROR: plain.shorten(message, 120) });
}

function sendThreadDetailError(threadId, message) {
	sendToWatch({
		THREAD_DETAIL_ERROR: JSON.stringify({
			threadId: threadId,
			message: plain.shorten(message, 120),
		}),
	});
}

function configuredApiKey(onMissing) {
	let apiKey;
	try {
		apiKey = settings.getApiKey();
	} catch (error) {
		onMissing(error.message || String(error));
		return null;
	}

	if (apiKey !== "") {
		return apiKey;
	}

	onMissing(settings.MISSING_API_KEY_MESSAGE);
	return null;
}

function fetchTodoThreads() {
	const apiKey = configuredApiKey(sendError);
	if (apiKey === null) {
		return;
	}

	plain.fetchTodoThreads(apiKey, function (threads) {
		sendToWatch({ THREADS: JSON.stringify(threads) });
	}, sendError);
}

function fetchThreadDetail(threadId) {
	const apiKey = configuredApiKey(function (message) {
		sendThreadDetailError(threadId, message);
	});
	if (apiKey === null) {
		return;
	}

	plain.fetchThreadDetail(apiKey, threadId, function (detail) {
		sendToWatch({ THREAD_DETAIL: JSON.stringify(detail) });
	}, function (message) {
		sendThreadDetailError(threadId, message);
	});
}

Pebble.addEventListener("ready", function (e) {
	moddableProxy.readyReceived(e);
	fetchTodoThreads();
});

Pebble.addEventListener("showConfiguration", function () {
	try {
		settings.scrubClaySecrets();
		Pebble.openURL(clay.generateUrl());
	} catch (error) {
		sendError("Config error: " + (error.message || String(error)));
	}
});

Pebble.addEventListener("webviewclosed", function (e) {
	try {
		if (!e || !e.response) {
			return;
		}

		if (settings.applyClaySettings(clay.getSettings(e.response, false))) {
			fetchTodoThreads();
		}
	} catch (error) {
		if (typeof console !== "undefined" && console.log) {
			console.log("Plain config: failed to process webview response: " + String(error));
		}
		sendError("Could not save Plain settings. Reopen settings and try again.");
	}
});

Pebble.addEventListener("appmessage", function (e) {
	if (moddableProxy.appMessageReceived(e)) return;

	if (e.payload.THREAD_ID) {
		fetchThreadDetail(e.payload.THREAD_ID);
	}
});
