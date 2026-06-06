const GRAPHQL_ENDPOINT = "https://core-api.uk.plain.com/graphql/v1";

function log(message) {
	if (typeof console !== "undefined" && console.log) {
		console.log(message);
	}
}

const threadsQuery = `
  query todoThreads {
    threads(
      filters: { statuses: [TODO] }
      first: 10
    ) {
      edges {
        node {
          id
          ref
          title
        }
      }
    }
  }
`;

const threadDetailQuery = `
  query pebbleThreadDetail($threadId: ID!) {
    thread(threadId: $threadId) {
      id
              ref
              title
              description
              previewText
              priority
              status
              createdAt {
                iso8601
              }
              customer {
                fullName
                email {
                  email
                }
                company {
                  name
                }
              }
              labels {
                labelType {
                  name
                }
              }
              assignedTo {
                __typename
                ... on User {
                  fullName
                }
                ... on MachineUser {
                  fullName
                  publicName
                }
                ... on System {
                  id
                }
              }
              timelineEntries(filters: { isMessage: true }, last: 5) {
        edges {
          node {
            entry {
              __typename
              ... on NoteEntry {
                noteText: text
                markdown
              }
              ... on ChatEntry {
                chatText: text
              }
              ... on EmailEntry {
                subject
                textContent
                markdownContent
              }
              ... on SlackMessageEntry {
                slackText: text
              }
              ... on SlackReplyEntry {
                slackReplyText: text
              }
              ... on MSTeamsMessageEntry {
                msTeamsText: text
                markdownContent
              }
              ... on DiscordMessageEntry {
                markdownContent
              }
              ... on ThreadDiscussionMessageEntry {
                discussionText: text
                resolvedText
              }
            }
          }
        }
      }
    }
  }
`;

function shorten(value, max) {
	if (value === null || value === undefined) {
		return "";
	}

	const text = String(value);
	if (text.length <= max) {
		return text;
	}

	return text.slice(0, max - 3) + "...";
}

function compactText(value) {
	if (value === null || value === undefined) {
		return "";
	}

	return String(value).replace(/\s+/g, " ").trim();
}

function entryText(entry) {
	if (entry === null || entry === undefined) {
		return "";
	}

	switch (entry.__typename) {
		case "NoteEntry":
			return compactText(entry.markdown || entry.noteText);
		case "ChatEntry":
			return compactText(entry.chatText);
		case "EmailEntry":
			return compactText((entry.subject ? entry.subject + ": " : "") + (entry.markdownContent || entry.textContent || ""));
		case "SlackMessageEntry":
			return compactText(entry.slackText);
		case "SlackReplyEntry":
			return compactText(entry.slackReplyText);
		case "MSTeamsMessageEntry":
			return compactText(entry.markdownContent || entry.msTeamsText);
		case "DiscordMessageEntry":
			return compactText(entry.markdownContent);
		case "ThreadDiscussionMessageEntry":
			return compactText(entry.resolvedText || entry.discussionText);
		default:
			return compactText(entry.__typename);
	}
}

function shortDate(value) {
	if (value === null || value === undefined || value.iso8601 === undefined) {
		return "";
	}

	return String(value.iso8601).slice(0, 10);
}

function assigneeText(assignee) {
	if (assignee === null || assignee === undefined) {
		return "Unassigned";
	}
	if (assignee.fullName) {
		return compactText(assignee.fullName);
	}
	if (assignee.publicName) {
		return compactText(assignee.publicName);
	}
	if (assignee.id) {
		return compactText(assignee.id);
	}

	return compactText(assignee.__typename);
}

function labelsText(labels) {
	if (!Array.isArray(labels) || labels.length === 0) {
		return "None";
	}

	const names = [];
	for (let i = 0; i < labels.length; i += 1) {
		if (labels[i].labelType && labels[i].labelType.name) {
			names.push(labels[i].labelType.name);
		}
	}

	return names.length === 0 ? "None" : compactText(names.join(", "));
}

function graphqlErrorMessage(xhr) {
	try {
		const result = JSON.parse(xhr.responseText);
		if (Array.isArray(result.errors)) {
			return result.errors.map((error) => error && error.message ? error.message : "Unknown GraphQL error").join(" ");
		}
	} catch (error) {
		log("Plain GraphQL: failed to parse error response: " + String(error));
	}

	return "Plain API request failed with HTTP " + xhr.status + " " + xhr.statusText;
}

