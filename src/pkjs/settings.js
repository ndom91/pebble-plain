const API_KEY_STORAGE_KEY = "plainApiKey";
const CLAY_SETTINGS_KEY = "clay-settings";
const MISSING_API_KEY_MESSAGE = "Configure Plain API key in phone app";

function log(message) {
	if (typeof console !== "undefined" && console.log) {
		console.log(message);
	}
}

function getApiKey() {
	try {
		return (localStorage.getItem(API_KEY_STORAGE_KEY) || "").trim();
	} catch (error) {
		log("Plain config: failed to read API key from localStorage: " + String(error));
		throw new Error("Could not read Plain settings from phone storage");
	}
}

function setApiKey(value) {
	const apiKey = (value || "").trim();

	try {
		if (apiKey === "") {
			localStorage.removeItem(API_KEY_STORAGE_KEY);
		} else {
			localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
		}
	} catch (error) {
		log("Plain config: failed to save API key to localStorage: " + String(error));
		throw new Error("Could not save Plain settings on this phone");
	}

	return apiKey;
}

function settingValue(settings, key) {
	const setting = settings[key];
	if (setting && typeof setting === "object" && setting.value !== undefined) {
		return setting.value;
	}

	return setting;
}

function scrubClaySecrets() {
	try {
		const settings = JSON.parse(localStorage.getItem(CLAY_SETTINGS_KEY)) || {};
		delete settings.PLAIN_API_KEY;
		delete settings.CLEAR_API_KEY;
		localStorage.setItem(CLAY_SETTINGS_KEY, JSON.stringify(settings));
	} catch (error) {
		log("Plain config: failed to scrub Clay settings: " + String(error));
	}
}

function applyClaySettings(claySettings) {
	scrubClaySecrets();

	if (claySettings === null || typeof claySettings !== "object") {
		throw new Error("Configuration response did not include Plain settings");
	}

	if (settingValue(claySettings, "CLEAR_API_KEY") === true) {
		setApiKey("");
		return true;
	}

	const apiKey = settingValue(claySettings, "PLAIN_API_KEY");
	if (typeof apiKey !== "string") {
		throw new Error("Configuration response did not include a Plain API key");
	}

	if (apiKey.trim() === "" && getApiKey() !== "") {
		return true;
	}

	setApiKey(apiKey);
	return true;
}

module.exports = {
	MISSING_API_KEY_MESSAGE: MISSING_API_KEY_MESSAGE,
	applyClaySettings: applyClaySettings,
	getApiKey: getApiKey,
	scrubClaySecrets: scrubClaySecrets,
};
