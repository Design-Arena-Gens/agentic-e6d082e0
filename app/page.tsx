/* eslint-disable react/no-array-index-key */
"use client";

import { useMemo, useState } from "react";

type KeywordRoute = {
  phrase: string;
  reply: string;
};

type FormState = {
  automationName: string;
  verifyToken: string;
  pageAccessToken: string;
  webhookPath: string;
  defaultReply: string;
  timezone: string;
};

const DEFAULT_ROUTES: KeywordRoute[] = [
  {
    phrase: "status",
    reply:
      "Sure thing! Send me your order number and I will pull up the latest status for you."
  },
  {
    phrase: "refund",
    reply:
      "I can help with refunds. Please share your order number and the reason for the refund so our team can review it quickly."
  },
  {
    phrase: "agent",
    reply:
      "I'm looping in a human teammate right away. Expect a reply within a few minutes during business hours."
  }
];

const DEFAULT_KEYWORD_INPUT = DEFAULT_ROUTES.map(
  (route) => `${route.phrase} => ${route.reply}`
).join("\n");

const TIMEZONE_CHOICES = [
  { value: "America/New_York", label: "New York (UTC-05:00)" },
  { value: "America/Los_Angeles", label: "Los Angeles (UTC-08:00)" },
  { value: "Europe/London", label: "London (UTC+00:00)" },
  { value: "Europe/Paris", label: "Paris (UTC+01:00)" },
  { value: "Asia/Singapore", label: "Singapore (UTC+08:00)" }
];

function sanitizeWebhookPath(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

function parseKeywordInput(value: string): KeywordRoute[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [phrasePart, replyPart] = line.split("=>").map((part) => part.trim());
      if (!phrasePart || !replyPart) {
        return null;
      }
      return {
        phrase: phrasePart,
        reply: replyPart
      };
    })
    .filter((route): route is KeywordRoute => Boolean(route));
}

function generateUuid(label: string) {
  return `${label}-${crypto.randomUUID()}`;
}

