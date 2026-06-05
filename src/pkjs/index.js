const moddableProxy = require("@moddable/pebbleproxy");

const PLAIN_API_KEY = "REDACTED";

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
      status
      timelineEntries(filters: { isMessage: true }, last: 5) {
        edges {
          node {
            entry {
              __typename
              ... on NoteEntry {
                text
                markdown
              }
              ... on ChatEntry {
                text
              }
              ... on EmailEntry {
                subject
                textContent
                markdownContent
              }
              ... on SlackMessageEntry {
                text
              }
              ... on SlackReplyEntry {
                text
              }
              ... on MSTeamsMessageEntry {
                text
                markdownContent
              }
              ... on DiscordMessageEntry {
                markdownContent
              }
              ... on ThreadDiscussionMessageEntry {
                text
                resolvedText
              }
            }
          }
        }
      }
    }
  }
`;

function sendToWatch(payload) {
    if (moddableProxy.sendAppMessage) {
        moddableProxy.sendAppMessage(payload);
    } else {
        Pebble.sendAppMessage(payload);
    }
}

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
            return compactText(entry.markdown || entry.text);
        case "ChatEntry":
            return compactText(entry.text);
        case "EmailEntry":
            return compactText((entry.subject ? entry.subject + ": " : "") + (entry.markdownContent || entry.textContent || ""));
        case "SlackMessageEntry":
        case "SlackReplyEntry":
            return compactText(entry.text);
        case "MSTeamsMessageEntry":
            return compactText(entry.markdownContent || entry.text);
        case "DiscordMessageEntry":
            return compactText(entry.markdownContent);
        case "ThreadDiscussionMessageEntry":
            return compactText(entry.resolvedText || entry.text);
        default:
            return compactText(entry.__typename);
    }
}

function fetchGraphQL(query, variables, onResult) {
    const xhr = new XMLHttpRequest();

    xhr.open("POST", "https://core-api.uk.plain.com/graphql/v1", true);
    xhr.setRequestHeader("authorization", "Bearer " + PLAIN_API_KEY);
    xhr.setRequestHeader("content-type", "application/json");
    xhr.setRequestHeader("user-agent", "pebble plain gql demo");

    xhr.onload = function () {
        if (xhr.status !== 200) {
            sendToWatch({ ERROR: "HTTP " + xhr.status + " " + xhr.statusText });
            return;
        }

        try {
            const result = JSON.parse(xhr.responseText);

            if (result.errors !== undefined) {
                sendToWatch({ ERROR: result.errors.map((error) => error.message).join(" ") });
                return;
            }

            onResult(result.data);
        } catch (error) {
            sendToWatch({ ERROR: String(error) });
        }
    };

    xhr.onerror = function () {
        sendToWatch({ ERROR: "Network error" });
    };

    xhr.send(JSON.stringify({ query: query, variables: variables || {} }));
}

function fetchTodoThreads() {
	fetchGraphQL(threadsQuery, null, function (data) {
		const threads = data.threads.edges.map((edge) => ({
			id: edge.node.id,
			ref: edge.node.ref,
			title: shorten(edge.node.title, 40),
		}));

		sendToWatch({ THREADS: JSON.stringify(threads) });
	});
}

function fetchThreadDetail(threadId) {
    fetchGraphQL(threadDetailQuery, { threadId: threadId }, function (data) {
        if (data.thread === null || data.thread === undefined) {
            sendToWatch({ ERROR: "Thread not found" });
            return;
        }

        const messages = [];
        const edges = data.thread.timelineEntries.edges;
        for (let i = 0; i < edges.length; i += 1) {
            const text = entryText(edges[i].node.entry);
            if (text !== "") {
                messages.push(shorten(text, 80));
            }
        }

        sendToWatch({
            THREAD_DETAIL: JSON.stringify({
                threadId: data.thread.id,
                ref: data.thread.ref,
                title: shorten(data.thread.title, 80),
                description: shorten(compactText(data.thread.description), 80),
                previewText: shorten(compactText(data.thread.previewText), 80),
                status: data.thread.status,
                messages: messages,
            }),
        });
    });
}

Pebble.addEventListener("ready", function (e) {
    moddableProxy.readyReceived(e);
    fetchTodoThreads();
});

Pebble.addEventListener("appmessage", function (e) {
    if (moddableProxy.appMessageReceived(e)) return;

    if (e.payload.THREAD_ID) {
        fetchThreadDetail(e.payload.THREAD_ID);
    }
});
