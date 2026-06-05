import Button from "pebble/button";
import Message from "pebble/message";
import Timer from "timer";
import {} from "piu/MC";

const ROW_COUNT = 4;
const HEADER_HEIGHT = 28;
const ROW_HEIGHT = Math.idiv(screen.height - HEADER_HEIGHT, ROW_COUNT);
const LOADING_LINES = [
	"================================",
	"================================",
	"================================",
	"================================",
	"==============......============",
	"============...........=========",
	"===========.............========",
	"=========................=======",
	"==================.......=======",
	"====================....========",
	"====================...=========",
	"=====================~==========",
	"===========..........===========",
	"==========..........============",
	"========...........=============",
	"=======..........===============",
	"================================",
	"================================",
	"================================",
	"================================",
];
const LOADING_LINE_HEIGHT = Math.idiv(screen.height, LOADING_LINES.length);

const backgroundSkin = new Skin({ fill: "black" });
const rowSkin = new Skin({ fill: ["black", "white"] });
const loadingStyle = new Style({
	font: "FiraMono-Regular-9",
	color: "white",
	horizontal: "center",
	vertical: "middle",
});
const statusStyle = new Style({
	font: "bold 18px Gothic",
	color: "white",
	horizontal: "center",
	vertical: "middle",
});
const rowStyle = new Style({
	font: "bold 18px Gothic",
	color: ["white", "black"],
	horizontal: "left",
	vertical: "middle",
	left: 6,
	right: 6,
});

const model = {};
let threads = [];
let selectedIndex = 0;
let firstVisibleIndex = 0;
let view = "list";
let detailThreadId = null;
let detailLines = [];
let detailOffset = 0;
let pendingThreads = null;
let pendingError = null;
let canHideLoading = false;

function buildLoadingContents($) {
	const contents = [];

	for (let index = 0; index < LOADING_LINES.length; index += 1) {
		contents.push(
			Label($, {
				left: 0,
				right: 0,
				top: index * LOADING_LINE_HEIGHT,
				height: LOADING_LINE_HEIGHT,
				style: loadingStyle,
				string: LOADING_LINES[index],
			}),
		);
	}

	return contents;
}

const ThreadsApplication = Application.template(($) => ({
	skin: backgroundSkin,
	contents: [
		Container($, {
			anchor: "LOADING",
			left: 0,
			right: 0,
			top: 0,
			bottom: 0,
			contents: buildLoadingContents($),
		}),
		Label($, {
			anchor: "STATUS",
			visible: false,
			left: 0,
			right: 0,
			top: 0,
			height: HEADER_HEIGHT,
			style: statusStyle,
			string: "Loading TODO...",
		}),
		Container($, {
			anchor: "ROW0",
			visible: false,
			left: 0,
			right: 0,
			top: HEADER_HEIGHT,
			height: ROW_HEIGHT,
			skin: rowSkin,
			contents: [
				Label($, {
					anchor: "TITLE0",
					left: 0,
					right: 0,
					top: 0,
					bottom: 0,
					style: rowStyle,
				}),
			],
		}),
		Container($, {
			anchor: "ROW1",
			visible: false,
			left: 0,
			right: 0,
			top: HEADER_HEIGHT + ROW_HEIGHT,
			height: ROW_HEIGHT,
			skin: rowSkin,
			contents: [
				Label($, {
					anchor: "TITLE1",
					left: 0,
					right: 0,
					top: 0,
					bottom: 0,
					style: rowStyle,
				}),
			],
		}),
		Container($, {
			anchor: "ROW2",
			visible: false,
			left: 0,
			right: 0,
			top: HEADER_HEIGHT + ROW_HEIGHT * 2,
			height: ROW_HEIGHT,
			skin: rowSkin,
			contents: [
				Label($, {
					anchor: "TITLE2",
					left: 0,
					right: 0,
					top: 0,
					bottom: 0,
					style: rowStyle,
				}),
			],
		}),
		Container($, {
			anchor: "ROW3",
			visible: false,
			left: 0,
			right: 0,
			top: HEADER_HEIGHT + ROW_HEIGHT * 3,
			height: ROW_HEIGHT,
			skin: rowSkin,
			contents: [
				Label($, {
					anchor: "TITLE3",
					left: 0,
					right: 0,
					top: 0,
					bottom: 0,
					style: rowStyle,
				}),
			],
		}),
	],
}));

