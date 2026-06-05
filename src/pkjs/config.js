module.exports = [
	{
		type: "heading",
		defaultValue: "Plain Configuration",
	},
	{
		type: "text",
		defaultValue: "Enter a Plain API key. If a key is already configured, leave the field blank to keep it.",
	},
	{
		type: "section",
		items: [
			{
				type: "input",
				messageKey: "PLAIN_API_KEY",
				defaultValue: "",
				label: "Plain API key",
				description: "Stored by PebbleKit JS on your phone. It is not sent to the watch.",
				attributes: {
					placeholder: "plainApiKey_...",
					type: "password",
				},
			},
			{
				type: "toggle",
				messageKey: "CLEAR_API_KEY",
				defaultValue: false,
				label: "Clear saved key",
				description: "Enable this and save to remove the stored Plain API key.",
			},
		],
	},
	{
		type: "submit",
		defaultValue: "Save",
	},
];