function generateWorkflowJson(
  form: FormState,
  keywordRoutes: KeywordRoute[]
): string {
  const timestamp = new Date().toISOString();
  const webhookNodeId = generateUuid("webhook");
  const functionNodeId = generateUuid("function");
  const verificationNodeId = generateUuid("respond-verification");
  const routeVerificationNodeId = generateUuid("route-verification");
  const shouldReplyNodeId = generateUuid("route-reply");
  const sendMessageNodeId = generateUuid("send-message");
  const webhookAckNodeId = generateUuid("respond-ack");
  const workflowId = generateUuid("workflow");

  const webhookPath = form.webhookPath || sanitizeWebhookPath(form.automationName);

  const functionCode = `
const query = $json.query ?? {};
const body = $json.body ?? {};
const verifyToken = ${JSON.stringify(form.verifyToken.trim())};
const keywordRoutes = ${JSON.stringify(keywordRoutes)};
const normalizedRoutes = keywordRoutes.map((route) => ({
  phrase: route.phrase.toLowerCase(),
  reply: route.reply
}));

if (query["hub.mode"] === "subscribe") {
  const tokenMatches = query["hub.verify_token"] === verifyToken;
  return [
    {
      json: {
        isVerification: true,
        statusCode: tokenMatches ? 200 : 403,
        responseBody: tokenMatches
          ? query["hub.challenge"] ?? "Verification challenge missing."
          : "Verification token mismatch.",
        tokenMatches
      }
    }
  ];
}

const entry = Array.isArray(body.entry) ? body.entry[0] : undefined;
const messaging = entry?.messaging?.[0];
const senderId = messaging?.sender?.id ?? "";
const messageText = messaging?.message?.text ?? "";

if (!senderId || !messageText) {
  return [
    {
      json: {
        isVerification: false,
        shouldReply: false,
        statusCode: 200,
        responseBody: "EVENT_RECEIVED",
        reason: "No message text or sender detected.",
        rawEvent: body
      }
    }
  ];
}

const normalizedText = messageText.toLowerCase();
const matchedRoute = normalizedRoutes.find((route) =>
  normalizedText.includes(route.phrase)
);

const replyText = matchedRoute?.reply ?? ${JSON.stringify(
    form.defaultReply.trim()
  )};

return [
  {
    json: {
      isVerification: false,
      shouldReply: true,
      statusCode: 200,
      responseBody: "EVENT_RECEIVED",
      senderId,
      replyText,
      matchedPhrase: matchedRoute?.phrase ?? null,
      rawEvent: body
    }
  }
];
  `.trim();

  const workflow = {
    id: workflowId,
    name: form.automationName || "Messenger Automation",
    active: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    versionId: generateUuid("version"),
    nodes: [
      {
        id: webhookNodeId,
        name: "Messenger Webhook",
        type: "n8n-nodes-base.webhook",
        typeVersion: 1,
        position: [-520, 300],
        parameters: {
          httpMethod: "POST",
          path: webhookPath,
          responseMode: "responseNode",
          options: {
            rawBody: false
          }
        },
        webhookId: generateUuid("webhook-path")
      },
      {
        id: functionNodeId,
        name: "Normalize Event",
        type: "n8n-nodes-base.function",
        typeVersion: 1,
        position: [-220, 300],
        parameters: {
          functionCode
        }
      },
      {
        id: routeVerificationNodeId,
        name: "Route Verification",
        type: "n8n-nodes-base.if",
        typeVersion: 1,
        position: [40, 300],
        parameters: {
          conditions: {
            boolean: [
              {
                value1: "={{$json.isVerification}}",
                operation: "isTrue"
              }
            ]
          }
        }
      },
      {
        id: verificationNodeId,
        name: "Respond Verification",
        type: "n8n-nodes-base.respondToWebhook",
        typeVersion: 1,
        position: [320, 120],
        parameters: {
          respondWith: "json",
          responseBody: "={{$json.responseBody}}",
          responseCode: "={{$json.statusCode}}"
        }
      },
      {
        id: shouldReplyNodeId,
        name: "Should Reply?",
        type: "n8n-nodes-base.if",
        typeVersion: 1,
        position: [320, 460],
        parameters: {
          conditions: {
            boolean: [
              {
                value1: "={{$json.shouldReply}}",
                operation: "isTrue"
              }
            ]
          }
        }
      },
      {
        id: sendMessageNodeId,
        name: "Send Messenger Reply",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 1,
        position: [620, 420],
        parameters: {
          method: "POST",
          url: "https://graph.facebook.com/v18.0/me/messages",
          authentication: "none",
          jsonParameters: true,
          sendBody: true,
          options: {
            fullResponse: false
          },
          bodyParametersJson:
            '{"messaging_type":"RESPONSE","recipient":{"id":"={{$json.senderId}}"},"message":{"text":"={{$json.replyText}}"}}',
          queryParametersJson: `{"access_token":"${form.pageAccessToken.trim()}"}`,
          headerParametersJson: '{"Content-Type":"application/json"}'
        }
      },
      {
        id: webhookAckNodeId,
        name: "Respond OK",
        type: "n8n-nodes-base.respondToWebhook",
        typeVersion: 1,
        position: [880, 580],
        parameters: {
          respondWith: "json",
          responseBody: "={{$json.responseBody}}",
          responseCode: "={{$json.statusCode}}"
        }
      }
    ],
    connections: {
      "Messenger Webhook": {
        main: [
          [
            {
              node: "Normalize Event",
              type: "main",
              index: 0
            }
          ]
        ]
      },
      "Normalize Event": {
        main: [
          [
            {
              node: "Route Verification",
              type: "main",
              index: 0
            }
          ]
        ]
      },
      "Route Verification": {
        main: [
          [
            {
              node: "Respond Verification",
              type: "main",
              index: 0
            }
          ],
          [
            {
              node: "Should Reply?",
              type: "main",
              index: 0
            }
          ]
        ]
      },
      "Should Reply?": {
        main: [
          [
            {
              node: "Send Messenger Reply",
              type: "main",
              index: 0
            }
          ],
          [
            {
              node: "Respond OK",
              type: "main",
              index: 0
            }
          ]
        ]
      },
      "Send Messenger Reply": {
        main: [
          [
            {
              node: "Respond OK",
              type: "main",
              index: 0
            }
          ]
        ]
      }
    },
    settings: {
      timezone: form.timezone
    },
    pinData: {},
    staticData: {}
  };

  return JSON.stringify(workflow, null, 2);
}

