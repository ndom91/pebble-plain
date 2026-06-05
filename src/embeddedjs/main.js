import Message from "pebble/message";
import {} from "piu/MC";

const ROW_COUNT = 5;
const HEADER_HEIGHT = 28;
const ROW_HEIGHT = Math.idiv(screen.height - HEADER_HEIGHT, ROW_COUNT);
const TITLE_WINDOW = 30;
const TITLE_SCROLL_INTERVAL = 650;
const TITLE_SCROLL_PAUSE_TICKS = 1;
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

	getTitle(rowIndex).string = marqueeText(detailLines[detailSelectedIndex]);
}

function advanceTitleScroll() {
	let text = "";

	if (view === "list" && threads.length !== 0) {
		text = formatThread(threads[selectedIndex]);
	} else if (view === "detail" && detailLines.length !== 0) {
		text = detailLines[detailSelectedIndex];
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

function renderDetailRows() {
	model.SPLASH.visible = false;
	model.STATUS.visible = true;

	for (let i = 0; i < ROW_COUNT; i += 1) {
		const lineIndex = detailOffset + i;
		const row = getRow(i);
		const title = getTitle(i);
		const visible = lineIndex < detailLines.length;
		const active = visible && lineIndex === detailSelectedIndex;

		row.visible = visible;
		row.state = active ? 1 : 0;
		title.style = detailStyle;
		title.state = row.state;
		title.string = visible ? (active ? marqueeText(detailLines[lineIndex]) : shorten(detailLines[lineIndex], TITLE_WINDOW)) : "";
	}
}

function renderDetailLoading(thread, threadIndex) {
	view = "detail";
	detailThreadId = threadIndex;
	detailOffset = 0;
	detailSelectedIndex = 0;
	detailLines = [`Loading ${thread.ref}...`];
	resetTitleScroll();
	model.STATUS.string = thread.ref;
	renderDetailRows();
}

function renderDetail(detail) {
	if (detail.threadId !== detailThreadId) {
		return;
	}

	view = "detail";
	detailOffset = 0;
	detailSelectedIndex = 0;
	resetTitleScroll();
	model.STATUS.string = `${detail.ref} ${detail.status} ${detail.priorityLabel}`;
	detailLines = [detail.title];

	if (detail.customer !== "") {
		detailLines.push(`From ${detail.customer}`);
	}
	if (detail.updatedAt !== "") {
		detailLines.push(`Updated ${detail.updatedAt}`);
	}

	if (detail.description !== "") {
		detailLines.push(detail.description);
	} else if (detail.previewText !== "") {
		detailLines.push(detail.previewText);
	}

	if (detail.messages.length === 0) {
		detailLines.push("No messages");
	} else {
		detailLines.push("Messages");
		for (let i = 0; i < detail.messages.length; i += 1) {
			detailLines.push(detail.messages[i]);
		}
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

function moveSelection(delta) {
	if (view === "detail") {
		if (detailLines.length === 0) {
			return;
		}

		detailSelectedIndex += delta;
		if (detailSelectedIndex < 0) {
			detailSelectedIndex = 0;
		} else if (detailSelectedIndex >= detailLines.length) {
			detailSelectedIndex = detailLines.length - 1;
		}

		if (detailSelectedIndex < detailOffset) {
			detailOffset = detailSelectedIndex;
		} else if (detailSelectedIndex >= detailOffset + ROW_COUNT) {
			detailOffset = detailSelectedIndex - ROW_COUNT + 1;
		}

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
		"THREADS",
		"THREAD_ID",
		"THREAD_DETAIL",
		"THREAD_DETAIL_ERROR",
		"ERROR",
	],
	input: 1536,
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
			try {
				const detailError = JSON.parse(detailErrorPayload);
				if (view === "detail" && detailError.threadId === detailThreadId) {
					renderDetailError(detailError.message);
				}
			} catch (e) {
				renderError(String(e));
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
			threads = nextThreads;
			selectedIndex = 0;
			firstVisibleIndex = 0;
			renderRows();
		} catch (e) {
			renderError(String(e));
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
