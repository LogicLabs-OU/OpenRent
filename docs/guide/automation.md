# Automation with Zapier and n8n

OpenRent tells other tools what happens through **webhooks** and takes instructions through its **API**. Zapier, Make and n8n can use both, so you can connect OpenRent to almost anything without writing a plugin:

- a new booking posts to a Slack channel;
- a returned booking adds a row to a Google Sheet;
- a paid invoice starts a task in your project tool;
- a form on another site creates a customer in OpenRent.

## 1. Create a webhook endpoint

1. In OpenRent, open **Settings → Webhooks**.
2. Paste the URL your automation tool gives you into **Endpoint URL**. Under **Events**, list the events you need, separated by commas (`*` sends all of them).
3. Choose **Add endpoint**.
4. Copy the **signing secret**. It is shown only once; **Rotate secret** makes a new one.
5. Use **Send test** to send a `ping` event, so the tool can see what a delivery looks like.

Each delivery is a `POST` with a JSON body:

```json
{
  "id": "evt_01JD…",
  "type": "order.status_changed",
  "api_version": "2026-10-01",
  "created_at": "2026-11-02T09:00:12.000Z",
  "tenant_id": "ten_01J…",
  "livemode": true,
  "data": {
    "object": { "id": "ord_01J…", "object": "order", "number": 1042, "status": "reserved", "…": "…" },
    "previous_attributes": { "status": "quote" }
  },
  "actor": { "type": "user", "id": "usr_01J…" }
}
```

`data.object` is the record as the API returns it. `previous_attributes` holds the values from before the change, when there are any. Related records come as ids (an order has `customer_id`). To get one, read it from the API, e.g. `GET /orders/{id}?expand=customer`.

These headers come with every delivery:

| Header | Meaning |
| --- | --- |
| `OpenRent-Event-Type` | The event, e.g. `order.status_changed` |
| `OpenRent-Event-Id` | The same for every retry of the event: use it to skip duplicates |
| `OpenRent-Delivery-Attempt` | 1 for the first try |
| `OpenRent-Signature` | `t=<unix time>,v1=<hex>`: see below |

A delivery counts as done when your endpoint answers with a 2xx status within 10 seconds. Otherwise OpenRent tries again after 1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours, 12 hours and twice after 24 hours. After that the delivery is marked failed and can be sent again from **Deliveries**.

### Events you will most often use

| Event | When |
| --- | --- |
| `order.created` | A booking, quote or draft is made (in the admin, the storefront, the widget or the API) |
| `order.status_changed` | Reserved, picked up, returned, cancelled… (`data.previous_attributes.status` is the old status) |
| `order.updated` | Dates, lines or details change |
| `order.overdue` | A rental was not returned in time |
| `payment.succeeded`, `payment.refunded` | Money in or out |
| `document.issued` | An invoice, credit note, quote or contract is issued |
| `customer.created`, `customer.updated` | Customer records |
| `delivery.scheduled`, `delivery.completed` | Deliveries and collections |
| `saved_report.sent` | A scheduled report went out (with the file id) |

## 2. Check the signature

The signature proves that a delivery comes from your shop and was not changed on the way. It is an HMAC-SHA256, made with the signing secret, over `<t>.<raw body>`. During the 24 hours after a secret rotation, the header carries a second `v1=` for the old secret.

To check it:

1. Take `t` and every `v1` from the header.
2. Compute `HMAC-SHA256(secret, t + "." + rawBody)` as hex.
3. Accept the delivery when it equals one of the `v1` values and `t` is no older than 5 minutes.

The check needs the raw body exactly as it was sent: re-encoding the parsed JSON changes it.

## 3. n8n

The workflow below receives OpenRent events and checks the signature. When a booking becomes **reserved**, it posts the booking to Slack, then adds the tag `notified` to the booking through the API.

To set it up:

1. Import the workflow: **Workflows → Import from file**.
2. In the **Webhook** node, copy the production URL into OpenRent as the endpoint URL. Use the events `order.status_changed`.
3. In n8n, add two variables: `OPENRENT_WEBHOOK_SECRET` (the signing secret) and `OPENRENT_API_URL` (e.g. `https://rent.example.com/api/v1`).
4. Add a credential of type **Header Auth** named `OpenRent API`. Set its name to `Authorization` and its value to `Bearer sk_live_…`. Make the key in **Settings → API keys** with the `orders:write` scope.
5. Choose your Slack channel in the **Slack** node, then activate the workflow.