export default function Page() {
  const [form, setForm] = useState<FormState>({
    automationName: "Messenger Concierge",
    verifyToken: "my-secure-verification-token",
    pageAccessToken: "EAAGYourPageAccessToken",
    webhookPath: `facebook/${sanitizeWebhookPath("Messenger Concierge")}`,
    defaultReply:
      "Thanks for reaching out! I'm a virtual assistant. Share a few details and I'll route you to the best next step (human support when needed).",
    timezone: "America/New_York"
  });

  const [keywordInput, setKeywordInput] = useState(DEFAULT_KEYWORD_INPUT);
  const [copyStatus, setCopyStatus] = useState<"idle" | "success" | "error">(
    "idle"
  );

  const keywordRoutes = useMemo(
    () => parseKeywordInput(keywordInput),
    [keywordInput]
  );

  const workflowJson = useMemo(
    () => generateWorkflowJson(form, keywordRoutes),
    [form, keywordRoutes]
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(workflowJson);
      setCopyStatus("success");
      setTimeout(() => setCopyStatus("idle"), 2600);
    } catch (error) {
      console.error("Copy failed", error);
      setCopyStatus("error");
      setTimeout(() => setCopyStatus("idle"), 2600);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([workflowJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${sanitizeWebhookPath(form.automationName) || "workflow"}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="container">
      <section className="panel">
        <div className="badge">Messenger · n8n workflow</div>
        <h1 style={{ fontSize: "2.6rem", margin: "0 0 18px" }}>
          Launch a Messenger Concierge in minutes
        </h1>
        <p style={{ maxWidth: 720, marginBottom: 32 }}>
          This generator crafts a production-ready n8n workflow that catches
          Facebook Messenger events, handles webhook verification, triages
          keywords, and responds instantly while keeping your thread open for
          human takeover. Customize the responses, copy the JSON, and import into
          your n8n instance.
        </p>

        <div className="grid">
          <div className="panel" style={{ padding: 28 }}>
            <h2>Messenger Settings</h2>
            <div className="input-grid">
              <div className="input-group">
                <label htmlFor="automationName">Workflow name</label>
                <input
                  id="automationName"
                  value={form.automationName}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      automationName: event.target.value,
                      webhookPath:
                        previous.webhookPath ||
                        `facebook/${sanitizeWebhookPath(event.target.value)}`
                    }))
                  }
                  placeholder="Messenger Concierge"
                />
              </div>
              <div className="input-group">
                <label htmlFor="verifyToken">Verify token</label>
                <input
                  id="verifyToken"
                  value={form.verifyToken}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      verifyToken: event.target.value
                    }))
                  }
                  placeholder="Paste the webhook verify token from Meta"
                />
                <p>
                  Meta sends this during webhook setup to confirm ownership. It
                  must match exactly.
                </p>
              </div>
              <div className="input-group">
                <label htmlFor="pageAccessToken">Page access token</label>
                <input
                  id="pageAccessToken"
                  value={form.pageAccessToken}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      pageAccessToken: event.target.value
                    }))
                  }
                  placeholder="EAAG..."
                />
                <p>
                  Generate a long-lived token from Meta for the Facebook Page the
                  bot should reply from.
                </p>
              </div>
              <div className="input-group">
                <label htmlFor="webhookPath">
                  n8n webhook path (auto-prefixed with /webhook/)
                </label>
                <input
                  id="webhookPath"
                  value={form.webhookPath}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      webhookPath: sanitizeWebhookPath(event.target.value)
                    }))
                  }
                  placeholder="facebook/messenger-concierge"
                />
                <p>
                  Your webhook URL will be
                  {` https://<your-n8n-host>/webhook/${form.webhookPath || "facebook/messenger-concierge"}`}
                </p>
              </div>
              <div className="input-group">
                <label htmlFor="timezone">Workflow timezone</label>
                <select
                  id="timezone"
                  value={form.timezone}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      timezone: event.target.value
                    }))
                  }
                >
                  {TIMEZONE_CHOICES.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="panel" style={{ padding: 28 }}>
            <h2>Conversation design</h2>
            <div className="input-grid">
              <div className="input-group">
                <label htmlFor="defaultReply">Default fallback reply</label>
                <textarea
                  id="defaultReply"
                  value={form.defaultReply}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      defaultReply: event.target.value
                    }))
                  }
                  rows={5}
                  placeholder="Thanks for reaching out..."
                />
                <p>
                  Sent when no keyword match is found. Keep it short and helpful,
                  and point to next steps.
                </p>
              </div>
              <div className="input-group">
                <label htmlFor="keywordRoutes">
                  Keyword routes <span style={{ opacity: 0.6 }}>(one per line)</span>
                </label>
                <textarea
                  id="keywordRoutes"
                  value={keywordInput}
                  onChange={(event) => setKeywordInput(event.target.value)}
                  rows={7}
                  placeholder="keyword => Reply text"
                />
                <p>
                  Format: <code>keyword =&gt; response</code>. Use broader phrases to
                  improve matching. The bot checks if the message contains the
                  keyword text.
                </p>
              </div>
            </div>
            <div className="chip-list">
              {keywordRoutes.map((route, index) => (
                <span className="chip" key={`${route.phrase}-${index}`}>
                  {route.phrase.toLowerCase()}
                </span>
              ))}
            </div>
            <div className="status-pill">
              <span role="img" aria-label="bolt">
                ⚡
              </span>
              {keywordRoutes.length} smart routes active
            </div>
          </div>
        </div>
      </section>

      <section className="grid" style={{ marginTop: 40 }}>
        <div className="panel">
          <h2>Generated n8n workflow</h2>
          <textarea
            className="workflow-code"
            value={workflowJson}
            onChange={() => {}}
            readOnly
          />
          <div className="actions">
            <button className="button primary" type="button" onClick={handleCopy}>
              Copy workflow JSON
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={handleDownload}
            >
              Download .json
            </button>
            {copyStatus === "success" && (
              <span className="copy-success">Copied to clipboard</span>
            )}
            {copyStatus === "error" && (
              <span className="copy-success">Clipboard blocked. Use download.</span>
            )}
          </div>
        </div>

        <div className="panel">
          <h2>What&apos;s inside</h2>
          <p>
            The workflow includes all the moving pieces needed for a compliant
            Messenger bot that keeps Meta happy and your customers informed.
          </p>
          <ul style={{ lineHeight: 1.6 }}>
            <li>
              <strong>Webhook handshake</strong> — gracefully handles the Meta
              verification challenge and protects against mismatched tokens.
            </li>
            <li>
              <strong>Keyword routing</strong> — runs lightweight NLP over your
              phrases so you can trigger different responses or escalate paths.
            </li>
            <li>
              <strong>Graph API reply</strong> — sends a compliant message using the
              Page access token you provide.
            </li>
            <li>
              <strong>Safe fallback</strong> — always acknowledges events so Meta
              never retries the webhook unnecessarily.
            </li>
            <li>
              <strong>Import-ready JSON</strong> — plug this into n8n with
              <em> Import from File</em> and update credentials as needed.
            </li>
          </ul>
          <div className="status-pill warning">
            <span role="img" aria-label="lock">
              🔐
            </span>
            Swap sensitive tokens for n8n credentials after import
          </div>
        </div>
      </section>
    </main>
  );
}
