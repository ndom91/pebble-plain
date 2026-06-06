const Clay = require("@rebble/clay");
const clayConfig = require("./config");
const plain = require("./plain");
const settings = require("./settings");

const clay = new Clay(clayConfig, null, { autoHandleEvents: false });
let threadIds = [];
const FIELD_SEPARATOR = "\x1f";
const RECORD_SEPARATOR = "\x1e";

function messageText(value, max) {
	return plain.shorten(value, max || 72).replace(/[^\x20-\x7e]/g, "?").replace(/[\x1e\x1f]/g, " ");
}

function sendToWatch(payload) {
	const onFailure = function (error) {
		if (typeof console !== "undefined" && console.log) {
			console.log("Plain watch message failed: " + String(error));
		}
	};

	Pebble.sendAppMessage(payload, null, onFailure);
}

function sendError(message) {
	threadIds = [];
	sendToWatch({ ERROR: plain.shorten(message, 120) });
}

function sendThreadDetailError(threadId, message) {
	sendToWatch({ THREAD_DETAIL_ERROR: threadId + FIELD_SEPARATOR + messageText(message, 72) });
}

function detailLines(detail) {
	const lines = [
		["Title", detail.title],
		["From", detail.customer],
		["Created", detail.createdAt],
		["Priority", detail.priorityLabel === "" ? "None" : detail.priorityLabel],
		["Labels", detail.labels],
		["Assignee", detail.assignee],
	];

	if (detail.messages.length === 0) {
		lines.push(["Message", "None"]);
	} else {
		for (let i = 0; i < detail.messages.length; i += 1) {
			lines.push(["Message", detail.messages[i]]);
		}
	}

	return lines;
}

function sendThreadDetail(threadIndexText, detail) {
	const records = [
		threadIndexText,
		messageText(detail.ref + " " + detail.status + " " + detail.priorityLabel, 48),
	];
	const lines = detailLines(detail);
	for (let i = 0; i < lines.length; i += 1) {
		records.push(messageText(lines[i][0], 16) + FIELD_SEPARATOR + messageText(lines[i][1], 72));
	}

	sendToWatch({ THREAD_DETAIL: records.join(RECORD_SEPARATOR) });
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
		const records = [];
		threadIds = [];

		for (let i = 0; i < threads.length; i += 1) {
			threadIds.push(threads[i].id);
			records.push(messageText(threads[i].ref, 16) + FIELD_SEPARATOR + messageText(threads[i].title, 72));
		}

		sendToWatch({ THREADS: records.join(RECORD_SEPARATOR) });
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

Pebble.addEventListener("ready", function () {
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
	if (e.payload.THREAD_ID) {
		fetchThreadDetail(e.payload.THREAD_ID);
	}
});