```json
{
  "name": "OpenRent: new bookings to Slack",
  "nodes": [
    {
      "parameters": { "httpMethod": "POST", "path": "openrent", "options": { "rawBody": true } },
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [0, 0]
    },
    {
      "parameters": {
        "jsCode": "const crypto = require('crypto');\nconst item = $input.first();\nconst raw = Buffer.from(item.binary.data.data, 'base64').toString('utf8');\nconst header = item.json.headers['openrent-signature'] || '';\nconst t = (header.match(/t=(\\d+)/) || [])[1];\nconst given = [...header.matchAll(/v1=([0-9a-f]+)/g)].map((m) => m[1]);\nconst expected = crypto.createHmac('sha256', $vars.OPENRENT_WEBHOOK_SECRET).update(`${t}.${raw}`).digest('hex');\nif (!t || Math.abs(Date.now() / 1000 - Number(t)) > 300 || !given.includes(expected)) throw new Error('Bad OpenRent signature');\nreturn [{ json: JSON.parse(raw) }];"
      },
      "name": "Check signature",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [220, 0]
    },
    {
      "parameters": {
        "conditions": {
          "conditions": [
            { "leftValue": "={{ $json.type }}", "rightValue": "order.status_changed", "operator": { "type": "string", "operation": "equals" } },
            { "leftValue": "={{ $json.data.object.status }}", "rightValue": "reserved", "operator": { "type": "string", "operation": "equals" } }
          ],
          "combinator": "and"
        }
      },
      "name": "Reserved?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2,
      "position": [440, 0]
    },
    {
      "parameters": {
        "select": "channel",
        "channelId": { "__rl": true, "mode": "name", "value": "#bookings" },
        "text": "=Booking #{{ $json.data.object.number }} is reserved from {{ $json.data.object.starts_at }} to {{ $json.data.object.ends_at }}"
      },
      "name": "Slack",
      "type": "n8n-nodes-base.slack",
      "typeVersion": 2.2,
      "position": [660, -100]
    },
    {
      "parameters": {
        "method": "PATCH",
        "url": "={{ $vars.OPENRENT_API_URL }}/orders/{{ $('Check signature').item.json.data.object.id }}",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\"tags\": {{ JSON.stringify([...($('Check signature').item.json.data.object.tags ?? []), 'notified']) }} }"
      },
      "name": "Tag the booking",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [880, -100],
      "credentials": { "httpHeaderAuth": { "name": "OpenRent API" } }
    }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "Check signature", "type": "main", "index": 0 }]] },
    "Check signature": { "main": [[{ "node": "Reserved?", "type": "main", "index": 0 }]] },
    "Reserved?": { "main": [[{ "node": "Slack", "type": "main", "index": 0 }], []] },
    "Slack": { "main": [[{ "node": "Tag the booking", "type": "main", "index": 0 }]] }
  }
}
```

With **Raw body** on, the Webhook node keeps the body as sent. The Code node reads it from the node's binary data, and only then parses the JSON.

## 4. Zapier

Zapier's **Webhooks by Zapier** trigger receives the events; **Code by Zapier** checks the signature.

1. Create a Zap with the trigger **Webhooks by Zapier → Catch Raw Hook**. "Raw" keeps the body and headers as sent, which the signature needs.
2. Copy the webhook URL into OpenRent as the endpoint URL, with the events you need, then choose **Send test** in OpenRent.
3. Add the step **Code by Zapier → Run JavaScript**. Map these input data fields from the trigger:
   - `raw`: **Raw Body**;
   - `signature`: **Headers Http Openrent Signature**;
   - `secret`: your signing secret.
4. Paste this code:

   ```js
   const crypto = require('crypto');
   const t = (inputData.signature.match(/t=(\d+)/) || [])[1];
   const given = [...inputData.signature.matchAll(/v1=([0-9a-f]+)/g)].map((m) => m[1]);
   const expected = crypto.createHmac('sha256', inputData.secret).update(`${t}.${inputData.raw}`).digest('hex');
   if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 300 || !given.includes(expected)) throw new Error('Bad OpenRent signature');
   const event = JSON.parse(inputData.raw);
   return { type: event.type, id: event.data.object.id, number: event.data.object.number, status: event.data.object.status, customer_id: event.data.object.customer_id ?? '' };
   ```

5. Add a **Filter**, e.g. `type` exactly matches `order.status_changed` and `status` exactly matches `returned`.
6. Add your action, e.g. **Google Sheets → Create Spreadsheet Row** with the fields from the code step.

To change something in OpenRent from a Zap, use **Webhooks by Zapier → Custom Request**:

- method `PATCH` (or `POST`);
- URL `https://rent.example.com/api/v1/orders/<id>`;
- header `Authorization: Bearer sk_live_…`;
- the JSON body the API expects.

The API reference is at `/docs` on your OpenRent address.

## Tips

- **Duplicates:** the same event can arrive twice, e.g. when your tool answered too slowly. Skip events whose `OpenRent-Event-Id` you have seen.
- **Order:** deliveries can arrive out of order. Compare `created_at`, or read the record from the API when the current state matters.
- **Keys:** give an automation's API key only the scopes it needs. Revoke it in **Settings → API keys** when the automation is retired.
- **Failures:** each delivery and the answer it got are listed under **Deliveries** on the endpoint. An endpoint that keeps failing is turned off, and the shop's staff get a notice.
