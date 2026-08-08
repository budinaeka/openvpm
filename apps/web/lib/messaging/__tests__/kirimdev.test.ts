import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isKirimdevConfigured,
  sendWhatsAppMessage,
} from "../kirimdev";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Kirimdev WhatsApp messaging", () => {
  it("reports configuration readiness from API key and phone number id", () => {
    vi.stubEnv("KIRIMDEV_API_KEY", "kdv_test");
    vi.stubEnv("KIRIMDEV_PHONE_NUMBER_ID", "767393663133752");

    expect(isKirimdevConfigured()).toBe(true);
  });

  it("sends a Cloud API-compatible text payload and returns Kirimdev data.id", async () => {
    vi.stubEnv("KIRIMDEV_API_KEY", "kdv_test");
    vi.stubEnv("KIRIMDEV_PHONE_NUMBER_ID", "767393663133752");

    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify({
          data: {
            id: "msg_test_123",
            object: "message",
            status: "pending",
          },
          request_id: "req_test_123",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendWhatsAppMessage("6281384645564", "Halo Doc"))
      .resolves.toEqual({ success: true, messageId: "msg_test_123" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.kirimdev.com/v1/767393663133752/messages");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer kdv_test",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: "whatsapp",
      to: "+6281384645564",
      type: "text",
      text: { body: "Halo Doc" },
    });
  });

  it("surfaces provider errors without marking the message delivered", async () => {
    vi.stubEnv("KIRIMDEV_API_KEY", "kdv_test");
    vi.stubEnv("KIRIMDEV_PHONE_NUMBER_ID", "767393663133752");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "outside window" } }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    await expect(sendWhatsAppMessage("+6281384645564", "Halo"))
      .resolves.toMatchObject({
        success: false,
        error: expect.stringContaining("Kirimdev returned HTTP 400"),
      });
  });
});
