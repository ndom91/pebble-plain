const moddableProxy = require("@moddable/pebbleproxy");
const Clay = require("@rebble/clay");
const clayConfig = require("./config");
const plain = require("./plain");
const settings = require("./settings");

const clay = new Clay(clayConfig, null, { autoHandleEvents: false });
let threadIds = [];

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
	threadIds = [];
	sendToWatch({ ERROR: plain.shorten(message, 120) });
}

function sendThreadDetailError(threadId, message) {
	sendToWatch({ THREAD_DETAIL_ERROR: threadId + "\n" + plain.shorten(message, 120) });
}

function detailLines(detail) {
	const lines = [detail.title];

	if (detail.customer !== "") {
		lines.push("From " + detail.customer);
	}
	if (detail.updatedAt !== "") {
		lines.push("Updated " + detail.updatedAt);
	}

	if (detail.description !== "") {
		lines.push(detail.description);
	} else if (detail.previewText !== "") {
		lines.push(detail.previewText);
	}

	if (detail.messages.length === 0) {
		lines.push("No messages");
	} else {
		lines.push("Messages");
		for (let i = 0; i < detail.messages.length; i += 1) {
			lines.push(detail.messages[i]);
		}
	}

	return lines;
}

function sendThreadDetail(threadIndexText, detail) {
	sendToWatch({ THREAD_DETAIL_START: threadIndexText + "\n" + detail.ref + " " + detail.status + " " + detail.priorityLabel });

	const lines = detailLines(detail);
	for (let i = 0; i < lines.length; i += 1) {
		sendToWatch({ THREAD_DETAIL_LINE: threadIndexText + "\n" + lines[i] });
	}

	sendToWatch({ THREAD_DETAIL_DONE: threadIndexText });
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
		threadIds = [];
		sendToWatch({ THREADS_START: "1" });

		for (let i = 0; i < threads.length; i += 1) {
			threadIds.push(threads[i].id);
			sendToWatch({ THREAD_LINE: threads[i].ref + "\n" + threads[i].title });
		}

		sendToWatch({ THREADS_DONE: "1" });
	}, sendError);
}

function fetchThreadDetail(threadIndexText) {
	const threadIndex = Number(threadIndexText);
	if (!Number.isInteger(threadIndex) || threadIndex < 0 || threadIndex >= threadIds.length) {
		sendThreadDetailError(threadIndexText, "Thread selection expired. Refresh the list.");
		return;
	}

	const threadId = threadIds[threadIndex];
	const apiKey = configuredApiKey(function (message) {
		sendThreadDetailError(threadIndexText, message);
	});
	if (apiKey === null) {
		return;
	}

	plain.fetchThreadDetail(apiKey, threadId, function (detail) {
		sendThreadDetail(threadIndexText, detail);
	}, function (message) {
		sendThreadDetailError(threadIndexText, message);
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
