# Kirimdev standalone WhatsApp runbook

OpenVPM can use Kirimdev as a standalone WhatsApp Business Cloud API bridge. In this mode Kirimdev is not loaded as a Hermes gateway plugin; WhatsApp traffic is handled by Kirimdev/OpenVPM directly, while Hermes remains available on its other configured platforms.

## Current architecture

```text
WhatsApp customer chat
  ↕
Kirimdev Cloud API / webhook
  ↕
OpenVPM Inbox + reminders

Hermes gateway
  ↕
Telegram and other non-Kirimdev plugins only
```

Operational policy:

- Kirimdev runs as the WhatsApp transport for OpenVPM.
- The Hermes `kirimdev-platform` plugin should stay disabled when Kirimdev is in standalone mode.
- `KIRIMDEV_ENABLED_NUMBERS` in the Hermes config should be empty so no WhatsApp phone number is routed into Hermes by accident.
- OpenVPM receives inbound WhatsApp webhooks at `/api/webhooks/kirimdev` and stores messages in the Inbox.
- OpenVPM sends outbound WhatsApp messages with `POST /v1/{phone_number_id}/messages` through Kirimdev.

## Required configuration

OpenVPM environment variables:

```env
KIRIMDEV_API_KEY=...
KIRIMDEV_PHONE_NUMBER_ID=...
OPENVPM_KIRIMDEV_PHONE_NUMBER_ID=...
KIRIMDEV_WEBHOOK_SECRETS=...
```

Hermes standalone guardrails:

```yaml
plugins:
  disabled:
    - kirimdev-platform
KIRIMDEV_ENABLED_NUMBERS: ''
```

Kirimdev dashboard webhook URL:

```text
https://openvpm.budinaeka.my.id/api/webhooks/kirimdev
```

## Send a direct standalone test message

Use this when testing from a server shell without involving the Hermes plugin. Keep the leading `+` in the recipient phone number.

```bash
set -a
. /home/ubuntu/.hermes/.env
set +a

PHONE_NUMBER_ID="${KIRIMDEV_DEFAULT_PHONE_NUMBER_ID:-$KIRIMDEV_PHONE_NUMBER_ID}"
RECIPIENT="+628xxxxxxxxxx"
MESSAGE="Kirimdev standalone test message."

curl -sS -X POST "https://api.kirimdev.com/v1/${PHONE_NUMBER_ID}/messages" \
  -H "Authorization: Bearer ${KIRIMDEV_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$(python3 - <<PY
import json
print(json.dumps({
    "messaging_product": "whatsapp",
    "to": "${RECIPIENT}",
    "type": "text",
    "text": {"body": "${MESSAGE}"},
}))
PY
)" | python3 -m json.tool
```

A successful API acceptance looks like:

```json
{
  "data": {
    "object": "message",
    "to": "+628****xxxx",
    "type": "text",
    "status": "pending",
    "content": "Kirimdev standalone test message."
  },
  "request_id": "req_..."
}
```

`status: pending` means Kirimdev accepted the request; Meta/Kirimdev deliver the WhatsApp message asynchronously.

## What Kirimdev Cloud API can and cannot do

Supported:

- One-to-one WhatsApp messages with customers.
- Inbound customer messages through webhooks.
- Outbound free-form replies within the WhatsApp customer-service window.
- Approved template messages outside the customer-service window.
- OpenVPM Inbox and reminder workflows.

Not supported by the official Cloud API:

- Sending messages to WhatsApp groups.
- Reading or monitoring WhatsApp group chats.
- Joining groups or listing group members.

For group automation use a different channel, such as Telegram, or a non-official WhatsApp Web bridge with the corresponding reliability and policy risks.

## Verification checklist

1. Confirm Hermes does not load the Kirimdev plugin:

   ```bash
   hermes plugins list --plain --no-bundled | grep kirimdev
   ```

   Expected: `disabled` or `not enabled` for `kirimdev-platform`.

2. Confirm OpenVPM webhook is configured in the Kirimdev dashboard:

   ```text
   https://openvpm.budinaeka.my.id/api/webhooks/kirimdev
   ```

3. Send a direct API message and confirm the response has `status: pending`.

4. Confirm the recipient receives the WhatsApp message.

5. Confirm inbound customer replies appear in the OpenVPM Inbox.
