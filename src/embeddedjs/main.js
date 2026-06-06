import Message from "pebble/message";
import {} from "piu/MC";

const ROW_COUNT = 5;
const HEADER_HEIGHT = 28;
const ROW_HEIGHT = Math.idiv(screen.height - HEADER_HEIGHT, ROW_COUNT);
const TITLE_WINDOW = 30;
const TITLE_SCROLL_INTERVAL = 650;
const TITLE_SCROLL_PAUSE_TICKS = 1;
const DETAIL_BUFFER_BEFORE = 1;
const DETAIL_PAGE_SIZE = ROW_COUNT + DETAIL_BUFFER_BEFORE + 2;
let suppressBackRelease = false;

const backgroundSkin = new Skin({ fill: "#071018" });
const rowSkin = new Skin({ fill: ["#071018", "#55D6BE"] });
const splashStyle = new Style({
	font: "bold 18px Gothic",
	color: "#55D6BE",
	horizontal: "center",
	vertical: "middle",
});
const statusStyle = new Style({
	font: "bold 14px Gothic",
	color: "#55D6BE",
	horizontal: "center",
	vertical: "middle",
});
const rowStyle = new Style({
	font: "bold 18px Gothic",
	color: ["white", "#06231E"],
	horizontal: "left",
	vertical: "middle",
	left: 6,
	right: 6,
});
const detailStyle = new Style({
	font: "14px Gothic",
	color: ["white", "#06231E"],
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
let detailLineStart = 0;
let detailLineCount = 0;
let detailRequestedStart = -1;
let detailOffset = 0;
let detailSelectedIndex = 0;
let titleScrollIndex = 0;
let titleScrollPause = TITLE_SCROLL_PAUSE_TICKS;

class AppBehavior extends Behavior {
	onDisplaying(application) {
		application.duration = 86400000;
		application.interval = TITLE_SCROLL_INTERVAL;
		application.start();
		application.focus();
	}
	onFinished(application) {
		application.time = 0;
		application.start();
	}
	onTimeChanged() {
		advanceTitleScroll();
	}
	onPressBack() {
		if (view === "detail") {
			suppressBackRelease = true;
			return true;
		}
	}
	onReleaseBack() {
		if (suppressBackRelease) {
			suppressBackRelease = false;
			renderRows();
			return true;
		}
	}
	onPressDown() {
		moveSelection(1);
		return true;
	}
	onPressSelect() {
		requestSelectedThread();
		return true;
	}
	onPressUp() {
		moveSelection(-1);
		return true;
	}
}

const ThreadsApplication = Application.template(($) => ({
	Behavior: AppBehavior,
	active: true,
	skin: backgroundSkin,
	contents: [
		Label($, {
			anchor: "SPLASH",
			left: 0,
			right: 0,
			top: 0,
			bottom: 0,
			style: splashStyle,
			string: "Plain",
		}),
		Label($, {
			anchor: "STATUS",
			visible: false,
			left: 0,
			right: 0,
			top: 0,
			height: HEADER_HEIGHT,
			style: statusStyle,
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
		Container($, {
			anchor: "ROW4",
			visible: false,
			left: 0,
			right: 0,
			top: HEADER_HEIGHT + ROW_HEIGHT * 4,
			height: ROW_HEIGHT,
			skin: rowSkin,
			contents: [
				Label($, {
					anchor: "TITLE4",
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

new ThreadsApplication(model, { displayListLength: 1024 });

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
	if (index === 3) return model.ROW3;
	return model.ROW4;
}

function getTitle(index) {
	if (index === 0) return model.TITLE0;
	if (index === 1) return model.TITLE1;
	if (index === 2) return model.TITLE2;
	if (index === 3) return model.TITLE3;
	return model.TITLE4;
}

function formatThread(thread) {
	return `${thread.ref} ${thread.title}`;
}

function marqueeText(text) {
	if (text.length <= TITLE_WINDOW) {
		return text;
	}

	const gap = "   ";
	const loop = text + gap + text;
	const index = titleScrollIndex % (text.length + gap.length);
	return loop.slice(index, index + TITLE_WINDOW);
}

function resetTitleScroll() {
	titleScrollIndex = 0;
	titleScrollPause = TITLE_SCROLL_PAUSE_TICKS;
}

function renderSelectedTitle() {
	if (view === "list") {
		if (threads.length === 0) {
			return;
		}

		const rowIndex = selectedIndex - firstVisibleIndex;
		if (rowIndex < 0 || rowIndex >= ROW_COUNT) {
			return;
		}

		getTitle(rowIndex).string = marqueeText(formatThread(threads[selectedIndex]));
		return;
	}

	if (view !== "detail" || detailLines.length === 0) {
		return;
	}

	const rowIndex = detailSelectedIndex - detailOffset;
	if (rowIndex < 0 || rowIndex >= ROW_COUNT) {
		return;
	}

	getTitle(rowIndex).string = marqueeText(getDetailLine(detailSelectedIndex));
}

function advanceTitleScroll() {
	let text = "";

	if (view === "list" && threads.length !== 0) {
		text = formatThread(threads[selectedIndex]);
	} else if (view === "detail" && detailLineCount !== 0) {
		text = getDetailLine(detailSelectedIndex);
	} else {
		return;
	}

	if (text.length <= TITLE_WINDOW) {
		return;
	}

	if (titleScrollPause > 0) {
		titleScrollPause -= 1;
		return;
	}

	titleScrollIndex += 1;
	renderSelectedTitle();
}

function getDetailLine(lineIndex) {
	const localIndex = lineIndex - detailLineStart;
	if (localIndex < 0 || localIndex >= detailLines.length) {
		return "Loading...";
	}

	return detailLines[localIndex] === undefined ? "Loading..." : detailLines[localIndex];
}

function requestDetailPage(start) {
	if (detailThreadId === null || start === detailRequestedStart || start === detailLineStart) {
		return;
	}

	detailRequestedStart = start;
	const request = new Map();
	request.set("THREAD_DETAIL_PAGE", detailThreadId + "\n" + start);
	messages.write(request);
}

function ensureDetailBuffer() {
	if (detailLineCount === 0) {
		return;
	}

	const visibleStart = detailOffset;
	const visibleEnd = Math.min(detailLineCount - 1, detailOffset + ROW_COUNT - 1);
	const loadedEnd = detailLineStart + detailLines.length - 1;
	if (visibleStart >= detailLineStart && visibleEnd <= loadedEnd) {
		return;
	}

	let start = visibleStart - DETAIL_BUFFER_BEFORE;
	if (start < 0) {
		start = 0;
	}

	const maxStart = Math.max(0, detailLineCount - DETAIL_PAGE_SIZE);
	if (start > maxStart) {
		start = maxStart;
	}

	requestDetailPage(start);
}

function renderDetailRows() {
	model.SPLASH.visible = false;
	model.STATUS.visible = true;

	for (let i = 0; i < ROW_COUNT; i += 1) {
		const lineIndex = detailOffset + i;
		const row = getRow(i);
		const title = getTitle(i);
		const visible = lineIndex < detailLineCount;
		const active = visible && lineIndex === detailSelectedIndex;
		const text = visible ? getDetailLine(lineIndex) : "";

		row.visible = visible;
		row.state = active ? 1 : 0;
		title.style = detailStyle;
		title.state = row.state;
		title.string = visible ? (active ? marqueeText(text) : shorten(text, TITLE_WINDOW)) : "";
	}
}

function renderDetailLoading(thread, threadIndex) {
	view = "detail";
	detailThreadId = threadIndex;
	detailLineStart = 0;
	detailLineCount = 1;
	detailRequestedStart = -1;
	detailOffset = 0;
	detailSelectedIndex = 0;
	detailLines = [`Loading ${thread.ref}...`];
	resetTitleScroll();
	model.STATUS.string = thread.ref;
	renderDetailRows();
}

function splitScopedMessage(payload) {
	const text = String(payload);
	const separator = text.indexOf("\n");
	if (separator < 0) {
		return { threadId: text, text: "" };
	}

	return {
		threadId: text.slice(0, separator),
		text: text.slice(separator + 1),
	};
}

function renderDetailStart(payload) {
	const message = splitScopedMessage(payload);
	if (message.threadId !== detailThreadId) {
		return;
	}

	view = "detail";
	detailOffset = 0;
	detailSelectedIndex = 0;
	detailLineStart = 0;
	detailLineCount = 0;
	detailRequestedStart = -1;
	resetTitleScroll();
	model.STATUS.string = message.text;
	detailLines = [];

	renderDetailRows();
}

function renderDetailLine(payload) {
	const message = splitScopedMessage(payload);
	const line = splitScopedMessage(message.text);
	const lineIndex = Number(line.threadId);
	if (message.threadId !== detailThreadId || !Number.isInteger(lineIndex)) {
		return;
	}

	const localIndex = lineIndex - detailLineStart;
	if (localIndex < 0 || localIndex >= DETAIL_PAGE_SIZE) {
		return;
	}

	detailLines[localIndex] = line.text;
	renderDetailRows();
}

function renderDetailDone(threadId) {
	if (String(threadId) !== detailThreadId || detailLineCount !== 0) {
		return;
	}

	detailLineCount = 1;
	detailLines = ["No detail lines"];
	renderDetailRows();
}

function renderDetailPage(payload) {
	const message = splitScopedMessage(payload);
	const page = splitScopedMessage(message.text);
	if (message.threadId !== detailThreadId) {
		return;
	}

	const start = Number(page.threadId);
	const count = Number(page.text);
	if (!Number.isInteger(start) || !Number.isInteger(count)) {
		return;
	}

	detailLineStart = start;
	detailLineCount = count;
	detailRequestedStart = -1;
	detailLines = [];
	if (detailLineCount === 0) {
		detailLineCount = 1;
		detailLines = ["No detail lines"];
	}
	renderDetailRows();
}

function renderDetailError(message) {
	detailOffset = 0;
	detailSelectedIndex = 0;
	resetTitleScroll();
	detailLines = ["Error", shorten(message, 90)];
	model.STATUS.string = "Thread detail";
	renderDetailRows();
}

function renderRows() {
	view = "list";
	detailThreadId = null;
	detailLines = [];
	detailLineStart = 0;
	detailLineCount = 0;
	detailRequestedStart = -1;
	detailOffset = 0;
	detailSelectedIndex = 0;
	resetTitleScroll();
	model.SPLASH.visible = false;
	model.STATUS.visible = true;

	if (threads.length === 0) {
		model.STATUS.string = "No TODO threads";
		for (let i = 0; i < ROW_COUNT; i += 1) {
			const row = getRow(i);
			const title = getTitle(i);
			row.visible = i === 0;
			row.state = 0;
			title.style = rowStyle;
			title.state = 0;
			title.string = i === 0 ? "Nothing to show" : "";
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
			const text = formatThread(threads[threadIndex]);
			row.visible = true;
			row.state = state;
			title.style = rowStyle;
			title.state = state;
			title.string = state === 1 ? marqueeText(text) : shorten(text, TITLE_WINDOW);
		}
	}
}

function renderThreadsLoading() {
	view = "list";
	detailThreadId = null;
	detailLines = [];
	detailLineStart = 0;
	detailLineCount = 0;
	detailRequestedStart = -1;
	detailOffset = 0;
	detailSelectedIndex = 0;
	threads = [];
	selectedIndex = 0;
	firstVisibleIndex = 0;
	resetTitleScroll();
	model.SPLASH.visible = false;
	model.STATUS.visible = true;
	model.STATUS.string = "Loading TODO...";

	for (let i = 0; i < ROW_COUNT; i += 1) {
		const row = getRow(i);
		const title = getTitle(i);
		row.visible = false;
		row.state = 0;
		title.style = rowStyle;
		title.state = 0;
		title.string = "";
	}
}

function addThreadLine(payload) {
	const thread = splitScopedMessage(payload);
	threads.push({
		ref: thread.threadId,
		title: thread.text,
	});
}

function moveSelection(delta) {
	if (view === "detail") {
		if (detailLineCount === 0) {
			return;
		}

		detailSelectedIndex += delta;
		if (detailSelectedIndex < 0) {
			detailSelectedIndex = 0;
		} else if (detailSelectedIndex >= detailLineCount) {
			detailSelectedIndex = detailLineCount - 1;
		}

		if (detailSelectedIndex < detailOffset) {
			detailOffset = detailSelectedIndex;
		} else if (detailSelectedIndex >= detailOffset + ROW_COUNT) {
			detailOffset = detailSelectedIndex - ROW_COUNT + 1;
		}

		ensureDetailBuffer();
		resetTitleScroll();
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

	model.SPLASH.visible = false;
	model.STATUS.visible = true;
	model.STATUS.string = "Error";
	threads = [];
	selectedIndex = 0;
	firstVisibleIndex = 0;

	for (let i = 0; i < ROW_COUNT; i += 1) {
		const row = getRow(i);
		const title = getTitle(i);
		row.visible = i === 0;
		row.state = 0;
		title.style = rowStyle;
		title.state = 0;
		title.string = i === 0 ? shorten(message, 30) : "";
	}
}

const messages = new Message({
	keys: [
		"THREADS_START",
		"THREAD_LINE",
		"THREADS_DONE",
		"THREAD_ID",
		"THREAD_DETAIL_START",
		"THREAD_DETAIL_PAGE",
		"THREAD_DETAIL_LINE",
		"THREAD_DETAIL_DONE",
		"THREAD_DETAIL_ERROR",
		"ERROR",
	],
	input: 768,
	output: 128,
	onReadable() {
		const msg = this.read();
		const error = msg.get("ERROR");
		if (error !== undefined) {
			renderError(error);
			return;
		}

		const detailErrorPayload = msg.get("THREAD_DETAIL_ERROR");
		if (detailErrorPayload !== undefined) {
			const detailError = splitScopedMessage(detailErrorPayload);
			if (view === "detail" && detailError.threadId === detailThreadId) {
				renderDetailError(detailError.text);
			}
			return;
		}

		const detailStartPayload = msg.get("THREAD_DETAIL_START");
		if (detailStartPayload !== undefined) {
			renderDetailStart(detailStartPayload);
			return;
		}

		const detailLinePayload = msg.get("THREAD_DETAIL_LINE");
		if (detailLinePayload !== undefined) {
			renderDetailLine(detailLinePayload);
			return;
		}

		const detailPagePayload = msg.get("THREAD_DETAIL_PAGE");
		if (detailPagePayload !== undefined) {
			renderDetailPage(detailPagePayload);
			return;
		}

		const detailDonePayload = msg.get("THREAD_DETAIL_DONE");
		if (detailDonePayload !== undefined) {
			renderDetailDone(detailDonePayload);
			return;
		}

		const threadsStartPayload = msg.get("THREADS_START");
		if (threadsStartPayload !== undefined) {
			renderThreadsLoading();
			return;
		}

		const threadLinePayload = msg.get("THREAD_LINE");
		if (threadLinePayload !== undefined) {
			addThreadLine(threadLinePayload);
			return;
		}

		const threadsDonePayload = msg.get("THREADS_DONE");
		if (threadsDonePayload !== undefined) {
			renderRows();
			return;
		}
	},
});

function requestSelectedThread() {
	if (view !== "list" || threads.length === 0) {
		return;
	}

	const thread = threads[selectedIndex];
	const threadIndex = String(selectedIndex);

	renderDetailLoading(thread, threadIndex);
	const request = new Map();
	request.set("THREAD_ID", threadIndex);
	messages.write(request);
}
