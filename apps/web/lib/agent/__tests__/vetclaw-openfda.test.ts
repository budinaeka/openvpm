import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  execFile: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.fetch);
vi.mock("node:child_process", () => ({
  execFile: mocks.execFile,
}));

const { topReactions } = await import("../vetclaw");

afterEach(() => {
  mocks.fetch.mockReset();
  mocks.execFile.mockReset();
});

describe("VetClaw openFDA client", () => {
  it("returns ranked reactions from the native fetch path", async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            { term: "VOMITING", count: 42 },
            { term: "LETHARGY", count: 21 },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    await expect(topReactions("DOG", "Carprofen")).resolves.toEqual({
      results: [
        { term: "VOMITING", count: 42 },
        { term: "LETHARGY", count: 21 },
      ],
    });

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it("falls back to the system curl transport when native fetch cannot connect", async () => {
    mocks.fetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    mocks.execFile.mockImplementationOnce((_file, _args, _options, callback) => {
      callback(
        null,
        JSON.stringify({
          results: [
            { term: "VOMITING", count: 7 },
            { term: "LETHARGY", count: 3 },
          ],
        }),
        ""
      );
    });

    await expect(topReactions("DOG")).resolves.toEqual({
      results: [
        { term: "VOMITING", count: 7 },
        { term: "LETHARGY", count: 3 },
      ],
    });

    expect(mocks.execFile).toHaveBeenCalledTimes(1);
    const [file, args] = mocks.execFile.mock.calls[0];
    expect(file).toBe("curl");
    expect(args).toContain("--ipv4");
  });
});