new ThreadsApplication(model, { displayListLength: 4096 });

Timer.set(() => {
	canHideLoading = true;
	if (pendingError !== null) {
		renderError(pendingError);
	} else if (pendingThreads !== null) {
		threads = pendingThreads;
		selectedIndex = 0;
		firstVisibleIndex = 0;
		renderRows();
	}
}, 1000);

function shorten(value, max) {
	if (value === undefined || value === null) {
		return "";
	}

	const string = String(value);
	if (string.length <= max) {
		return string;
	}

	return string.slice(0, max - 3) + "...";
}

function getRow(index) {
	if (index === 0) return model.ROW0;
	if (index === 1) return model.ROW1;
	if (index === 2) return model.ROW2;
	return model.ROW3;
}

function getTitle(index) {
	if (index === 0) return model.TITLE0;
	if (index === 1) return model.TITLE1;
	if (index === 2) return model.TITLE2;
	return model.TITLE3;
}

function formatThread(thread) {
	return `${thread.ref} ${shorten(thread.title, 24)}`;
}

function renderDetailRows() {
	model.LOADING.visible = false;
	model.STATUS.visible = true;

	for (let i = 0; i < ROW_COUNT; i += 1) {
		const lineIndex = detailOffset + i;
		const row = getRow(i);
		const title = getTitle(i);

		row.visible = lineIndex < detailLines.length;
		row.state = 0;
		title.state = 0;
		title.string = lineIndex < detailLines.length ? detailLines[lineIndex] : "";
	}
}

function renderDetailLoading(thread) {
	view = "detail";
	detailThreadId = thread.id;
	detailOffset = 0;
	detailLines = [`Loading ${thread.ref}...`];
	model.STATUS.string = thread.ref;
	renderDetailRows();
}

function renderDetail(detail) {
	if (detail.threadId !== detailThreadId) {
		return;
	}

	view = "detail";
	detailOffset = 0;
	model.STATUS.string = `${detail.ref} ${detail.status}`;
	detailLines = [detail.title];

	if (detail.description !== "") {
		detailLines.push(detail.description);
	} else if (detail.previewText !== "") {
		detailLines.push(detail.previewText);
	}

	if (detail.messages.length === 0) {
		detailLines.push("No messages");
	} else {
		detailLines.push("Messages:");
		for (let i = 0; i < detail.messages.length; i += 1) {
			detailLines.push(detail.messages[i]);
		}
	}

	renderDetailRows();
}

function renderDetailError(message) {
	detailOffset = 0;
	detailLines = ["Error", shorten(message, 90)];
	model.STATUS.string = "Thread detail";
	renderDetailRows();
}

function renderRows() {
	view = "list";
	detailThreadId = null;
	detailLines = [];
	detailOffset = 0;
	model.LOADING.visible = false;
	model.STATUS.visible = true;

	if (threads.length === 0) {
		model.STATUS.string = "No TODO threads";
		for (let i = 0; i < ROW_COUNT; i += 1) {
			getRow(i).visible = i === 0;
			getRow(i).state = 0;
			getTitle(i).state = 0;
			getTitle(i).string = i === 0 ? "Nothing to show" : "";
		}
		return;
	}

	model.STATUS.string = `TODO ${selectedIndex + 1}/${threads.length}`;

	for (let i = 0; i < ROW_COUNT; i += 1) {
		const threadIndex = firstVisibleIndex + i;
		const row = getRow(i);
		const title = getTitle(i);

		if (threadIndex >= threads.length) {
			row.visible = false;
			title.string = "";
		} else {
			const state = threadIndex === selectedIndex ? 1 : 0;
			row.visible = true;
			row.state = state;
			title.state = state;
			title.string = formatThread(threads[threadIndex]);
		}
	}
}

