const moddableProxy = require("@moddable/pebbleproxy");

const PLAIN_API_KEY = "REDACTED";

const query = `
  query todoThreads {
    threads(
      filters: { statuses: [TODO] }
      first: 10
    ) {
      edges {
        node {
          ref
          title
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

function fetchTodoThreads() {
    const xhr = new XMLHttpRequest();
    const url = "https://core-api.uk.plain.com/graphql/v1?query=" + encodeURIComponent(query);

    xhr.open("GET", url, true);
    xhr.setRequestHeader("authorization", "Bearer " + PLAIN_API_KEY);
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

            const threads = result.data.threads.edges.map((edge) => ({
                ref: edge.node.ref,
                title: shorten(edge.node.title, 40),
            }));

            sendToWatch({ THREADS: JSON.stringify(threads) });
        } catch (error) {
            sendToWatch({ ERROR: String(error) });
        }
    };

    xhr.onerror = function () {
        sendToWatch({ ERROR: "Network error" });
    };

    xhr.send();
}

Pebble.addEventListener("ready", function (e) {
    moddableProxy.readyReceived(e);
    fetchTodoThreads();
});

Pebble.addEventListener("appmessage", function (e) {
    if (moddableProxy.appMessageReceived(e)) return;

    // This is not a Moddable proxy event. Handle the event here.
});