function fetchGraphQL(apiKey, query, variables, onResult, onError) {
	const xhr = new XMLHttpRequest();

	xhr.onload = function () {
		if (xhr.status !== 200) {
			onError(graphqlErrorMessage(xhr));
			return;
		}

		let result;
		try {
			result = JSON.parse(xhr.responseText);
		} catch (error) {
			log("Plain GraphQL: invalid JSON response: " + String(error));
			onError("Plain returned an invalid response");
			return;
		}

		if (Array.isArray(result.errors)) {
			onError(result.errors.map((error) => error && error.message ? error.message : "Unknown GraphQL error").join(" "));
			return;
		}

		if (result.data === undefined || result.data === null) {
			onError("Plain returned an incomplete response");
			return;
		}

		try {
			onResult(result.data);
		} catch (error) {
			log("Plain GraphQL: could not read response data: " + String(error));
			onError("Plain returned data this app could not read");
		}
	};

	xhr.onerror = function () {
		onError("Could not reach Plain. Check your phone connection");
	};

	xhr.ontimeout = function () {
		onError("Plain request timed out. Check your phone connection");
	};

	try {
		xhr.timeout = 15000;
		xhr.open("POST", GRAPHQL_ENDPOINT, true);
		xhr.setRequestHeader("authorization", "Bearer " + apiKey);
		xhr.setRequestHeader("content-type", "application/json");
		xhr.setRequestHeader("user-agent", "pebble plain");
		xhr.send(JSON.stringify({ query: query, variables: variables || {} }));
	} catch (error) {
		log("Plain GraphQL: failed to send request: " + String(error));
		onError("Could not start the Plain request");
	}
}

function fetchTodoThreads(apiKey, onThreads, onError) {
	fetchGraphQL(apiKey, threadsQuery, null, function (data) {
		if (!data.threads || !Array.isArray(data.threads.edges)) {
			onError("Plain returned an unexpected thread list");
			return;
		}

		const threads = data.threads.edges.map((edge) => ({
			id: edge.node.id,
			ref: edge.node.ref,
			title: shorten(edge.node.title, 80),
		}));

		onThreads(threads);
	}, onError);
}

function fetchThreadDetail(apiKey, threadId, onDetail, onError) {
	fetchGraphQL(apiKey, threadDetailQuery, { threadId: threadId }, function (data) {
		if (data.thread === null || data.thread === undefined) {
			onError("Thread not found");
			return;
		}
		if (!data.thread.timelineEntries || !Array.isArray(data.thread.timelineEntries.edges)) {
			onError("Plain returned an unexpected thread detail");
			return;
		}

		const messages = [];
		const edges = data.thread.timelineEntries.edges;
		const customer = data.thread.customer;
		const customerEmail = customer && customer.email ? customer.email.email : "";
		const customerName = customer ? compactText(customer.fullName || customerEmail) : "Unknown";
		const companyName = customer && customer.company ? compactText(customer.company.name) : "";
		const customerText = companyName === "" ? customerName : customerName + " @ " + companyName;
		const priorityLabel = data.thread.priority === null || data.thread.priority === undefined ? "" : "P" + data.thread.priority;

		for (let i = 0; i < edges.length; i += 1) {
			const text = entryText(edges[i].node.entry);
			if (text !== "") {
				messages.push(shorten(text, 80));
			}
		}

		onDetail({
			threadId: data.thread.id,
			ref: data.thread.ref,
			title: shorten(data.thread.title, 80),
			description: shorten(compactText(data.thread.description), 80),
			previewText: shorten(compactText(data.thread.previewText), 80),
			priorityLabel: priorityLabel,
			status: data.thread.status,
			customer: shorten(customerText, 80),
			createdAt: shortDate(data.thread.createdAt),
			labels: shorten(labelsText(data.thread.labels), 80),
			assignee: shorten(assigneeText(data.thread.assignedTo), 80),
			updatedAt: "",
			messages: messages,
		});
	}, onError);
}

module.exports = {
	fetchThreadDetail: fetchThreadDetail,
	fetchTodoThreads: fetchTodoThreads,
	shorten: shorten,
};