function moveSelection(delta) {
	if (view === "detail") {
		const maxOffset = detailLines.length - ROW_COUNT;
		detailOffset += delta;
		if (detailOffset < 0) {
			detailOffset = 0;
		} else if (detailOffset > maxOffset) {
			detailOffset = maxOffset;
		}
		if (detailOffset < 0) {
			detailOffset = 0;
		}
		renderDetailRows();
		return;
	}

	if (threads.length === 0) {
		return;
	}

	selectedIndex += delta;
	if (selectedIndex < 0) {
		selectedIndex = 0;
	} else if (selectedIndex >= threads.length) {
		selectedIndex = threads.length - 1;
	}

	if (selectedIndex < firstVisibleIndex) {
		firstVisibleIndex = selectedIndex;
	} else if (selectedIndex >= firstVisibleIndex + ROW_COUNT) {
		firstVisibleIndex = selectedIndex - ROW_COUNT + 1;
	}

	renderRows();
}

function renderError(message) {
	if (view === "detail") {
		renderDetailError(message);
		return;
	}

	model.LOADING.visible = false;
	model.STATUS.visible = true;
	model.STATUS.string = "Error";
	threads = [];
	selectedIndex = 0;
	firstVisibleIndex = 0;

	for (let i = 0; i < ROW_COUNT; i += 1) {
		getRow(i).visible = i === 0;
		getRow(i).state = 0;
		getTitle(i).state = 0;
		getTitle(i).string = i === 0 ? shorten(message, 30) : "";
	}
}

function handleResponse(responseText) {
	let result;

	try {
		result = JSON.parse(responseText);
	} catch (e) {
		return false;
	}

	if (result.errors !== undefined) {
		renderError(result.errors.map((error) => error.message).join(" "));
		return true;
	}

	if (result.data === undefined || result.data.threads === undefined) {
		renderError(responseText);
		return true;
	}

	const edges = result.data.threads.edges;
	threads = [];

	for (let i = 0; i < edges.length; i += 1) {
		threads.push(edges[i].node);
	}

	selectedIndex = 0;
	firstVisibleIndex = 0;
	renderRows();
	return true;
}

const messages = new Message({
	keys: ["THREADS", "THREAD_ID", "THREAD_DETAIL", "ERROR"],
	onReadable() {
		const msg = this.read();
		const error = msg.get("ERROR");
		if (error !== undefined) {
			if (canHideLoading) {
				renderError(error);
			} else {
				pendingError = error;
			}
			return;
		}

		const detailPayload = msg.get("THREAD_DETAIL");
		if (detailPayload !== undefined) {
			try {
				renderDetail(JSON.parse(detailPayload));
			} catch (e) {
				renderError(String(e));
			}
			return;
		}

		const threadPayload = msg.get("THREADS");
		if (threadPayload === undefined) {
			return;
		}

		try {
			const nextThreads = JSON.parse(threadPayload);
			if (canHideLoading) {
				threads = nextThreads;
				selectedIndex = 0;
				firstVisibleIndex = 0;
				renderRows();
			} else {
				pendingThreads = nextThreads;
			}
		} catch (e) {
			if (canHideLoading) {
				renderError(String(e));
			} else {
				pendingError = String(e);
			}
		}
	},
});

function requestSelectedThread() {
	if (view !== "list" || threads.length === 0) {
		return;
	}

	const thread = threads[selectedIndex];
	if (thread.id === undefined) {
		renderError("Thread id missing");
		return;
	}

	renderDetailLoading(thread);
	const request = new Map();
	request.set("THREAD_ID", thread.id);
	messages.write(request);
}

new Button({
	types: ["select", "up", "down", "back"],
	onPush(down, type) {
		if (!down) {
			return;
		}

		if (type === "up") {
			moveSelection(-1);
		} else if (type === "down") {
			moveSelection(1);
		} else if (type === "select") {
			requestSelectedThread();
		} else if (type === "back" && view === "detail") {
			renderRows();
		}
	},
});
